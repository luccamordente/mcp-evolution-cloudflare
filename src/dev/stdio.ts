import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { getPlatformProxy, type PlatformProxy } from 'wrangler';
import { serveStdio, StdioServerTransport, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { createMcpServer } from '../lib/mcp';
import { EvolutionGoClient } from '../lib/evolution';
import { createConnection, ensureUser, getConnection, listConnections, revealConnectionToken } from '../lib/db';
import type { Env } from '../types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
class SetupError extends Error {}
let proxy: PlatformProxy<Env> | undefined;
let pendingProxy: Promise<PlatformProxy<Env>> | undefined;
let server: StdioServerHandle | undefined;
let closing: Promise<void> | undefined;
function close() {
  return closing ??= Promise.resolve().then(async () => {
    try { await server?.close(); }
    finally {
      try { await (proxy ?? await pendingProxy?.catch(() => undefined))?.dispose(); }
      finally { process.stdin.destroy(); input.destroy(); }
    }
  });
}
const stop = () => { void close().finally(() => process.exit(0)); };
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, stop);
// Buffer opening messages while setup runs, and observe EOF even before the transport starts.
const input = new PassThrough();
process.stdin.once('end', stop);
process.stdin.pipe(input);

async function optionalFile(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

try {
  const config = { ...parseEnv(await optionalFile(resolve(root, '.env.stdio')) ?? ''), ...process.env };
  const baseUrl = config.EVOLUTION_BASE_URL?.trim();
  const instanceId = config.LOCAL_INSTANCE_ID?.trim();
  const token = config.LOCAL_INSTANCE_TOKEN?.trim();
  if (!baseUrl || !instanceId || !token) throw new SetupError('Informe EVOLUTION_BASE_URL, LOCAL_INSTANCE_ID e LOCAL_INSTANCE_TOKEN em .env.stdio.');
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new SetupError('URL inválida para o serviço WaPilot.');
  const client = new EvolutionGoClient({ baseUrl, instanceId, instanceToken: token });
  let status: Record<string, unknown>;
  try { status = await client.status(); }
  catch { throw new SetupError('Não foi possível validar as credenciais no serviço WaPilot. Confira a configuração e a disponibilidade.'); }
  const resource = status.data as { type?: string; id?: string } | undefined;
  if (resource?.type !== 'connection' || resource.id !== instanceId) throw new SetupError('O estado live não corresponde à instância configurada.');

  const state = resolve(config.WAPILOT_STDIO_STATE_DIR ?? resolve(root, '.wrangler/stdio'));
  const persistence = resolve(state, 'bindings');
  await mkdir(state, { recursive: true, mode: 0o700 });
  const migration = spawnSync(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'migrations', 'apply', 'DB', '--env', 'stdio', '--local', '--persist-to', persistence], {
    cwd: root, stdio: ['ignore', 2, 2], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (migration.status !== 0) throw new SetupError('Não foi possível preparar o banco local do WaPilot.');
  // The CLI appends /v3, while getPlatformProxy uses the supplied path verbatim.
  pendingProxy = getPlatformProxy<Env>({ configPath: resolve(root, 'wrangler.jsonc'), environment: 'stdio', persist: { path: resolve(persistence, 'v3') }, remoteBindings: false, envFiles: [] });
  proxy = await pendingProxy;
  const db = proxy.env.DB;
  const identity = { id: 'local-development', email: 'dev@example.test', claims: {} };
  const existing = await db.prepare('SELECT COUNT(*) as count FROM whatsapp_connections').first<{ count: number }>();
  const keyPath = resolve(state, 'encryption.key');
  let key = (await optionalFile(keyPath))?.trim();
  if (!key) {
    if (existing?.count) throw new SetupError('A chave local está ausente. Restaure a chave deste banco antes de continuar.');
    key = randomBytes(32).toString('base64url');
    await writeFile(keyPath, key, { mode: 0o600, flag: 'wx' });
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new SetupError('A chave local é inválida. Restaure a chave original.');
  const metadataPath = resolve(state, 'instance.json');
  const metadata = JSON.stringify({ baseUrl: url.href, instanceId });
  const previousMetadata = await optionalFile(metadataPath);
  if ((previousMetadata !== undefined && previousMetadata !== metadata) || (existing?.count && previousMetadata === undefined)) throw new SetupError('A configuração diverge do cadastro local. Use uma persistência separada para outra instância.');
  const user = await ensureUser(db, identity);
  const connections = await listConnections(db, user.id);
  if (connections.length) {
    if (connections.length !== 1 || connections[0].instanceId !== instanceId || !connections[0].isDefault) throw new SetupError('O cadastro local não corresponde à conexão padrão esperada.');
    const connection = await getConnection(db, user.id, connections[0].id);
    let previousToken: string;
    try { previousToken = await revealConnectionToken(db, key, connection!); }
    catch { throw new SetupError('Não foi possível abrir a credencial local. Restaure a chave original.'); }
    if (previousToken !== token) throw new SetupError('A credencial diverge do cadastro local. Use uma persistência separada.');
  } else {
    await writeFile(metadataPath, metadata, { mode: 0o600, flag: previousMetadata === undefined ? 'wx' : 'w' });
    await createConnection(db, key, { userId: user.id, friendlyName: 'Desenvolvimento WaPilot', instanceId, token });
  }
  const env: Env = { DB: db, TOKEN_ENCRYPTION_KEY: key, EVOLUTION_BASE_URL: baseUrl, MAX_MEDIA_BYTES: '8388608', IMAGE_STORAGE_ORIGINS: config.IMAGE_STORAGE_ORIGINS };
  const transport = new StdioServerTransport(input);
  server = serveStdio(() => createMcpServer(env, identity), { transport, onerror: () => console.error('WaPilot: erro no protocolo MCP local.') });
  const transportClosed = transport.onclose;
  transport.onclose = () => { transportClosed?.(); stop(); };
} catch (error) {
  // Only our fixed setup messages are safe; dependency errors can contain configuration.
  const message = error instanceof SetupError
    ? error.message : 'Não foi possível iniciar o WaPilot local. Confira a configuração e a persistência.';
  console.error(`WaPilot: ${message}`);
  await close().catch(() => console.error('WaPilot: não foi possível liberar o ambiente local.'));
  process.exitCode = 1;
}
