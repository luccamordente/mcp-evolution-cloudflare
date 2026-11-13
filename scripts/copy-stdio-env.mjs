import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const workspace = resolve(process.argv[2] ?? process.cwd());
const git = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: workspace, encoding: 'utf8' });
if (git.error || git.status !== 0) {
  console.warn('Git indisponível ou diretório sem checkout; cópia da configuração local pulada.');
  process.exit(0);
}
const files = process.argv.length > 3 ? process.argv.slice(3) : ['.env.stdio'];
for (const file of files) {
  const source = resolve(dirname(git.stdout.trim()), file);
  const destination = resolve(workspace, file);
  if (source !== destination) {
    try {
      const contents = readFileSync(source);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      writeFileSync(destination, contents, { flag: 'wx', mode: 0o600 });
      console.log('Configuração local copiada da worktree principal.');
    } catch (error) {
      if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error;
    }
  }
}
