import { mkdir, readFile, writeFile, access, chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { randomBytes, X509Certificate } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
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
let serve: ChildProcess | undefined;
let serveStopped: Promise<void> | undefined;
let ready = false;
let serveFailed = false;
let closing: Promise<void> | undefined;
function close() {
  return closing ??= (async () => {
    if (serve && serve.exitCode === null && serve.signalCode === null) {
      serve.kill('SIGINT');
      const force = setTimeout(() => serve?.kill('SIGTERM'), 3_000);
      try { await serveStopped; } finally { clearTimeout(force); }
    }
    await worker?.stop();
    await new Promise<void>((done, reject) => { if (mock?.listening) mock.close(error => error ? reject(error) : done()); else done(); });
  })();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void close().finally(() => process.exit(0)); });

async function optionalFile(path: string) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

type ServeConfig = {
  TCP?: Record<string, unknown>;
  Web?: Record<string, unknown>;
  AllowFunnel?: Record<string, boolean>;
  Foreground?: Record<string, ServeConfig>;
};
function tailscaleJson(args: string[]) {
  const result = spawnSync('tailscale', args, { encoding: 'utf8', timeout: 5_000 });
  if (result.status !== 0) throw new SetupError('Instale o Tailscale e conecte esta máquina à sua tailnet antes de iniciar o WaPilot.');
  try { return JSON.parse(result.stdout); }
  catch { throw new SetupError('Não foi possível conferir a configuração local do Tailscale.'); }
}
function serveConfigs(config: ServeConfig): ServeConfig[] {
  return [config, ...Object.values(config.Foreground ?? {}).flatMap(serveConfigs)];
}
function tailscaleOrigin(): string {
  const status = tailscaleJson(['status', '--json']);
  const hostname = String(status?.Self?.DNSName ?? '').replace(/\.$/, '').toLowerCase();
  if (status?.BackendState !== 'Running' || status.Self?.Online === false || !/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(hostname)) throw new SetupError('Conecte esta máquina à sua tailnet com MagicDNS antes de iniciar o WaPilot.');
  if (!(status.Self?.Capabilities ?? []).includes('https') && !Object.hasOwn(status.Self?.CapMap ?? {}, 'https')) throw new SetupError('Habilite os certificados HTTPS na sua tailnet antes de iniciar o WaPilot.');
  const config = (tailscaleJson(['serve', 'status', '--json']) ?? {}) as ServeConfig;
  if (serveConfigs(config).some(value => Object.hasOwn(value.TCP ?? {}, '8443') || [...Object.keys(value.Web ?? {}), ...Object.keys(value.AllowFunnel ?? {})].some(host => host.endsWith(':8443')))) throw new SetupError('A porta Tailscale 8443 já tem configuração. Encerre esse serviço antes de iniciar o WaPilot; nenhuma configuração foi alterada.');
  return `https://${hostname}:8443`;
}

