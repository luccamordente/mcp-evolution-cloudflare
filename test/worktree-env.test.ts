import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

it('copies the main stdio configuration when Git creates a worktree, with private permissions and without replacing local changes', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'wapilot env '));
  const main = resolve(root, 'main');
  const child = resolve(root, 'child worktree');
  const helper = resolve('scripts/copy-stdio-env.mjs');
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  const git = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { stdio: 'pipe' });
  try {
    execFileSync('git', ['init', main], { stdio: 'pipe' });
    git('config', 'core.hooksPath', resolve(main, '.git/hooks'));
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'fixture');
    await writeFile(resolve(main, '.git/hooks/post-checkout'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(helper)} "$(git rev-parse --show-toplevel)"\n`, { mode: 0o755 });
    const fixture = 'LOCAL_INSTANCE_TOKEN=fixture-only\n';
    await writeFile(resolve(main, '.env.stdio'), fixture);
    const copied = spawnSync('git', ['-C', main, 'worktree', 'add', '--detach', child], { encoding: 'utf8' });
    expect(copied.status).toBe(0);
    expect(copied.stdout + copied.stderr).toContain('Configuração stdio copiada da worktree principal.');
    expect(copied.stdout + copied.stderr).not.toContain('fixture-only');
    expect(await readFile(resolve(child, '.env.stdio'), 'utf8')).toBe(fixture);
    expect((await stat(resolve(child, '.env.stdio'))).mode & 0o777).toBe(0o600);
    await writeFile(resolve(child, '.env.stdio'), 'worktree-specific');
    expect(execFileSync(process.execPath, [helper, child], { stdio: 'pipe', encoding: 'utf8' }))
      .toContain('Configuração stdio existente mantida (.env.stdio).');
    expect(await readFile(resolve(child, '.env.stdio'), 'utf8')).toBe('worktree-specific');
    expect(await readFile(resolve(main, '.env.stdio'), 'utf8')).toBe(fixture);
    await rm(resolve(main, '.env.stdio'));
    expect(execFileSync(process.execPath, [helper, child], { stdio: 'pipe', encoding: 'utf8' }))
      .toContain('Configuração stdio existente mantida (.env.stdio).');
    expect(await readFile(resolve(child, '.env.stdio'), 'utf8')).toBe('worktree-specific');
    await rm(resolve(child, '.env.stdio'));
    const missing = spawnSync(process.execPath, [helper, child], { encoding: 'utf8' });
    expect(missing.status).toBe(0);
    expect(missing.stderr).toContain('.env.stdio ausente na worktree principal; configure a partir de .env.stdio.example.');
    await expect(stat(resolve(child, '.env.stdio'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
