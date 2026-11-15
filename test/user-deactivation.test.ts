import { expect, it } from 'vitest';
import { clerkRuntime } from './helpers/clerk-session';

function latestReport(fixture: Awaited<ReturnType<typeof clerkRuntime>>) {
  const reports = fixture.logs.flatMap(line => { try { const value = JSON.parse(line); return value.event === 'wapilot_user_deactivation' ? [value] : []; } catch { return []; } });
  return reports.at(-1);
}

it('disables D1 first, clears pending activation and leaves an unlinked identity explicitly unresolved', async () => {
  const fixture = await clerkRuntime();
  try {
    const account = await fixture.issue({ email: 'unlinked@example.test', legacy: '1' });
    expect((await fixture.rpc(account.accessToken, 'tools/list')).response.status).toBe(200);
    await fixture.deactivate(account.userId);
    expect(await fixture.db.prepare('SELECT status, invite_pending_at FROM users WHERE id = ?').bind(account.userId).first()).toEqual({ status: 'disabled', invite_pending_at: null });
    expect([401, 403]).toContain((await fixture.rpc(account.accessToken, 'tools/list')).response.status);
    expect(latestReport(fixture)).toMatchObject({ disabled: true, complete: false, sessionsRevoked: false });
    await fixture.db.prepare("INSERT INTO users (id,email,status,invite_pending_at) VALUES ('pending-user','pending@example.test','disabled','2026-11-12T00:00:00.000Z')").run();
    await fixture.deactivate('pending-user');
    expect(await fixture.db.prepare("SELECT status, invite_pending_at FROM users WHERE id = 'pending-user'").first()).toEqual({ status: 'disabled', invite_pending_at: null });
    expect(latestReport(fixture)).toMatchObject({ disabled: true, complete: false, errors: ['clerk_identity_unlinked'] });
  } finally { await fixture.runtime.dispose(); }
});

it('invalidates notification secrets and previews before any external revocation can fail', async () => {
  let delivered = 0;
  const fixture = await clerkRuntime(async request => {
    const input = await request.json() as { body: string };
    const message = JSON.parse(input.body);
    if (message.type !== 'verification') delivered++;
    return Response.json({ status: 202, body: JSON.stringify({ challenge: message.challenge }) });
  });
  try {
    const account = await fixture.issue({ email: 'notifications@example.test', legacy: '1' });
    const sub = await fixture.rpc(account.accessToken, 'events/subscribe', { name: 'message.received', arguments: { connectionId: account.connections[0] }, delivery: { mode: 'webhook', url: 'https://receiver.example.test/pending', secret: 'whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=' } });
    expect(sub.body.result.id).toBeTruthy();
    const hook = await fixture.webhook(account.connections[0]);
    const ingress = await fixture.fetch(hook.path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonapi: { version: '1.1' }, meta: { event: 'Message', instanceId: hook.instanceId }, data: { type: 'message', id: 'pending-preview', attributes: { at: Date.now(), encodingFormat: 'text/plain', body: { text: 'temporary private preview' } }, relationships: { author: { data: { type: 'chat', id: '5511' } } }, meta: { chat: 'chat-a', fromMe: false } } }) });
    expect(ingress.status).toBe(202);
    const ids = fixture.published.splice(0);
    expect(ids).toHaveLength(1);
    await fixture.fetch('/fixture/provider-failure?enabled=1');
    await fixture.deactivate(account.userId);
    expect(await fixture.db.prepare('SELECT state, encrypted_secret, encrypted_previous_secret FROM event_subscriptions WHERE id = ?').bind(sub.body.result.id).first()).toEqual({ state: 'revoked', encrypted_secret: null, encrypted_previous_secret: null });
    expect(await fixture.db.prepare('SELECT state, body FROM event_deliveries WHERE id = ?').bind(ids[0]).first()).toEqual({ state: 'cancelled', body: null });
    await fixture.queue(ids);
    expect(delivered).toBe(0);
    expect((await fixture.rpc(account.accessToken, 'tools/list')).response.status).toBe(403);
    expect(latestReport(fixture)).toMatchObject({ disabled: true, complete: false, errors: expect.arrayContaining(['provider_list']) });
  } finally { await fixture.runtime.dispose(); }
});

