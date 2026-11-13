import { afterAll, beforeAll, expect, it } from 'vitest';
import { clerkRuntime } from './helpers/clerk-session';

let fixture: Awaited<ReturnType<typeof clerkRuntime>>;
const invitations = new Map<string, { object: string; id: string; email_address: string; status: string; url: string }>();
const users = new Map<string, Record<string, unknown>>();
const requests: { method: string; path: string; body?: Record<string, unknown> }[] = [];
const reads: { path: string; query: URLSearchParams }[] = [];
let intercept: ((request: Request) => Promise<Response | undefined>) | undefined;
let headers: Record<string, string>;

beforeAll(async () => {
  fixture = await clerkRuntime(async request => {
    const url = new URL(request.url);
    if (request.method === 'GET') reads.push({ path: url.pathname, query: url.searchParams });
    else requests.push({ method: request.method, path: url.pathname, body: await request.clone().json() as Record<string, unknown> });
    const intercepted = await intercept?.(request);
    if (intercepted) return intercepted;
    if (url.pathname === '/v1/users' || url.pathname === '/v1/users/count') {
      const data = [...users.values()].filter(user => (user.email_addresses as { email_address: string }[]).some(address => address.email_address === url.searchParams.get('email_address')));
      return Response.json(url.pathname.endsWith('/count') ? { object: 'total_count', total_count: data.length } : data);
    }
    if (url.pathname.startsWith('/v1/users/')) return users.has(url.pathname.split('/').at(-1)!) ? Response.json(users.get(url.pathname.split('/').at(-1)!)) : Response.json({ errors: [{ code: 'resource_not_found', message: 'private user data' }] }, { status: 404 });
    if (url.pathname === '/v1/invitations' && request.method === 'GET') {
      const data = [...invitations.values()].filter(invite => invite.email_address.includes(url.searchParams.get('query') ?? '') && invite.status === url.searchParams.get('status'));
      return Response.json({ data, total_count: data.length });
    }
    if (url.pathname === '/v1/invitations' && request.method === 'POST') {
      const body = await request.json() as Record<string, unknown>;
      const email = String(body.email_address);
      const owner = await fixture.db.prepare('SELECT id, status, invite_pending_at, clerk_user_id FROM users WHERE email = ?').bind(email).first();
      expect(owner).toMatchObject({ status: 'disabled', invite_pending_at: expect.any(String), clerk_user_id: null });
      const invite = { object: 'invitation', id: 'inv_fixture', email_address: email, status: 'pending', url: 'https://private.invalid/?__clerk_ticket=do-not-return' };
      invitations.set(email, invite);
      return Response.json(invite);
    }
    throw new Error('Unexpected external action');
  });
  await fixture.db.prepare("UPDATE users SET clerk_user_id = 'user_lucca' WHERE id = 'seed-lucca'").run();
  const { cookie } = await fixture.session();
  const page = await fixture.fetch('/admin', { headers: { cookie, accept: 'text/html' } });
  const csrfCookie = page.headers.getSetCookie().find(value => value.startsWith('__Host-wapilot_csrf='))!.split(';')[0];
  headers = { cookie: cookie + '; ' + csrfCookie, origin: 'https://mcp.invalid', 'x-wapilot-csrf': csrfCookie.split('=')[1], 'content-type': 'application/json' };
});

it('authenticates the browser, active D1 administrator and CSRF before reserving or calling the invitation API', async () => {
  await fixture.db.prepare("INSERT INTO users (id, email, status, clerk_user_id) VALUES ('regular', 'regular@example.test', 'active', 'user_regular')").run();
  const nonAdmin = await fixture.session('user_regular');
  const bearer = await fixture.session();
  const before = requests.length;
  for (const [requestHeaders, status] of [[{}, 401], [{ authorization: 'Bearer ' + bearer.token }, 401], [{ ...headers, origin: 'https://attacker.invalid' }, 403], [{ ...headers, 'x-wapilot-csrf': '' }, 403], [{ ...headers, cookie: nonAdmin.cookie + '; __Host-wapilot_csrf=' + headers['x-wapilot-csrf'] }, 403]] as [Record<string, string>, number][]) {
    expect((await invite('unauthorized@example.test', requestHeaders)).status).toBe(status);
    expect((await fixture.fetch('/admin/invitations/regular/activate', { method: 'POST', headers: requestHeaders, body: JSON.stringify({ clerkUserId: 'user_regular' }) })).status).toBe(status);
  }
  expect(requests.length).toBe(before);
  expect(await fixture.db.prepare("SELECT id FROM users WHERE email = 'unauthorized@example.test'").first()).toBeNull();
});

