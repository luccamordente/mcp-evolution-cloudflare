import type { Contact, Group, Message, Page, SendMessageResult } from '../types';

export interface EvolutionClientOptions {
  baseUrl: string;
  globalApiKey?: string;
  instanceToken: string;
  instanceId: string;
  fetcher?: typeof fetch;
}

export interface EvolutionInstanceCreateInput {
  name: string;
  instanceId: string;
  token: string;
}

export interface EvolutionConnectInput {
  webhookUrl?: string;
  subscribe?: string[];
  immediate?: boolean;
}

export class EvolutionApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'EvolutionApiError';
  }
}

/** Administrative client used only by the owner-protected provisioning route.
 * It keeps the global key separate from per-instance credentials. */
export class EvolutionGoAdminClient {
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private readonly globalApiKey: string;

  constructor(options: { baseUrl: string; globalApiKey: string; fetcher?: typeof fetch }) {
    this.fetcher = options.fetcher ?? fetch.bind(globalThis);
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.globalApiKey = options.globalApiKey;
  }

  private async request<T>(path: string, apiKey: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    headers.set('apikey', apiKey);
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers });
    } catch (error) {
      throw new EvolutionApiError(503, 'Evolution Go is unreachable', { cause: error instanceof Error ? error.message : String(error) });
    }
    const text = await response.text();
    let payload: unknown = undefined;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
    if (!response.ok) {
      const message = typeof payload === 'object' && payload && 'message' in payload ? String((payload as { message: unknown }).message) : `Evolution Go request failed (${response.status})`;
      throw new EvolutionApiError(response.status, message, payload);
    }
    return payload as T;
  }

  async createInstance(input: EvolutionInstanceCreateInput): Promise<unknown> {
    return this.request('/instance/create', this.globalApiKey, { method: 'POST', body: JSON.stringify(input) });
  }

  async connectInstance(token: string, input: EvolutionConnectInput): Promise<unknown> {
    return this.request('/instance/connect', token, { method: 'POST', body: JSON.stringify(input) });
  }

  async qr(token: string): Promise<unknown> {
    return this.request('/instance/qr', token);
  }

  async reconnectInstance(token: string): Promise<unknown> {
    return this.request('/instance/reconnect', token, { method: 'POST', body: JSON.stringify({}) });
  }

  async status(token: string): Promise<unknown> {
    return this.request('/instance/status', token);
  }

  async listInstances(): Promise<unknown> {
    return this.request('/instance/all', this.globalApiKey);
  }
}

