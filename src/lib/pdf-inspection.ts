import type { Env } from '../types';
import type { EvolutionGoClient } from './evolution';
import type { PdfNativeContext } from './pdfium-runtime';
import { PdfProcessingError, PDF_TIMEOUT_MS, checkPdfDeadline } from './pdf-processing';
import { DocumentReadingError } from './document-reading';
import { withPdfDownload } from './pdf-policy';

export type PdfInspectionRequest = { cursor?: string; limit: number; bookmarkCursor?: number };
const TEXT_CHUNK = 4000;

function nativeString(native: PdfNativeContext, read: (pointer: number, length: number) => number, maxBytes: number, signal: AbortSignal, expiresAt: number) {
  checkPdfDeadline(signal, expiresAt);
  const needed = read(0, 0);
  checkPdfDeadline(signal, expiresAt);
  if (needed <= 2) return undefined;
  if (needed > maxBytes) throw new PdfProcessingError('pdf_limit', 413, 'WaPilot PDF label or bookmark is too long.');
  const pointer = native.call('malloc', needed);
  if (!pointer) throw new PdfProcessingError('pdf_limit', 413, 'WaPilot PDF inspection memory limit exceeded.');
  try {
    if (read(pointer, needed) !== needed) throw new Error('PDF string unavailable');
    checkPdfDeadline(signal, expiresAt);
    return new TextDecoder('utf-16le').decode(native.heap().slice(pointer, pointer + needed - 2));
  } finally { native.call('free', pointer); }
}

function outline(native: PdfNativeContext, offset: number, signal: AbortSignal, expiresAt: number) {
  const bookmarks: { title: string; page?: number; depth: number }[] = [];
  const pending: { handle: number; depth: number }[] = [];
  checkPdfDeadline(signal, expiresAt);
  const first = native.call('FPDFBookmark_GetFirstChild', native.document, 0);
  if (first) pending.push({ handle: first, depth: 0 });
  const seen = new Set<number>();
  let index = 0;
  while (pending.length) {
    checkPdfDeadline(signal, expiresAt);
    if (index === offset + 100) return { bookmarks, nextBookmarkCursor: index < 2000 ? index : null, outlineLimited: index >= 2000 };
    if (index >= 2000) throw new PdfProcessingError('pdf_limit', 413, 'WaPilot supports inspection of at most 2,000 bookmarks. Continue using physical page positions.');
    const { handle, depth } = pending.pop()!;
    if (seen.has(handle)) throw new PdfProcessingError('pdf_invalid', 422, 'WaPilot cannot inspect a cyclic PDF outline.');
    seen.add(handle);
    if (index++ >= offset) {
      const title = nativeString(native, (pointer, length) => native.call('FPDFBookmark_GetTitle', handle, pointer, length), 4096, signal, expiresAt) ?? '';
      const destination = native.call('FPDFBookmark_GetDest', native.document, handle);
      const page = destination ? native.call('FPDFDest_GetDestPageIndex', native.document, destination) : -1;
      bookmarks.push({ title, ...(page >= 0 ? { page: page + 1 } : {}), depth });
    }
    const sibling = native.call('FPDFBookmark_GetNextSibling', native.document, handle);
    const child = native.call('FPDFBookmark_GetFirstChild', native.document, handle);
    if (sibling) pending.push({ handle: sibling, depth });
    if (child) pending.push({ handle: child, depth: depth + 1 });
  }
  return { bookmarks, nextBookmarkCursor: null, outlineLimited: false };
}

