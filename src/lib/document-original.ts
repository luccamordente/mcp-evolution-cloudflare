import { Buffer } from 'node:buffer';
import type { Env } from '../types';
import type { EvolutionGoClient } from './evolution';
import { DocumentReadingError, DOCUMENT_READING_TIMEOUT_MS } from './document-reading';
import { PdfProcessingError, checkPdfDeadline } from './pdf-processing';
import { approvedMediaOrigins } from './media-origins';

export async function getMessageDocumentOriginal(client: EvolutionGoClient, env: Pick<Env, 'DOCUMENT_STORAGE_ORIGINS' | 'EVOLUTION_BASE_URL' | 'MAX_MEDIA_BYTES'>, messageId: string, parentSignal: AbortSignal) {
  const expiresAt = Date.now() + DOCUMENT_READING_TIMEOUT_MS;
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), DOCUMENT_READING_TIMEOUT_MS);
  const signal = AbortSignal.any([parentSignal, deadline.signal]);
  try {
    checkPdfDeadline(signal, expiresAt);
    const blob = await client.getMessageDocument(messageId, approvedMediaOrigins(env.DOCUMENT_STORAGE_ORIGINS, env.EVOLUTION_BASE_URL), Math.min(Number(env.MAX_MEDIA_BYTES ?? 8 * 1024 * 1024), 8 * 1024 * 1024), signal);
    checkPdfDeadline(signal, expiresAt);
    const bytes = await blob.arrayBuffer();
    checkPdfDeadline(signal, expiresAt);
    const result = { size: bytes.byteLength, blob: Buffer.from(bytes).toString('base64') };
    checkPdfDeadline(signal, expiresAt);
    return result;
  } catch (error) {
    if (parentSignal.aborted) throw new DocumentReadingError('request_cancelled', 499, 'WaPilot document download was cancelled.');
    if (deadline.signal.aborted) throw new DocumentReadingError('wapilot_timeout', 504, `WaPilot stopped waiting for the PDF after ${DOCUMENT_READING_TIMEOUT_MS} ms (WaPilot timeout).`);
    if (error instanceof DocumentReadingError || error instanceof PdfProcessingError) throw error;
    throw new DocumentReadingError('document_unavailable', 502, 'WaPilot could not retrieve the PDF original.');
  } finally { clearTimeout(timeout); }
}
