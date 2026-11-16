import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const backend = resolve(process.env.WAPILOT_OBSERVATION_GO_ROOT ?? join(root, '.scratch/evolution-go'));
const dsn = process.env.MESSAGE_HISTORY_TEST_DSN;
if (!dsn) throw new Error('Set MESSAGE_HISTORY_TEST_DSN to an isolated loopback PostgreSQL keyword DSN.');
const parameters = new Map();
for (const entry of dsn.trim().split(/\s+/)) {
  const match = /^(host|port|dbname|user|password|sslmode|connect_timeout)=([^\s'"\\=]+)$/.exec(entry);
  if (!match || parameters.has(match[1])) throw new Error('Use unique PostgreSQL keyword parameters without quotes or escapes.');
  parameters.set(match[1], match[2]);
}
if (!['127.0.0.1', 'localhost', '::1'].includes(parameters.get('host'))) throw new Error('Observation acceptance requires an explicit loopback PostgreSQL host.');
await access(join(backend, 'pkg/message/acceptance/observation_connected_test.go'));
const temporary = await mkdtemp(join(tmpdir(), 'wapilot-observation-'));
const infoFile = join(temporary, 'server.json');
const stopFile = join(temporary, 'stop');
const providerEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG')));
const provider = spawn(process.env.WAPILOT_ACCEPTANCE_GO ?? 'go', ['test', './pkg/message/acceptance', '-run', '^TestObservationConnectedServer$', '-count=1', '-v', '-timeout=20m', '-args', '-postgres-dsn', dsn], {
  cwd: backend,
  env: { ...providerEnv, MESSAGE_OBSERVATION_GO: process.env.WAPILOT_ACCEPTANCE_GO ?? 'go', MESSAGE_OBSERVATION_SERVER_INFO: infoFile, MESSAGE_OBSERVATION_SERVER_STOP: stopFile },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let backendOutput = '';
provider.stdout.on('data', chunk => { backendOutput += chunk; });
provider.stderr.on('data', chunk => { backendOutput += chunk; });
let providerDone = false;
const completion = new Promise(resolve => {
  provider.once('error', error => { providerDone = true; resolve({ error }); });
  provider.once('exit', code => { providerDone = true; resolve({ code }); });
});
const interrupt = new AbortController();
const abort = () => interrupt.abort();
process.once('SIGINT', abort);
process.once('SIGTERM', abort);
try {
  const deadline = Date.now() + 10 * 60 * 1000;
  let info;
  while (Date.now() < deadline) {
    interrupt.signal.throwIfAborted();
    if (providerDone) throw new Error('Go fixture exited before readiness.');
    try { info = JSON.parse(await readFile(infoFile, 'utf8')); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(100, undefined, { signal: interrupt.signal });
  }
  if (!info || typeof info.url !== 'string' || typeof info.token !== 'string') throw new Error('Go fixture did not publish readiness information.');
  const url = new URL(info.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Go fixture must listen on loopback.');
  const vitest = spawn(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'test/message-observation.test.ts'], {
    cwd: root, env: { ...process.env, WAPILOT_OBSERVATION_FIXTURE: JSON.stringify(info) }, stdio: 'inherit', signal: interrupt.signal,
  });
  const code = await new Promise((resolve, reject) => { vitest.once('error', reject); vitest.once('exit', resolve); });
  if (code !== 0) throw new Error(`Connected message observation acceptance failed (${code}).`);
} finally {
  await writeFile(stopFile, 'stop');
  const timeout = new AbortController();
  const finished = await Promise.race([completion, delay(15000, { timedOut: true }, { signal: timeout.signal }).catch(() => ({}))]);
  timeout.abort();
  if (finished.timedOut) { provider.kill('SIGTERM'); await completion; }
  process.removeListener('SIGINT', abort);
  process.removeListener('SIGTERM', abort);
  await rm(temporary, { recursive: true, force: true });
  process.stdout.write(backendOutput);
  if (finished.timedOut) throw new Error('Go fixture did not finish cleanup within 15 seconds.');
  if (finished.error) throw finished.error;
  if (finished.code !== 0) throw new Error(`Go fixture failed (${finished.code}).`);
}