try {
  const input = parseEnv(await optionalFile(resolve(root, '.env.clerk')) ?? '');
  const adminEmail = input.CLERK_TEST_ADMIN_EMAIL?.trim().toLowerCase();
  if (!/^pk_test_[A-Za-z0-9+/=]+$/.test(input.CLERK_PUBLISHABLE_KEY ?? '') || !/^sk_test_[A-Za-z0-9_-]+$/.test(input.CLERK_SECRET_KEY ?? '') || !adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new SetupError('Informe as chaves Clerk development e o e-mail de teste em .env.clerk.');
  if (Object.keys(input).some(name => !['CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'CLERK_TEST_ADMIN_EMAIL'].includes(name))) throw new SetupError('.env.clerk aceita somente as duas chaves Clerk development e CLERK_TEST_ADMIN_EMAIL.');
  if (process.argv.slice(2).some(arg => arg !== '--prepare')) throw new SetupError('Use dev:clerk ou dev:clerk -- --prepare, sem opções adicionais do Wrangler.');
  const origin = process.argv.includes('--prepare') ? undefined : tailscaleOrigin();
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
  if (origin) { config.vars.MCP_PUBLIC_URL = origin; config.dev.host = new URL(origin).host; }
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
    const tls = resolve(state, 'tls');
    await mkdir(tls, { recursive: true, mode: 0o700 });
    await chmod(tls, 0o700);
    const certPath = resolve(tls, 'tailscale.pem'), keyPath = resolve(tls, 'tailscale-key.pem');
    const hostname = new URL(origin!).hostname;
    // shortcut: refresh certificates at startup; restart development sessions before expiry.
    const certificate = spawnSync('tailscale', ['cert', '--cert-file', certPath, '--key-file', keyPath, hostname], { encoding: 'utf8', timeout: 30_000 });
    if (certificate.status !== 0) throw new SetupError('Não foi possível obter o certificado HTTPS desta máquina pelo Tailscale. Confira a permissão de certificados na sua tailnet.');
    await chmod(certPath, 0o600); await chmod(keyPath, 0o600);
    const cert = new X509Certificate(await readFile(certPath));
    if (!cert.checkHost(hostname) || !(Date.parse(cert.validFrom) <= Date.now() && Date.now() < Date.parse(cert.validTo))) throw new SetupError('O certificado Tailscale não corresponde a esta máquina ou está fora da validade.');
    worker = await unstable_dev(config.main, { config: configPath, envFiles: [envPath], local: true, ip: config.dev.ip, port: config.dev.port, localProtocol: 'https', httpsKeyPath: keyPath, httpsCertPath: certPath, persistTo: persistence, logLevel: 'error', experimental: { disableExperimentalWarning: true, forceLocal: true, disableDevRegistry: true, enableContainers: false, showInteractiveDevSession: false, watch: true } });
    const target = `127.0.0.1:${config.dev.port}`;
    // A foreground session belongs to this process and removes only its own endpoint on exit.
    serve = spawn('tailscale', ['serve', '--tcp=8443', 'tcp://' + target], { stdio: 'ignore' });
    serveStopped = new Promise<void>(done => {
      serve!.once('error', () => { serveFailed = true; done(); });
      serve!.once('exit', () => {
        done();
        if (ready && !closing) {
          console.error('WaPilot: O acesso privado do Tailscale foi encerrado.');
          process.exitCode = 1;
          void close().catch(() => {});
        }
      });
    });
    const deadline = Date.now() + 15_000;
    let active = false;
    while (Date.now() < deadline) {
      if (serveFailed || serve.exitCode !== null || serve.signalCode !== null) throw new SetupError('Não foi possível iniciar o Tailscale Serve privado. Confira login e HTTPS na sua tailnet.');
      const configs = serveConfigs((tailscaleJson(['serve', 'status', '--json']) ?? {}) as ServeConfig);
      if (configs.some(value => Object.keys(value.AllowFunnel ?? {}).some(name => name.endsWith(':8443')))) throw new SetupError('A porta 8443 não está privada. O acesso de desenvolvimento foi encerrado.');
      active = configs.filter(value => { const tcp = value.TCP?.['8443'] as { TCPForward?: string; TerminateTLS?: boolean } | undefined; return tcp?.TCPForward === target && !tcp.TerminateTLS; }).length === 1;
      if (active) break;
      await delay(100);
    }
    if (!active) throw new SetupError('Não foi possível conferir o endpoint privado do Tailscale na porta 8443.');
    // The production verifier returns 503 if request.url has a different origin.
    const status = await new Promise<number | undefined>((done, reject) => {
      const request = get(origin! + '/connections/data', { rejectUnauthorized: true, headers: { Accept: 'application/json' } }, response => { response.resume(); done(response.statusCode); });
      request.setTimeout(20_000, () => { request.destroy(); reject(new Error()); });
      request.once('error', reject);
    }).catch(() => { throw new SetupError('Falha na verificação HTTPS do Tailscale. Confira MagicDNS, certificados HTTPS e acesso desta máquina à sua tailnet; não desative a validação TLS.'); });
    if (status !== 401) throw new SetupError('A origem HTTPS ou a fronteira Clerk diverge do perfil esperado.');
    if (serveFailed || serve.exitCode !== null || serve.signalCode !== null) throw new SetupError('O acesso privado do Tailscale foi encerrado antes da verificação.');
    ready = true;
    console.log(`WaPilot: ${origin} pronto na sua tailnet; origem HTTPS e recusa sem sessão conferidas. Ctrl+C encerra Serve, Worker e mock.`);
  }
} catch (error) {
  console.error('WaPilot: ' + (error instanceof SetupError ? error.message : 'Não foi possível iniciar o perfil Clerk local. Confira .env.clerk e a persistência de teste.'));
  await close().catch(() => {});
  process.exitCode = 1;
}
