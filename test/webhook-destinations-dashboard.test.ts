import { expect, it } from 'vitest';
import { clerkRuntime } from './helpers/clerk-session';

it('saves, rotates and disables a destination through the authenticated dashboard', async () => {
  const host = 'api2.cursor.sh';
  const fixture = await clerkRuntime(undefined, { WEBHOOK_ROUTINE_HOST: host });
  try {
    const owner = await fixture.issue({ email: 'luccamordente@gmail.com' });
    const foreign = await fixture.issue({ email: 'other@example.test' });
    await fixture.db.prepare("UPDATE users SET clerk_user_id = 'user_lucca' WHERE id = ?").bind(owner.userId).run();
    const { cookie } = await fixture.session();
    const csrf = 'a'.repeat(43);
    const headers = { cookie: `${cookie}; __Host-wapilot_csrf=${csrf}`, origin: 'https://mcp.invalid', 'x-wapilot-csrf': csrf, 'content-type': 'application/json' };
    const endpoint = (id: string) => `/connections/api/connections/${id}/webhook-destinations`;
    const path = endpoint(owner.connections[0]);
    const payload = { label: 'Fixture', grantId: owner.grantId, conversationIds: ['120363000000001@g.us'], url: `https://${host}/automations/webhook/fixture`, key: 'synthetic-fixture-key' };
    const save = (input = payload, requestHeaders = headers) => fixture.fetch(path, { method: 'POST', headers: requestHeaders, body: JSON.stringify(input) });

    const anonymous = await fixture.fetch(path, { headers: { accept: 'text/html' } });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('content-type')).toContain('application/json');
    expect((await save(payload, { ...headers, 'x-wapilot-csrf': '' })).status).toBe(403);
    expect((await save(payload, { ...headers, origin: 'https://other.invalid' })).status).toBe(403);
    expect((await save({ ...payload, grantId: foreign.grantId })).status).toBe(404);
    expect((await fixture.fetch(endpoint(foreign.connections[0]), { headers })).status).toBe(404);

    const created = await save();
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const { destination } = await created.json() as { destination: { id: string; state: string } };
    expect(destination).toMatchObject({ label: payload.label, hostname: host, grantId: owner.grantId, conversationIds: payload.conversationIds, state: 'active' });
    const detail = path + '/' + destination.id;
    const rotated = await fixture.fetch(detail, { method: 'PATCH', headers, body: JSON.stringify({ key: 'synthetic-replacement-key' }) });
    expect(rotated.status).toBe(200);
    expect((await fixture.fetch(endpoint(owner.connections[1]) + '/' + destination.id, { method: 'DELETE', headers })).status).toBe(404);
    const disabled = await fixture.fetch(detail, { method: 'DELETE', headers });
    expect(disabled.status).toBe(200);
    const listed = await fixture.fetch(path, { headers });
    expect(listed.headers.get('cache-control')).toBe('no-store');
    const result = await listed.json();
    expect(result).toEqual({ destinations: [{ ...destination, state: 'disabled' }] });
    expect(JSON.stringify(result)).not.toMatch(/synthetic-fixture-key|synthetic-replacement-key|\/automations\/webhook\//);

    const readKey = (id: string) => fixture.db.prepare('SELECT encrypted_key FROM webhook_destinations WHERE id = ?').bind(id).first('encrypted_key');
    const savedForRevocation = await save();
    expect(savedForRevocation.status).toBe(201);
    const revokeId = (await savedForRevocation.json() as { destination: { id: string } }).destination.id;
    expect(await readKey(revokeId)).toEqual(expect.any(String));
    const revoked = await fixture.fetch('/connections/authorizations/' + owner.grantId + '/revoke', { method: 'POST', headers });
    expect(revoked.status).toBe(200);
    expect(await readKey(revokeId)).toBeNull();

    const nextGrant = await fixture.issue({ email: 'luccamordente@gmail.com' });
    const savedForDeactivation = await save({ ...payload, grantId: nextGrant.grantId });
    expect(savedForDeactivation.status).toBe(201);
    const deactivateId = (await savedForDeactivation.json() as { destination: { id: string } }).destination.id;
    expect(await readKey(deactivateId)).toEqual(expect.any(String));
    await fixture.deactivate(owner.userId);
    expect(await readKey(deactivateId)).toBeNull();
  } finally {
    await fixture.runtime.dispose();
  }
}, 20_000);
