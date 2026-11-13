import { afterAll, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, resolve } from 'node:path';
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
const fixtureHost = 'developer.tail-fixture.ts.net';
const fixtureOrigin = 'https://developer.tail-fixture.ts.net:8443';
const previousServe = { TCP: { '443': { HTTPS: true } }, Web: { 'existing.tail-fixture.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:4000' } } } }, AllowFunnel: { 'existing.tail-fixture.ts.net:443': true } };
async function tailscaleFixture(root: string, config: object = previousServe, status = { BackendState: 'Running', Self: { DNSName: fixtureHost + '.', Online: true, Capabilities: ['https'] } }) {
  const bin = resolve(root, 'bin');
  await mkdir(bin);
  await writeFile(resolve(root, 'tailscale-state.json'), JSON.stringify(config));
  await writeFile(resolve(root, 'tailscale-status.json'), JSON.stringify(status));
  await writeFile(resolve(bin, 'tailscale'), `#!/usr/bin/env node
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer,connect} from 'node:net';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
writeFileSync(resolve(root,'tailscale-used'),'used');
if(args[0]==='status') console.log(readFileSync(resolve(root,'tailscale-status.json'),'utf8'));
else if(args[0]==='serve'&&args[1]==='status') console.log(readFileSync(resolve(root,'tailscale-state.json'),'utf8'));
else if(args[0]==='cert'){
  copyFileSync(resolve(root,'fixture.pem'),args[args.indexOf('--cert-file')+1]);
  copyFileSync(resolve(root,'fixture-key.pem'),args[args.indexOf('--key-file')+1]);
}else if(args[0]==='serve'&&args[1]==='--tcp=8443'&&args[2]==='tcp://127.0.0.1:8795'&&args.length===3){
  const config=JSON.parse(readFileSync(resolve(root,'tailscale-state.json'),'utf8'));
  const sockets=new Set();
  const server=createServer(incoming=>{
    const upstream=connect(8795,'127.0.0.1');
    sockets.add(incoming);sockets.add(upstream);
    incoming.once('close',()=>sockets.delete(incoming));upstream.once('close',()=>sockets.delete(upstream));
    incoming.on('error',()=>upstream.destroy());upstream.on('error',()=>incoming.destroy());
    incoming.pipe(upstream).pipe(incoming);
  });
  server.listen(8443,'127.0.0.1',()=>{
    config.Foreground={...(config.Foreground??{}),fixture:{TCP:{'8443':{TCPForward:'127.0.0.1:8795'}}}};
    writeFileSync(resolve(root,'tailscale-state.json'),JSON.stringify(config));
  });
  const stop=()=>{
    const config=JSON.parse(readFileSync(resolve(root,'tailscale-state.json'),'utf8'));
    delete config.Foreground?.fixture;
    if(Object.keys(config.Foreground??{}).length===0)delete config.Foreground;
    writeFileSync(resolve(root,'tailscale-state.json'),JSON.stringify(config));
    server.close(()=>process.exit(0));for(const socket of sockets)socket.destroy();
  };
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}else {writeFileSync(resolve(root,'unexpected-serve'),'started');process.exitCode=1;}
`, { mode: 0o755 });
  return { PATH: bin + delimiter + process.env.PATH };
}
function run(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [resolve(root, 'scripts/dev-clerk.mjs'), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', PATH: resolve(root, 'bin') + delimiter + process.env.PATH }, timeout: 60_000 });
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
  await tailscaleFixture(root, previousServe, { BackendState: 'Stopped', Self: { DNSName: fixtureHost + '.', Online: false, Capabilities: [] } });
  const first = run(root, '--prepare');
  expect(first.status, first.stderr + first.stdout).toBe(0);
  expect(first.stdout).toContain('Fixtures locais preparadas');
  const config = JSON.parse(await readFile(resolve(root, '.wrangler/clerk-test/wrangler.json'), 'utf8'));
  expect(config).toMatchObject({ main: resolve(root, 'src/worker.ts'), routes: [], containers: [], queues: { producers: [], consumers: [] }, triggers: { crons: [] }, durable_objects: { bindings: [] }, vars: { ENVIRONMENT: 'clerk-test', MCP_PUBLIC_URL: 'https://clerk-test.invalid', EVOLUTION_BASE_URL: 'http://127.0.0.1:8794', ADMIN_EMAILS: 'admin@example.test' }, dev: { host: 'clerk-test.invalid', local_protocol: 'https', upstream_protocol: 'https', port: 8795 } });
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
  await expect(readFile(resolve(root, 'tailscale-used'))).rejects.toMatchObject({ code: 'ENOENT' });
}, 30_000);
it('requires Tailscale before starting the Clerk profile without exposing credentials', async () => {
  const root = await checkout();
  await writeFile(resolve(root, '.env.clerk'), 'CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZml4dHVyZS5pbnZhbGlkJA==\nCLERK_SECRET_KEY=sk_test_synthetic\nCLERK_TEST_ADMIN_EMAIL=admin@example.test\n');
  const bin = resolve(root, 'bin');
  await mkdir(bin);
  await writeFile(resolve(bin, 'tailscale'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/dev-clerk.mjs')], { cwd: root, encoding: 'utf8', env: { ...process.env, PATH: bin + delimiter + process.env.PATH }, timeout: 60_000 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Tailscale');
  expect(result.stdout + result.stderr).not.toContain('sk_test_synthetic');
});

it.each([
  ['a configured endpoint', { TCP: { '8443': { HTTPS: true } } }],
  ['another foreground session', { Foreground: { other: { TCP: { '8443': { HTTPS: true } } } } }],
  ['a public Funnel endpoint', { AllowFunnel: { [fixtureHost + ':8443']: true } }],
])('refuses %s on the development port without changing Tailscale', async (_name, config) => {
  const root = await checkout();
  await writeFile(resolve(root, '.env.clerk'), 'CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZml4dHVyZS5pbnZhbGlkJA==\nCLERK_SECRET_KEY=sk_test_synthetic\nCLERK_TEST_ADMIN_EMAIL=admin@example.test\n');
  const env = await tailscaleFixture(root, config);
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/dev-clerk.mjs')], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('8443');
  expect(JSON.parse(await readFile(resolve(root, 'tailscale-state.json'), 'utf8'))).toEqual(config);
  await expect(readFile(resolve(root, 'unexpected-serve'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each([
  ['offline', { BackendState: 'Stopped', Self: { DNSName: fixtureHost + '.', Online: false, Capabilities: ['https'] } }, 'tailnet'],
  ['without HTTPS', { BackendState: 'Running', Self: { DNSName: fixtureHost + '.', Online: true, Capabilities: [] } }, 'HTTPS'],
])('refuses a tailnet %s before changing its configuration', async (_name, status, message) => {
  const root = await checkout();
  await writeFile(resolve(root, '.env.clerk'), 'CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZml4dHVyZS5pbnZhbGlkJA==\nCLERK_SECRET_KEY=sk_test_synthetic\nCLERK_TEST_ADMIN_EMAIL=admin@example.test\n');
  const env = await tailscaleFixture(root, previousServe, status);
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/dev-clerk.mjs')], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000 });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(message);
  expect(JSON.parse(await readFile(resolve(root, 'tailscale-state.json'), 'utf8'))).toEqual(previousServe);
  await expect(readFile(resolve(root, 'unexpected-serve'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['another hostname', 'expired'])('refuses a certificate for %s before publishing the endpoint', async kind => {
  const root = await checkout();
  await writeFile(resolve(root, '.env.clerk'), 'CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZml4dHVyZS5pbnZhbGlkJA==\nCLERK_SECRET_KEY=sk_test_synthetic\nCLERK_TEST_ADMIN_EMAIL=admin@example.test\n');
  const hostname = kind === 'expired' ? fixtureHost : 'different.tail-fixture.ts.net';
  const certificate = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', resolve(root, 'fixture-key.pem'), '-out', resolve(root, 'fixture.pem'), '-subj', '/CN=' + hostname, '-addext', 'subjectAltName=DNS:' + hostname], { encoding: 'utf8' });
  expect(certificate.status, certificate.stderr).toBe(0);
  if (kind === 'expired') {
    const expired = spawnSync('openssl', ['x509', '-in', resolve(root, 'fixture.pem'), '-signkey', resolve(root, 'fixture-key.pem'), '-days', '0', '-out', resolve(root, 'expired.pem')], { encoding: 'utf8' });
    expect(expired.status, expired.stderr).toBe(0);
    await cp(resolve(root, 'expired.pem'), resolve(root, 'fixture.pem'));
  }
  const env = await tailscaleFixture(root);
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/dev-clerk.mjs')], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000 });
  expect(result.status, result.stdout + result.stderr).toBe(1);
  expect(result.stderr).toContain('O certificado Tailscale não corresponde a esta máquina ou está fora da validade');
  expect(result.stdout + result.stderr).not.toContain('sk_test_synthetic');
  expect(JSON.parse(await readFile(resolve(root, 'tailscale-state.json'), 'utf8'))).toEqual(previousServe);
  await expect(readFile(resolve(root, 'unexpected-serve'))).rejects.toMatchObject({ code: 'ENOENT' });
}, 30_000);

it('serves each developer origin privately with verified TLS and preserves existing services on shutdown', async () => {
  const root = await checkout();
  await writeFile(resolve(root, '.env.clerk'), 'CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZml4dHVyZS5pbnZhbGlkJA==\nCLERK_SECRET_KEY=sk_test_synthetic\nCLERK_TEST_ADMIN_EMAIL=admin@example.test\n');
  await cp(resolve(root, 'src/worker.ts'), resolve(root, 'src/published-worker.ts'));
  await writeFile(resolve(root, 'src/worker.ts'), `import published from './published-worker';
    export { CallbackSender } from './published-worker';
    export default { ...published, fetch(request, env, ctx) {
      if (new URL(request.url).origin !== '${fixtureOrigin}') return new Response(null, { status: 599 });
      return published.fetch(request, env, ctx);
    } };`);
  const cert = resolve(root, 'fixture.pem');
  const openssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', resolve(root, 'fixture-key.pem'), '-out', cert, '-subj', '/CN=' + fixtureHost, '-addext', 'subjectAltName=DNS:' + fixtureHost], { encoding: 'utf8' });
  expect(openssl.status, openssl.stderr).toBe(0);
  const env = await tailscaleFixture(root);
  const dns = resolve(root, 'fixture-dns.mjs');
  await writeFile(dns, `import dns from 'node:dns';
    import {syncBuiltinESMExports} from 'node:module';
    const lookup=dns.lookup;
    dns.lookup=(name, options, callback)=>{
      if(name!=='${fixtureHost}')return lookup(name,options,callback);
      if(typeof options==='function'){callback=options;options={};}
      queueMicrotask(()=>options?.all?callback(null,[{address:'127.0.0.1',family:4}]):callback(null,'127.0.0.1',4));
    };
    syncBuiltinESMExports();`);
  const child = spawn(process.execPath, [resolve(root, 'scripts/dev-clerk.mjs')], { cwd: root, env: { ...process.env, ...env, NODE_OPTIONS: ((process.env.NODE_OPTIONS ?? '') + ' --import ' + JSON.stringify(dns)).trim(), NODE_EXTRA_CA_CERTS: cert, WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  try {
    await new Promise<void>((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out starting Tailscale fixture: ' + output)), 40_000);
      const consume = (chunk: Buffer) => { output += chunk.toString(); if (output.includes('origem HTTPS e recusa sem sessão conferidas')) { clearTimeout(timer); done(); } };
      child.stdout.on('data', consume); child.stderr.on('data', consume);
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Tailscale fixture exited ' + code + ': ' + output)); });
    });
    const ca = await readFile(cert);
    const request = (path: string, method = 'GET', headers = {}) => new Promise<{ status?: number; body: string; headers: Record<string, unknown> }>((done, reject) => {
      const req = get(fixtureOrigin + path, { ca, servername: fixtureHost, lookup: (_name, _options, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]), method, headers: { Accept: 'application/json', ...headers } }, response => {
        let body = ''; response.on('data', chunk => body += chunk); response.once('end', () => done({ status: response.statusCode, body, headers: response.headers }));
      }); req.once('error', reject);
    });
    expect((await request('/connections/data')).status).toBe(401);
    expect((await request('/connections/data', 'GET', { Host: 'attacker.invalid', 'X-Forwarded-Host': 'attacker.invalid', 'X-Forwarded-Proto': 'http' })).status).toBe(401);
    const mcp = await request('/mcp', 'POST');
    expect(mcp.status).toBe(401);
    expect(mcp.headers['www-authenticate']).toContain(fixtureOrigin + '/.well-known/oauth-protected-resource/mcp');
    expect(JSON.parse((await request('/.well-known/oauth-protected-resource/mcp')).body).resource).toBe(fixtureOrigin + '/mcp');
    expect((await request('/auth.js')).status).toBe(200);
    expect((await request('/sign-in')).status).toBe(200);
    const navigation = await request('/connections', 'GET', { Accept: 'text/html' });
    expect(navigation.status).toBe(307);
    const location = new URL(String(navigation.headers.location), fixtureOrigin);
    expect(location.protocol).toBe('https:');
    expect(location.searchParams.get('redirect_url')).toBe(fixtureOrigin + '/connections');
    expect((await request('/authorize')).status).toBe(401);
    expect(output).toContain(fixtureOrigin);
    expect(output).not.toContain('sk_test_synthetic');
    const config = JSON.parse(await readFile(resolve(root, '.wrangler/clerk-test/wrangler.json'), 'utf8'));
    for (const path of ['tailscale.pem', 'tailscale-key.pem']) expect((await stat(resolve(root, '.wrangler/clerk-test/tls', path))).mode & 0o777).toBe(0o600);
    expect((await stat(resolve(root, '.wrangler/clerk-test/tls'))).mode & 0o777).toBe(0o700);
    expect(config.vars.MCP_PUBLIC_URL).toBe(fixtureOrigin);
    expect(config.dev).toMatchObject({ ip: '127.0.0.1', port: 8795, host: fixtureHost + ':8443', local_protocol: 'https', upstream_protocol: 'https' });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    }
  }
  expect(JSON.parse(await readFile(resolve(root, 'tailscale-state.json'), 'utf8'))).toEqual(previousServe);
}, 60_000);

it('requires a Clerk cookie and deliberate active D1 link with isolated connection visibility', async () => {
  const config = JSON.parse(await readFile('wrangler.clerk-test.jsonc', 'utf8'));
  const fixture = await clerkRuntime(async request => {
    expect(new URL(request.url).pathname).toBe('/instance/status');
    return Response.json({ jsonapi: { version: '1.1' }, data: { type: 'connection', id: 'clerk-test-admin', attributes: { connected: true, loggedIn: true } } });
  }, { ...config.vars, MCP_PUBLIC_URL: fixtureOrigin, CLERK_PUBLISHABLE_KEY: 'pk_test_' + Buffer.from('clerk.fixture.invalid$').toString('base64') });
  const fetch = (path: string, cookie?: string) => fixture.runtime.dispatchFetch(fixtureOrigin + path, { headers: { accept: 'application/json', ...(cookie ? { cookie } : {}) } });
  try {
    expect((await fetch('/connections/data')).status).toBe(401);
    const session = await fixture.session('user_fixture_admin', { azp: fixtureOrigin });
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