export async function inspectPdf(bytes: Uint8Array, options: PdfInspectionRequest, signal: AbortSignal, expiresAt = Date.now() + PDF_TIMEOUT_MS) {
  const { withNativePdf } = await import('./pdfium-runtime');
  return withNativePdf(bytes, signal, async native => {
    checkPdfDeadline(signal, expiresAt);
    const totalPages = native.call('FPDF_GetPageCount', native.document);
    if (totalPages > 2000) throw new PdfProcessingError('pdf_limit', 413, 'WaPilot supports PDFs with at most 2,000 pages.');
    const [first, offset] = (options.cursor ?? '1:0').split(':').map(Number);
    if (first < 1 || first > totalPages) throw new PdfProcessingError('pdf_page_unavailable', 422, `WaPilot requires page positions between 1 and ${totalPages}.`);
    const pages = [];
    let nextCursor: string | null = null;
    for (let number = first; number <= totalPages && pages.length < options.limit; number++) {
      checkPdfDeadline(signal, expiresAt);
      const page = native.call('FPDF_LoadPage', native.document, number - 1);
      if (!page) throw new PdfProcessingError('pdf_page_unavailable', 422, 'WaPilot could not inspect this PDF page. It is unavailable, not blank.');
      let textPage = 0;
      try {
        const width = native.call('FPDF_GetPageWidthF', page), height = native.call('FPDF_GetPageHeightF', page);
        if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 14400)) throw new PdfProcessingError('pdf_limit', 413, 'WaPilot cannot inspect these page dimensions.');
        checkPdfDeadline(signal, expiresAt);
        textPage = native.call('FPDFText_LoadPage', page);
        if (!textPage) throw new PdfProcessingError('pdf_page_unavailable', 422, 'WaPilot could not extract this page text. Use visual reading; failure does not mean a blank page.');
        const totalCharacters = native.call('FPDFText_CountChars', textPage);
        if (totalCharacters < 0) throw new PdfProcessingError('pdf_page_unavailable', 422, 'WaPilot could not inspect this page text. Use visual reading.');
        checkPdfDeadline(signal, expiresAt);
        const textOffset = number === first ? offset : 0;
        if (textOffset > totalCharacters) throw new PdfProcessingError('pdf_page_unavailable', 422, 'WaPilot text cursor is outside this page. Restart inspection without a cursor.');
        const count = Math.min(TEXT_CHUNK, totalCharacters - textOffset);
        const buffer = native.call('malloc', (count * 2 + 1) * 2);
        if (!buffer) throw new PdfProcessingError('pdf_limit', 413, 'WaPilot PDF inspection memory limit exceeded.');
        let text: string;
        try {
          const written = native.call('FPDFText_GetText', textPage, textOffset, count, buffer);
          text = written > 1 ? new TextDecoder('utf-16le').decode(native.heap().slice(buffer, buffer + (written - 1) * 2)) : '';
        } finally { native.call('free', buffer); }
        checkPdfDeadline(signal, expiresAt);
        const label = nativeString(native, (pointer, length) => native.call('FPDF_GetPageLabel', native.document, number - 1, pointer, length), 512, signal, expiresAt);
        const nextTextOffset = textOffset + count;
        pages.push({ page: number, width, height, orientation: width > height ? 'landscape' : width < height ? 'portrait' : 'square', ...(label ? { label } : {}), textStatus: totalCharacters ? 'available' : 'none', coverage: 'text-only', textOffset, nextTextOffset, totalCharacters, text });
        nextCursor = nextTextOffset < totalCharacters ? `${number}:${nextTextOffset}` : number < totalPages ? `${number + 1}:0` : null;
        if (nextTextOffset < totalCharacters) break;
      } finally { if (textPage) native.call('FPDFText_ClosePage', textPage); native.call('FPDF_ClosePage', page); }
    }
    return { totalPages, format: 'text', pages, nextCursor, ...outline(native, options.bookmarkCursor ?? 0, signal, expiresAt), note: 'Physical page positions start at 1; labels are separate when available. Text is not visual coverage, may omit scans, figures or have poor reading order. No text does not mean blank. Continue with nextCursor and preserve messageId/connectionId; use WaPilot page images to inspect visual content.' };
  }, expiresAt);
}

export async function inspectMessageDocument(client: EvolutionGoClient, env: Pick<Env, 'DOCUMENT_STORAGE_ORIGINS' | 'EVOLUTION_BASE_URL' | 'MAX_MEDIA_BYTES'>, messageId: string, options: PdfInspectionRequest, parentSignal: AbortSignal) {
  try {
    return await withPdfDownload(client, env, messageId, parentSignal,
      kind => new PdfProcessingError(kind === 'cancel' ? 'request_cancelled' : 'wapilot_timeout', kind === 'cancel' ? 499 : 504, kind === 'cancel' ? 'WaPilot PDF inspection was cancelled.' : 'WaPilot PDF inspection exceeded 60 seconds. Request fewer pages.'),
      async (blob, signal, expiresAt) => inspectPdf(new Uint8Array(await blob.arrayBuffer()), options, signal, expiresAt));
  } catch (error) {
    if (error instanceof PdfProcessingError || error instanceof DocumentReadingError) throw error;
    throw new PdfProcessingError('pdf_page_unavailable', 422, 'WaPilot could not inspect this PDF. Use visual reading if available.');
  }
}
