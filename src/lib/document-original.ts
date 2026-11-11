import { Buffer } from 'node:buffer';
import type { Env } from '../types';
import type { EvolutionGoClient } from './evolution';
import { DocumentReadingError, DOCUMENT_READING_TIMEOUT_MS } from './document-reading';
import { PdfProcessingError, checkPdfDeadline } from './pdf-processing';
import { withPdfDownload } from './pdf-policy';

export async function getMessageDocumentOriginal(client: EvolutionGoClient, env: Pick<Env, 'DOCUMENT_STORAGE_ORIGINS' | 'EVOLUTION_BASE_URL' | 'MAX_MEDIA_BYTES'>, messageId: string, parentSignal: AbortSignal) {
  try {
    return await withPdfDownload(client, env, messageId, parentSignal,
      kind => new DocumentReadingError(kind === 'cancel' ? 'request_cancelled' : 'wapilot_timeout', kind === 'cancel' ? 499 : 504, kind === 'cancel' ? 'WaPilot document download was cancelled.' : `WaPilot stopped waiting for the PDF after ${DOCUMENT_READING_TIMEOUT_MS} ms (WaPilot timeout).`),
      async (blob, signal, expiresAt) => {
        const bytes = await blob.arrayBuffer();
        checkPdfDeadline(signal, expiresAt);
        return { size: bytes.byteLength, blob: Buffer.from(bytes).toString('base64') };
      });
  } catch (error) {
    if (error instanceof DocumentReadingError || error instanceof PdfProcessingError) throw error;
    throw new DocumentReadingError('document_unavailable', 502, 'WaPilot could not retrieve the PDF original.');
  }
}
