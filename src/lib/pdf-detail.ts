import { encode } from 'fast-png';
import { Buffer } from 'node:buffer';
import { PdfProcessingError, PDF_TIMEOUT_MS, checkPdfDeadline, MAX_PDF_OUTPUT_BYTES, PDF_PRESETS, type PdfRequest } from './pdf-processing';

export interface PdfCrop { x: number; y: number; width: number; height: number }

export async function processPdfDetail(bytes: Uint8Array, options: PdfRequest & { crop: PdfCrop }, signal: AbortSignal, expiresAt = Date.now() + PDF_TIMEOUT_MS) {
  const { withNativePdf } = await import('./pdfium-runtime');
  return withNativePdf(bytes, signal, async ctx => {
    const { call, heap, document } = ctx;
    const totalPages = call('FPDF_GetPageCount', document);
    if (totalPages > 2000) throw new PdfProcessingError('pdf_limit', 413, 'WaPilot supports PDFs with at most 2,000 pages.');
    const number = options.pages[0];
    if (number > totalPages) throw new PdfProcessingError('pdf_page_unavailable', 422, `WaPilot requires page positions between 1 and ${totalPages}.`);
    let page = 0, bitmap = 0, pixels = 0, form = 0, formInfo = 0;
    try {
      checkPdfDeadline(signal, expiresAt);
      page = call('FPDF_LoadPage', document, number - 1);
      if (!page) throw new Error('Page unavailable');
      const w = call('FPDF_GetPageWidth', page), h = call('FPDF_GetPageHeight', page);
      if (![w,h].every(n => Number.isFinite(n) && n > 0 && n <= 14400)) throw new PdfProcessingError('pdf_limit', 413, 'WaPilot cannot render these page dimensions.');
      const crop = options.crop;
      const scale = PDF_PRESETS[options.preset] / Math.max(w * crop.width, h * crop.height);
      const fullWidth = Math.round(w * scale), fullHeight = Math.round(h * scale);
      const width = Math.max(1, Math.round(fullWidth * crop.width)), height = Math.max(1, Math.round(fullHeight * crop.height));
      if (fullWidth > 1_000_000 || fullHeight > 1_000_000 || width * height > 5_760_000) throw new PdfProcessingError('pdf_limit', 413, 'WaPilot detail pixel limit exceeded. Request a wider or differently shaped region.');
      checkPdfDeadline(signal, expiresAt);
      pixels = call('malloc', width * height * 4);
      if (!pixels) throw new Error('Allocation unavailable');
      bitmap = call('FPDFBitmap_CreateEx', width, height, 4, pixels, width * 4);
      if (!bitmap) throw new Error('Bitmap unavailable');
      call('FPDFBitmap_FillRect', bitmap, 0, 0, width, height, 0xffffffff);
      const x = -Math.round(fullWidth * crop.x), y = -Math.round(fullHeight * crop.y);
      // Clip a fresh render into the output bitmap; never allocate the full zoomed page.
      checkPdfDeadline(signal, expiresAt);
      call('FPDF_RenderPageBitmap', bitmap, page, x, y, fullWidth, fullHeight, 0, 0x13);
      checkPdfDeadline(signal, expiresAt);
      formInfo = call('malloc', 256);
      if (!formInfo) throw new Error('Form allocation unavailable');
      heap().fill(0, formInfo, formInfo + 256);
      new DataView(heap().buffer).setUint32(formInfo, 2, true);
      form = call('FPDFDOC_InitFormFillEnvironment', document, formInfo);
      if (!form) throw new Error('Form appearance unavailable');
      call('FORM_OnAfterLoadPage', page, form);
      checkPdfDeadline(signal, expiresAt);
      call('FPDF_FFLDraw', form, bitmap, page, x, y, fullWidth, fullHeight, 0, 0x12);
      checkPdfDeadline(signal, expiresAt);
      const data = Buffer.from(encode({ width, height, data: heap().slice(pixels, pixels + width * height * 4), channels: 4 })).toString('base64');
      checkPdfDeadline(signal, expiresAt);
      if (data.length > MAX_PDF_OUTPUT_BYTES) throw new PdfProcessingError('pdf_limit', 413, 'WaPilot PDF response exceeds 8 MiB encoded. Request a preview or smaller region.');
      return { totalPages, preset: options.preset, requestedPages: options.pages, deliveredPages: options.pages, failedPages: [], complete: true, continuation: 'Request another page or region using the same connectionId and messageId.',
        pages: [{ page: number, width, height, crop, imageIndex: 0, status: 'delivered' as const }], images: [{ type: 'image' as const, mimeType: 'image/png' as const, data }],
        note: 'Crop coordinates use the visible rotated page, top-left origin. Detail is rendered from the original; missing scan pixels cannot be recovered. Unsupported interactive features may be absent.' };
    } catch (error) {
      if (signal.aborted || error instanceof PdfProcessingError) throw error;
      throw new PdfProcessingError('pdf_page_unavailable', 422, 'WaPilot could not render this region. The page is unavailable, not blank.');
    } finally {
      if (form) { call('FORM_OnBeforeClosePage', page, form); call('FPDFDOC_ExitFormFillEnvironment', form); }
      if (formInfo) call('free', formInfo);
      if (bitmap) call('FPDFBitmap_Destroy', bitmap);
      if (pixels) call('free', pixels);
      if (page) call('FPDF_ClosePage', page);
    }
  }, expiresAt);
}
