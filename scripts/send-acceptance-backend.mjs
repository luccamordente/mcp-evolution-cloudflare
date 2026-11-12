import { mkdtemp, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { accessSync, constants } from 'node:fs';

const root = resolve(import.meta.dirname, '..');
const backend = resolve(process.env.WAPILOT_SEND_ACCEPTANCE_BACKEND ?? join(root, '.scratch', 'evolution-go'));
function goExecutable() {
  if (process.env.WAPILOT_ACCEPTANCE_GO) return process.env.WAPILOT_ACCEPTANCE_GO;
  for (const directory of [...(process.env.PATH ?? '').split(delimiter), '/usr/local/go/bin']) {
    const candidate = join(directory, process.platform === 'win32' ? 'go.exe' : 'go');
    try { accessSync(candidate, constants.X_OK); return candidate; } catch {}
  }
  throw new Error('Send acceptance requires Go on PATH or WAPILOT_ACCEPTANCE_GO.');
}
const go = goExecutable();

async function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: backend, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? accept() : reject(new Error(`${command} exited ${code}\n${stderr}\n${stdout}`)));
  });
  return stdout.trim();
}

function inject(source, marker, addition) {
  if (source.split(marker).length !== 2) throw new Error(`Acceptance hook requires exactly one occurrence of ${marker}`);
  return source.replace(marker, marker + addition);
}

export async function startSendAcceptanceBackend({ signal } = {}) {
  const temporary = await mkdtemp(join(tmpdir(), 'wapilot-send-acceptance-'));
  try {
    const module = JSON.parse(await run(go, ['list', '-m', '-json', 'go.mau.fi/whatsmeow'], { signal }));
    const dependency = join(temporary, 'whatsmeow');
    await cp(module.Dir, dependency, { recursive: true });
    await run('chmod', ['-R', 'u+w', dependency], { signal });
    const modfile = join(temporary, 'go.mod');
    await cp(join(backend, 'go.mod'), modfile);
    await cp(join(backend, 'go.sum'), join(temporary, 'go.sum'));
    await run(go, ['mod', 'edit', `-modfile=${modfile}`, `-replace=go.mau.fi/whatsmeow=${dependency}`], { signal });
    const originals = {
      send: join(dependency, 'send.go'),
      upload: join(dependency, 'upload.go'),
      client: join(dependency, 'client.go'),
    };
    let send = await readFile(originals.send, 'utf8');
    send = inject(send, 'func (cli *Client) SendMessage(ctx context.Context, to types.JID, message *waE2E.Message, extra ...SendRequestExtra) (resp SendResponse, err error) {', '\nif WapilotAcceptanceSend != nil { return WapilotAcceptanceSend(ctx, to, message, extra...) }\n');
    send += '\nvar WapilotAcceptanceSend func(context.Context, types.JID, *waE2E.Message, ...SendRequestExtra) (SendResponse, error)\nvar WapilotAcceptanceUpload func(context.Context, []byte, MediaType) (UploadResponse, error)\n';
    const upload = inject(await readFile(originals.upload, 'utf8'), 'func (cli *Client) Upload(ctx context.Context, plaintext []byte, appInfo MediaType) (resp UploadResponse, err error) {', '\nif WapilotAcceptanceUpload != nil { return WapilotAcceptanceUpload(ctx, plaintext, appInfo) }\n');
    const client = inject(await readFile(originals.client, 'utf8'), 'func (cli *Client) IsConnected() bool {', '\nif WapilotAcceptanceSend != nil { return true }\n');
    const replace = {};
    for (const [name, source] of Object.entries({ send, upload, client })) {
      const overlay = join(temporary, `${name}.go`);
      await writeFile(overlay, source);
      replace[originals[name]] = overlay;
    }
    const overlay = join(temporary, 'overlay.json');
    await writeFile(overlay, JSON.stringify({ Replace: replace }));
    const binary = join(temporary, 'backend');
    await run(go, ['build', `-modfile=${modfile}`, `-overlay=${overlay}`, '-o', binary, join(root, 'scripts', 'send-acceptance-backend.go')], { signal });
    const child = spawn(binary, [], { signal, cwd: backend, env: { ...process.env, WAPILOT_ACCEPTANCE_TMP: temporary }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const lines = createInterface({ input: child.stdout });
    const url = await new Promise((accept, reject) => {
      const timeout = setTimeout(() => { child.kill(); reject(new Error(`Acceptance backend did not start\n${stderr}`)); }, 15000);
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Acceptance backend exited ${code}\n${stderr}`)); });
      lines.on('line', line => {
        if (line.startsWith('WAPILOT_ACCEPTANCE_URL=')) {
          clearTimeout(timeout);
          accept(line.slice('WAPILOT_ACCEPTANCE_URL='.length));
        }
      });
    });
    let closing;
    return {
      url,
      close() {
        return closing ??= (async () => {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = new Promise(accept => child.once('exit', accept));
          child.kill('SIGTERM');
          await exited;
        }
        lines.close();
        await rm(temporary, { recursive: true, force: true });
        })();
      },
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController();
  const interrupt = () => { process.exitCode = 130; cancellation.abort(); };
  const terminate = () => { process.exitCode = 143; cancellation.abort(); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  let backend;
  let reports;
  try {
    backend = await startSendAcceptanceBackend({ signal: cancellation.signal });
    reports = await mkdtemp(join(tmpdir(), 'wapilot-send-report-'));
    const report = join(reports, 'vitest.json');
    const child = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', '--reporter=json', `--outputFile=${report}`, 'test/send-message.test.ts', 'test/send-message-backend.test.ts'], {
      signal: cancellation.signal, cwd: root, stdio: 'inherit', env: { ...process.env, WAPILOT_SEND_ACCEPTANCE_URL: backend.url },
    });
    process.exitCode = await new Promise((accept, reject) => { child.once('error', reject); child.once('exit', code => accept(code ?? 1)); });
    if (process.exitCode === 0) {
      const result = JSON.parse(await readFile(report, 'utf8'));
      const native = result.testResults.find(test => basename(test.name) === 'send-message-backend.test.ts')?.assertionResults ?? [];
      if (native.length < 14 || native.some(test => test.status !== 'passed')) throw new Error('Native send acceptance did not execute every required case.');
      console.log(`Send acceptance passed ${result.numPassedTests} tests, including ${native.length} native Go cases.`);
    }
  } catch (error) {
    if (!cancellation.signal.aborted) throw error;
  } finally {
    await backend?.close();
    if (reports) await rm(reports, { recursive: true, force: true });
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}
