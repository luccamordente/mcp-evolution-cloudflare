import { PDFiumLibrary } from '@hyzyla/pdfium';
import { PdfProcessingError, PDF_TIMEOUT_MS, checkPdfDeadline } from './pdf-processing';
import wasm from '@hyzyla/pdfium/pdfium.wasm';

export function createPdfLibrary() {
  return PDFiumLibrary.init({ instantiateWasm(imports, done) { done(new WebAssembly.Instance(wasm, imports), wasm); } });
}

export interface PdfNativeContext {
  document: number;
  call(name: string, ...args: number[]): number;
  heap(): Uint8Array;
}

/** Own the document and its input allocation; callers own page/text/bitmap handles. */
export async function withNativePdf<T>(bytes: Uint8Array, signal: AbortSignal, fn: (context: PdfNativeContext) => Promise<T>, expiresAt = Date.now() + PDF_TIMEOUT_MS): Promise<T> {
  checkPdfDeadline(signal, expiresAt);
  let exports: WebAssembly.Exports | undefined;
  const library = await PDFiumLibrary.init({ instantiateWasm(imports, done) {
    const instance = new WebAssembly.Instance(wasm, imports);
    exports = instance.exports;
    done(instance, wasm);
  } });
  const call = (name: string, ...args: number[]) => {
    const method = exports?.[name];
    if (typeof method !== 'function') throw new Error('WaPilot PDF capability is unavailable.');
    return Number(method(...args));
  };
  const heap = () => {
    const memory = exports?.memory;
    if (!(memory instanceof WebAssembly.Memory)) throw new Error('WaPilot PDF memory is unavailable.');
    return new Uint8Array(memory.buffer);
  };
  let document = 0;
  let input = 0;
  try {
    checkPdfDeadline(signal, expiresAt);
    input = call('malloc', bytes.length);
    if (!input) throw new Error('WaPilot PDF memory limit exceeded.');
    heap().set(bytes, input);
    document = call('FPDF_LoadMemDocument', input, bytes.length, 0);
    if (!document) throw new PdfProcessingError('pdf_invalid', 422, 'WaPilot cannot open this PDF. It may be protected, invalid or unsupported.');
    checkPdfDeadline(signal, expiresAt);
    const result = await fn({ document, call, heap });
    checkPdfDeadline(signal, expiresAt);
    return result;
  } finally {
    if (document) call('FPDF_CloseDocument', document);
    if (input) call('free', input);
    library.destroy();
  }
}
