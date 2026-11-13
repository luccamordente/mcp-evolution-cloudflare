import { expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, resolve } from 'node:path';

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
    git('worktree', 'add', '--detach', child);
    expect(await readFile(resolve(child, '.env.stdio'), 'utf8')).toBe(fixture);
    expect((await stat(resolve(child, '.env.stdio'))).mode & 0o777).toBe(0o600);
    await writeFile(resolve(child, '.env.stdio'), 'worktree-specific');
    execFileSync(process.execPath, [helper, child], { stdio: 'pipe' });
    expect(await readFile(resolve(child, '.env.stdio'), 'utf8')).toBe('worktree-specific');
    expect(await readFile(resolve(main, '.env.stdio'), 'utf8')).toBe(fixture);
    await rm(resolve(main, '.env.stdio'));
    await rm(resolve(child, '.env.stdio'));
    execFileSync(process.execPath, [helper, child], { stdio: 'pipe' });
    await expect(stat(resolve(child, '.env.stdio'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('copies the configured Clerk inputs through the Orca setup without sharing runtime state or replacing existing files', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'wapilot clerk env '));
  const main = resolve(root, 'main');
  const child = resolve(root, 'child worktree');
  const inputs = ['.env.stdio', '.env.clerk', '.wrangler/clerk-test/tls/localhost.pem', '.wrangler/clerk-test/tls/localhost-key.pem'];
  const excluded = ['.dev.vars', '.wrangler/clerk-test/secrets.json', '.wrangler/clerk-test/runtime.env', '.wrangler/clerk-test/bindings/state.sqlite', '.wrangler/clerk-test/tls/rootCA-key.pem'];
  const git = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { stdio: 'pipe' });
  try {
    execFileSync('git', ['init', main], { stdio: 'pipe' });
    git('config', 'core.hooksPath', resolve(main, '.git/hooks'));
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'fixture');
    git('worktree', 'add', '--detach', child);
    for (const file of [...inputs, ...excluded]) {
      await mkdir(dirname(resolve(main, file)), { recursive: true });
      await writeFile(resolve(main, file), 'synthetic-main-' + file);
    }
    await mkdir(resolve(child, 'scripts'));
    for (const script of ['worktree-setup.mjs', 'copy-stdio-env.mjs']) await cp(resolve('scripts', script), resolve(child, 'scripts', script));
    const bin = resolve(root, 'bin');
    await mkdir(bin);
    await writeFile(resolve(bin, 'tokensave'), '#!/bin/sh\nexit 127\n', { mode: 0o755 });
    const setup = (await readFile('orca.yaml', 'utf8')).match(/^\s*setup:\s*(.+)$/m)?.[1];
    expect(setup).toBeDefined();
    const run = () => execFileSync('/bin/sh', ['-ec', setup!], { env: { ...process.env, ORCA_WORKTREE_PATH: child, PATH: bin + delimiter + process.env.PATH }, encoding: 'utf8', stdio: 'pipe' });
    const output = run();
    for (const file of inputs) {
      expect(await readFile(resolve(child, file), 'utf8')).toBe('synthetic-main-' + file);
      expect((await stat(resolve(child, file))).mode & 0o777).toBe(0o600);
      await writeFile(resolve(child, file), 'worktree-specific');
    }
    for (const file of excluded) await expect(stat(resolve(child, file))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(output).not.toContain('synthetic-main-');
    run();
    for (const file of inputs) {
      expect(await readFile(resolve(child, file), 'utf8')).toBe('worktree-specific');
      expect(await readFile(resolve(main, file), 'utf8')).toBe('synthetic-main-' + file);
      await rm(resolve(main, file));
      await rm(resolve(child, file));
    }
    run();
    for (const file of inputs) await expect(stat(resolve(child, file))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
