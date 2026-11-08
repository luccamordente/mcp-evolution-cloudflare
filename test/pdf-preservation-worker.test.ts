import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { afterAll, beforeAll, expect, it } from 'vitest';

let runtime: Miniflare;

function twoPagePdf() {
  const stream = (text: string) => `BT /F1 18 Tf 10 50 Td (${text}) Tj ET`;
  const first = stream('First page');
  const second = stream('Second page');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${first.length} >>\nstream\n${first}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${second.length} >>\nstream\n${second}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let text = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

beforeAll(async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import { inspectPdf } from './src/lib/pdf-inspection';
      import { processPdf } from './src/lib/pdf-processing';
      export default { async fetch(request) {
        const bytes = new Uint8Array(await request.arrayBuffer());
        const mode = new URL(request.url).pathname.slice(1);
        try {
          const value = mode === 'inspect'
            ? await inspectPdf(bytes, { limit: 5 }, request.signal)
            : await processPdf(bytes, {
                pages: [2], preset: mode === 'detail' ? 'detail' : 'preview',
                ...(mode === 'detail' ? { crop: { x: 0, y: 0, width: 0.5, height: 1 } } : {}),
              }, request.signal);
          return Response.json(value);
        } catch (error) { return Response.json({ message: error.message }, { status: error.status ?? 500 }); }
      } };
    ` },
    bundle: true, write: false, format: 'esm', platform: 'browser', external: ['node:*'],
    plugins: [{ name: 'pdfium-module', setup(builder) {
      builder.onResolve({ filter: /pdfium\.wasm$/ }, () => ({ path: './pdfium.wasm', external: true }));
    } }],
  });
  runtime = new Miniflare(convertV4MiniflareOptions({
    modulesRoot: process.cwd(),
    modules: [
      { type: 'ESModule', path: resolve('worker.js'), contents: bundle.outputFiles[0].text },
      { type: 'CompiledWasm', path: resolve('pdfium.wasm'), contents: await readFile(resolve('node_modules/@hyzyla/pdfium/dist/pdfium.wasm')) },
    ],
    compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'],
  }));
});

afterAll(async () => { await runtime?.dispose(); });

it('preserves native PDF page inspection and physical page text in Workers', async () => {
  const response = await runtime.dispatchFetch('https://local/inspect', { method: 'POST', body: twoPagePdf() });
  const value = await response.json();
  expect(response.status).toBe(200);
  expect(value).toMatchObject({ totalPages: 2, pages: [
    { page: 1, width: 200, height: 100, text: 'First page' },
    { page: 2, width: 200, height: 100, text: 'Second page' },
  ] });
});

it.each(['preview', 'detail'])('preserves real PDF %s rendering in Workers', async mode => {
  const response = await runtime.dispatchFetch('https://local/' + mode, { method: 'POST', body: twoPagePdf() });
  const value = await response.json() as { totalPages: number; complete: boolean; deliveredPages: number[]; images: Array<{ type: string; mimeType: string; data: string }> };
  expect({ status: response.status, ...value }).toMatchObject({ status: 200, totalPages: 2, complete: true, deliveredPages: [2] });
  expect(value.images).toHaveLength(1);
  expect(value.images[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  const png = Buffer.from(value.images[0].data, 'base64');
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual(mode === 'preview' ? [640, 320] : [2400, 2400]);
});
