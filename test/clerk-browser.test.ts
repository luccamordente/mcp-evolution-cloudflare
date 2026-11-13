import { afterAll, beforeAll, expect, it } from 'vitest';
import { clerkRuntime } from './helpers/clerk-session';
import { eventRuntime } from './helpers/mcp-events-runtime';

let fixture: Awaited<ReturnType<typeof clerkRuntime>>;
beforeAll(async () => {
  fixture = await clerkRuntime();
  await fixture.db.prepare("UPDATE users SET clerk_user_id = 'user_lucca' WHERE id = 'seed-lucca'").run();
});
afterAll(async () => { await fixture?.runtime.dispose(); });

it('uses the Clerk browser session to resolve the existing active D1 account', async () => {
  const { cookie } = await fixture.session();
  const response = await fixture.fetch('/connections/data', { headers: { cookie, accept: 'application/json' } });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ connections: [] });
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('returns HTML navigation to the embedded sign-in page and keeps APIs JSON', async () => {
  const page = await fixture.fetch('/connections?refresh=1', { redirect: 'manual', headers: { accept: 'text/html' } });
  expect(page.status).toBe(302);
  expect(page.headers.get('location')).toBe('/sign-in?returnTo=%2Fconnections%3Frefresh%3D1');
  const api = await fixture.fetch('/connections/data', { headers: { accept: 'application/json' } });
  expect(api.status).toBe(401);
  expect(api.headers.get('content-type')).toContain('application/json');
  expect(api.headers.get('cache-control')).toBe('no-store');
});

it('serves embedded Portuguese login and invitation pages with a safe return', async () => {
  const response = await fixture.fetch('/sign-in?returnTo=https://attacker.invalid/steal');
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('lang="pt-BR"');
  expect(html).toContain('Entre no WaPilot');
  expect(html).toContain('/auth.js');
  expect(html).toContain('@clerk/ui@1.42.5');
  expect(html).not.toContain('attacker.invalid');
  const invite = await fixture.fetch('/accept-invitation?__clerk_ticket=private-ticket');
  expect(invite.status).toBe(200);
  expect(invite.headers.get('referrer-policy')).toBe('no-referrer');
  expect(invite.headers.get('cache-control')).toBe('no-store');
  expect(await invite.text()).not.toContain('private-ticket');
});

it('requires the dashboard CSRF token and trusted origin for mutations and aliases', async () => {
  const { cookie } = await fixture.session();
  const page = await fixture.fetch('/connections', { headers: { cookie, accept: 'text/html' } });
  const csrfCookie = page.headers.getSetCookie().find(value => value.startsWith('__Host-wapilot_csrf='))?.split(';')[0];
  expect(csrfCookie).toMatch(/^__Host-wapilot_csrf=[A-Za-z0-9_-]{43}$/);
  const csrf = csrfCookie!.split('=')[1];
  for (const path of ['/api/connections/missing/default', '/connections/api/connections/missing/default', '/connections/authorizations/missing/revoke', '/connections/provision']) {
    const denied = await fixture.fetch(path, { method: 'POST', headers: { cookie: cookie + '; ' + csrfCookie, origin: 'https://attacker.invalid', 'x-wapilot-csrf': csrf } });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: 'Esta ação precisa ser iniciada no WaPilot.' });
  }
  const missing = await fixture.fetch('/api/connections/missing/default', { method: 'POST', headers: { cookie, origin: 'https://mcp.invalid' } });
  expect(missing.status).toBe(403);
  const malformed = await fixture.fetch('/api/connections/missing/default', { method: 'POST', headers: { cookie: cookie + '; ' + csrfCookie, origin: 'https://mcp.invalid', 'x-wapilot-csrf': 'é'.repeat(43) } });
  expect(malformed.status).toBe(403);
  const accepted = await fixture.fetch('/connections/api/connections/missing/default', { method: 'POST', headers: { cookie: cookie + '; ' + csrfCookie, origin: 'https://mcp.invalid', 'x-wapilot-csrf': csrf } });
  expect(accepted.status).toBe(404);
});

