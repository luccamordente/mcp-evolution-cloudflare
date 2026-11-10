import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { decode } from 'fast-png';

type PdfImage = { data: string };
type PageResult = { page: number; width: number; height: number; status: string };
type RenderResult = { totalPages: number; requestedPages: number[]; deliveredPages: number[]; images: PdfImage[]; pages: PageResult[] };
let runtime: Miniflare;

beforeAll(async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { processPdf, withPdf } from './src/lib/pdf-processing';
    export default { async fetch(request) {
      const bytes = new Uint8Array(await request.arrayBuffer());
      const page = Number(new URL(request.url).searchParams.get('page'));
      if (new URL(request.url).pathname === '/text') {
        return Response.json(await withPdf(bytes, request.signal, async document => {
          const selected = document.getPage(page - 1);
          try { return { text: selected.getText(), totalPages: document.getPageCount() }; }
          finally { selected.close(); }
        }));
      }
      const extra = JSON.parse(new URL(request.url).searchParams.get('options') ?? '{}');
      return Response.json(await processPdf(bytes, { pages: [page], preset: 'reading', ...extra }, request.signal));
    } };` }, bundle: true, write: false, format: 'esm', platform: 'browser', external: ['*.wasm', 'node:*'] });
  runtime = new Miniflare(convertV4MiniflareOptions({ compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'], modules: [
    { type: 'ESModule', path: 'index.js', contents: bundle.outputFiles[0].text },
    { type: 'CompiledWasm', path: '@hyzyla/pdfium/pdfium.wasm', contents: readFileSync('node_modules/@hyzyla/pdfium/dist/pdfium.wasm') },
  ] }));
});
afterAll(async () => { await runtime?.dispose(); });

async function request<T>(page: number, operation = '/', options = {}) {
  const response = await runtime.dispatchFetch(`https://local${operation}?page=${page}&options=${encodeURIComponent(JSON.stringify(options))}`, { method: 'POST', body: readFileSync('test/fixtures/document-matrix.pdf') });
  expect(response.status).toBe(200);
  return await response.json() as T;
}
const image = (result: RenderResult) => decode(Buffer.from(result.images[0].data, 'base64'));
const pixel = (png: ReturnType<typeof decode>, x: number, y: number) => Array.from(png.data.slice((y * png.width + x) * 4, (y * png.width + x) * 4 + 3));

it('reads scan pixels despite having no extractable text', async () => {
  expect(await request(2, '/text')).toEqual({ totalPages: 24, text: '' });
  const result = await request<RenderResult>(2);
  expect(result.pages).toEqual([{ page: 2, width: 1200, height: 1600, status: 'delivered', imageIndex: 0 }]);
  const png = image(result);
  expect(pixel(png, 200, 400)).toEqual([0, 0, 255]);
  expect(pixel(png, 900, 1200)).toEqual([255, 0, 0]);
});

it('preserves visual content on a page that also contains selectable text', async () => {
  expect((await request<{text: string}>(3, '/text')).text).toContain('Physical page 3');
  const png = image(await request<RenderResult>(3));
  expect(pixel(png, 700, 800)).toEqual([0, 179, 0]);
  expect(pixel(png, 100, 800)).toEqual([255, 255, 255]);
});

it('applies saved rotation to dimensions and marker placement', async () => {
  const result = await request<RenderResult>(4);
  expect(result.pages).toEqual([{ page: 4, width: 1200, height: 1600, status: 'delivered', imageIndex: 0 }]);
  const png = image(result);
  expect(pixel(png, 100, 100)).toEqual([255, 0, 0]);
  expect(pixel(png, 1000, 1000)).toEqual([0, 0, 255]);
});

it('renders the visible saved form value inside its field', async () => {
  const png = image(await request<RenderResult>(5));
  let inkPixels = 0;
  for (let y = 350; y < 390; y++) for (let x = 90; x < 350; x++) {
    const [r, g, b] = pixel(png, x, y);
    if (r < 100 && g < 100 && b < 100) inkPixels++;
  }
  expect(inkPixels).toBeGreaterThan(100);
});

it('delivers only the selected final page of an extensive document', async () => {
  const result = await request<RenderResult>(24);
  expect(result.totalPages).toBe(24);
  expect(result.requestedPages).toEqual([24]);
  expect(result.deliveredPages).toEqual([24]);
  expect(result.images).toHaveLength(1);
  expect(result.pages).toEqual([{ page: 24, width: 1200, height: 1600, status: 'delivered', imageIndex: 0 }]);
  expect((await request<{text: string}>(24, '/text')).text).toContain('Item 24');
});

it('keeps two scanned logical sheets distinct inside a single physical landscape page', async () => {
  expect((await request<{text: string}>(6, '/text')).text).toBe('');
  const result = await request<RenderResult>(6);
  expect(result.pages[0]).toMatchObject({ page: 6, width: 1600, height: 1200 });
  const png = image(result);
  expect(pixel(png, 400, 300)).toEqual([0, 0, 255]);
  expect(pixel(png, 1200, 900)).toEqual([255, 0, 0]);
  expect(pixel(png, 800, 600)).toEqual([230, 230, 230]);
});

it('preserves repeated units and table structure across two wide landscape pages', async () => {
  for (const page of [7, 8]) {
    const text = (await request<{text: string}>(page, '/text')).text;
    expect(text).toContain('Mass (kg)');
    expect(text).toContain('Flow (m3/s)');
    expect(text).toContain(page === 7 ? 'Rows 01-20' : 'Rows 21-40');
    const result = await request<RenderResult>(page);
    expect(result.pages[0]).toMatchObject({ width: 1600, height: 1066 });
    const png = image(result);
    const [r, g, b] = pixel(png, 435, 400);
    expect(Math.max(r, g, b)).toBeLessThan(90);
    expect(pixel(png, 1550, 100)).toEqual([255, 255, 255]);
  }
});

it('renders fine mathematical signs and units from the original into a detail crop', async () => {
  const text = (await request<{text: string}>(7, '/text')).text;
  expect(text).toContain('Fine detail: -0.003 kg; x = 2 + 3; preserve units.');
  const result = await request<RenderResult>(7, '/', { preset: 'detail', crop: {x: 0.04, y: 0.9, width: 0.4, height: 0.08} });
  const png = image(result);
  expect(png.width).toBe(2400);
  expect(png.height).toBe(320);
  let dark = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const [r, g, b] = pixel(png, x, y);
    if (Math.max(r, g, b) < 100) dark++;
  }
  expect(dark).toBeGreaterThan(300);
});

it('does not invent text for a poor-resolution scan while preserving its visible marker', async () => {
  expect((await request<{text: string}>(9, '/text')).text).toBe('');
  const result = await request<RenderResult>(9);
  expect(result.pages[0]).toMatchObject({width: 1200, height: 1600});
  expect(pixel(image(result), 600, 800)).toEqual([180, 180, 180]);
});