it('gives Heitor the same invitation permission and rejects invalid input without reserving an account', async () => {
  await fixture.db.prepare("UPDATE users SET clerk_user_id = 'user_heitor' WHERE id = 'seed-heitor'").run();
  const heitor = await fixture.session('user_heitor');
  expect((await invite('heitor-guest@example.test', { ...headers, cookie: heitor.cookie + '; __Host-wapilot_csrf=' + headers['x-wapilot-csrf'] })).status).toBe(201);
  for (const body of [{ email: 'invalid' }, { email: 'invalid@example.test', redirectUrl: 'https://attacker.invalid' }, { email: 12 }, null]) {
    const response = await fixture.fetch('/admin/invitations', { method: 'POST', headers, body: JSON.stringify(body) });
    expect(response.status).toBe(400);
  }
});

it('keeps active and previously disabled accounts unchanged and never resends their invitations', async () => {
  await fixture.db.prepare("INSERT INTO users (id, email, status) VALUES ('disabled', 'previously-disabled@example.test', 'disabled')").run();
  const before = requests.length;
  for (const email of ['luccamordente@gmail.com', 'previously-disabled@example.test']) expect((await invite(email)).status).toBe(409);
  expect(await fixture.db.prepare("SELECT status, invite_pending_at, clerk_user_id FROM users WHERE id = 'disabled'").first()).toEqual({ status: 'disabled', invite_pending_at: null, clerk_user_id: null });
  expect(requests.length).toBe(before);
});
afterAll(async () => { await fixture?.runtime.dispose(); });

function invite(email: string, requestHeaders = headers) {
  return fixture.fetch('/admin/invitations', { method: 'POST', headers: requestHeaders, body: JSON.stringify({ email }) });
}

function clerkUser(id: string, email: string): Record<string, unknown> {
  return { object: 'user', id, banned: false, primary_email_address_id: 'email_primary', email_addresses: [{ id: 'email_primary', object: 'email_address', email_address: email, verification: { status: 'verified' }, linked_to: [] }] };
}

it('reserves a disabled account before inviting to the canonical embedded page and never returns the ticket', async () => {
  const response = await invite('  Guest@Example.test  ');
  expect(response.status).toBe(201);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  expect(body).toEqual({ userId: expect.any(String), state: 'pending' });
  expect(requests.at(-1)?.body).toEqual({ email_address: 'guest@example.test', redirect_url: 'https://mcp.invalid/accept-invitation', ignore_existing: false });
  expect(JSON.stringify(body)).not.toMatch(/do-not-return|clerk_ticket|private.invalid/);
  const session = await fixture.session('user_guest');
  expect((await fixture.fetch('/connections/data', { headers: { cookie: session.cookie } })).status).toBe(403);
});

it('reuses a confirmed pending invitation without sending another email', async () => {
  const first = await invite('duplicate@example.test');
  expect(first.status).toBe(201);
  const before = requests.length;
  const repeated = await invite('duplicate@example.test');
  expect(repeated.status).toBe(200);
  expect(await repeated.json()).toEqual(await first.json());
  expect(requests.length).toBe(before);
});

it('activates only after a verified primary email read-back and preserves the local identity', async () => {
  const invited = await (await invite('activation@example.test')).json() as { userId: string };
  users.set('user_activation', clerkUser('user_activation', 'activation@example.test'));
  const cookie = (await fixture.session('user_activation')).cookie;
  expect((await fixture.fetch('/connections/data', { headers: { cookie } })).status).toBe(403);
  const activate = () => fixture.fetch('/admin/invitations/' + invited.userId + '/activate', { method: 'POST', headers, body: JSON.stringify({ clerkUserId: 'user_activation' }) });
  const response = await activate();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ userId: invited.userId, state: 'active' });
  expect((await fixture.fetch('/connections/data', { headers: { cookie } })).status).toBe(200);
  expect((await activate()).status).toBe(200);
  expect(await fixture.db.prepare('SELECT id, status, invite_pending_at, clerk_user_id FROM users WHERE id = ?').bind(invited.userId).first()).toEqual({ id: invited.userId, status: 'active', invite_pending_at: null, clerk_user_id: 'user_activation' });
});

