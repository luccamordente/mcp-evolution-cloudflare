import { copyFileSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const devVars = resolve(root, '.dev.vars');
const exampleVars = resolve(root, '.dev.vars.example');
const persistTo = resolve(root, '.wrangler/local-dev');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

if (!existsSync(devVars)) {
  copyFileSync(exampleVars, devVars);
  console.log('Criado .dev.vars com segredos locais de desenvolvimento.');
}

const migration = spawnSync(npx, [
  'wrangler', 'd1', 'migrations', 'apply', 'mcp-evolution',
  '--env', 'local', '--local', '--persist-to', persistTo,
], { cwd: root, stdio: 'inherit' });

if (migration.status !== 0) process.exit(migration.status ?? 1);

const worker = spawn(npx, [
  'wrangler', 'dev', '--env', 'local', '--local', '--persist-to', persistTo,
  ...process.argv.slice(2),
], { cwd: root, stdio: 'inherit' });

const stop = (signal) => worker.kill(signal);
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
worker.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
