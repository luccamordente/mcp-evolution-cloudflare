import type { Contact, Group, Message, Page, SendMessageResult } from '../types';
import { Buffer } from 'node:buffer';
import { galleryImage } from './image-gallery';
import { AudioTranscriptionError } from './audio-transcription';

const JSON_API_MEDIA_TYPE = 'application/vnd.api+json';
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const AVATAR_REQUEST_TIMEOUT_MS = 3_000;
const GROUP_REQUEST_TIMEOUT_MS = 300_000;
const MEDIA_REQUEST_TIMEOUT_MS = 60_000;

type EvolutionRequestInit = RequestInit & { timeoutMs?: number };

export interface EvolutionClientOptions {
  baseUrl: string;
  globalApiKey?: string;
  instanceToken: string;
  instanceId: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export interface EvolutionInstanceCreateInput {
  name: string;
  token: string;
}

export interface EvolutionConnectInput {
  /** JSON:API connection resource id. The token still authenticates the request. */
  instanceId?: string;
  webhookUrl?: string;
  subscribe?: string[];
  immediate?: boolean;
}

export interface EvolutionQrRenewOptions extends EvolutionConnectInput {
  maxAttempts?: number;
  retryDelayMs?: number;
}

export class EvolutionApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown, public readonly timeoutSource?: 'wapilot' | 'upstream') {
    super(message);
    this.name = 'EvolutionApiError';
  }
}

export class MessageImageError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