it.each(['wrong-id', 'unverified', 'wrong-primary', 'banned', 'missing-banned', 'missing-primary', 'deleted', 'taken', 'not-found'] as const)('does not activate an incompatible %s Clerk identity', async reason => {
  const email = reason + '@example.test';
  const invited = await (await invite(email)).json() as { userId: string };
  const id = 'user_' + reason.replaceAll('-', '');
  const user = clerkUser(id, email);
  if (reason === 'wrong-id') user.id = 'user_someoneelse';
  if (reason === 'unverified') ((user.email_addresses as Record<string, unknown>[])[0]).verification = { status: 'unverified' };
  if (reason === 'wrong-primary') { user.primary_email_address_id = 'other'; (user.email_addresses as unknown[]).push({ id: 'other', object: 'email_address', email_address: 'another@example.test', verification: { status: 'verified' }, linked_to: [] }); }
  if (reason === 'banned') user.banned = true;
  if (reason === 'missing-banned') delete user.banned;
  if (reason === 'missing-primary') delete user.primary_email_address_id;
  if (reason === 'deleted') user.deleted = true;
  if (reason === 'taken') await fixture.db.prepare("INSERT INTO users (id, email, status, clerk_user_id) VALUES ('taken-clerk-id', 'another-owner@example.test', 'active', ?)").bind(id).run();
  if (reason !== 'not-found') users.set(id, user);
  const response = await fixture.fetch('/admin/invitations/' + invited.userId + '/activate', { method: 'POST', headers, body: JSON.stringify({ clerkUserId: id }) });
  expect(response.status).toBe(409);
  expect(await fixture.db.prepare('SELECT status, clerk_user_id FROM users WHERE id = ?').bind(invited.userId).first()).toEqual({ status: 'disabled', clerk_user_id: null });
});

it('reserves one account and sends at most once under concurrent invitation requests', async () => {
  const before = requests.length;
  const responses = await Promise.all(Array.from({ length: 6 }, () => invite('concurrent@example.test')));
  expect(responses.filter(response => response.status === 201)).toHaveLength(1);
  expect(responses.every(response => [200, 201, 503].includes(response.status))).toBe(true);
  expect(requests.length - before).toBe(1);
  expect((await fixture.db.prepare("SELECT id FROM users WHERE email = 'concurrent@example.test'").all()).results).toHaveLength(1);
  expect((await invite('concurrent@example.test')).status).toBe(200);
});

it.each(['before', 'after'] as const)('reconciles a failure %s the provider stored an invitation without repeating its POST', async when => {
  const email = 'failure-' + when + '@example.test';
  const before = requests.length;
  intercept = async request => {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/v1/invitations') return;
    if (when === 'after') invitations.set(email, { object: 'invitation', id: 'inv_unknown', email_address: email, status: 'pending', url: 'https://private.invalid/do-not-return' });
    return Response.json({ errors: [{ code: 'internal_error', message: 'private token=do-not-return' }] }, { status: 503 });
  };
  try { expect((await invite(email)).status).toBe(503); }
  finally { intercept = undefined; }
  const response = await invite(email);
  expect(response.status).toBe(when === 'after' ? 200 : 503);
  expect(requests.length - before).toBe(1);
  expect(await fixture.db.prepare('SELECT status, clerk_user_id FROM users WHERE email = ?').bind(email).first()).toEqual({ status: 'disabled', clerk_user_id: null });
  expect(fixture.logs.join(' ')).not.toContain('do-not-return');
});

it.each(['revoked', 'expired'] as const)('requires explicit administrative reconciliation for a %s invitation', async status => {
  const email = status + '@example.test';
  invitations.set(email, { object: 'invitation', id: 'inv_' + status, email_address: email, status, url: 'https://private.invalid/do-not-return' });
  const before = requests.length;
  expect((await invite(email)).status).toBe(409);
  expect(requests.length).toBe(before);
  expect(await fixture.db.prepare('SELECT status, clerk_user_id FROM users WHERE email = ?').bind(email).first()).toEqual({ status: 'disabled', clerk_user_id: null });
});

it('finds an exact invitation on a later page instead of treating a partial email match as absence', async () => {
  const email = 'paginated@example.test';
  const before = requests.length;
  intercept = async request => {
    const url = new URL(request.url);
    if (url.pathname !== '/v1/invitations' || url.searchParams.get('query') !== email || url.searchParams.get('status') !== 'pending') return;
    const offset = Number(url.searchParams.get('offset'));
    const data = offset === 0 ? Array.from({ length: 100 }, (_, index) => ({ object: 'invitation', id: 'inv_prefix' + index, email_address: 'prefix' + index + email, status: 'pending' })) : [{ object: 'invitation', id: 'inv_exact', email_address: email.toUpperCase(), status: 'pending' }];
    return Response.json({ data, total_count: 101 });
  };
  try {
    const response = await invite(email);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: 'pending' });
    expect(reads.some(read => read.path === '/v1/invitations' && read.query.get('query') === email && read.query.get('offset') === '100')).toBe(true);
    expect(requests.length).toBe(before);
  } finally { intercept = undefined; }
});

