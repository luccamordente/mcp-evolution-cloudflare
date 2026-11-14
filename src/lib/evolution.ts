import { contentDiagnosticSchema, nativeMessageSchema, hasNativeContent, responsePageSchema, type ResponseKind } from './native-message';
import type { Contact, Group, Message, Page, SendMessageResult } from '../types';
import { Buffer } from 'node:buffer';
import { galleryImage } from './image-gallery';
import { AudioTranscriptionError } from './audio-transcription';
import { DocumentReadingError } from './document-reading';
import { messageUpdateSchema } from './message-update';
import type { OutgoingMessage } from './send-message';

const JSON_API_MEDIA_TYPE = 'application/vnd.api+json';
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const AVATAR_REQUEST_TIMEOUT_MS = 3_000;
const GROUP_REQUEST_TIMEOUT_MS = 300_000;
const MEDIA_REQUEST_TIMEOUT_MS = 60_000;
const GIF_PLAYBACK_FLAG = 1 << 6;

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
  if (fetchInit.body && !(fetchInit.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', JSON_API_MEDIA_TYPE);
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
    messageType: stringValue(attributes.encodingFormat) ?? 'unknown',
  };
  const diagnostic = contentDiagnosticSchema.safeParse(meta.content);
  if (diagnostic.success) {
    message.contentDiagnostic = diagnostic.data;
    if (diagnostic.data.state === 'partial') message.contentPartial = true;
  }
  const native = nativeMessageSchema.safeParse(body);
  if (native.success) Object.assign(message, native.data);
  for (const kind of ['votes', 'eventResponses'] as const) {
    const relation = asRecord(asRecord(item?.relationships)?.[kind]);
    const related = stringValue(asRecord(relation?.links)?.related);
    const expected = kind === 'votes' ? `/polls/${encodeURIComponent(message.id ?? '')}/votes` : `/messages/${encodeURIComponent(message.id ?? '')}/event-responses`;
    if (related === expected) message.responseLinks = { ...message.responseLinks, [kind]: related };
  }
  if (typeof body.text === 'string') message.text = body.text;
  const media = asRecord(body.media);
  const fileName = stringValue(media?.fileName) ?? stringValue(attributes.filename) ?? stringValue(body.filename);
  const mimeType = stringValue(media?.encodingFormat);
  if (typeof media?.url === 'string' || fileName || mimeType) {
    message.media = {
      mimeType: mimeType ?? stringValue(attributes.encodingFormat),
      url: stringValue(media?.url),
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
        ...(rec.encodingFormat === 'text/vcard' && typeof rec.content === 'string' ? { content: rec.content } : {}),
        accuracyMeters: typeof rec.accuracyMeters === 'number' && Number.isFinite(rec.accuracyMeters) ? rec.accuracyMeters : undefined,
        speed: typeof rec.speed === 'number' && Number.isFinite(rec.speed) ? rec.speed : undefined,
        degrees: typeof rec.degrees === 'number' && Number.isFinite(rec.degrees) ? rec.degrees : undefined,
        waveform: typeof rec.waveform === 'string' ? rec.waveform : undefined,
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
    if (!message.media?.url && message.medias[0]?.url) {
      const first = message.medias[0];
      message.media = {
        ...message.media,
        mimeType: first.encodingFormat ?? message.media?.mimeType ?? stringValue(attributes.encodingFormat),
        url: first.url,
        ...(first.fileName ? { fileName: first.fileName } : {}),
      };
    }
  }
  if (typeof meta.flags === 'number') {
    message.flags = meta.flags;
    if (message.media && message.media.mimeType === 'video/mp4' && (meta.flags & GIF_PLAYBACK_FLAG) !== 0) message.media.gifPlayback = true;
  }
  const quoted = stringValue(meta.quotedId) ?? stringValue(meta.quoted);
  if (quoted) {
    message.quotedId = quoted;
  }
  if (Array.isArray(meta.mentions)) {
    message.mentions = meta.mentions.filter((m): m is string => typeof m === 'string');
  }
  const update = messageUpdateSchema.safeParse(meta.update);
  if (update.success) message.update = update.data;
  // Evolution Go reports application/octet-stream when a stored row has
  // neither a body nor a file. That happens for text messages on instances with
  // saveMessageBodies off (only id and time are kept), so octet-stream does not
  // mean "binary media". Report text rows as text and flag empty rows instead
  // of passing a misleading file MIME type through.
  const isGenericFormat = !message.type || message.type === 'application/octet-stream';
  const missingContent = message.text === undefined && !message.media && !message.medias?.length && !hasNativeContent(message);
  if (isGenericFormat && message.text !== undefined && !message.media) {
    message.type = 'text/plain';
  } else if (isGenericFormat && missingContent) {
    message.type = message.update?.state === 'unsupported' ? 'application/vnd.whatsapp.update' : undefined;
  }
  if (message.contentDiagnostic && ['unavailable', 'invalid', 'unsupported'].includes(message.contentDiagnostic.state)) {
    message.contentUnavailable = true;
    message.contentUnavailableReason = message.contentDiagnostic.reason;
  } else if (message.update?.state === 'unavailable') {
    message.contentUnavailable = true;
    message.contentUnavailableReason = message.update.reason;
  } else if (missingContent && message.update?.state !== 'unsupported') {
    message.contentUnavailable = true;
    message.contentUnavailableReason = 'not_retained_or_unknown';
  }

  return message;
}

function normalizeSendResult(payload: unknown, recipientId?: string): SendMessageResult {
  const item = resource(documentData(payload));
  const messageId = stringValue(item?.id);
  if (!item || item.type !== 'message' || !messageId) throw new EvolutionApiError(502, 'Evolution Go returned an invalid message resource', payload);
  const meta = resourceMeta(item);
  const recipient = relationshipResource(item, 'recipient')?.id ?? recipientId;
  const attributes = resourceAttributes(item);
  const body = asRecord(attributes.body);
  const firstMedia = Array.isArray(body?.medias) ? asRecord(body.medias[0]) : asRecord(body?.media);
  const mimeType = stringValue(attributes.encodingFormat)?.split(';')[0].trim().toLowerCase();
  const gifPlayback = mimeType === 'video/mp4' && typeof meta.flags === 'number' && (meta.flags & GIF_PLAYBACK_FLAG) !== 0;
  let media: SendMessageResult['media'];
  if (mimeType && mimeType !== 'text/plain' && (firstMedia || gifPlayback)) {
    const size = firstMedia?.fileSize;
    const fileName = stringValue(firstMedia?.fileName) ?? stringValue(attributes.filename);
    media = {
      mimeType,
      ...(fileName ? { fileName: fileName.slice(0, 255) } : {}),
      ...(typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 ? { size } : {}),
      ...(gifPlayback ? { gifPlayback: true } : {}),
    };
  }
  return {
    accepted: true,
    messageId,
    conversationId: stringValue(meta.chat) ?? stringValue(recipient),
    jid: stringValue(meta.chat) ?? stringValue(recipient),
    ...(media ? { media } : {}),
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
      if (resource(item)?.type !== 'message' || resource(item)?.id !== messageId) return undefined;
      return normalizeMessage(item);
    } catch (error) {
      if (error instanceof EvolutionApiError && (error.status === 404 || error.status === 400)) return undefined;
      throw error;
    }
  }

  async listMessageResponses(messageId: string, kind: ResponseKind, limit = 100, cursor?: string) {
    const message = await this.getMessage(messageId);
    const path = message?.responseLinks?.[kind];
    if (!path) throw new EvolutionApiError(404, 'WaPilot response relationship is unavailable for this message.');
    const query = new URLSearchParams({ 'page[limit]': String(limit) });
    const cursorKey = 'page[cursor]';
    if (cursor) query.set(cursorKey, cursor);
    const parsed = responsePageSchema.safeParse(await this.request<unknown>(`${path}?${query}`, { redirect: 'manual' }));
    if (!parsed.success) throw new EvolutionApiError(502, 'WaPilot received an invalid message response page.');
    const page = parsed.data;
    if (page.data.length > limit) throw new EvolutionApiError(502, 'WaPilot received an oversized message response page.');
    if (page.data.some(row => row.type !== (kind === 'votes' ? 'poll-vote' : 'event-response'))) throw new EvolutionApiError(502, 'WaPilot received an unexpected message response type.');
    if (page.data.some(row => ('pollMessageId' in row.attributes ? row.attributes.pollMessageId : row.attributes.eventMessageId) !== messageId)) throw new EvolutionApiError(502, 'WaPilot received responses for another message.');
    let nextCursor: string | undefined;
    if (page.links.next) {
      const next = new URL(page.links.next, 'https://responses.invalid');
      if (next.origin !== 'https://responses.invalid' || next.pathname !== path || next.username || next.password || next.hash) throw new EvolutionApiError(502, 'WaPilot received an invalid message response link.');
      nextCursor = next.searchParams.get(cursorKey) ?? undefined;
      if (!nextCursor) throw new EvolutionApiError(502, 'WaPilot received a response link without a cursor.');
    }
    if (page.meta.hasMore === true && !nextCursor) throw new EvolutionApiError(502, 'WaPilot received an incomplete message response page.');
    return { items: page.data, meta: page.meta, hasMore: Boolean(nextCursor), ...(nextCursor ? { nextCursor } : {}) };
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

  /** Read a retained PDF in this instance without forwarding API credentials to storage. */
  async getMessageDocument(messageId: string, approvedOrigins: string[], maxBytes: number, signal: AbortSignal): Promise<Blob> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new DocumentReadingError('document_unavailable', 500, 'WaPilot document size limit is invalid.');
    let message: Message | undefined;
    try { message = await this.getMessage(messageId, signal); }
    catch (error) {
      signal.throwIfAborted();
      const status = error instanceof EvolutionApiError ? error.status : 502;
      const code = error instanceof EvolutionApiError && error.timeoutSource ? (error.timeoutSource === 'wapilot' ? 'wapilot_timeout' : 'upstream_timeout') : 'document_unavailable';
      throw new DocumentReadingError(code, status, 'WaPilot could not retrieve the requested document message.');
    }
    if (!message || message.id !== messageId) throw new DocumentReadingError('document_unavailable', 404, 'WaPilot could not find this message in retained history.');
    const mimeType = (message.media?.mimeType ?? message.type ?? '').split(';')[0].trim().toLowerCase();
    if (mimeType !== 'application/pdf') throw new DocumentReadingError('document_unavailable', 415, 'WaPilot document reading supports PDF files only.');
    let url: URL;
    try {
      const source = message.media?.url ?? '';
      url = new URL(source);
      if (source.length > 8192 || url.protocol !== 'https:' || url.username || url.password || url.hash || !approvedOrigins.includes(url.origin)) throw new Error();
    } catch {
      throw new DocumentReadingError('document_unavailable', 404, 'WaPilot cannot access a retained PDF for this message. Unavailable files do not prove deletion.');
    }
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      signal.throwIfAborted();
      const response = await this.fetcher(url.href, { redirect: 'manual', credentials: 'omit', signal: AbortSignal.any([signal, controller.signal]) });
      if (response.status === 408 || response.status === 504) throw new DocumentReadingError('upstream_timeout', response.status, `Document storage returned a timeout response (HTTP ${response.status}) to WaPilot.`);
      if (!response.ok) throw new DocumentReadingError('document_unavailable', response.status >= 400 ? response.status : 502, `WaPilot could not load the document from storage (HTTP ${response.status}).`);
      if (Number(response.headers.get('content-length')) > maxBytes) throw new DocumentReadingError('media_too_large', 413, `Media exceeds configured limit of ${maxBytes} bytes`);
      reader = response.body?.getReader();
      if (!reader) throw new DocumentReadingError('document_unavailable', 502, 'WaPilot received an empty document response.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new DocumentReadingError('media_too_large', 413, `Media exceeds configured limit of ${maxBytes} bytes`);
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks, size);
      if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new DocumentReadingError('document_unavailable', 415, 'WaPilot received content that does not match the expected PDF format.');
      return new Blob([bytes], { type: 'application/pdf' });
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof DocumentReadingError) throw error;
      throw new DocumentReadingError('document_unavailable', 502, 'WaPilot could not load the document from storage.');
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

  async sendMessage(message: OutgoingMessage): Promise<SendMessageResult> {
    if (message.kind === 'forward') return this.sendRetainedMessage(message);
    const recipient = 'to' in message ? message.to : 'status@broadcast';
    const relationships: Record<string, unknown> = 'to' in message
      ? { recipient: { data: { type: 'chat', id: message.to } } } : {};
    if ('replyTo' in message && message.replyTo) {
      relationships.quoted = { data: { type: 'message', id: message.replyTo.messageId,
        ...(message.replyTo.participant ? { meta: { participant: message.replyTo.participant } } : {}) } };
    }
    const attributes: Record<string, unknown> = {};
    if ('delayMs' in message && message.delayMs !== undefined) attributes.delay = message.delayMs;
    if ('formatJid' in message && message.formatJid !== undefined) attributes.formatJid = message.formatJid;
    if ('mentions' in message && message.mentions) {
      if (message.mentions.kind === 'all') attributes.mentionAll = true;
      else attributes.mentionedJid = message.mentions.jids;
    }
    let route: string;
    let encodingFormat: string;
    let body: Record<string, unknown>;
    let timeoutMs: number | undefined;
    switch (message.kind) {
      case 'text':
        route = '/send/text';
        encodingFormat = 'text/plain';
        body = { text: message.text };
        if (message.forwardingScore !== undefined) attributes.forwardingScore = message.forwardingScore;
        break;
      case 'link':
        route = '/send/link';
        encodingFormat = 'text/plain';
        body = { text: message.text };
        timeoutMs = MEDIA_REQUEST_TIMEOUT_MS;
        break;
      case 'image': case 'video': case 'voice_note': case 'document': case 'gif':
        route = '/send/media';
        encodingFormat = message.mimeType.split(';')[0].trim().toLowerCase();
        body = { media: { url: message.source.dataBase64 }, ...('caption' in message && message.caption ? { text: message.caption } : {}) };
        if ('fileName' in message && message.fileName) attributes.filename = message.fileName;
        if (message.kind === 'gif') attributes.gifPlayback = true;
        else if (message.kind === 'video' && message.gifPlayback !== undefined) attributes.gifPlayback = message.gifPlayback;
        timeoutMs = MEDIA_REQUEST_TIMEOUT_MS;
        break;
      case 'event':
        route = '/send/event';
        encodingFormat = 'application/vnd.whatsapp.event';
        body = { event: { name: message.name, startTime: Date.parse(message.startTime) / 1000, ...(message.description !== undefined ? { description: message.description } : {}), ...(message.endTime ? { endTime: Date.parse(message.endTime) / 1000 } : {}), ...(message.location ? { location: message.location } : {}) } };
        break;
      case 'poll':
        route = '/send/poll';
        encodingFormat = 'application/vnd.whatsapp.poll';
        body = { text: message.question, options: message.options };
        attributes.maxAnswer = message.maxAnswers;
        break;
      case 'list':
        route = '/send/list';
        encodingFormat = 'application/vnd.whatsapp.list';
        body = { title: message.title, description: message.description, buttonText: message.buttonText,
          footerText: message.footerText, sections: message.sections };
        break;
      case 'location':
        route = '/send/location';
        encodingFormat = 'application/vnd.whatsapp.location';
        body = { name: message.name, latitude: message.latitude, longitude: message.longitude, address: message.address };
        break;
      case 'contact':
        route = '/send/contact';
        encodingFormat = 'text/vcard';
        body = {};
        attributes.vcard = { fullName: message.fullName, ...(message.organization ? { organization: message.organization } : {}), phone: message.phone };
        break;
      case 'sticker':
        route = '/send/sticker';
        encodingFormat = 'image/webp';
        body = { media: { url: message.url } };
        timeoutMs = MEDIA_REQUEST_TIMEOUT_MS;
        break;
      case 'buttons':
        route = '/send/button';
        encodingFormat = 'application/vnd.whatsapp.buttons';
        body = { title: message.title, description: message.description, footer: message.footer,
          buttons: message.buttons.map(button => {
            const common = { type: button.kind, displayText: button.label };
            switch (button.kind) {
              case 'reply': return { ...common, id: button.id };
              case 'copy': return { ...common, copyCode: button.code };
              case 'url': return { ...common, url: button.url };
              case 'call': return { ...common, phoneNumber: button.phoneNumber };
            }
          }) };
        if (message.header) attributes[message.header.kind === 'image' ? 'imageUrl' : 'videoUrl'] = message.header.url;
        timeoutMs = MEDIA_REQUEST_TIMEOUT_MS;
        break;
      case 'carousel': {
        const jsonStringContent = (value: string) => JSON.stringify(value).slice(1, -1);
        route = '/send/carousel';
        encodingFormat = 'application/vnd.whatsapp.carousel';
        body = {};
        if (message.footer !== undefined) attributes.footer = message.footer;
        attributes.cards = message.cards.map(card => ({ ...card, buttons: card.buttons?.map(button => {
          const common = { type: button.kind.toUpperCase(), displayText: jsonStringContent(button.label) };
          switch (button.kind) {
            case 'reply': return { ...common, id: jsonStringContent(button.id) };
            case 'copy': return { ...common, copyCode: jsonStringContent(button.code) };
            case 'url': return { ...common, id: jsonStringContent(button.url) };
            case 'call': return { ...common, id: jsonStringContent(button.phoneNumber) };
          }
        }) }));
        timeoutMs = MEDIA_REQUEST_TIMEOUT_MS;
        break;
      }
      case 'status_image': case 'status_video': {
        const form = new FormData();
        form.set('type', message.kind === 'status_image' ? 'image' : 'video');
        form.set('file', new Blob([Buffer.from(message.source.dataBase64, 'base64')], { type: message.mimeType }), 'attachment');
        if (message.caption !== undefined) form.set('caption', message.caption);
        if (message.customMessageId) form.set('id', message.customMessageId);
        const payload = await this.request<unknown>('/send/status/media', { method: 'POST', body: form, timeoutMs: MEDIA_REQUEST_TIMEOUT_MS });
        return normalizeSendResult(payload, recipient);
      }
      case 'status_text':
        route = '/send/status/text';
        encodingFormat = 'text/plain';
        body = { text: message.text };
        break;
      default: {
        const unreachable: never = message;
        throw new Error(`WaPilot cannot send this message kind: ${unreachable}`);
      }
    }
    const payload = await this.request<unknown>(route, {
      method: 'POST',
      body: jsonApiBody({ type: 'message', ...('customMessageId' in message && message.customMessageId ? { id: message.customMessageId } : {}),
        attributes: { encodingFormat, ...attributes, body }, relationships }),
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    return normalizeSendResult(payload, recipient);
  }

  private async sendRetainedMessage(message: Extract<OutgoingMessage, { kind: 'forward' }>): Promise<SendMessageResult> {
    const { conversationId, messageId } = message.source;
    let source: Message | undefined;
    let cursor: string | undefined;
    for (let pageNo = 0; pageNo < 5 && !source; pageNo++) {
      const page = await this.listMessages(undefined, 50, conversationId, undefined, cursor);
      source = page.items.find(item => item.id === messageId);
      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;
    }
    if (!source) source = await this.getMessage(messageId);
    const sourceConversation = source?.conversationId ?? source?.jid;
    const conversationKey = (value: string) => /^\+?(\d+)(?::\d+)?(?:@s\.whatsapp\.net)?$/.exec(value)?.[1] ?? value;
    if (!source || !sourceConversation || conversationKey(sourceConversation) !== conversationKey(conversationId)) {
      throw new EvolutionApiError(404, 'WaPilot could not find that retained message in the selected conversation.');
    }
    const body: Record<string, unknown> = {};
    if (source.text) body.text = source.text;
    let route = '/send/text';
    let encodingFormat = 'text/plain';
    let timeoutMs: number | undefined;
    if (!source.media?.url && (source.media || source.medias?.length || (source.type && source.type !== 'text/plain'))) {
      throw new EvolutionApiError(422, 'WaPilot cannot forward this attachment because its file is unavailable.');
    }
    if (source.media?.url) {
      route = '/send/media';
      body.media = { url: source.media.url };
      encodingFormat = (source.media.mimeType ?? source.type ?? 'application/octet-stream').toLowerCase();
      timeoutMs = MEDIA_REQUEST_TIMEOUT_MS;
    } else if (!source.text) {
      throw new EvolutionApiError(422, 'WaPilot could not find retained text or media to forward.');
    }
    const payload = await this.request<unknown>(route, {
      method: 'POST',
      body: jsonApiBody({ type: 'message', attributes: { encodingFormat, body, forwardingScore: 1,
        ...(source.media?.fileName ? { filename: source.media.fileName } : {}),
        ...(encodingFormat === 'video/mp4' && (source.media?.gifPlayback || ((source.flags ?? 0) & GIF_PLAYBACK_FLAG) !== 0) ? { gifPlayback: true } : {}) },
        relationships: { recipient: { data: { type: 'chat', id: message.to } } } }),
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    return normalizeSendResult(payload, message.to);
  }

}

async function retryDelay(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
}
