import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decode } from 'fast-png';
import { processPdf } from '../src/lib/pdf-processing';

it('renders a region from original coordinates with detail resolution', async () => {
  const bytes = new Uint8Array(readFileSync('test/fixtures/document-pages.pdf'));
  const result = await processPdf(bytes, { pages: [1], preset: 'detail', crop: { x: 0, y: 0.4, width: 0.4, height: 0.6 } }, new AbortController().signal);
  expect(result.pages[0]).toMatchObject({ page: 1, status: 'delivered', width: 2400, height: 2400 });
  const png = decode(Buffer.from(result.images[0].data, 'base64'));
  const at = (x:number,y:number) => Array.from(png.data.slice((y * png.width + x)*4,(y*png.width+x)*4+3));
  expect(at(1500,1500)).toEqual([255,0,0]);
  expect(at(50,50)).toEqual([255,255,255]);
});

it('recovers a vector marker lost at reading resolution instead of enlarging a thumbnail', async () => {
  const bytes = new Uint8Array(readFileSync('test/fixtures/document-pages.pdf'));
  const result = await processPdf(bytes, { pages: [1], preset: 'detail', crop: { x: 0.8, y: 0.2, width: 0.1, height: 0.1 } }, new AbortController().signal);
  const detail = decode(Buffer.from(result.images[0].data, 'base64'));
  const sample = (image: ReturnType<typeof decode>, x:number,y:number) => Array.from(image.data.slice((y * image.width + x)*4,(y*image.width+x)*4+3));
  expect(sample(detail, 800, 760)).toEqual([0,0,255]);
  const reading = await processPdf(bytes, { pages: [1], preset: 'reading' }, new AbortController().signal);
  const full = decode(Buffer.from(reading.images[0].data, 'base64'));
  expect(sample(full, 1333, 263)).not.toEqual([0,0,255]);
});
