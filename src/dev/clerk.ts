import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { get } from 'node:https';
import { getPlatformProxy, unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { createConnection, listConnections } from '../lib/db';
import type { Env } from '../types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const state = resolve(root, '.wrangler/clerk-test');
const persistence = resolve(state, 'bindings');
const configPath = resolve(state, 'wrangler.json');
const envPath = resolve(state, 'runtime.env');
class SetupError extends Error {}
let worker: Unstable_DevWorker | undefined;
let mock: Server | undefined;
let closing: Promise<void> | undefined;
function close() {
  return closing ??= (async () => {
    await worker?.stop();
    await new Promise<void>((done, reject) => { if (mock?.listening) mock.close(error => error ? reject(error) : done()); else done(); });
  })();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void close().finally(() => process.exit(0)); });

async function optionalFile(path: string) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

try {
  const input = parseEnv(await optionalFile(resolve(root, '.env.clerk')) ?? '');
  const adminEmail = input.CLERK_TEST_ADMIN_EMAIL?.trim().toLowerCase();
  if (!/^pk_test_[A-Za-z0-9+/=]+$/.test(input.CLERK_PUBLISHABLE_KEY ?? '') || !/^sk_test_[A-Za-z0-9_-]+$/.test(input.CLERK_SECRET_KEY ?? '') || !adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new SetupError('Informe as chaves Clerk development e o e-mail de teste em .env.clerk.');
  if (Object.keys(input).some(name => !['CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'CLERK_TEST_ADMIN_EMAIL'].includes(name))) throw new SetupError('.env.clerk aceita somente as duas chaves Clerk development e CLERK_TEST_ADMIN_EMAIL.');
  if (process.argv.slice(2).some(arg => arg !== '--prepare')) throw new SetupError('Use dev:clerk ou dev:clerk -- --prepare, sem opções adicionais do Wrangler.');
  const certPath = resolve(state, 'tls/localhost.pem');
  const keyTlsPath = resolve(state, 'tls/localhost-key.pem');
  if (!process.argv.includes('--prepare')) {
    try { await access(certPath); await access(keyTlsPath); }
    catch { throw new SetupError('Prepare o certificado confiável de localhost conforme DEVELOPMENT.md, em .wrangler/clerk-test/tls.'); }
  }
  await mkdir(state, { recursive: true, mode: 0o700 });
  const keyPath = resolve(state, 'secrets.json');
  let previous = await optionalFile(keyPath);
  if (!previous) {
    try { await access(persistence); throw new SetupError('Segredos locais ausentes. Restaure o conjunto original ou limpe apenas .wrangler/clerk-test.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    previous = JSON.stringify({ adminEmail, encryptionKey: randomBytes(32).toString('base64url'), consentSecret: randomBytes(32).toString('base64url') });
    await writeFile(keyPath, previous, { mode: 0o600, flag: 'wx' });
  }
  const secrets = JSON.parse(previous) as { adminEmail: string; encryptionKey: string; consentSecret: string };
  if (secrets.adminEmail !== adminEmail || !/^[A-Za-z0-9_-]{43}$/.test(secrets.encryptionKey) || !/^[A-Za-z0-9_-]{43}$/.test(secrets.consentSecret)) throw new SetupError('A configuração diverge da fixture local. Restaure os valores originais ou use uma base de teste vazia.');
  const config = JSON.parse(await readFile(resolve(root, 'wrangler.clerk-test.jsonc'), 'utf8'));
  config.main = resolve(root, config.main);
  config.assets.directory = resolve(root, config.assets.directory);
  config.d1_databases[0].migrations_dir = resolve(root, config.d1_databases[0].migrations_dir);
  config.vars.ADMIN_EMAILS = adminEmail;
  await writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  await writeFile(envPath, Object.entries({ CLERK_PUBLISHABLE_KEY: input.CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY: input.CLERK_SECRET_KEY, TOKEN_ENCRYPTION_KEY: secrets.encryptionKey, CONSENT_SECRET: secrets.consentSecret }).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'false';
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'true';
  const childEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
  const migration = spawnSync(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'migrations', 'apply', 'DB', '--config', configPath, '--env-file', envPath, '--local', '--persist-to', persistence], { cwd: root, env: childEnv, encoding: 'utf8' });
  if (migration.status !== 0) throw new SetupError('Não foi possível preparar as migrations do D1 local.');
  const proxy = await getPlatformProxy<Env>({ configPath, envFiles: [envPath], persist: { path: resolve(persistence, 'v3') }, remoteBindings: false });
  try {
    const db = proxy.env.DB;
    await db.prepare("DELETE FROM users WHERE id IN ('seed-lucca', 'seed-heitor') AND clerk_user_id IS NULL").run();
    for (const [id, email, name] of [['clerk-test-admin', adminEmail, 'Conexão de teste'], ['clerk-test-other', 'other-clerk-fixture@example.test', 'Conexão de outro usuário']]) {
      await db.prepare("INSERT INTO users (id, email, status) VALUES (?, ?, 'disabled') ON CONFLICT(id) DO NOTHING").bind(id, email).run();
      if (!(await listConnections(db, id)).length) await createConnection(db, secrets.encryptionKey, { userId: id, friendlyName: name, instanceId: id, token: 'synthetic-' + id });
    }
  } finally { await proxy.dispose(); }
  console.log('WaPilot: Fixtures locais preparadas; o primeiro vínculo e ativação exigem operação explícita no D1.');
  if (!process.argv.includes('--prepare')) {
    mock = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/vnd.api+json');
      const id = request.headers.apikey === 'synthetic-clerk-test-admin' ? 'clerk-test-admin' : request.headers.apikey === 'synthetic-clerk-test-other' ? 'clerk-test-other' : undefined;
      if (request.method !== 'GET' || request.url !== '/instance/status' || !id) { response.writeHead(403); response.end(JSON.stringify({ errors: [{ detail: 'A fixture permite apenas consulta de estado.' }] })); return; }
      response.end(JSON.stringify({ jsonapi: { version: '1.1' }, data: { type: 'connection', id, attributes: { connected: true, loggedIn: true, name: 'Fixture WaPilot' } } }));
    });
    await new Promise<void>((done, reject) => { mock!.once('error', reject); mock!.listen(8794, '127.0.0.1', done); });
    worker = await unstable_dev(config.main, { config: configPath, envFiles: [envPath], local: true, ip: config.dev.ip, port: config.dev.port, localProtocol: 'https', httpsKeyPath: keyTlsPath, httpsCertPath: certPath, persistTo: persistence, logLevel: 'error', experimental: { disableExperimentalWarning: true, forceLocal: true, disableDevRegistry: true, enableContainers: false, showInteractiveDevSession: false, watch: true } });
    // The production verifier returns 503 if request.url has a different origin.
    const status = await new Promise<number | undefined>((done, reject) => {
      const request = get('https://localhost:8795/connections/data', { headers: { Accept: 'application/json' } }, response => { response.resume(); done(response.statusCode); });
      request.setTimeout(10_000, () => { request.destroy(); reject(new Error()); });
      request.once('error', reject);
    }).catch(() => { throw new SetupError('Falha na verificação HTTPS. Confira a confiança do certificado no navegador e NODE_EXTRA_CA_CERTS no cliente Node; não desative a validação TLS.'); });
    if (status !== 401) throw new SetupError('A origem HTTPS ou a fronteira Clerk diverge do perfil esperado.');
    console.log('WaPilot: https://localhost:8795 pronto; origem HTTPS e recusa sem sessão conferidas. Ctrl+C encerra Worker e mock.');
  }
} catch (error) {
  console.error('WaPilot: ' + (error instanceof SetupError ? error.message : 'Não foi possível iniciar o perfil Clerk local. Confira .env.clerk e a persistência de teste.'));
  await close().catch(() => {});
  process.exitCode = 1;
}
