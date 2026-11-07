import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const backend = join(root, '.scratch', 'evolution-go');

function executable(name, extraDirectories = []) {
  for (const directory of [...(process.env.PATH ?? '').split(delimiter), ...extraDirectories]) {
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(`GIF acceptance tests require ${name} on PATH.`);
}

function run(command, args, cwd, env = process.env, printOutput = true) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (printOutput || result.status !== 0) process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}

if (!existsSync(join(backend, 'go.mod'))) {
  throw new Error('Clone neurau/evolution-go into .scratch/evolution-go before running GIF acceptance tests.');
}

const go = executable('go', ['/usr/local/go/bin']);
executable('ffmpeg');
executable('ffprobe');
const validationDirectory = join(root, '.scratch', 'validation');
mkdirSync(validationDirectory, { recursive: true });
const temporaryDirectory = mkdtempSync(join(validationDirectory, 'gif-'));
const report = join(temporaryDirectory, 'wapilot.json');

run(process.execPath, [join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', 'test/outbound-history.test.ts', '-t', 'GIF acceptance', '--reporter=json', `--outputFile=${report}`], root);
const result = JSON.parse(readFileSync(report, 'utf8'));
if (result.numPassedTests < 1) throw new Error('No WaPilot GIF acceptance tests passed. Check the checkout version.');
console.log(`WaPilot GIF acceptance passed ${result.numPassedTests} tests.`);

const output = run(go, ['test', './pkg/sendMessage/handler', '-run', '^TestGIFAcceptance', '-count=1', '-json'], backend, {
  ...process.env,
  GOTMPDIR: temporaryDirectory,
  TMPDIR: temporaryDirectory,
}, false);
writeFileSync(join(temporaryDirectory, 'backend.jsonl'), output);
const events = output.trim().split('\n').map((line) => JSON.parse(line));
const passed = events.filter((event) => event.Action === 'pass' && /^TestGIFAcceptance\//.test(event.Test ?? ''));
if (!events.some((event) => event.Action === 'pass' && event.Test === 'TestGIFAcceptance') || passed.length < 1) {
  throw new Error('No backend GIF acceptance tests passed. Check the checkout version.');
}
console.log(`Backend GIF acceptance passed ${passed.length} cases with real FFmpeg and ffprobe.`);
