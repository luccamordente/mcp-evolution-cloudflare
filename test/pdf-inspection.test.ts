import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { expect, it } from 'vitest';

it('inspects real page text, labels and bookmarks in workerd without creating images', async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { inspectPdf } from './src/lib/pdf-inspection';
    export default { async fetch(request) {
      return Response.json(await inspectPdf(new Uint8Array(await request.arrayBuffer()), {limit: 3}, request.signal));
    } };` }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['*.wasm', 'node:*'] });
  const runtime = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'], modules: [
    { type: 'ESModule', path: 'index.js', contents: bundle.outputFiles[0].text },
    { type: 'CompiledWasm', path: '@hyzyla/pdfium/pdfium.wasm', contents: readFileSync('node_modules/@hyzyla/pdfium/dist/pdfium.wasm') },
  ] }));
  try {
    const response = await runtime.dispatchFetch('https://local/', { method: 'POST', body: readFileSync('test/fixtures/document-inspection.pdf') });
    expect(response.status).toBe(200);
    const result = await response.json() as {nextCursor: string; pages: Array<{page: number; label?: string; text: string}>; bookmarks: Array<{title: string; page: number}>};
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toMatchObject({ page: 1, label: 'i' });
    expect(result.pages[0].text).toContain('Line 000:');
    expect(result.nextCursor).toBe('1:4000');
    expect(result.bookmarks[1]).toMatchObject({title: 'Header and visual content', page: 2});
    expect(result).not.toHaveProperty('images');
    const matrix = await runtime.dispatchFetch('https://local/', { method: 'POST', body: readFileSync('test/fixtures/document-matrix.pdf') });
    const mapped = await matrix.json() as {totalPages: number; pages: Array<{page: number; text: string; textStatus: string}>};
    expect(mapped.totalPages).toBe(24);
    expect(mapped.pages[1]).toMatchObject({page: 2, text: '', textStatus: 'none'});
    expect(mapped.pages[2].text).toContain('Physical page 3');
  } finally { await runtime.dispose(); }
});
