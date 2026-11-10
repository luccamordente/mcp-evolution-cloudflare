import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { expect, it } from 'vitest';
import { decode } from 'fast-png';

it('renders detail directly into a clipped bitmap within workerd memory', async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { processPdf } from './src/lib/pdf-processing';
    export default { async fetch(request) {
      return Response.json(await processPdf(new Uint8Array(await request.arrayBuffer()), { pages: [1], preset: 'detail', crop: { x: 0, y: 0.4, width: 0.4, height: 0.6 } }, request.signal));
    } };` }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['*.wasm', 'node:*'] });
  const mf = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'], modules: [
    { type: 'ESModule', path: 'index.js', contents: bundle.outputFiles[0].text },
    { type: 'CompiledWasm', path: '@hyzyla/pdfium/pdfium.wasm', contents: readFileSync('node_modules/@hyzyla/pdfium/dist/pdfium.wasm') },
  ] }));
  try {
    const response = await mf.dispatchFetch('https://local/', { method: 'POST', body: readFileSync('test/fixtures/document-pages.pdf') });
    const result = await response.json() as any;
    expect(result.totalPages).toBe(1);
    expect(result.pages[0]).toMatchObject({ page: 1, width: 2400, height: 2400, status: 'delivered' });
    const png = decode(Buffer.from(result.images[0].data, 'base64'));
    expect(png.width).toBe(2400);
    const pixel = (x: number, y: number) => Array.from(png.data.slice((y * png.width + x) * 4, (y * png.width + x) * 4 + 3));
    expect(pixel(1500, 1500)).toEqual([255, 0, 0]);
    expect(pixel(50, 50)).toEqual([255, 255, 255]);
  } finally { await mf.dispose(); }
});