it('keeps consent explicit under the Clerk session and loads session renewal', async () => {
  const account = await fixture.issue({ email: 'luccamordente@gmail.com' });
  const { cookie } = await fixture.session();
  const verifier = 'z'.repeat(43), challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString('base64url');
  const query = new URLSearchParams({ client_id: account.clientId, redirect_uri: 'https://client.invalid/callback', response_type: 'code', scope: 'mcp:read', resource: 'https://mcp.invalid/mcp', code_challenge: challenge, code_challenge_method: 'S256', state: 'keep-this-state' });
  const login = await fixture.fetch('/authorize?' + query, { redirect: 'manual', headers: { accept: 'text/html' } });
  expect(login.status).toBe(302);
  expect(new URL(login.headers.get('location')!, 'https://mcp.invalid').searchParams.get('returnTo')).toBe('/authorize?' + query);
  const consent = await fixture.fetch('/authorize?' + query, { headers: { cookie, accept: 'text/html' } });
  expect(consent.status).toBe(200);
  const html = await consent.text();
  expect(html).toContain('/auth.js');
  expect(html).toContain('name="handle"');
  expect(html).toContain('Sair do navegador');
  expect(html).toContain('Permitir conexão');
  const handle = html.match(/name="handle" value="([^"]+)"/)![1];
  const binding = consent.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const denied = await fixture.fetch('/authorize', { method: 'POST', redirect: 'manual', headers: { cookie: cookie + '; ' + binding, origin: 'https://attacker.invalid', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ handle, decision: 'allow' }).toString() });
  expect(denied.status).toBe(403);
  const approve = () => fixture.fetch('/authorize', { method: 'POST', redirect: 'manual', headers: { cookie: cookie + '; ' + binding, origin: 'https://mcp.invalid', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ handle, decision: 'allow' }).toString() });
  const approved = await approve();
  expect(approved.status).toBe(302);
  expect(new URL(approved.headers.get('location')!).searchParams.get('state')).toBe('keep-this-state');
  const code = new URL(approved.headers.get('location')!).searchParams.get('code')!;
  const tokenResponse = await fixture.fetch('/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: account.clientId, redirect_uri: 'https://client.invalid/callback', code, code_verifier: verifier, resource: 'https://mcp.invalid/mcp' }).toString() });
  expect(tokenResponse.status).toBe(200);
  const token = await tokenResponse.json() as { access_token: string; scope: string };
  expect(token.scope).toBe('mcp:read mcp:write offline_access');
  expect((await fixture.rpc(token.access_token, 'tools/list')).response.status).toBe(200);
  expect((await fixture.rpc(account.accessToken, 'tools/list')).response.status).toBe(200);
  expect((await approve()).status).toBe(400);
});

it('never provisions or renews a QR from the legacy GET parameters', async () => {
  const { cookie } = await fixture.session();
  const response = await fixture.fetch('/connections?provision=1&run=1&renew=lucca', { headers: { cookie, accept: 'text/html' } });
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain('run=1');
});

