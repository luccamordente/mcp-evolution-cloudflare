import { z } from 'zod';
import type { Env, Message } from '../types';
import { encryptToken, decryptToken } from './crypto';
import { approvedMediaOrigins } from './media-origins';
import { EvolutionApiError, EvolutionGoClient } from './evolution';
import { getConnection, revealConnectionToken } from './db';
import { recoveryFor } from './tool-recovery';

export class AttachmentError extends Error {
  constructor(public readonly code: 'attachment_not_found' | 'attachment_source_unavailable' | 'attachment_download_failed' | 'attachment_links_unavailable' | 'attachment_link_invalid' | 'attachment_link_expired' | 'attachment_configuration_error' | 'media_too_large' | 'media_origin_not_allowed' | 'request_cancelled' | 'request_deadline_exceeded', public readonly status: number, message: string) { super(message); }
}
function attachmentFailure(error: AttachmentError, operation = 'get_message') {
  const failure = { code: error.code, status: error.status, message: error.message, operation, retryable: error.code === 'attachment_download_failed' && (error.status === 429 || error.status >= 500) };
  const recovery = recoveryFor(failure);
  return { ...failure, hint: recovery.steps.join(' '), recovery };
}
function unavailableLink() { return new AttachmentError('attachment_links_unavailable', 503, 'WaPilot could not create a public download link. The attachment metadata remains available.'); }

const LINK_TTL_MS = 15 * 60 * 1000;
const mimeSchema = z.string().regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/);
function attachmentMime(value: string | undefined) {
  const parsed = mimeSchema.safeParse(value?.split(';')[0].trim().toLowerCase());
  return parsed.success ? parsed.data : 'application/octet-stream';
}
const capabilitySchema = z.object({
  purpose: z.literal('attachment-download'), userId: z.string().min(1),
  connectionId: z.string().uuid(), messageId: z.string().min(1).max(200),
  index: z.number().int().min(0), expiresAt: z.number().int(),
}).strict();

export function messageAttachments(message: Message) {
  if (message.medias?.length) return message.medias.map(({ url, content: _content, ...metadata }, index) => ({
    ...metadata, index, mimeType: attachmentMime(metadata.encodingFormat ?? message.media?.mimeType), url,
  }));
  return message.media ? [{ index: 0, mimeType: attachmentMime(message.media.mimeType),
    fileName: message.media.fileName, fileSize: message.media.size, mediaId: message.media.mediaId, gifPlayback: message.media.gifPlayback, url: message.media.url }] : [];
}

function attachmentSource(source: string | undefined, mimeType: string, env: Env): URL {
  if (!source) throw new AttachmentError('attachment_source_unavailable', 404, 'WaPilot retained attachment metadata but no downloadable source is available.');
  const config = mimeType.startsWith('image/') ? env.IMAGE_STORAGE_ORIGINS : mimeType.startsWith('audio/') ? env.AUDIO_STORAGE_ORIGINS : env.DOCUMENT_STORAGE_ORIGINS;
  const origins = approvedMediaOrigins(config, env.EVOLUTION_BASE_URL);
  try {
    const url = new URL(source ?? '');
    if ((source?.length ?? 0) > 8192 || url.protocol !== 'https:' || url.username || url.password || url.hash || !origins.includes(url.origin)) throw new Error();
    return url;
  } catch { throw new AttachmentError('media_origin_not_allowed', 502, 'WaPilot cannot access this attachment because its source does not meet the approved HTTPS storage policy.'); }
}

export async function attachmentMetadata(message: Message, env: Env, userId: string, connectionId: string) {
  const expiresAt = Date.now() + LINK_TTL_MS;
  return Promise.all(messageAttachments(message).map(async ({ url, ...metadata }) => {
    try { attachmentSource(url, metadata.mimeType, env); } catch (error) { return { ...metadata, downloadAvailable: false, error: attachmentFailure(error instanceof AttachmentError ? error : unavailableLink()) }; }
    if (!message.id || !env.MCP_PUBLIC_URL) return { ...metadata, downloadAvailable: false, error: attachmentFailure(unavailableLink()) };
    let base: URL;
    try { base = new URL(env.MCP_PUBLIC_URL); } catch { return { ...metadata, downloadAvailable: false, error: attachmentFailure(unavailableLink()) }; }
    if (base.protocol !== 'https:' || base.username || base.password || base.hash) return { ...metadata, downloadAvailable: false, error: attachmentFailure(unavailableLink()) };
    try {
      const token = await encryptToken(JSON.stringify({ purpose: 'attachment-download', userId, connectionId, messageId: message.id, index: metadata.index, expiresAt }), env.TOKEN_ENCRYPTION_KEY);
      return { ...metadata, downloadAvailable: true, downloadUrl: new URL(`/attachments/${token}`, base).href, expiresAt: new Date(expiresAt).toISOString() };
    } catch { return { ...metadata, downloadAvailable: false, error: attachmentFailure(unavailableLink()) }; }
  }));
}

