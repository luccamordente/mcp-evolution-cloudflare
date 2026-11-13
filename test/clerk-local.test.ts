import { afterAll, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { get } from 'node:https';
import { once } from 'node:events';
import { clerkRuntime } from './helpers/clerk-session';
import { createConnection } from '../src/lib/db';
import { getPlatformProxy } from 'wrangler';


const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });
async function checkout() {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), 'wapilot-clerk-local-')));
  roots.push(root);
  for (const name of ['src', 'scripts', 'migrations', 'package.json', 'wrangler.clerk-test.jsonc', 'public']) {
    await cp(resolve(name), resolve(root, name), { recursive: true });
  }
  await symlink(resolve('node_modules'), resolve(root, 'node_modules'), 'dir');
  return root;
}
function run(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [resolve(root, 'scripts/dev-clerk.mjs'), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, timeout: 60_000 });
}
it('requires explicit Clerk development credentials without reading existing environments', async () => {
  const root = await checkout();
  await writeFile(resolve(root, '.dev.vars'), 'CLERK_SECRET_KEY=sk_live_do-not-copy');
  const result = run(root, '--prepare');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Informe as chaves Clerk development e o e-mail de teste em .env.clerk');
  expect(result.stderr + result.stdout).not.toContain('sk_live_do-not-copy');
  expect(await readFile(resolve(root, '.dev.vars'), 'utf8')).toBe('CLERK_SECRET_KEY=sk_live_do-not-copy');
});
it('prepares only isolated local bindings, secrets and disabled synthetic fixtures', async () => {
  const root = await checkout();
  await writeFile(resolve(root, '.env.clerk'), 'CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZml4dHVyZS5pbnZhbGlkJA==\nCLERK_SECRET_KEY=sk_test_synthetic\nCLERK_TEST_ADMIN_EMAIL=admin@example.test\n');
  const first = run(root, '--prepare');
  expect(first.status, first.stderr + first.stdout).toBe(0);
  expect(first.stdout).toContain('Fixtures locais preparadas');
  const config = JSON.parse(await readFile(resolve(root, '.wrangler/clerk-test/wrangler.json'), 'utf8'));
  expect(config).toMatchObject({ main: resolve(root, 'src/worker.ts'), routes: [], containers: [], queues: { producers: [], consumers: [] }, triggers: { crons: [] }, durable_objects: { bindings: [] }, vars: { ENVIRONMENT: 'clerk-test', MCP_PUBLIC_URL: 'https://localhost:8795', EVOLUTION_BASE_URL: 'http://127.0.0.1:8794', ADMIN_EMAILS: 'admin@example.test' }, dev: { host: 'localhost:8795', local_protocol: 'https', port: 8795 } });
  expect(config).not.toHaveProperty('ai');
  expect(config.d1_databases).toEqual([{ binding: 'DB', database_name: 'wapilot-clerk-test', database_id: '00000000-0000-0000-0000-000000000060', migrations_dir: resolve(root, 'migrations'), remote: false }]);
  expect(config.kv_namespaces).toEqual([{ binding: 'OAUTH_KV', id: '00000000000000000000000000000060', remote: false }]);
  const secrets = await readFile(resolve(root, '.wrangler/clerk-test/secrets.json'), 'utf8');
  expect(run(root, '--prepare').status).toBe(0);
  expect(await readFile(resolve(root, '.wrangler/clerk-test/secrets.json'), 'utf8')).toBe(secrets);
  const proxy = await getPlatformProxy({ configPath: resolve(root, '.wrangler/clerk-test/wrangler.json'), envFiles: [resolve(root, '.wrangler/clerk-test/runtime.env')], persist: { path: resolve(root, '.wrangler/clerk-test/bindings/v3') }, remoteBindings: false });
  try {
    const db = proxy.env.DB as D1Database;
    expect((await db.prepare('SELECT id, status, clerk_user_id FROM users ORDER BY id').all()).results).toEqual([
      { id: 'clerk-test-admin', status: 'disabled', clerk_user_id: null },
      { id: 'clerk-test-other', status: 'disabled', clerk_user_id: null },
    ]);
    expect((await db.prepare('SELECT count(*) as count FROM whatsapp_connections').first())?.count).toBe(2);
  } finally { await proxy.dispose(); }
  expect(first.stdout + first.stderr).not.toContain('sk_test_synthetic');
});
it('requires a trusted HTTPS certificate before starting the Clerk profile', async () => {
  const root = await checkout();
  await writeFile(resolve(root, '.env.clerk'), 'CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZml4dHVyZS5pbnZhbGlkJA==\nCLERK_SECRET_KEY=sk_test_synthetic\nCLERK_TEST_ADMIN_EMAIL=admin@example.test\n');
  const result = run(root);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Prepare o certificado confiável de localhost');
  expect(result.stdout + result.stderr).not.toContain('sk_test_synthetic');
});

