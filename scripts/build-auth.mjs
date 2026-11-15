import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const license = await readFile(root + 'third_party/clerk-localizations-LICENSE.txt', 'utf8');
const result = await build({ banner: { js: '/*! @clerk/localizations\n' + license.replace(/\*\//g, '* /') + '\n*/' }, entryPoints: [root + 'ui/auth.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'inline' });
const target = root + 'public/auth.js', output = result.outputFiles[0].text;
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8').catch(() => '') !== output) { console.error('Auth bundle is stale. Run npm run build:auth.'); process.exitCode = 1; }
} else await writeFile(target, output);
