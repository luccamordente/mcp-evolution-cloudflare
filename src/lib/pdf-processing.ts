import { type PDFiumDocument } from '@hyzyla/pdfium';
import { encode } from 'fast-png';
import { Buffer } from 'node:buffer';
import type { Env } from '../types';
import type { EvolutionGoClient } from './evolution';

export const PDF_PRESETS = { preview: 640, reading: 1600, detail: 2400 } as const;
export { PDF_TIMEOUT_MS, PdfProcessingError, checkPdfDeadline } from './pdf-policy';
import { PDF_TIMEOUT_MS, PdfProcessingError, checkPdfDeadline, withPdfDownload } from './pdf-policy';
export const MAX_PDF_OUTPUT_BYTES = 8 * 1024 * 1024 - 64 * 1024; // Reserve room for metadata and the MCP envelope.

export type PdfRequest = { pages: number[]; preset: keyof typeof PDF_PRESETS; crop?: import('./pdf-detail').PdfCrop };

export async function withPdf<T>(bytes: Uint8Array, signal: AbortSignal, fn: (document: PDFiumDocument) => Promise<T>, expiresAt = Date.now() + PDF_TIMEOUT_MS): Promise<T> {
  checkPdfDeadline(signal, expiresAt);
  const { createPdfLibrary } = await import('./pdfium-runtime');
  checkPdfDeadline(signal, expiresAt);
  const library = await createPdfLibrary();
  let document: PDFiumDocument | undefined;
  try {
    checkPdfDeadline(signal, expiresAt);
    try { document = await library.loadDocument(bytes); }
    catch { throw new PdfProcessingError('pdf_invalid', 422, 'WaPilot cannot open this PDF. It may be invalid, protected or unsupported.'); }
    checkPdfDeadline(signal, expiresAt);
    if (document.getPageCount() > 2000) throw new PdfProcessingError('pdf_limit', 413, 'WaPilot supports PDFs with at most 2,000 pages.');
    checkPdfDeadline(signal, expiresAt);
    const result = await fn(document);
    checkPdfDeadline(signal, expiresAt);
    return result;
  } catch (error) {
    if (signal.aborted || error instanceof PdfProcessingError) throw error;
    throw new PdfProcessingError('pdf_page_unavailable', 422, 'WaPilot could not process this PDF page. It is unavailable, not blank.');
  } finally { document?.destroy(); library.destroy(); }
}

export async function processPdf(bytes: Uint8Array, options: PdfRequest, signal: AbortSignal, expiresAt = Date.now() + PDF_TIMEOUT_MS) {
  checkPdfDeadline(signal, expiresAt);
  if (options.crop) {
    const c = options.crop;
    if (options.pages.length !== 1 || ![c.x,c.y,c.width,c.height].every(Number.isFinite) || c.x < 0 || c.y < 0 || c.width <= 0 || c.height <= 0 || c.x + c.width > 1 || c.y + c.height > 1) throw new PdfProcessingError('pdf_limit', 422, 'WaPilot requires one page and a nonempty crop within its visible bounds.');
    const { processPdfDetail } = await import('./pdf-detail');
    return processPdfDetail(bytes, { ...options, crop: options.crop }, signal, expiresAt);
  }
  return withPdf(bytes, signal, async document => {
    const totalPages = document.getPageCount();
    if (options.pages.some(page => page < 1 || page > totalPages)) throw new PdfProcessingError('pdf_page_unavailable', 422, `WaPilot requires page positions between 1 and ${totalPages}.`);
    const pages: ({ page: number; width: number; height: number; status: 'delivered'; imageIndex: number } | { page: number; status: 'failed'; code: string; message: string })[] = [];
    const images: { type: 'image'; mimeType: 'image/png'; data: string }[] = [];
    let encodedBytes = 0;
    let renderedPixels = 0;
    for (const number of options.pages) {
      checkPdfDeadline(signal, expiresAt);
      let page: ReturnType<PDFiumDocument['getPage']> | undefined;
      try {
        page = document.getPage(number - 1);
        checkPdfDeadline(signal, expiresAt);
        const { originalWidth: w, originalHeight: h } = page.getOriginalSize();
        if (![w, h].every(n => Number.isFinite(n) && n > 0 && n <= 14_400)) throw new PdfProcessingError('pdf_limit', 413, 'WaPilot cannot render these page dimensions.');
        const scale = PDF_PRESETS[options.preset] / Math.max(w, h);
        const width = Math.floor(w * scale), height = Math.floor(h * scale);
        if (width < 1 || height < 1 || width * height > 10_240_000) throw new PdfProcessingError('pdf_limit', 413, 'WaPilot page pixel limit exceeded.');
        if (renderedPixels + width * height > 8_000_000) throw new PdfProcessingError('pdf_limit', 413, 'WaPilot batch exceeds 8 million pixels. Continue with fewer pages or previews.');
        renderedPixels += width * height;
        checkPdfDeadline(signal, expiresAt);
        const bitmap = await page.render({ scale, renderFormFields: true });
        checkPdfDeadline(signal, expiresAt);
        const png = encode({ width: bitmap.width, height: bitmap.height, data: bitmap.data, channels: 4 });
        checkPdfDeadline(signal, expiresAt);
        const data = Buffer.from(png).toString('base64');
        if (encodedBytes + data.length > MAX_PDF_OUTPUT_BYTES) throw new PdfProcessingError('pdf_limit', 413, 'WaPilot PDF response exceeds 8 MiB encoded. Request fewer pages or a preview.');
        encodedBytes += data.length;
        pages.push({ page: number, width: bitmap.width, height: bitmap.height, status: 'delivered', imageIndex: images.length });
        images.push({ type: 'image', mimeType: 'image/png', data });
      } catch (error) {
        checkPdfDeadline(signal, expiresAt);
        pages.push({ page: number, status: 'failed', code: error instanceof PdfProcessingError ? error.code : 'pdf_page_unavailable', message: error instanceof PdfProcessingError ? error.message : 'WaPilot could not render this page. It is unavailable, not blank. Request this page separately.' });
      } finally { page?.close(); }
    }
    const deliveredPages = pages.filter(page => page.status === 'delivered').map(page => page.page);
    const failedPages = pages.filter(page => page.status === 'failed').map(page => page.page);
    return { totalPages, preset: options.preset, requestedPages: options.pages, deliveredPages, failedPages, complete: failedPages.length === 0, pages, images,
      continuation: 'Request the next explicit page positions (at most 3). Retry failed pages separately with preview or a smaller crop when available; no reading state is stored.',
      note: 'Physical page positions start at 1. Rendered appearance may omit unsupported interactive features. Preview images do not establish reading coverage; low-resolution originals may remain illegible.' };
  }, expiresAt);
}

export async function readDocumentPages(client: EvolutionGoClient, env: Pick<Env, 'DOCUMENT_STORAGE_ORIGINS' | 'EVOLUTION_BASE_URL' | 'MAX_MEDIA_BYTES'>, messageId: string, options: PdfRequest, parentSignal: AbortSignal) {
  return withPdfDownload(client, env, messageId, parentSignal,
    kind => new PdfProcessingError(kind === 'cancel' ? 'request_cancelled' : 'wapilot_timeout', kind === 'cancel' ? 499 : 504, kind === 'cancel' ? 'WaPilot PDF reading was cancelled.' : 'WaPilot PDF reading exceeded 60 seconds. Request fewer pages.'),
    async (blob, signal, expiresAt) => processPdf(new Uint8Array(await blob.arrayBuffer()), options, signal, expiresAt));
}
