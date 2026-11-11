import type { Env } from '../types';
import type { EvolutionGoClient } from './evolution';
import { approvedMediaOrigins } from './media-origins';

export const PDF_TIMEOUT_MS = 60_000;
export class PdfProcessingError extends Error {
  constructor(public readonly code: 'pdf_invalid' | 'pdf_limit' | 'pdf_page_unavailable' | 'request_cancelled' | 'wapilot_timeout', public readonly status: number, message: string) { super(message); }
}
export function checkPdfDeadline(signal: AbortSignal, expiresAt: number) {
  signal.throwIfAborted();
  if (Date.now() >= expiresAt) throw new PdfProcessingError('wapilot_timeout', 504, 'WaPilot PDF processing exceeded 60 seconds. Request fewer pages.');
}


type DocumentEnv = Pick<Env, 'DOCUMENT_STORAGE_ORIGINS' | 'EVOLUTION_BASE_URL' | 'MAX_MEDIA_BYTES'>;

export function downloadPdf(client: EvolutionGoClient, env: DocumentEnv, messageId: string, signal: AbortSignal) {
  return client.getMessageDocument(messageId, approvedMediaOrigins(env.DOCUMENT_STORAGE_ORIGINS, env.EVOLUTION_BASE_URL), Math.min(Number(env.MAX_MEDIA_BYTES ?? 8 * 1024 * 1024), 8 * 1024 * 1024), signal);
}

export async function withPdfDownload<T>(client: EvolutionGoClient, env: DocumentEnv, messageId: string, parentSignal: AbortSignal, abortError: (kind: 'cancel' | 'timeout') => Error, process: (blob: Blob, signal: AbortSignal, expiresAt: number) => Promise<T>): Promise<T> {
  const expiresAt = Date.now() + PDF_TIMEOUT_MS;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), PDF_TIMEOUT_MS);
  const signal = AbortSignal.any([parentSignal, deadline.signal]);
  try {
    checkPdfDeadline(signal, expiresAt);
    const blob = await downloadPdf(client, env, messageId, signal);
    checkPdfDeadline(signal, expiresAt);
    const result = await process(blob, signal, expiresAt);
    checkPdfDeadline(signal, expiresAt);
    return result;
  } catch (error) {
    if (parentSignal.aborted) throw abortError('cancel');
    if (deadline.signal.aborted) throw abortError('timeout');
    throw error;
  } finally { clearTimeout(timer); }
}