it('revokes every page of legacy grants and Clerk sessions while preserving other users and connections', async () => {
  let banned = false, banRequests = 0;
  let fixture: Awaited<ReturnType<typeof clerkRuntime>>;
  fixture = await clerkRuntime(async request => {
    expect(await fixture.db.prepare("SELECT status FROM users WHERE id = 'seed-lucca'").first()).toEqual({ status: 'disabled' });
    if (new URL(request.url).pathname === '/v1/users/user_lucca/ban' && request.method === 'POST') { banRequests++; banned = true; }
    return Response.json({ object: 'user', id: 'user_lucca', banned, email_addresses: [] });
  });
  try {
    const first = await fixture.issue({ email: 'luccamordente@gmail.com', legacy: '1' });
    const grants = [first];
    for (let i = 0; i < 100; i++) grants.push(await fixture.issue({ email: 'luccamordente@gmail.com', clientId: first.clientId, legacy: '1' }));
    const other = await fixture.issue({ email: 'other@example.test', legacy: '1' });
    await fixture.db.prepare("UPDATE users SET clerk_user_id = 'user_lucca' WHERE id = 'seed-lucca'").run();
    const before = (await fixture.db.prepare('SELECT id, user_id, is_default, encrypted_token FROM whatsapp_connections ORDER BY id').all()).results;
    await fixture.deactivate(first.userId);
    expect(latestReport(fixture)).toMatchObject({ disabled: true, grantsRevoked: 101, grantsRemaining: 0, sessionsRevoked: true, complete: true, errors: [] });
    expect(banRequests).toBe(1);
    for (const grant of [grants[0], grants.at(-1)!]) expect((await fixture.rpc(grant.accessToken, 'tools/list')).response.status).toBe(401);
    expect((await fixture.rpc(other.accessToken, 'tools/list')).response.status).toBe(200);
    expect((await fixture.db.prepare('SELECT id, user_id, is_default, encrypted_token FROM whatsapp_connections ORDER BY id').all()).results).toEqual(before);
    await fixture.deactivate(first.userId);
    expect(latestReport(fixture)).toMatchObject({ disabled: true, grantsRevoked: 0, grantsRemaining: 0, sessionsRevoked: true, complete: true, errors: [] });
    expect(banRequests).toBe(1);
  } finally { await fixture.runtime.dispose(); }
});

it('recovers partial Provider and Clerk failures without reopening D1 or repeating an uncertain ban', async () => {
  let banned = false, failBan = true, banRequests = 0;
  const fixture = await clerkRuntime(async request => {
    if (new URL(request.url).pathname.endsWith('/ban')) {
      banRequests++; banned = true;
      if (failBan) return Response.json({ errors: [{ code: 'unavailable', message: 'private-clerk-token-do-not-return' }] }, { status: 503 });
    }
    return Response.json({ object: 'user', id: 'user_lucca', banned, email_addresses: [] });
  });
  try {
    const first = await fixture.issue({ email: 'luccamordente@gmail.com', legacy: '1' });
    await fixture.issue({ email: 'luccamordente@gmail.com', clientId: first.clientId });
    await fixture.issue({ email: 'luccamordente@gmail.com', clientId: first.clientId });
    await fixture.db.prepare("UPDATE users SET clerk_user_id = 'user_lucca' WHERE id = 'seed-lucca'").run();
    await fixture.fetch('/fixture/revoke-failure?after=1');
    await fixture.deactivate(first.userId);
    expect(latestReport(fixture)).toMatchObject({ disabled: true, grantsRevoked: 1, grantsRemaining: 2, sessionsRevoked: false, complete: false, errors: expect.arrayContaining(['provider_revoke', 'provider_readback', 'clerk_sessions']) });
    expect(await fixture.db.prepare("SELECT status, invite_pending_at FROM users WHERE id = 'seed-lucca'").first()).toEqual({ status: 'disabled', invite_pending_at: null });
    expect([401, 403]).toContain((await fixture.rpc(first.accessToken, 'tools/list')).response.status);
    expect(fixture.logs.join(' ')).not.toContain('do-not-return');
    await fixture.fetch('/fixture/revoke-failure');
    failBan = false;
    await fixture.deactivate(first.userId);
    expect(latestReport(fixture)).toMatchObject({ disabled: true, grantsRevoked: 2, grantsRemaining: 0, sessionsRevoked: true, complete: true, errors: [] });
    expect(banRequests).toBe(1);
  } finally { await fixture.runtime.dispose(); }
});

it('stops repeated grant cursors and reports unresolved revocation without reopening the account', async () => {
  const fixture = await clerkRuntime();
  try {
    const account = await fixture.issue();
    await fixture.fetch('/fixture/cursor-cycle?enabled=1');
    await fixture.deactivate(account.userId);
    expect(await (await fixture.fetch('/fixture/cursor-cycle')).json()).toEqual({ reads: 2 });
    expect(latestReport(fixture)).toMatchObject({ disabled: true, grantsRemaining: null, complete: false, errors: expect.arrayContaining(['provider_list']) });
    expect((await fixture.rpc(account.accessToken, 'tools/list')).response.status).toBe(403);
  } finally { await fixture.runtime.dispose(); }
});
