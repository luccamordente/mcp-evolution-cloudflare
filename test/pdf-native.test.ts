import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { expect, it } from 'vitest';
import { decode } from 'fast-png';

it('owns an explicit native PDF handle for bounded page inspection in workerd', async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { withNativePdf } from './src/lib/pdfium-runtime';
    export default { async fetch(request) {
      return Response.json(await withNativePdf(new Uint8Array(await request.arrayBuffer()), request.signal, async ctx => ({totalPages: ctx.call('FPDF_GetPageCount', ctx.document)})));
    } };` }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['*.wasm', 'node:*'] });
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'], modules: [
    { type: 'ESModule', path: 'index.js', contents: bundle.outputFiles[0].text },
    { type: 'CompiledWasm', path: '@hyzyla/pdfium/pdfium.wasm', contents: readFileSync('node_modules/@hyzyla/pdfium/dist/pdfium.wasm') },
  ] }));
  try {
    const response = await mf.dispatchFetch('https://local/', { method: 'POST', body: readFileSync('test/fixtures/document-pages.pdf') });
    const result = await response.json() as any;
    expect(result.totalPages).toBe(1);
  } finally { await mf.dispose(); }
});
