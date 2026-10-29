import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const workspace = resolve(process.argv[2] ?? process.cwd());
const git = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: workspace, encoding: 'utf8' });
if (git.error || git.status !== 0) {
  console.warn('Git indisponível ou diretório sem checkout; cópia da configuração stdio pulada.');
  process.exit(0);
}
const source = resolve(dirname(git.stdout.trim()), '.env.stdio');
const destination = resolve(workspace, '.env.stdio');
if (source !== destination) {
  try {
    writeFileSync(destination, readFileSync(source), { flag: 'wx', mode: 0o600 });
    console.log('Configuração stdio copiada da worktree principal.');
  } catch (error) {
    if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error;
  }
}
