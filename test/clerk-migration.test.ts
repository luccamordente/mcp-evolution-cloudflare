import { expect, it } from 'vitest';
import { clerkRuntime } from './helpers/clerk-session';

it('lists and revokes legacy grants through Clerk without changing connection ownership or inventory', async () => {
  let statusReads = 0;
  const fixture = await clerkRuntime(async request => {
    if (new URL(request.url).pathname === '/instance/status') { statusReads++; return Response.json({ jsonapi: { version: '1.1' }, data: { type: 'connection', id: 'synthetic', attributes: { connected: false, loggedIn: false } } }); }
    throw new Error('Unexpected external action');
  });
  try {
    const legacy = await fixture.issue({ email: 'luccamordente@gmail.com', legacy: '1' });
    const current = await fixture.issue({ email: 'luccamordente@gmail.com' });
    const other = await fixture.issue({ email: 'heitorsalazar@gmail.com', legacy: '1' });
    await fixture.db.prepare("UPDATE users SET clerk_user_id = 'user_lucca' WHERE id = 'seed-lucca'").run();
    await fixture.db.prepare("UPDATE users SET clerk_user_id = 'user_heitor' WHERE id = 'seed-heitor'").run();
    const before = (await fixture.db.prepare('SELECT id, user_id, instance_id, is_default, encrypted_token FROM whatsapp_connections ORDER BY id').all()).results;
    const a = await fixture.session(), b = await fixture.session('user_heitor');
    const first = await fixture.fetch('/connections/authorizations?limit=1', { headers: { cookie: a.cookie } });
    const csrf = first.headers.getSetCookie().find(value => value.startsWith('__Host-wapilot_csrf='))!.split(';')[0];
    const page = await first.json() as { authorizations: Array<{ id: string }>; nextCursor: string };
    expect(page.authorizations).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const second = await fixture.fetch('/api/authorizations?limit=1&cursor=' + encodeURIComponent(page.nextCursor), { headers: { cookie: a.cookie } });
    const next = await second.json() as { authorizations: Array<{ id: string }> };
    expect([...page.authorizations, ...next.authorizations].map(item => item.id).sort()).toEqual([legacy.grantId, current.grantId].sort());
    const bGrants = await (await fixture.fetch('/connections/authorizations', { headers: { cookie: b.cookie } })).json() as { authorizations: Array<{ id: string }> };
    expect(bGrants.authorizations.map(item => item.id)).toEqual([other.grantId]);
    const headers = { origin: 'https://mcp.invalid', 'x-wapilot-csrf': csrf.split('=')[1] };
    await fixture.fetch('/connections/authorizations/' + legacy.grantId, { method: 'DELETE', headers: { ...headers, cookie: b.cookie + '; ' + csrf } });
    expect((await fixture.rpc(legacy.accessToken, 'tools/list')).response.status).toBe(200);
    const reads = statusReads;
    const foreign = await fixture.rpc(other.accessToken, 'tools/call', { name: 'connection_status', arguments: { connectionId: legacy.connections[0] } }, { 'Mcp-Name': 'connection_status' });
    expect(foreign.body.result.isError).toBe(true);
    expect(statusReads).toBe(reads);
    const readOnly = await fixture.rpc(legacy.accessToken, 'tools/call', { name: 'send_message', arguments: { message: { kind: 'text', to: '5511999999999', text: 'must not send' } } }, { 'Mcp-Name': 'send_message' });
    expect(readOnly.response.status).toBe(403);
    const revoke = await fixture.fetch('/connections/authorizations/' + legacy.grantId + '/revoke', { method: 'POST', headers: { ...headers, cookie: a.cookie + '; ' + csrf } });
    expect(revoke.status).toBe(200);
    const remaining = await (await fixture.fetch('/connections/authorizations', { headers: { cookie: a.cookie } })).json() as { authorizations: Array<{ id: string }> };
    expect(remaining.authorizations.map(item => item.id)).toEqual([current.grantId]);
    expect((await fixture.rpc(legacy.accessToken, 'tools/list')).response.status).toBe(401);
    expect((await fixture.rpc(current.accessToken, 'tools/list')).response.status).toBe(200);
    expect((await fixture.rpc(other.accessToken, 'tools/list')).response.status).toBe(200);
    expect((await fixture.db.prepare('SELECT id, user_id, instance_id, is_default, encrypted_token FROM whatsapp_connections ORDER BY id').all()).results).toEqual(before);
  } finally { await fixture.runtime.dispose(); }
});