function field(record: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const value = record[name];
    if (typeof value === 'string' && value.trim()) return value;
  }
  const lowered = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]));
  for (const name of names) {
    const value = lowered.get(name.toLowerCase());
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

/** Evolution Go returns PascalCase contact fields (`FullName`, `Jid`). */
function normalizeContact(value: unknown): Contact {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const fullName = field(record, 'FullName', 'fullName', 'name');
  const firstName = field(record, 'FirstName', 'firstName');
  const pushName = field(record, 'PushName', 'pushName');
  const businessName = field(record, 'BusinessName', 'businessName');
  return {
    jid: field(record, 'Jid', 'jid'),
    name: fullName || firstName || pushName || businessName || undefined,
    pushName: pushName || undefined,
    phoneNumber: field(record, 'phoneNumber', 'phone') || undefined,
  };
}

/**
 * Narrow HTTP client for Evolution Go. Paths are kept in one place because the
 * backend's contract is versioned independently from Evolution API v2.
 * No credential is ever placed in a URL or returned to callers.
 */
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

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    // Evolution Go authenticates instance routes with the instance token in `apikey`.
    // The global key is retained for administrative routes only and is never sent to user tools.
    headers.set('apikey', this.instanceToken);
    const method = (init.method ?? 'GET').toUpperCase();
    const attempts = method === 'GET' ? 3 : 1;
    let lastStatus: number | undefined;
    let lastPayload: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers });
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
      if (response.ok) return payload as T;
      lastStatus = response.status;
      lastPayload = payload;
      if (response.status < 500 || response.status > 599 || attempt + 1 >= attempts) break;
      await retryDelay(attempt);
    }
    const message = typeof lastPayload === 'object' && lastPayload && 'message' in lastPayload ? String((lastPayload as { message: unknown }).message) : `Evolution Go request failed (${lastStatus ?? 502})`;
    throw new EvolutionApiError(lastStatus ?? 502, message, lastPayload);
  }

  private page<T>(payload: unknown, mapper: (value: unknown) => T): Page<T> {
    if (Array.isArray(payload)) return { items: payload.map(mapper), hasMore: false };
    const object = (payload ?? {}) as Record<string, unknown>;
    const raw = object.items ?? object.data ?? object.results ?? [];
    const items = Array.isArray(raw) ? raw.map(mapper) : [];
    const nextCursor = typeof object.nextCursor === 'string' ? object.nextCursor : typeof object.next_cursor === 'string' ? object.next_cursor : undefined;
    const hasMore = Boolean(object.hasMore ?? object.has_more ?? nextCursor);
    return { items, nextCursor, hasMore };
  }

  async status(): Promise<Record<string, unknown>> {
    return this.request('/instance/status');
  }

  async searchContacts(query: string, cursor?: string, limit = 50): Promise<Page<Contact>> {
    const needle = query.trim().toLowerCase();
    const path = needle ? `/user/contacts?search=${encodeURIComponent(needle)}` : '/user/contacts';
    const payload = await this.request<unknown>(path);
    const object = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined;
    const values = Array.isArray(payload) ? payload : (Array.isArray(object?.data) ? object.data : Array.isArray(object?.items) ? object.items : payload);
    const digits = needle.replace(/\D/g, '');
    const contacts = (Array.isArray(values) ? values : []).map(normalizeContact).filter((contact) => {
      if (!needle) return true;
      const haystack = [contact.name, contact.pushName, contact.phoneNumber, contact.jid].filter(Boolean).join(' ').toLowerCase();
      if (haystack.includes(needle)) return true;
      return Boolean(digits) && (contact.jid ?? '').replace(/\D/g, '').includes(digits);
    });
    const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const items = contacts.slice(offset, offset + limit);
    const nextCursor = typeof object?.next_cursor === 'string' ? object.next_cursor : typeof object?.nextCursor === 'string' ? object.nextCursor : offset + limit < contacts.length ? String(offset + limit) : undefined;
    return { items, nextCursor, hasMore: Boolean(nextCursor) };
  }

  async listGroups(cursor?: string, limit = 50): Promise<Page<Group>> {
    const payload = await this.request<unknown>('/group/list');
    const values = Array.isArray(payload) ? payload : ((payload as Record<string, unknown> | undefined)?.data ?? payload);
    const groups = Array.isArray(values) ? values.map((value) => value as Group) : [];
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
    return this.page(payload, normalizeStoredMessage);
  }

  async sendText(to: string, text: string, replyTo?: string, participant?: string): Promise<SendMessageResult> {
    return this.request('/send/text', {
      method: 'POST', body: JSON.stringify({ number: to, text, ...(replyTo ? { quoted: { messageId: replyTo, ...(participant ? { participant } : {}) } } : {}) }),
    });
  }

  async sendMedia(to: string, media: { mimeType: string; fileName?: string; data: ArrayBuffer; caption?: string }, replyTo?: string): Promise<SendMessageResult> {
    const bytes = new Uint8Array(media.data);
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    // Evolution Go accepts only image, video, audio, or document here. MIME
    // types such as application/pdf must be sent as `document`, not `application`.
    const mimeType = media.mimeType.toLowerCase();
    const type = mimeType.startsWith('image/') ? 'image'
      : mimeType.startsWith('video/') ? 'video'
        : mimeType.startsWith('audio/') ? 'audio' : 'document';
    return this.request('/send/media', {
      method: 'POST',
      body: JSON.stringify({ number: to, url: btoa(binary), type, caption: media.caption, filename: media.fileName, ...(replyTo ? { quoted: { messageId: replyTo } } : {}) }),
    });
  }

}

function normalizeStoredMessage(value: unknown): Message {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const id = record.message_id ?? record.messageId ?? record.id;
  const text = record.body ?? record.text;
  return {
    id: typeof id === 'string' ? id : undefined,
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : undefined,
    text: typeof text === 'string' ? text : undefined,
    type: typeof record.source === 'string' ? record.source : undefined,
    raw: value,
  };
}

async function retryDelay(attempt: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
}