type JsonApiResource = {
  type?: unknown;
  id?: unknown;
  attributes?: unknown;
  relationships?: unknown;
  meta?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function resource(value: unknown): JsonApiResource | undefined {
  return asRecord(value) as JsonApiResource | undefined;
}

function documentData(value: unknown): unknown {
  return asRecord(value)?.data;
}

/** Return the canonical Evolution Go connection UUID from a JSON:API response. */
export function connectionIdFromResponse(value: unknown): string | undefined {
  return stringValue(resource(documentData(value))?.id);
}

function resourceAttributes(value: unknown): Record<string, unknown> {
  return asRecord(resource(value)?.attributes) ?? {};
}

function resourceMeta(value: unknown): Record<string, unknown> {
  return asRecord(resource(value)?.meta) ?? {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function relationshipResource(value: unknown, name: string): JsonApiResource | undefined {
  const relationships = asRecord(resource(value)?.relationships);
  const relationship = asRecord(relationships?.[name]);
  return resource(relationship?.data);
}

function jsonApiBody(data: JsonApiResource | JsonApiResource[]): string {
  return JSON.stringify({ data });
}

function errorMessage(payload: unknown, status: number): string {
  const document = asRecord(payload);
  const errors = Array.isArray(document?.errors) ? document.errors : [];
  const first = asRecord(errors[0]);
  return stringValue(first?.detail) ?? stringValue(first?.title) ?? `Evolution Go request failed (${status})`;
}

function sanitizeErrorMessage(value: string): string {
  return value
    .replace(/(token|api[-_ ]?key|password|secret)[=:]?\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240) || 'Evolution Go request failed';
}

function isJsonApiDocument(value: unknown): boolean {
  const document = asRecord(value);
  const jsonapi = asRecord(document?.jsonapi);
  if (jsonapi?.version !== '1.1' || !document) return false;
  const hasData = 'data' in document;
  const hasErrors = 'errors' in document;
  if (hasData && hasErrors) return false;
  if (hasErrors && !Array.isArray(document.errors)) return false;
  return hasData || hasErrors || 'meta' in document;
}

/** Shared HTTP boundary. GET reads retry transient 5xx/network failures; writes never retry. */
async function requestJson<T>(fetcher: typeof fetch, baseUrl: string, path: string, apiKey: string, init: EvolutionRequestInit = {}): Promise<T> {
  const { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, signal: parentSignal, ...fetchInit } = init;
  const headers = new Headers(fetchInit.headers);
  headers.set('Accept', JSON_API_MEDIA_TYPE);
  if (fetchInit.body && !headers.has('Content-Type')) headers.set('Content-Type', JSON_API_MEDIA_TYPE);
  headers.set('apikey', apiKey);
  const method = (fetchInit.method ?? 'GET').toUpperCase();
  const attempts = method === 'GET' ? 3 : 1;
  let lastStatus: number | undefined;
  let lastPayload: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    let payload: unknown = undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
    try {
      signal.throwIfAborted();
      response = await fetcher(`${baseUrl}${path}`, { ...fetchInit, headers, signal });
      const text = await response.text();
      signal.throwIfAborted();
      if (text) {
        try { payload = JSON.parse(text); } catch { payload = text; }
      }
    } catch (error) {
      clearTimeout(timeout);
      if (parentSignal?.aborted) throw error;
      if (controller.signal.aborted) {
        throw new EvolutionApiError(504, `WaPilot stopped waiting for the WhatsApp service after ${timeoutMs} ms (WaPilot timeout). The service outcome is unknown.`, { path, timeoutMs }, 'wapilot');
      }
      if (attempt + 1 < attempts) {
        await retryDelay(attempt);
        continue;
      }
      throw new EvolutionApiError(503, 'Evolution Go is unreachable', { cause: error instanceof Error ? error.message : String(error) });
    }
    clearTimeout(timeout);
    if (response.ok) {
      if (payload !== undefined && !isJsonApiDocument(payload)) {
        throw new EvolutionApiError(502, 'Evolution Go returned an invalid JSON:API document', payload);
      }
      return payload as T;
    }
    lastStatus = response.status;
    lastPayload = payload;
    if (response.status < 500 || response.status > 599 || attempt + 1 >= attempts) break;
    await retryDelay(attempt);
  }
  const status = lastStatus ?? 502;
  const timeoutSource = status === 408 || status === 504 ? 'upstream' : undefined;
  const message = timeoutSource
    ? `The WhatsApp service returned a timeout response (HTTP ${status}) to WaPilot.`
    : sanitizeErrorMessage(errorMessage(lastPayload, status));
  throw new EvolutionApiError(status, message, lastPayload, timeoutSource);
}

/** Administrative client used only by the owner-protected provisioning route. */
export class EvolutionGoAdminClient {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly globalApiKey: string;
  private readonly timeoutMs: number;

  constructor(options: { baseUrl: string; globalApiKey: string; fetcher?: typeof fetch; timeoutMs?: number }) {
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.globalApiKey = options.globalApiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private request<T>(path: string, apiKey: string, init: EvolutionRequestInit = {}): Promise<T> {
    return requestJson(this.fetcher, this.baseUrl, path, apiKey, { ...init, timeoutMs: init.timeoutMs ?? this.timeoutMs });
  }

  async deleteInstance(instanceId: string): Promise<unknown> {
    return this.request(`/instance/delete/${encodeURIComponent(instanceId)}`, this.globalApiKey, { method: 'DELETE' });
  }

  async createInstance(input: EvolutionInstanceCreateInput): Promise<unknown> {
    return this.request('/instance/create', this.globalApiKey, {
      method: 'POST',
      body: jsonApiBody({ type: 'connection', attributes: { name: input.name, token: input.token } }),
    });
  }

  async connectInstance(token: string, input: EvolutionConnectInput): Promise<unknown> {
    const attributes: Record<string, unknown> = {};
    if (input.webhookUrl !== undefined) attributes.webhookUrl = input.webhookUrl;
    if (input.subscribe !== undefined) attributes.subscribe = input.subscribe;
    if (input.immediate !== undefined) attributes.immediate = input.immediate;
    return this.request('/instance/connect', token, {
      method: 'POST',
      body: jsonApiBody({ type: 'connection', ...(input.instanceId ? { id: input.instanceId } : {}), attributes }),
    });
  }

  async qr(token: string): Promise<unknown> {
    return this.request('/instance/qr', token);
  }

  /** Start the existing instance again after logout and wait for its QR code.
   * Reconnecting alone restarts the runtime, but the current Evolution Go
   * contract requires /instance/connect to begin a new pairing flow. */
  async renewQr(token: string, options: EvolutionQrRenewOptions = {}): Promise<unknown> {
    const { maxAttempts = 3, retryDelayMs = 500, ...connectInput } = options;
    const attempts = Math.max(1, Math.floor(maxAttempts));
    await this.connectInstance(token, { ...connectInput, immediate: connectInput.immediate ?? true });

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.qr(token);
      } catch (error) {
        const retryable = error instanceof EvolutionApiError && (error.status === 400 || error.status >= 500);
        if (!retryable || attempt === attempts) throw error;
        if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    throw new Error('Evolution Go QR renewal did not complete');
  }

  async reconnectInstance(token: string, instanceId?: string): Promise<unknown> {
    return this.request('/instance/reconnect', token, {
      method: 'POST',
      body: jsonApiBody({ type: 'connection', ...(instanceId ? { id: instanceId } : {}) }),
    });
  }

  async status(token: string): Promise<unknown> {
    return this.request('/instance/status', token);
  }

  async instanceInfo(instanceId: string): Promise<unknown> {
    return this.request(`/instance/info/${encodeURIComponent(instanceId)}`, this.globalApiKey);
  }

  async avatar(token: string, number: string): Promise<unknown> {
    return this.request('/user/avatar', token, {
      method: 'POST',
      timeoutMs: Math.min(this.timeoutMs, AVATAR_REQUEST_TIMEOUT_MS),
      body: jsonApiBody({ type: 'chat', id: number, attributes: { preview: true } }),
    });
  }

  async listInstances(): Promise<unknown> {
    return this.request('/instance/all', this.globalApiKey);
  }
}

/** JSON:API exposes contacts as chat resources. */
function normalizeContact(value: unknown): Contact {
  const item = resource(value);
  const attributes = resourceAttributes(value);
  const id = stringValue(item?.id);
  return {
    id,
    jid: id,
    name: stringValue(attributes.fullName) ?? stringValue(attributes.firstName) ?? stringValue(attributes.name) ?? stringValue(attributes.businessName),
    pushName: stringValue(attributes.pushName),
    phoneNumber: stringValue(attributes.phoneNumber) ?? stringValue(attributes.phone),
    avatarUrl: stringValue(attributes.pictureUrl),
  };
}

function normalizeGroup(value: unknown): Group {
  const item = resource(value);
  const attributes = resourceAttributes(value);
  const participants = asRecord(item?.relationships)?.participants;
  const participantData = asRecord(participants)?.data;
  const participantItems = Array.isArray(participantData) ? participantData : [];
  return {
    id: stringValue(item?.id),
    jid: stringValue(item?.id),
    name: stringValue(attributes.subject),
    description: stringValue(attributes.description),
    owner: stringValue(attributes.owner),
    participants: participantItems.map((participant) => ({ jid: stringValue(resource(participant)?.id) })),
  };
}

function normalizeMessage(value: unknown): Message {
  const item = resource(value);
  const attributes = resourceAttributes(value);
  const body = asRecord(attributes.body) ?? {};
  const meta = resourceMeta(value);
  const author = stringValue(relationshipResource(value, 'author')?.id);
  const chat = stringValue(meta.chat);
  const at = typeof attributes.at === 'number' && Number.isFinite(attributes.at) ? attributes.at : undefined;
  const message: Message = {
    id: stringValue(item?.id),
    conversationId: chat,
    jid: chat,
    source: author,
    direction: typeof meta.fromMe === 'boolean'
      ? (meta.fromMe ? 'outbound' : 'inbound')
      : (typeof meta.flags === 'number' && (meta.flags & 1) !== 0 ? 'outbound' : undefined),
    timestamp: at === undefined ? undefined : new Date(at).toISOString(),
    type: stringValue(attributes.encodingFormat),
  };
  if (typeof body.text === 'string') message.text = body.text;
  const media = asRecord(body.media);
  if (media && typeof media.url === 'string') {
    const fileName = stringValue(media.fileName) ?? stringValue(attributes.filename) ?? stringValue(body.filename);
    message.media = {
      mimeType: stringValue(media.encodingFormat) ?? stringValue(attributes.encodingFormat),
      url: media.url,
      ...(fileName ? { fileName } : {}),
    };
  }
  const mediasArray = Array.isArray(body.medias) ? body.medias : undefined;
  if (mediasArray && mediasArray.length > 0) {
    message.medias = mediasArray.map((m) => {
      const rec = asRecord(m) ?? {};
      return {
        encodingFormat: stringValue(rec.encodingFormat),
        url: stringValue(rec.url),
        content: rec.content,
        fileName: stringValue(rec.fileName),
        fileSize: typeof rec.fileSize === 'number' ? rec.fileSize : undefined,
        duration: typeof rec.duration === 'number' ? rec.duration : undefined,
        pageCount: typeof rec.pageCount === 'number' ? rec.pageCount : undefined,
        width: typeof rec.width === 'number' ? rec.width : undefined,
        height: typeof rec.height === 'number' ? rec.height : undefined,
        displayName: stringValue(rec.displayName),
        name: stringValue(rec.name),
        address: stringValue(rec.address),
        latitude: typeof rec.latitude === 'number' ? rec.latitude : undefined,
        longitude: typeof rec.longitude === 'number' ? rec.longitude : undefined,
      };
    });
    if (!message.media && message.medias[0]?.url) {
      const first = message.medias[0];
      message.media = {
        mimeType: first.encodingFormat ?? stringValue(attributes.encodingFormat),
        url: first.url,
        ...(first.fileName ? { fileName: first.fileName } : {}),
      };
    }
  }
  if (typeof meta.flags === 'number') {
    message.flags = meta.flags;
  }
  const quoted = stringValue(meta.quotedId) ?? stringValue(meta.quoted);
  if (quoted) {
    message.quotedId = quoted;
  }
  if (Array.isArray(meta.mentions)) {
    message.mentions = meta.mentions.filter((m): m is string => typeof m === 'string');
  }
  // Evolution Go reports application/octet-stream when a stored row has
  // neither a body nor a file. That happens for text messages on instances with
  // saveMessageBodies off (only id and time are kept), so octet-stream does not
  // mean "binary media". Report text rows as text and flag empty rows instead
  // of passing a misleading file MIME type through.
  const isGenericFormat = !message.type || message.type === 'application/octet-stream';
  if (isGenericFormat && message.text !== undefined && !message.media) {
    message.type = 'text/plain';
  } else if (isGenericFormat && message.text === undefined && !message.media) {
    message.type = undefined;
    message.contentUnavailable = true;
  }
  return message;
}

function normalizeSendResult(payload: unknown, recipientId?: string): SendMessageResult {
  const item = resource(documentData(payload));
  const messageId = stringValue(item?.id);
  if (!item || item.type !== 'message' || !messageId) throw new EvolutionApiError(502, 'Evolution Go returned an invalid message resource', payload);
  const meta = resourceMeta(item);
  const recipient = relationshipResource(item, 'recipient')?.id ?? recipientId;
  return {
    accepted: true,
    messageId,
    conversationId: stringValue(meta.chat) ?? stringValue(recipient),
    jid: stringValue(meta.chat) ?? stringValue(recipient),
  };
}

const MESSAGE_SEARCH_MAX_LIMIT = 50;

/** Narrow HTTP client for the Evolution Go JSON:API 1.1 contract. */
export class EvolutionGoClient {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly instanceToken: string;
  private readonly instanceId: string;
  private readonly globalApiKey?: string;
  private readonly timeoutMs: number;

  constructor(options: EvolutionClientOptions) {
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.instanceToken = options.instanceToken;
    this.instanceId = options.instanceId;
    this.globalApiKey = options.globalApiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private request<T>(path: string, init: EvolutionRequestInit = {}): Promise<T> {
    return requestJson(this.fetcher, this.baseUrl, path, this.instanceToken, { ...init, timeoutMs: init.timeoutMs ?? this.timeoutMs });
  }

  private page<T>(payload: unknown, expectedType: string, mapper: (value: unknown) => T): Page<T> {
    const data = documentData(payload);
    if (!Array.isArray(data)) return { items: [], hasMore: false };
    return { items: data.filter((item) => resource(item)?.type === expectedType).map(mapper), hasMore: false };
  }

  async status(): Promise<Record<string, unknown>> {
    return this.request('/instance/status');
  }

  async searchContacts(query: string, cursor?: string, limit = 50): Promise<Page<Contact>> {
    const needle = query.trim().toLowerCase();
    const path = needle ? `/user/contacts?search=${encodeURIComponent(needle)}` : '/user/contacts';
    const payload = await this.request<unknown>(path);
    const contacts = this.page(payload, 'chat', normalizeContact).items.filter((contact) => {
      if (!needle) return true;
      const haystack = [contact.name, contact.pushName, contact.phoneNumber, contact.jid].filter(Boolean).join(' ').toLowerCase();
      const digits = needle.replace(/\D/g, '');
      return haystack.includes(needle) || Boolean(digits && (contact.jid ?? '').replace(/\D/g, '').includes(digits));
    });
    // Deduplicate contacts strictly by unique ID / JID
    const seenIds = new Set<string>();
    const deduplicated = contacts.filter((c) => {
      const key = (c.id || c.jid || '').trim();
      if (!key || seenIds.has(key)) return false;
      seenIds.add(key);
      return true;
    });
    const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const items = deduplicated.slice(offset, offset + limit);
    const nextCursor = offset + limit < deduplicated.length ? String(offset + limit) : undefined;
    return { items, nextCursor, hasMore: Boolean(nextCursor) };
  }

  async listGroups(cursor?: string, limit = 50): Promise<Page<Group>> {
    const payload = await this.request<unknown>('/group/list', { timeoutMs: GROUP_REQUEST_TIMEOUT_MS });
    const groups = this.page(payload, 'chat', normalizeGroup).items;
    const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const items = groups.slice(offset, offset + limit);
    const nextCursor = offset + limit < groups.length ? String(offset + limit) : undefined;
    return { items, nextCursor, hasMore: Boolean(nextCursor) };
  }

  async listMessages(text?: string, limit = 50, conversationId?: string, encodingFormat?: 'image/*', cursor?: string): Promise<Page<Message>> {
    const boundedLimit = Math.min(Math.max(limit, 1), 50);
    const query = text?.trim() ?? '';
    // Evolution Go caps limit at 50 (anything above falls back to 25), so look one row
    // ahead when we can, and otherwise probe once for an older row.
    const fetchLimit = Math.min(boundedLimit + 1, MESSAGE_SEARCH_MAX_LIMIT);
    const search = async (rowLimit: number, before?: string) => {
      const params = new URLSearchParams({ limit: String(rowLimit) });
      if (query) params.set('q', query);
      if (conversationId !== undefined) params.set('identifier', conversationId);
      if (encodingFormat) params.set('encodingFormat', encodingFormat);
      // Cursor = Unix ms; Evolution Go returns rows with at < before.
      if (before && /^\d{1,15}$/.test(before)) params.set('before', before);
      const payload = await this.request<unknown>(`/message/search?${params.toString()}`);
      return this.page(payload, 'message', normalizeMessage).items;
    };
    const time = (m: Message) => (m.timestamp ? Date.parse(m.timestamp) : NaN);
    const rows = await search(fetchLimit, cursor);
    let items = rows.slice(0, boundedLimit);
    const lookahead = rows.slice(boundedLimit);
    const times = items.map(time).filter(Number.isFinite);
    if (items.length < boundedLimit || !times.length) return { items, hasMore: false };
    let oldest = Math.min(...times);
    let nextCursor = oldest;
    let hasMore: boolean;
    if (lookahead.length) {
      hasMore = true;
      // A row past the page shares the oldest timestamp: `before` is exclusive, so move the
      // tied rows to the next page and point the cursor just after that timestamp.
      if (time(lookahead[0]) === oldest) {
        const untied = items.filter((m) => time(m) !== oldest);
        if (untied.length) { items = untied; nextCursor = oldest + 1; }
      }
    } else if (fetchLimit > boundedLimit) {
      hasMore = false;
    } else {
      hasMore = (await search(1, String(oldest))).length > 0;
    }
    return hasMore ? { items, nextCursor: String(nextCursor), hasMore: true } : { items, hasMore: false };
  }

  /** Fetch one stored message by id (Evolution Go POST /message/status).
   * Returns undefined when Evolution Go did not store it. */
  async getMessage(messageId: string, signal?: AbortSignal): Promise<Message | undefined> {
    try {
      const payload = await this.request<unknown>('/message/status', {
        method: 'POST',
        body: jsonApiBody({ type: 'message', id: messageId }),
        signal,
      });
      const item = documentData(payload);
      if (resource(item)?.type !== 'message') return undefined;
      const message = normalizeMessage(item);
      return message.id ? message : { ...message, id: messageId };
    } catch (error) {
      if (error instanceof EvolutionApiError && (error.status === 404 || error.status === 400)) return undefined;
      throw error;
    }
  }

  /** Read audio only from a retained message in this instance; never forward API credentials to storage. */
  async getMessageAudio(messageId: string, approvedOrigins: string[], maxBytes: number, signal: AbortSignal): Promise<string> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new AudioTranscriptionError('audio_unavailable', 500, 'WaPilot audio size limit is invalid.');
    let message: Message | undefined;
    try { message = await this.getMessage(messageId, signal); }
    catch (error) {
      signal.throwIfAborted();
      const status = error instanceof EvolutionApiError ? error.status : 502;
      const code = error instanceof EvolutionApiError && error.timeoutSource ? (error.timeoutSource === 'wapilot' ? 'wapilot_timeout' : 'upstream_timeout') : 'audio_unavailable';
      throw new AudioTranscriptionError(code, status, 'WaPilot could not retrieve the requested audio message.');
    }
    if (!message || message.id !== messageId) throw new AudioTranscriptionError('audio_unavailable', 404, 'WaPilot could not find this message in retained history.');
    const mimeType = (message.media?.mimeType ?? message.type ?? '').split(';')[0].trim().toLowerCase();
    if (!/^audio\/[a-z0-9][a-z0-9.+-]*$/.test(mimeType)) throw new AudioTranscriptionError('audio_unavailable', 415, 'WaPilot audio transcription requires an audio message.');
    let url: URL;
    try {
      const source = message.media?.url ?? '';
      url = new URL(source);
      if (source.length > 8192 || url.protocol !== 'https:' || url.username || url.password || url.hash || !approvedOrigins.includes(url.origin)) throw new Error();
    } catch {
      throw new AudioTranscriptionError('audio_unavailable', 404, 'WaPilot cannot access retained audio for this message. Unavailable files do not prove deletion.');
    }
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      signal.throwIfAborted();
      const response = await this.fetcher(url.href, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.any([signal, controller.signal]) });
      if (response.status === 408 || response.status === 504) throw new AudioTranscriptionError('upstream_timeout', response.status, `Audio storage returned a timeout response (HTTP ${response.status}) to WaPilot.`);
      if (!response.ok) throw new AudioTranscriptionError('audio_unavailable', response.status >= 400 ? response.status : 502, `WaPilot could not load audio from storage (HTTP ${response.status}).`);
      if (Number(response.headers.get('content-length')) > maxBytes) throw new AudioTranscriptionError('media_too_large', 413, `Media exceeds configured limit of ${maxBytes} bytes`);
      reader = response.body?.getReader();
      if (!reader) throw new AudioTranscriptionError('audio_unavailable', 502, 'WaPilot received an empty audio response.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new AudioTranscriptionError('media_too_large', 413, `Media exceeds configured limit of ${maxBytes} bytes`);
        chunks.push(value);
      }
      if (!size) throw new AudioTranscriptionError('audio_unavailable', 502, 'WaPilot received an empty audio response.');
      return Buffer.concat(chunks, size).toString('base64');
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof AudioTranscriptionError) throw error;
      throw new AudioTranscriptionError('audio_unavailable', 502, 'WaPilot could not load audio from storage.');
    } finally {
      controller.abort();
      reader?.releaseLock();
    }
  }

  /** Read a retained image without exposing its signed URL or forwarding API credentials. */
  async getMessageImage(messageId: string, approvedOrigins: string[], maxBytes: number): Promise<{ data: string; mimeType: string }> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new MessageImageError(500, 'WaPilot image size limit is invalid.');
    let message: Message | undefined;
    try { message = await this.getMessage(messageId); }
    catch (error) {
      if (error instanceof EvolutionApiError) {
        if (error.timeoutSource) throw error;
        throw new EvolutionApiError(error.status, `WaPilot could not retrieve the requested message (HTTP ${error.status}).`);
      }
      throw new MessageImageError(502, 'WaPilot could not retrieve the requested message.');
    }
    if (!message || message.id !== messageId) throw new MessageImageError(404, 'WaPilot could not find this message in retained history.');
    // shortcut: read the first normalized media item; add selection when album items need separate analysis.
    const image = galleryImage(message, approvedOrigins);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType)) throw new MessageImageError(415, 'WaPilot visual analysis supports JPEG, PNG and WebP images.');
    if (image.state !== 'ready') throw new MessageImageError(404, 'WaPilot cannot access a retained image for this message. Missing or unavailable files do not prove deletion.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.fetcher(image.url, { redirect: 'manual', credentials: 'omit', signal: controller.signal });
      if (response.status === 408 || response.status === 504) throw new EvolutionApiError(response.status, `Image storage returned a timeout response (HTTP ${response.status}) to WaPilot.`, undefined, 'upstream');
      if (!response.ok) throw new MessageImageError(response.status >= 400 ? response.status : 502, `WaPilot could not load the image from storage (HTTP ${response.status}).`);
      if (Number(response.headers.get('content-length')) > maxBytes) throw new MessageImageError(413, `Media exceeds configured limit of ${maxBytes} bytes`);
      reader = response.body?.getReader();
      if (!reader) throw new MessageImageError(502, 'WaPilot received an empty image response.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new MessageImageError(413, `Media exceeds configured limit of ${maxBytes} bytes`);
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks, size);
      const valid = image.mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        : image.mimeType === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
      if (!valid) throw new MessageImageError(415, 'WaPilot received content that does not match the expected image format.');
      return { data: bytes.toString('base64'), mimeType: image.mimeType };
    } catch (error) {
      if (controller.signal.aborted) throw new EvolutionApiError(504, `WaPilot stopped waiting for image storage after ${DEFAULT_REQUEST_TIMEOUT_MS} ms (WaPilot timeout).`, undefined, 'wapilot');
      if (error instanceof MessageImageError || error instanceof EvolutionApiError) throw error;
      throw new MessageImageError(502, 'WaPilot could not load the image from storage.');
    } finally {
      clearTimeout(timeout);
      controller.abort();
      reader?.releaseLock();
    }
  }

  async sendText(to: string, text: string, replyTo?: string, participant?: string): Promise<SendMessageResult> {
    const relationships: Record<string, unknown> = {
      recipient: { data: { type: 'chat', id: to } },
    };
    const body: Record<string, unknown> = { text };
    if (replyTo) relationships.quoted = { data: { type: 'message', id: replyTo, ...(participant ? { meta: { participant } } : {}) } };
    const payload = await this.request<unknown>('/send/text', {
      method: 'POST',
      body: jsonApiBody({ type: 'message', attributes: { encodingFormat: 'text/plain', body }, relationships }),
    });
    return normalizeSendResult(payload, to);
  }

  /** Re-send a retained message to another chat, flagged as forwarded (WhatsApp "Encaminhada"). */
  async forwardMessage(to: string, source: Message): Promise<SendMessageResult> {
    const relationships: Record<string, unknown> = { recipient: { data: { type: 'chat', id: to } } };
    const body: Record<string, unknown> = {};
    if (source.text) body.text = source.text;
    let path = '/send/text';
    let encodingFormat = 'text/plain';
    let timeoutMs: number | undefined;
    if (source.media && !source.media.url) {
      // Never silently drop the file and forward only the caption.
      throw new EvolutionApiError(422, 'The file of this message is not retained, so it cannot be forwarded; send it again with send_media');
    }
    if (source.media?.url) {
      path = '/send/media';
      body.media = { url: source.media.url };
      encodingFormat = (source.media.mimeType ?? source.type ?? 'application/octet-stream').toLowerCase();
      timeoutMs = MEDIA_REQUEST_TIMEOUT_MS;
    } else if (!source.text) {
      throw new EvolutionApiError(422, 'Message has no forwardable text or retained media');
    }
    const attributes: Record<string, unknown> = {
      encodingFormat,
      body,
      forwardingScore: 1,
      ...(source.media?.fileName ? { filename: source.media.fileName } : {}),
    };
    const payload = await this.request<unknown>(path, {
      method: 'POST',
      body: jsonApiBody({ type: 'message', attributes, relationships }),
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    return normalizeSendResult(payload, to);
  }

  async sendMedia(to: string, media: { mimeType: string; fileName?: string; data: ArrayBuffer; caption?: string }, replyTo?: string): Promise<SendMessageResult> {
    const bytes = new Uint8Array(media.data);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const relationships: Record<string, unknown> = { recipient: { data: { type: 'chat', id: to } } };
    const body: Record<string, unknown> = { media: { url: btoa(binary) } };
    if (media.caption) body.text = media.caption;
    if (replyTo) relationships.quoted = { data: { type: 'message', id: replyTo } };
    const payload = await this.request<unknown>('/send/media', {
      method: 'POST',
      body: jsonApiBody({ type: 'message', attributes: { encodingFormat: media.mimeType.toLowerCase(), body, ...(media.fileName ? { filename: media.fileName } : {}) }, relationships }),
      timeoutMs: MEDIA_REQUEST_TIMEOUT_MS,
    });
    return normalizeSendResult(payload, to);
  }
}

async function retryDelay(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
}