it('rejects bearer compatibility, invalid sessions and credentials from the other auth surface', async () => {
  const { token, cookie } = await fixture.session();
  for (const headers of [{ authorization: 'Bearer ' + token }, { 'cf-access-jwt-assertion': token }, { cookie: (await fixture.session('user_lucca', { azp: 'https://attacker.invalid' })).cookie }, { cookie: (await fixture.session('user_lucca', { iss: 'https://other.clerk.accounts.dev' })).cookie }, { cookie: (await fixture.session('user_lucca', { exp: Math.floor(Date.now() / 1000) - 30 })).cookie }]) {
    const response = await fixture.fetch('/connections/data', { headers });
    expect(response.status).toBe(401);
  }
  const oauth = await fixture.issue({ email: 'luccamordente@gmail.com' });
  expect((await fixture.fetch('/connections/data', { headers: { authorization: 'Bearer ' + oauth.accessToken } })).status).toBe(401);
  for (const headers of [{ cookie }, { authorization: 'Bearer ' + token }, { 'cf-access-jwt-assertion': token }]) {
    const response = await fixture.fetch('/mcp', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('oauth-protected-resource/mcp');
  }
});

it('requires a deliberate D1 link and rejects a disabled account on every protected surface', async () => {
  const unlinked = await fixture.session('user_unlinked');
  const pending = await fixture.fetch('/connections', { headers: { cookie: unlinked.cookie, accept: 'text/html' } });
  expect(pending.status).toBe(403);
  expect(await pending.text()).toContain('Sua conta aguarda ativação');
  const { cookie } = await fixture.session();
  await fixture.db.prepare("UPDATE users SET status = 'disabled' WHERE id = 'seed-lucca'").run();
  try {
    for (const path of ['/connections', '/connections/data', '/connections/activity/foreign', '/api/connections', '/admin', '/admin/data', '/connections/authorizations', '/api/authorizations', '/authorize']) {
      const response = await fixture.fetch(path, { headers: { cookie, accept: 'application/json' } });
      expect(response.status, path).toBe(403);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  } finally { await fixture.db.prepare("UPDATE users SET status = 'active' WHERE id = 'seed-lucca'").run(); }
});

it('propagates the SDK handshake and preserves every response cookie', async () => {
  let directives: string[] = [];
  const handshake = await clerkRuntime(async request => {
    if (new URL(request.url).pathname === '/v1/clients/handshake_payload') return Response.json({ directives });
    throw new Error('Unexpected handshake action');
  });
  try {
    await handshake.db.prepare("UPDATE users SET clerk_user_id = 'user_lucca' WHERE id = 'seed-lucca'").run();
    const session = await handshake.session();
    const start = await handshake.fetch('/connections', { redirect: 'manual', headers: { cookie: '__session=' + session.token, accept: 'text/html' } });
    expect(start.status).toBe(307);
    expect(new URL(start.headers.get('location')!).pathname).toBe('/v1/client/handshake');
    expect(start.headers.get('cache-control')).toBe('no-store');
    directives = ['__session=' + session.token + '; Path=/; Secure', '__client_uat=1; Path=/; Secure', 'fixture_one=one; Path=/; Secure; Expires=Wed, 01 Jan 2031 00:00:00 GMT', 'fixture_two=two; Path=/; Secure'];
    const resolved = await handshake.fetch('/connections/data?__clerk_handshake_nonce=synthetic', { redirect: 'manual', headers: { accept: 'application/json' } });
    expect(resolved.status).toBe(200);
    expect(resolved.headers.getSetCookie()).toEqual(expect.arrayContaining(directives));
    expect(resolved.headers.getSetCookie()).toHaveLength(5);
    expect(await resolved.json()).toEqual({ connections: [] });
  } finally { await handshake.runtime.dispose(); }
});

it('never lets development handshake parameters redirect to an arbitrary origin', async () => {
  const development = await clerkRuntime(undefined, { CLERK_PUBLISHABLE_KEY: 'pk_test_' + Buffer.from('clerk.fixture.invalid$').toString('base64'), CLERK_SECRET_KEY: 'sk_test_synthetic' });
  try {
    const response = await development.fetch('/connections?__clerk_redirect_url=https%3A%2F%2Fattacker.invalid%2Fsteal&__clerk_ticket=private-ticket', { redirect: 'manual', headers: { accept: 'text/html' } });
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://clerk.fixture.invalid');
    expect(location.href).not.toContain('private-ticket');
    expect(location.href).not.toContain('attacker.invalid');
  } finally { await development.runtime.dispose(); }
});

it('reports authorization infrastructure failure without exposing diagnostics or changing access', async () => {
  const { cookie } = await fixture.session();
  const databaseFailure = await fixture.fetch('/connections/data', { headers: { cookie, 'x-fixture-db-failure': '1' } });
  expect(databaseFailure.status).toBe(503);
  expect(await databaseFailure.text()).not.toContain('do-not-return');
  const unavailable = await eventRuntime(async () => Response.json({ errors: [{ code: 'service_unavailable', message: 'private-token-do-not-return' }] }, { status: 503 }), '9999', { ENVIRONMENT: 'test', CLERK_PUBLISHABLE_KEY: 'pk_live_' + Buffer.from('clerk.fixture.invalid$').toString('base64'), CLERK_SECRET_KEY: 'sk_live_unavailable' });
  try {
    const response = await unavailable.fetch('/connections/data', { headers: { cookie } });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('do-not-return');
    expect(unavailable.logs.join(' ')).not.toContain('do-not-return');
  } finally { await unavailable.runtime.dispose(); }
  expect((await fixture.fetch('/connections/data', { headers: { cookie } })).status).toBe(200);
});
