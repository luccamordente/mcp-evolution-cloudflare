import type { Env } from '../types';
import type { EvolutionGoClient } from './evolution';
import { approvedMediaOrigins } from './media-origins';

export const DOCUMENT_READING_TIMEOUT_MS = 60_000;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export class DocumentReadingError extends Error {
  constructor(
    public readonly code: 'document_unavailable' | 'document_reading_unavailable' | 'document_conversion_failed' | 'no_document_text' | 'document_text_too_large' | 'media_too_large' | 'wapilot_timeout' | 'upstream_timeout' | 'request_cancelled',
    public readonly status: number,
    message: string,
  ) { super(message); }
}

export async function readMessageDocument(client: EvolutionGoClient, env: Pick<Env, 'AI' | 'DOCUMENT_STORAGE_ORIGINS' | 'EVOLUTION_BASE_URL' | 'MAX_MEDIA_BYTES'>, messageId: string, parentSignal: AbortSignal): Promise<string> {
  if (!env.AI?.toMarkdown) throw new DocumentReadingError('document_reading_unavailable', 503, 'WaPilot document reading is unavailable.');
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), DOCUMENT_READING_TIMEOUT_MS);
  const signal = AbortSignal.any([parentSignal, deadline.signal]);
  let onAbort: (() => void) | undefined;
  try {
    signal.throwIfAborted();
    const blob = await client.getMessageDocument(messageId, approvedMediaOrigins(env.DOCUMENT_STORAGE_ORIGINS, env.EVOLUTION_BASE_URL), Math.min(Number(env.MAX_MEDIA_BYTES ?? MAX_DOCUMENT_BYTES), MAX_DOCUMENT_BYTES), signal);
    signal.throwIfAborted();
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    // toMarkdown has no AbortSignal option; stop waiting locally without claiming remote cancellation.
    const result: unknown = await Promise.race([
      env.AI.toMarkdown({ name: 'document.pdf', blob }, { conversionOptions: { pdf: { metadata: false, images: { convert: false } } } }),
      aborted,
    ]);
    signal.throwIfAborted();
    if (!result || typeof result !== 'object' || !('format' in result) || (result.format !== 'markdown' && result.format !== 'text') || !('data' in result) || typeof result.data !== 'string') {
      throw new DocumentReadingError('document_conversion_failed', 502, 'WaPilot could not extract text from this PDF.');
    }
    const text = result.data.trim();
    if (!text) throw new DocumentReadingError('no_document_text', 422, 'WaPilot found no extractable text in this PDF. Scanned pages require OCR, which WaPilot does not support.');
    if (text.length > 200_000) throw new DocumentReadingError('document_text_too_large', 413, 'WaPilot cannot return more than 200,000 characters from a PDF. No partial text was returned.');
    return text;
  } catch (error) {
    if (parentSignal.aborted) throw new DocumentReadingError('request_cancelled', 499, 'WaPilot document reading was cancelled.');
    if (deadline.signal.aborted) throw new DocumentReadingError('wapilot_timeout', 504, `WaPilot stopped waiting for document reading after ${DOCUMENT_READING_TIMEOUT_MS} ms (WaPilot timeout).`);
    if (error instanceof DocumentReadingError) throw error;
    throw new DocumentReadingError('document_conversion_failed', 502, 'WaPilot could not extract text from this PDF.');
  } finally {
    clearTimeout(timeout);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
