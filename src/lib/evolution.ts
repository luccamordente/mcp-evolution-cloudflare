import type { Contact, Conversation, Group, MediaDownload, Message, Page, SendMessageResult } from '../types';

export interface EvolutionClientOptions {
  baseUrl: string;
  globalApiKey?: string;
  instanceToken: string;
  instanceId: string;
  fetcher?: typeof fetch;
}

export class EvolutionApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'EvolutionApiError';
  }
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
    this.fetcher = options.fetcher ?? fetch;
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
    const payload = await this.request<unknown>('/user/contacts');
    const object = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined;
    const values = Array.isArray(payload) ? payload : (Array.isArray(object?.data) ? object.data : Array.isArray(object?.items) ? object.items : payload);
    const needle = query.trim().toLocaleLowerCase();
    const contacts = (Array.isArray(values) ? values : []).map((value) => value as Contact).filter((contact) => {
      const haystack = [contact.name, contact.pushName, contact.phoneNumber, contact.jid].filter(Boolean).join(' ').toLocaleLowerCase();
      return !needle || haystack.includes(needle);
    });
    const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
    const items = contacts.slice(offset, offset + limit);
    const nextCursor = typeof object?.next_cursor === 'string' ? object.next_cursor : typeof object?.nextCursor === 'string' ? object.nextCursor : offset + limit < contacts.length ? String(offset + limit) : undefined;
    return { items, nextCursor, hasMore: Boolean(nextCursor) };
  }

  async listConversations(_cursor?: string, _limit?: number): Promise<Page<Conversation>> {
    throw new EvolutionApiError(501, 'Evolution Go does not expose a conversation list endpoint; use captured webhook events');
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

  async listMessages(_options?: { conversationId?: string; after?: string; before?: string; text?: string; cursor?: string; limit?: number }): Promise<Page<Message>> {
    throw new EvolutionApiError(501, 'Evolution Go does not expose message history search; configure webhook capture for post-integration history');
  }

  async sendText(to: string, text: string, replyTo?: string, participant?: string): Promise<SendMessageResult> {
    return this.request('/send/text', {
      method: 'POST', body: JSON.stringify({ number: to, text, ...(replyTo ? { quoted: { messageId: replyTo, ...(participant ? { participant } : {}) } } : {}) }),
    });
  }

  async sendMedia(to: string, media: { mimeType: string; fileName?: string; data: ArrayBuffer; caption?: string; ptt?: boolean }, replyTo?: string): Promise<SendMessageResult> {
    const bytes = new Uint8Array(media.data);
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    const type = media.mimeType.split('/')[0] || 'document';
    return this.request('/send/media', {
      method: 'POST',
      body: JSON.stringify({ number: to, url: `data:${media.mimeType};base64,${btoa(binary)}`, type, caption: media.caption, filename: media.fileName, ptt: media.ptt, ...(replyTo ? { quoted: { messageId: replyTo } } : {}) }),
    });
  }

  async downloadMedia(messageId: string, message: unknown): Promise<MediaDownload> {
    const payload = await this.request<{ data?: { base64?: string; mimetype?: string; fileName?: string }; base64?: string; mimetype?: string; fileName?: string }>('/message/downloadmedia', { method: 'POST', body: JSON.stringify({ message }) });
    const raw = payload.data ?? payload;
    const dataUrl = raw.base64 ?? '';
    const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!match) throw new EvolutionApiError(502, 'Evolution Go returned media without a data URL');
    const binary = atob(match[2]);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return { body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), mimeType: raw.mimetype ?? match[1] ?? 'application/octet-stream', fileName: raw.fileName, size: bytes.byteLength };
  }
}
