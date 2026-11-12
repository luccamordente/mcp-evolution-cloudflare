import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const backend = resolve(process.env.WAPILOT_HISTORY_BACKEND ?? join(root, '.scratch/evolution-go'));
const dsn = process.env.MESSAGE_HISTORY_TEST_DSN;
if (!dsn) throw new Error('Set MESSAGE_HISTORY_TEST_DSN to an isolated local PostgreSQL keyword DSN.');
if (!/(?:^|\s)host=(?:127\.0\.0\.1|localhost|::1)(?:\s|$)/.test(dsn)) {
  throw new Error('History acceptance requires an explicit loopback PostgreSQL host in MESSAGE_HISTORY_TEST_DSN.');
}
await access(join(backend, 'pkg/message/acceptance/reading_test.go'));
const temporary = await mkdtemp(join(tmpdir(), 'wapilot-native-history-'));
const infoFile = join(temporary, 'server.json');
const stopFile = join(temporary, 'stop');
const go = process.env.WAPILOT_ACCEPTANCE_GO ?? 'go';
let backendOutput = '';
const provider = spawn(go, ['test', './pkg/message/acceptance', '-run', '^TestNativeContentHTTPRoundTrip$', '-count=1', '-timeout=20m', '-args', '-postgres-dsn', dsn], {
  cwd: backend,
  env: { ...process.env, MESSAGE_CONTENT_FIXTURE_SERVER_ADDR: '127.0.0.1:0', MESSAGE_CONTENT_FIXTURE_SERVER_INFO: infoFile, MESSAGE_CONTENT_FIXTURE_SERVER_STOP: stopFile },
  stdio: ['ignore', 'pipe', 'pipe'],
});
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
    if (providerDone) throw new Error(`Provider fixture exited before readiness. ${backendOutput}`);
    try { info = JSON.parse(await readFile(infoFile, 'utf8')); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(100, undefined, { signal: interrupt.signal });
  }
  if (!info || typeof info.url !== 'string' || typeof info.token !== 'string') throw new Error('Provider fixture did not publish valid readiness information.');
  const url = new URL(info.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Provider fixture must listen on loopback.');
  const vitest = spawn(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'test/native-history.test.ts'], {
    cwd: root,
    env: { ...process.env, WAPILOT_HISTORY_ACCEPTANCE_URL: info.url, WAPILOT_HISTORY_ACCEPTANCE_TOKEN: info.token },
    stdio: 'inherit', signal: interrupt.signal,
  });
  const code = await new Promise((resolve, reject) => { vitest.once('error', reject); vitest.once('exit', resolve); });
  if (code !== 0) throw new Error(`Connected native history acceptance failed (${code}).`);
} finally {
  await writeFile(stopFile, 'stop');
  const timeout = new AbortController();
  const finished = await Promise.race([completion, delay(15000, { timedOut: true }, { signal: timeout.signal }).catch(() => ({}))]);
  timeout.abort();
  if (finished.timedOut) provider.kill('SIGTERM');
  process.removeListener('SIGINT', abort);
  process.removeListener('SIGTERM', abort);
  await rm(temporary, { recursive: true, force: true });
  if (finished.error) throw finished.error;
  if (finished.code !== undefined && finished.code !== 0) throw new Error(`Provider fixture failed (${finished.code}). ${backendOutput}`);
}