export async function downloadAttachment(message: Message, index: number, env: Env, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const attachment = messageAttachments(message)[index];
  if (!attachment) throw new AttachmentError('attachment_not_found', 404, 'WaPilot could not find this attachment index in the retained message.');
  const source = attachmentSource(attachment.url, attachment.mimeType, env);
  const maxBytes = Number(env.MAX_MEDIA_BYTES ?? 8 * 1024 * 1024);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new AttachmentError('attachment_configuration_error', 500, 'WaPilot attachment size configuration is invalid; downloading is disabled.');
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  deadline.throwIfAborted();
  let response: Response;
  try { response = await fetcher(source.href, { redirect: 'manual', signal: deadline, credentials: 'omit', headers: { Accept: 'application/octet-stream' } }); }
  catch { throw new AttachmentError(signal.aborted ? 'request_cancelled' : 'attachment_download_failed', signal.aborted ? 499 : deadline.aborted ? 504 : 502, signal.aborted ? 'WaPilot attachment download was cancelled.' : deadline.aborted ? 'WaPilot attachment download exceeded 60 seconds.' : 'WaPilot could not reach attachment storage.'); }
  if (!response.ok) { await response.body?.cancel(); throw new AttachmentError('attachment_download_failed', [401, 403, 404, 410, 429].includes(response.status) ? response.status : 502, `WaPilot storage could not provide this attachment (HTTP ${response.status}).`); }
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new AttachmentError('media_too_large', 413, `WaPilot attachment exceeds the configured limit of ${maxBytes} bytes; no file was returned.`); }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  try {
    if (reader) while (true) {
      const { done, value } = await reader.read();
      deadline.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new AttachmentError('media_too_large', 413, `WaPilot attachment exceeds the configured limit of ${maxBytes} bytes; no file was returned.`); }
      chunks.push(value);
    }
  } catch (error) { await reader?.cancel().catch(() => {}); if (error instanceof AttachmentError) throw error; throw new AttachmentError(signal.aborted ? 'request_cancelled' : 'attachment_download_failed', signal.aborted ? 499 : deadline.aborted ? 504 : 502, 'WaPilot could not finish reading this attachment; no complete file was returned.'); }
  finally { reader?.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { bytes, mimeType: attachment.mimeType, fileName: attachment.fileName };
}

export async function serveAttachment(request: Request, env: Env, token: string): Promise<Response> {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
  let capability: z.infer<typeof capabilitySchema>;
  try {
    if (token.length > 4096) throw new Error();
    capability = capabilitySchema.parse(JSON.parse(await decryptToken(token, env.TOKEN_ENCRYPTION_KEY)));
    if (capability.expiresAt <= Date.now()) throw new AttachmentError('attachment_link_expired', 401, 'WaPilot attachment link has expired.');
    if (capability.expiresAt > Date.now() + LINK_TTL_MS) throw new Error();
  } catch (error) { return Response.json({ error: attachmentFailure(error instanceof AttachmentError ? error : new AttachmentError('attachment_link_invalid', 401, 'WaPilot attachment link is invalid or has been changed.'), 'download_attachment') }, { status: 401, headers }); }
  try {
    const connection = await getConnection(env.DB, capability.userId, capability.connectionId);
    if (!connection) throw new AttachmentError('attachment_not_found', 404, 'WaPilot cannot find the connection or retained message for this attachment.');
    const client = new EvolutionGoClient({ baseUrl: env.EVOLUTION_BASE_URL, instanceId: connection.instanceId, instanceToken: await revealConnectionToken(env.DB, env.TOKEN_ENCRYPTION_KEY, connection) });
    const message = await client.getMessage(capability.messageId, request.signal);
    if (!message) throw new AttachmentError('attachment_not_found', 404, 'WaPilot cannot find the connection or retained message for this attachment.');
    const file = await downloadAttachment(message, capability.index, env, request.signal);
    const fileName = encodeURIComponent(file.fileName ?? 'attachment').replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(file.bytes, { headers: { ...headers, 'Content-Type': file.mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${fileName}` } });
  } catch (error) {
    const failure = error instanceof AttachmentError ? error : new AttachmentError('attachment_download_failed', error instanceof EvolutionApiError && error.status >= 400 ? error.status : 502, 'WaPilot could not retrieve this attachment.');
    return Response.json({ error: attachmentFailure(failure, 'download_attachment') }, { status: failure.status, headers });
  }
}
