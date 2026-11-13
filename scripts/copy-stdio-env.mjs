import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
if (existsSync(destination)) {
  console.log('Configuração stdio existente mantida (.env.stdio).');
  process.exit(0);
}
try {
  writeFileSync(destination, readFileSync(source), { flag: 'wx', mode: 0o600 });
  console.log('Configuração stdio copiada da worktree principal.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('Configuração stdio existente mantida (.env.stdio).');
  else if (error.code === 'ENOENT') console.warn('.env.stdio ausente na worktree principal; configure a partir de .env.stdio.example.');
  else throw error;
}
