import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = process.env.ORCA_WORKTREE_PATH
  || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(workspace, '.tokensave/config.json');

const envCopy = spawnSync(process.execPath, [resolve(dirname(fileURLToPath(import.meta.url)), 'copy-stdio-env.mjs'), workspace], { stdio: 'inherit' });
if (envCopy.error || envCopy.status !== 0) throw new Error('Não foi possível copiar a configuração stdio para a worktree.');

function run(...args) {
  const result = spawnSync('tokensave', args, {
    cwd: workspace,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`tokensave ${args.join(' ')} falhou`);
}

// O índice pertence à worktree; copiar o da principal mistura código de branches.
try {
  run('--version');
  if (!existsSync(configPath)) {
    run('init', '--cpu-usage', 'balanced', '--no-git-hook');
  }

  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const before = JSON.stringify(config);
  // Artefatos ampliam a busca literal para arquivos sem extrator de símbolos.
  const additions = {
    artifact_extensions: ['css', 'html', 'jsonc', 'webmanifest'],
    include: ['.github', '.github/**', '.scratch', '.scratch/*.md'],
    exclude: ['**/.agents/**', '**/.claude/**', '**/.codex/**', '**/.cursor/**'],
  };
  for (const [key, values] of Object.entries(additions)) {
    config[key] = [...new Set([...(config[key] ?? []), ...values])].sort();
  }

  const changed = JSON.stringify(config) !== before;
  if (changed) writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  // init registra main; a branch da worktree precisa ser rastreada explicitamente.
  run('branch', 'add');
  run('sync', ...(changed ? ['--force'] : []));
  console.log('Índice TokenSave desta worktree pronto.');
} catch (error) {
  // Ferramenta opcional: sua ausência ou falha não impede o setup do workspace.
  console.warn(error.code === 'ENOENT' && error.path === 'tokensave'
    ? 'TokenSave não instalado; indexação pulada.'
    : `Não foi possível preparar o TokenSave: ${error.message}. Execute node scripts/worktree-setup.mjs para tentar novamente.`);
}
