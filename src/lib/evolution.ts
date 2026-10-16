import type { Contact, Group, Message, Page, SendMessageResult } from '../types';

const JSON_API_MEDIA_TYPE = 'application/vnd.api+json';

export interface EvolutionClientOptions {
  baseUrl: string;
  globalApiKey?: string;
  instanceToken: string;
  instanceId: string;
  fetcher?: typeof fetch;
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
}

export class EvolutionApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'EvolutionApiError';
  }
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
async function requestJson<T>(fetcher: typeof fetch, baseUrl: string, path: string, apiKey: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', JSON_API_MEDIA_TYPE);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', JSON_API_MEDIA_TYPE);
  headers.set('apikey', apiKey);
  const method = (init.method ?? 'GET').toUpperCase();
  const attempts = method === 'GET' ? 3 : 1;
  let lastStatus: number | undefined;
  let lastPayload: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, { ...init, headers });
    } catch (error) {
      if (attempt + 1 < attempts) {
        await retryDelay(attempt);
        continue;
      }
      throw new EvolutionApiError(503, 'Evolution Go is unreachable', { cause: error instanceof Error ? error.message : String(error) });
    }
    const text = await response.text();
    let payload: unknown = undefined;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
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
  throw new EvolutionApiError(status, sanitizeErrorMessage(errorMessage(lastPayload, status)), lastPayload);
}

/** Administrative client used only by the owner-protected provisioning route. */
export class EvolutionGoAdminClient {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly globalApiKey: string;

  constructor(options: { baseUrl: string; globalApiKey: string; fetcher?: typeof fetch }) {
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.globalApiKey = options.globalApiKey;
  }

  private request<T>(path: string, apiKey: string, init: RequestInit = {}): Promise<T> {
    return requestJson(this.fetcher, this.baseUrl, path, apiKey, init);
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
    return this.request('/instance/connect', token, {
      method: 'POST',
      body: jsonApiBody({ type: 'connection', ...(input.instanceId ? { id: input.instanceId } : {}), attributes }),
    });
  }

  async qr(token: string): Promise<unknown> {
    return this.request('/instance/qr', token);
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
    sender: author,
    direction: typeof meta.fromMe === 'boolean' ? (meta.fromMe ? 'outbound' : 'inbound') : undefined,
    timestamp: at === undefined ? undefined : new Date(at).toISOString(),
    type: stringValue(attributes.encodingFormat),
  };
  if (typeof body.text === 'string') message.text = body.text;
  const media = asRecord(body.media);
  if (media && typeof media.url === 'string') {
    message.media = { mimeType: stringValue(attributes.encodingFormat), url: media.url };
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

/** Narrow HTTP client for the Evolution Go JSON:API 1.1 contract. */
export class EvolutionGoClient {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly instanceToken: string;
  private readonly instanceId: string;
  private readonly globalApiKey?: string;

  constructor(options: EvolutionClientOptions) {
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.instanceToken = options.instanceToken;
    this.instanceId = options.instanceId;
    this.globalApiKey = options.globalApiKey;
  }

  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    return requestJson(this.fetcher, this.baseUrl, path, this.instanceToken, init);
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
    const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const items = contacts.slice(offset, offset + limit);
    const nextCursor = offset + limit < contacts.length ? String(offset + limit) : undefined;
    return { items, nextCursor, hasMore: Boolean(nextCursor) };
  }

  async listGroups(cursor?: string, limit = 50): Promise<Page<Group>> {
    const payload = await this.request<unknown>('/group/list');
    const groups = this.page(payload, 'chat', normalizeGroup).items;
    const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const items = groups.slice(offset, offset + limit);
    const nextCursor = offset + limit < groups.length ? String(offset + limit) : undefined;
    return { items, nextCursor, hasMore: Boolean(nextCursor) };
  }

  async listMessages(text?: string, limit = 50): Promise<Page<Message>> {
    const boundedLimit = Math.min(Math.max(limit, 1), 50);
    const query = text?.trim() ?? '';
    const params = new URLSearchParams({ limit: String(boundedLimit) });
    if (query) params.set('q', query);
    const payload = await this.request<unknown>(`/message/search?${params.toString()}`);
    return this.page(payload, 'message', normalizeMessage);
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
      body: jsonApiBody({ type: 'message', attributes: { encodingFormat: media.mimeType.toLowerCase(), body }, relationships }),
    });
    return normalizeSendResult(payload, to);
  }
}

async function retryDelay(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
}