it('serves the published entrypoint at the exact trusted HTTPS loopback origin', async () => {
  const root = await checkout();
  await writeFile(resolve(root, '.env.clerk'), 'CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZml4dHVyZS5pbnZhbGlkJA==\nCLERK_SECRET_KEY=sk_test_synthetic\nCLERK_TEST_ADMIN_EMAIL=admin@example.test\n');
  // Guard every Worker route without adding a diagnostic endpoint to the product.
  await cp(resolve(root, 'src/worker.ts'), resolve(root, 'src/published-worker.ts'));
  await writeFile(resolve(root, 'src/worker.ts'), `import published from './published-worker';
    export { CallbackSender } from './published-worker';
    export default { ...published, fetch(request, env, ctx) {
      if (new URL(request.url).origin !== 'https://localhost:8795') return new Response(null, { status: 599 });
      return published.fetch(request, env, ctx);
    } };`);
  const tls = resolve(root, '.wrangler/clerk-test/tls');
  await mkdir(tls, { recursive: true });
  const cert = resolve(tls, 'localhost.pem');
  const openssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', resolve(tls, 'localhost-key.pem'), '-out', cert, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { encoding: 'utf8' });
  expect(openssl.status, openssl.stderr).toBe(0);
  const child = spawn(process.execPath, [resolve(root, 'scripts/dev-clerk.mjs')], { cwd: root, env: { ...process.env, NODE_EXTRA_CA_CERTS: cert, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out starting HTTPS fixture: ' + output)), 40_000);
      const consume = (chunk: Buffer) => { output += chunk.toString(); if (output.includes('origem HTTPS e recusa sem sessão conferidas')) { clearTimeout(timer); done(); } };
      child.stdout.on('data', consume); child.stderr.on('data', consume);
      child.once('exit', code => { clearTimeout(timer); reject(new Error('HTTPS fixture exited ' + code + ': ' + output)); });
    });
    const ca = await readFile(cert);
    const request = (path: string, method = 'GET') => new Promise<{ status?: number; body: string; headers: Record<string, unknown> }>((done, reject) => {
      const req = get('https://localhost:8795' + path, { ca, method, headers: { Accept: 'application/json' } }, response => {
        let body = ''; response.on('data', chunk => body += chunk); response.once('end', () => done({ status: response.statusCode, body, headers: response.headers }));
      }); req.once('error', reject);
    });
    expect((await request('/connections/data')).status).toBe(401);
    const mcp = await request('/mcp', 'POST');
    expect(mcp.status).toBe(401);
    expect(mcp.headers['www-authenticate']).toContain('https://localhost:8795/.well-known/oauth-protected-resource/mcp');
    const metadata = await request('/.well-known/oauth-protected-resource/mcp');
    expect(JSON.parse(metadata.body).resource).toBe('https://localhost:8795/mcp');
    expect((await request('/auth.js')).status).toBe(200);
    expect((await request('/sign-in')).status).toBe(200);
    expect((await request('/authorize')).status).toBe(401);
    expect(output).not.toContain('sk_test_synthetic');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    }
  }
}, 60_000);

it('requires a Clerk cookie and deliberate active D1 link with isolated connection visibility', async () => {
  const config = JSON.parse(await readFile('wrangler.clerk-test.jsonc', 'utf8'));
  const fixture = await clerkRuntime(async request => {
    expect(new URL(request.url).pathname).toBe('/instance/status');
    return Response.json({ jsonapi: { version: '1.1' }, data: { type: 'connection', id: 'clerk-test-admin', attributes: { connected: true, loggedIn: true } } });
  }, { ...config.vars, CLERK_PUBLISHABLE_KEY: 'pk_test_' + Buffer.from('clerk.fixture.invalid$').toString('base64') });
  const fetch = (path: string, cookie?: string) => fixture.runtime.dispatchFetch('https://localhost:8795' + path, { headers: { accept: 'application/json', ...(cookie ? { cookie } : {}) } });
  try {
    expect((await fetch('/connections/data')).status).toBe(401);
    const session = await fixture.session('user_fixture_admin', { azp: 'https://localhost:8795' });
    const cookie = session.cookie + '; __clerk_db_jwt=synthetic-dev-browser';
    expect((await fetch('/connections/data', cookie)).status).toBe(403);
    await fixture.db.prepare("INSERT INTO users (id, email, status, clerk_user_id) VALUES ('clerk-test-admin', 'admin@example.test', 'disabled', 'user_fixture_admin'), ('clerk-test-other', 'other@example.test', 'active', 'user_fixture_other')").run();
    for (const id of ['clerk-test-admin', 'clerk-test-other']) await createConnection(fixture.db as unknown as D1Database, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', { userId: id, friendlyName: id, instanceId: id, token: 'synthetic-' + id });
    expect((await fetch('/connections/data', cookie)).status).toBe(403);
    await fixture.db.prepare("UPDATE users SET status = 'active' WHERE id = 'clerk-test-admin'").run();
    const response = await fetch('/connections/data', cookie);
    expect(response.status).toBe(200);
    const result = await response.json() as { connections: Array<{ instanceId: string }> };
    expect(result.connections.map(connection => connection.instanceId)).toEqual(['clerk-test-admin']);
    expect(response.headers.get('cache-control')).toBe('no-store');
  } finally { await fixture.runtime.dispose(); }
});