it('finds an existing Clerk user on a later page and directs the pending account to activation', async () => {
  const email = 'existing-user@example.test';
  const before = requests.length;
  intercept = async request => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/v1/users') || url.searchParams.get('email_address') !== email) return;
    if (url.pathname.endsWith('/count')) return Response.json({ object: 'total_count', total_count: 101 });
    return Response.json(Number(url.searchParams.get('offset')) === 0 ? Array.from({ length: 100 }, (_, index) => clerkUser('user_prefix' + index, 'prefix' + index + email)) : [clerkUser('user_existing', email)]);
  };
  try {
    const response = await invite(email);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: 'awaiting_activation' });
    expect(reads.some(read => read.path === '/v1/users' && read.query.get('email_address') === email && read.query.get('offset') === '100')).toBe(true);
    expect(requests.length).toBe(before);
  } finally { intercept = undefined; }
});

it.each(['pending', 'active'] as const)('lets cancellation win over a %s activation waiting for verified account read-back', async state => {
  const email = 'cancel-race-' + state + '@example.test', id = 'user_cancelrace' + state;
  const invited = await (await invite(email)).json() as { userId: string };
  users.set(id, clerkUser(id, email));
  if (state === 'active') expect((await fixture.fetch('/admin/invitations/' + invited.userId + '/activate', { method: 'POST', headers, body: JSON.stringify({ clerkUserId: id }) })).status).toBe(200);
  let signal!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { signal = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  intercept = async request => { if (new URL(request.url).pathname === '/v1/users/' + id) { signal(); await gate; } return undefined; };
  try {
    const activating = fixture.fetch('/admin/invitations/' + invited.userId + '/activate', { method: 'POST', headers, body: JSON.stringify({ clerkUserId: id }) });
    await reached;
    await fixture.db.prepare("UPDATE users SET status = 'disabled', invite_pending_at = NULL WHERE id = ?").bind(invited.userId).run();
    release();
    expect((await activating).status).toBe(409);
    expect(await fixture.db.prepare('SELECT status, invite_pending_at, clerk_user_id FROM users WHERE id = ?').bind(invited.userId).first()).toEqual({ status: 'disabled', invite_pending_at: null, clerk_user_id: state === 'active' ? id : null });
    expect((await invite(email)).status).toBe(409);
  } finally { release(); intercept = undefined; }
});

it.each([[503, 503], [403, 502]] as const)('keeps the account disabled when provider read-back returns %s', async (upstreamStatus, expectedStatus) => {
  const email = 'read-failure-' + upstreamStatus + '@example.test';
  const before = requests.length;
  intercept = async request => new URL(request.url).pathname === '/v1/invitations' ? Response.json({ errors: [{ code: 'read_failure', message: 'private token=do-not-return' }] }, { status: upstreamStatus }) : undefined;
  try {
    const response = await invite(email);
    expect(response.status).toBe(expectedStatus);
    expect(JSON.stringify(await response.json())).not.toContain('do-not-return');
    expect(requests.length).toBe(before);
    expect(await fixture.db.prepare('SELECT status, clerk_user_id FROM users WHERE email = ?').bind(email).first()).toEqual({ status: 'disabled', clerk_user_id: null });
  } finally { intercept = undefined; }
});

it('keeps D1 failures unavailable and sanitized without sending or activating', async () => {
  const before = requests.length;
  await fixture.db.prepare("CREATE TRIGGER fail_invite_reservation BEFORE INSERT ON users WHEN NEW.email = 'reserve-error@example.test' BEGIN SELECT RAISE(ABORT, 'private token=do-not-return'); END").run();
  const reserved = await invite('reserve-error@example.test');
  expect(reserved.status).toBe(503);
  expect(JSON.stringify(await reserved.json())).not.toContain('do-not-return');
  expect(requests.length).toBe(before);
  const email = 'activate-db-error@example.test', id = 'user_dberror';
  const invited = await (await invite(email)).json() as { userId: string };
  users.set(id, clerkUser(id, email));
  await fixture.db.prepare("CREATE TRIGGER fail_invite_activation BEFORE UPDATE OF clerk_user_id ON users WHEN NEW.email = 'activate-db-error@example.test' BEGIN SELECT RAISE(ABORT, 'private SQL token=do-not-return'); END").run();
  const response = await fixture.fetch('/admin/invitations/' + invited.userId + '/activate', { method: 'POST', headers, body: JSON.stringify({ clerkUserId: id }) });
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('do-not-return');
  expect(await fixture.db.prepare('SELECT status, clerk_user_id FROM users WHERE id = ?').bind(invited.userId).first()).toEqual({ status: 'disabled', clerk_user_id: null });
  expect(fixture.logs.join(' ')).not.toContain('do-not-return');
});
