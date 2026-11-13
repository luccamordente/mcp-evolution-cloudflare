import { afterAll, beforeAll, expect, it } from 'vitest';
import { eventRuntime } from './helpers/mcp-events-runtime';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { readFile } from 'node:fs/promises';
import { unstable_splitSqlQuery } from 'wrangler';

let fixture: Awaited<ReturnType<typeof eventRuntime>>;
beforeAll(async () => { fixture = await eventRuntime(async () => { throw new Error('Unauthorized external action'); }); });
afterAll(async () => { await fixture?.runtime.dispose(); });

it('blocks an already issued MCP token as soon as the D1 account is disabled', async () => {
  const account = await fixture.issue({ email: 'disabled@example.test', scope: 'mcp:read mcp:write', legacy: '1' });
  expect((await fixture.rpc(account.accessToken, 'tools/list')).response.status).toBe(200);
  await fixture.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind(account.userId).run();
  for (const [method, params] of [['tools/list', {}], ['tools/call', { name: 'list_contacts', arguments: {} }], ['tools/call', { name: 'send_text', arguments: { to: '5511999999999', text: 'Must not send' } }]] as const) {
    const result = await fixture.rpc(account.accessToken, method, params);
    expect(result.response.status).toBe(403);
    expect(JSON.stringify(result.body)).not.toContain(account.accessToken);
  }
});

it('rejects an old refresh token after disabling its account and revokes the grant', async () => {
  const account = await fixture.issue({ email: 'refresh-disabled@example.test' });
  await fixture.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind(account.userId).run();
  const response = await fixture.fetch('/oauth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: account.refreshToken, client_id: account.clientId, resource: 'https://mcp.invalid/mcp' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
  expect((await fixture.rpc(account.accessToken, 'tools/list')).response.status).toBe(401);
});

it('does not recreate a missing D1 account from a legacy access token', async () => {
  const account = await fixture.issue({ email: 'removed@example.test' });
  await fixture.db.prepare('DELETE FROM users WHERE id = ?').bind(account.userId).run();
  expect((await fixture.rpc(account.accessToken, 'tools/list')).response.status).toBe(403);
  expect(await fixture.db.prepare('SELECT id FROM users WHERE email = ?').bind('removed@example.test').first()).toBeNull();
});

it('refuses code exchange after the account is disabled following consent', async () => {
  const code = await (await fixture.fetch('/fixture/issue?email=code-disabled@example.test&codeOnly=1')).json() as { code: string; clientId: string; verifier: string; redirectUri: string; userId: string };
  await fixture.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind(code.userId).run();
  const response = await fixture.fetch('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: code.code, client_id: code.clientId, code_verifier: code.verifier, redirect_uri: code.redirectUri, resource: 'https://mcp.invalid/mcp' }).toString() });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
});

it('fails temporarily without destroying an active grant when D1 is unavailable', async () => {
  const account = await fixture.issue({ email: 'database-unavailable@example.test' });
  const denied = await fixture.rpc(account.accessToken, 'tools/list', {}, { 'x-fixture-db-failure': '1' });
  expect(denied.response.status).toBe(503);
  const response = await fixture.fetch('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-fixture-db-failure': '1' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: account.refreshToken, client_id: account.clientId, resource: 'https://mcp.invalid/mcp' }).toString() });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: 'temporarily_unavailable' });
  expect((await fixture.rpc(account.accessToken, 'tools/list')).response.status).toBe(200);
  const retried = await fixture.fetch('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: account.refreshToken, client_id: account.clientId, resource: 'https://mcp.invalid/mcp' }).toString() });
  expect(retried.status).toBe(200);
  expect(await retried.json()).toMatchObject({ scope: 'mcp:read' });
  expect(fixture.logs.join(' ')).not.toContain('do-not-return');
});

it('requires an existing active D1 account on the Access browser and consent surfaces', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'fixture' };
  const browser = await eventRuntime(async request => {
    if (new URL(request.url).hostname === 'access.invalid') return Response.json({ keys: [jwk] });
    throw new Error('Unauthorized external action');
  }, '9999', { ENVIRONMENT: 'test', ACCESS_ISSUER: 'https://access.invalid', ACCESS_AUDIENCE: 'browser', ACCESS_JWKS_URL: 'https://access.invalid/jwks', ALLOWED_EMAILS: 'luccamordente@gmail.com,missing@example.test' });
  try {
    const token = async (email: string) => new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).setSubject('legacy-access-sub').setIssuer('https://access.invalid').setAudience('browser').setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const active = await token('luccamordente@gmail.com');
    expect((await browser.fetch('/connections', { headers: { 'cf-access-jwt-assertion': active } })).status).toBe(200);
    await browser.db.prepare("UPDATE users SET status = 'disabled' WHERE id = 'seed-lucca'").run();
    for (const path of ['/connections', '/connections/data', '/api/connections', '/admin', '/admin/data', '/authorize']) {
      expect((await browser.fetch(path, { headers: { 'cf-access-jwt-assertion': active } })).status).toBe(403);
    }
    expect((await browser.fetch('/connections', { headers: { 'cf-access-jwt-assertion': await token('missing@example.test') } })).status).toBe(403);
    expect(await browser.db.prepare("SELECT id FROM users WHERE email = 'missing@example.test'").first()).toBeNull();
  } finally { await browser.runtime.dispose(); }
});

it('adds unique Clerk links without rewriting existing identities, connection defaults or credentials', async () => {
  const migration = await readFile('migrations/0010_clerk_identity.sql', 'utf8');
  const legacy = await eventRuntime(async () => { throw new Error('Unauthorized external action'); }, '0009_drop_legacy_message_storage.sql');
  try {
    const account = await legacy.issue({ email: 'legacy@example.test' });
    const before = await legacy.db.prepare('SELECT * FROM whatsapp_connections WHERE user_id = ? ORDER BY id').bind(account.userId).all();
    await legacy.db.batch(unstable_splitSqlQuery(migration).map(sql => legacy.db.prepare(sql)));
    await legacy.db.prepare("UPDATE users SET clerk_user_id = 'user_linked' WHERE id = ?").bind(account.userId).run();
    expect((await legacy.db.prepare('SELECT * FROM whatsapp_connections WHERE user_id = ? ORDER BY id').bind(account.userId).all()).results).toEqual(before.results);
    const listed = await legacy.rpc(account.accessToken, 'tools/call', { name: 'list_connections', arguments: {} }, { 'Mcp-Name': 'list_connections' });
    expect(listed.response.status).toBe(200);
    expect(listed.body.result.isError).not.toBe(true);
    expect(listed.body.result.structuredContent.data.map((connection: { id: string }) => connection.id).sort()).toEqual([...account.connections].sort());
    await expect(legacy.db.prepare("UPDATE users SET clerk_user_id = 'user_linked' WHERE id = 'seed-heitor'").run()).rejects.toThrow(/UNIQUE/);
    expect((await legacy.db.prepare('SELECT id, status, invite_pending_at FROM users WHERE id = ?').bind(account.userId).first())).toMatchObject({ id: account.userId, status: 'active', invite_pending_at: null });
  } finally { await legacy.runtime.dispose(); }
});

it('rejects legacy grant props whose canonical email does not match the Provider subject', async () => {
  const account = await fixture.issue({ email: 'mismatched@example.test', providerUserId: 'another-subject', legacy: '1' });
  expect((await fixture.rpc(account.accessToken, 'tools/list')).response.status).toBe(403);
  const response = await fixture.fetch('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: account.refreshToken, client_id: account.clientId, resource: 'https://mcp.invalid/mcp' }).toString() });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: 'invalid_grant' });
});
