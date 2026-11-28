import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const backend = resolve(process.env.WAPILOT_ACTIONS_GO_ROOT ?? join(root, '.scratch/evolution-go'));
await access(join(backend, 'pkg/message/acceptance/actions_connected_test.go'));
const temporary = await mkdtemp(join(tmpdir(), 'wapilot-actions-'));
const infoPath = join(temporary, 'server.json');
const stopPath = join(temporary, 'stop');

function finished(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code));
  });
}

const provider = spawn(process.env.WAPILOT_ACCEPTANCE_GO ?? 'go', ['test', './pkg/message/acceptance', '-run', '^TestMessageActionsConnectedServer$', '-count=1', '-v', '-timeout=10m'], {
  cwd: backend,
  env: { ...process.env, MESSAGE_ACTIONS_SERVER_INFO: infoPath, MESSAGE_ACTIONS_SERVER_STOP: stopPath },
  stdio: 'inherit',
  detached: true,
});
let providerDone = false;
const providerFinished = finished(provider).then(code => ({ code }), error => ({ error })).finally(() => { providerDone = true; });
const interrupt = new AbortController();
const abort = () => interrupt.abort();
process.once('SIGINT', abort);
process.once('SIGTERM', abort);

try {
  const deadline = Date.now() + 5 * 60 * 1000;
  let fixture;
  while (Date.now() < deadline) {
    interrupt.signal.throwIfAborted();
    if (providerDone) throw new Error('Go action fixture exited before readiness.');
    try {
      fixture = JSON.parse(await readFile(infoPath, 'utf8'));
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(100, undefined, { signal: interrupt.signal });
  }
  if (!fixture || typeof fixture.url !== 'string') throw new Error('Go action fixture did not publish readiness information.');
  const url = new URL(fixture.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Go action fixture must listen on loopback.');

  const vitest = spawn(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'test/update-message.connected.test.ts'], {
    cwd: root, env: { ...process.env, WAPILOT_ACTIONS_FIXTURE: fixture.url }, stdio: 'inherit', signal: interrupt.signal,
  });
  const code = await finished(vitest);
  if (code !== 0) throw new Error(`Connected message action acceptance failed (${code}).`);
} finally {
  try {
    await writeFile(stopPath, 'stop', { mode: 0o600 });
    const timeout = new AbortController();
    const result = await Promise.race([providerFinished, delay(15_000, null, { signal: timeout.signal })]);
    timeout.abort();
    if (!result) {
      try { process.kill(-provider.pid, 'SIGKILL'); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      await providerFinished;
      throw new Error('Go action fixture did not finish cleanup within 15 seconds.');
    }
    if (result.error) throw result.error;
    if (result.code !== 0) throw new Error(`Go action fixture failed (${result.code}).`);
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    await rm(temporary, { recursive: true, force: true });
  }
}
