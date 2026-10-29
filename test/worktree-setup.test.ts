import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/worktree-setup.mjs', import.meta.url));
const workspaces: string[] = [];
afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

function fixture() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'tokensave setup ')));
  workspaces.push(workspace);
  const bin = join(workspace, 'bin');
  mkdirSync(bin);
  return { workspace, bin };
}

function run(workspace: string, path: string) {
  return spawnSync(process.execPath, [script], {
    cwd: tmpdir(),
    env: { ...process.env, ORCA_WORKTREE_PATH: workspace, PATH: path },
    encoding: 'utf8',
  });
}

it('cria um índice local e repete o setup sem perder configurações ou reindexar tudo', () => {
  const { workspace, bin } = fixture();
  writeFileSync(join(bin, 'tokensave'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('calls', args.join(' ') + '\\n');
if (args[0] === 'init') {
  fs.mkdirSync('.tokensave');
  fs.writeFileSync('.tokensave/config.json', JSON.stringify({
    root_dir: process.cwd(), cpu_usage: 'balanced', git_ignore: true,
    exclude: ['custom/**'], artifact_extensions: ['md'],
  }));
}
`, { mode: 0o755 });
  const path = `${bin}${delimiter}${process.env.PATH}`;
  expect(run(workspace, path).status).toBe(0);
  const configPath = join(workspace, '.tokensave/config.json');
  const firstConfig = readFileSync(configPath, 'utf8');
  expect(JSON.parse(firstConfig)).toMatchObject({
    root_dir: workspace,
    cpu_usage: 'balanced',
    git_ignore: true,
    exclude: expect.arrayContaining(['custom/**', '**/.agents/**']),
    artifact_extensions: expect.arrayContaining(['md', 'jsonc', 'html', 'css', 'webmanifest']),
    include: expect.arrayContaining(['.github/**', '.scratch/*.md']),
  });
  expect(run(workspace, path).status).toBe(0);
  expect(readFileSync(configPath, 'utf8')).toBe(firstConfig);
  expect(readFileSync(join(workspace, 'calls'), 'utf8').trim().split('\n')).toEqual([
    '--version', 'init --cpu-usage balanced --no-git-hook', 'branch add', 'sync --force',
    '--version', 'branch add', 'sync',
  ]);
});

it('permite o setup quando o tokensave não está instalado', () => {
  const { workspace, bin } = fixture();
  const result = run(workspace, bin);
  expect(result.status).toBe(0);
  expect(result.stderr).toContain('TokenSave não instalado');
});

it('informa a falha da indexação sem impedir o setup', () => {
  const { workspace, bin } = fixture();
  writeFileSync(join(bin, 'tokensave'), `#!${process.execPath}
process.exit(process.argv[2] === '--version' ? 0 : 1);
`, { mode: 0o755 });
  const result = run(workspace, bin);
  expect(result.status).toBe(0);
  expect(result.stderr).toContain('Não foi possível preparar o TokenSave');
  expect(result.stderr).toContain('Execute node scripts/worktree-setup.mjs');
});
