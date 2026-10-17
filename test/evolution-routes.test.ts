import { describe, expect, it } from 'vitest';
import { EvolutionGoAdminClient, EvolutionGoClient } from '../src/lib/evolution';

describe('Evolution Go route contracts', () => {
  it('uses JSON:API resources for administrative writes', async () => {
    const requests: Array<{ url: string; body: unknown; contentType: string }> = [];
    const client = new EvolutionGoAdminClient({ baseUrl: 'https://evolution.invalid/', globalApiKey: 'global-secret', fetcher: async (request, init) => {
      requests.push({ url: String(request), body: init?.body ? JSON.parse(String(init.body)) : undefined, contentType: new Headers(init?.headers).get('content-type') ?? '' });
      return Response.json({ jsonapi: { version: '1.1' }, data: { type: 'connection', id: 'canonical-1', attributes: { name: 'heitor' } } });
    } });

    const created = await client.createInstance({ name: 'heitor', token: 'instance-secret' });
    await client.connectInstance('instance-secret', { instanceId: 'canonical-1', webhookUrl: 'https://app.invalid/webhook', subscribe: ['MESSAGE'] });
    await client.reconnectInstance('instance-secret', 'canonical-1');

    expect(created).toMatchObject({ data: { id: 'canonical-1', type: 'connection' } });
    expect(requests.map((item) => item.url)).toEqual([
      'https://evolution.invalid/instance/create',
      'https://evolution.invalid/instance/connect',
      'https://evolution.invalid/instance/reconnect',
    ]);
    expect(requests[0].body).toEqual({ data: { type: 'connection', attributes: { name: 'heitor', token: 'instance-secret' } } });
    expect(requests[1].body).toEqual({ data: { type: 'connection', id: 'canonical-1', attributes: { webhookUrl: 'https://app.invalid/webhook', subscribe: ['MESSAGE'] } } });
    expect(requests[2].body).toEqual({ data: { type: 'connection', id: 'canonical-1' } });
    expect(requests.every((item) => item.contentType === 'application/vnd.api+json')).toBe(true);
  });

  it('lists instances through the administrative route with the global key', async () => {
    let seen: { url: string; headers: Headers } | undefined;
    const client = new EvolutionGoAdminClient({ baseUrl: 'https://evolution.invalid/', globalApiKey: 'global-secret', fetcher: async (request, init) => {
      seen = { url: String(request), headers: new Headers(init?.headers) };
      return Response.json({ jsonapi: { version: '1.1' }, data: [{ type: 'connection', id: 'instance-1', attributes: { name: 'heitor' } }] });
    } });

    await expect(client.listInstances()).resolves.toEqual({ jsonapi: { version: '1.1' }, data: [{ type: 'connection', id: 'instance-1', attributes: { name: 'heitor' } }] });
    expect(seen?.url).toBe('https://evolution.invalid/instance/all');
    expect(seen?.headers.get('apikey')).toBe('global-secret');
  });

  it('uses the global key for instance metadata and the instance token for avatars', async () => {
    const calls: Array<{ url: string; method: string; apiKey: string | null; body?: unknown }> = [];
    const client = new EvolutionGoAdminClient({
      baseUrl: 'https://evolution.invalid',
      globalApiKey: 'global-secret',
      fetcher: async (request, init) => {
        calls.push({
          url: String(request),
          method: String(init?.method ?? 'GET'),
          apiKey: new Headers(init?.headers).get('apikey'),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return Response.json(String(request).includes('/instance/info/')
          ? { jsonapi: { version: '1.1' }, data: { type: 'connection', id: 'instance-1', attributes: { jid: '5511999999999@s.whatsapp.net' } } }
          : { jsonapi: { version: '1.1' }, meta: { result: { URL: 'https://pps.whatsapp.net/avatar' } } });
      },
    });

    await client.instanceInfo('instance-1');
    await client.avatar('instance-secret', '5511999999999');

    expect(calls).toEqual([
      { url: 'https://evolution.invalid/instance/info/instance-1', method: 'GET', apiKey: 'global-secret' },
      { url: 'https://evolution.invalid/user/avatar', method: 'POST', apiKey: 'instance-secret', body: { data: { type: 'chat', id: '5511999999999' } } },
    ]);
  });

  it('bounds avatar requests and returns a timeout error when Evolution Go stalls', async () => {
    const client = new EvolutionGoAdminClient({
      baseUrl: 'https://evolution.invalid',
      globalApiKey: 'global-secret',
      timeoutMs: 10,
      fetcher: async (_request, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    });

    await expect(client.avatar('instance-secret', '5511999999999@s.whatsapp.net')).rejects.toMatchObject({
      status: 504,
      message: 'Evolution Go request timed out',
    });
  });

  it('uses the Go text route and quoted message shape', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'ignored-by-go', instanceToken: 'instance-secret', fetcher: async (request, init) => {
      seen = { url: String(request), init: init as RequestInit };
      return Response.json({ jsonapi: { version: '1.1' }, data: { type: 'message', id: 'msg-1', attributes: { at: 1792104420000, encodingFormat: 'text/plain', body: { text: 'Olá' } }, relationships: { author: { data: { type: 'chat', id: '5511999999999' } } } } });
    } });
    const result = await client.sendText('5511999999999', 'Olá', 'quoted-1', '5511888888888');
    expect(result).toMatchObject({ accepted: true, messageId: 'msg-1', conversationId: '5511999999999' });
    expect(seen?.url).toBe('https://evolution.invalid/send/text');
    expect(JSON.parse(String(seen?.init.body))).toEqual({ data: { type: 'message', attributes: { encodingFormat: 'text/plain', body: { text: 'Olá' } }, relationships: { recipient: { data: { type: 'chat', id: '5511999999999' } }, quoted: { data: { type: 'message', id: 'quoted-1', meta: { participant: '5511888888888' } } } } } });
    expect(new Headers(seen?.init.headers).get('content-type')).toBe('application/vnd.api+json');
    expect(new Headers(seen?.init.headers).get('apikey')).toBe('instance-secret');
  });

  it('maps application MIME types to Evolution Go documents', async () => {
    let body = '';
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'ignored', instanceToken: 'secret', fetcher: async (_request, init) => {
      body = String(init?.body ?? '');
      return Response.json({ jsonapi: { version: '1.1' }, data: { type: 'message', id: 'sent-media', attributes: { at: 1792104420000, encodingFormat: 'application/pdf' } } });
    } });

    await client.sendMedia('5511999999999', { mimeType: 'application/pdf', fileName: 'arquivo.pdf', data: Uint8Array.from([1]).buffer });
    expect(JSON.parse(body)).toMatchObject({ data: { type: 'message', attributes: { encodingFormat: 'application/pdf', body: { media: { url: 'AQ==' } } }, relationships: { recipient: { data: { type: 'chat', id: '5511999999999' } } } } });
    expect(JSON.parse(body)).not.toHaveProperty('ptt');
  });

  it('retries transient GET failures before returning an Evolution error', async () => {
    let attempts = 0;
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'ignored', instanceToken: 'secret', fetcher: async () => {
      attempts += 1;
      if (attempts < 3) return Response.json({ jsonapi: { version: '1.1' }, errors: [{ status: '503', title: 'Service Unavailable', detail: 'temporary upstream failure' }] }, { status: 503 });
      return Response.json({ jsonapi: { version: '1.1' }, data: [{ type: 'chat', id: '5511999999999', attributes: { fullName: 'Alice' } }] });
    } });

    await expect(client.searchContacts('5511')).resolves.toMatchObject({ items: [{ jid: '5511999999999' }] });
    expect(attempts).toBe(3);
  });

  it('rejects legacy success envelopes instead of treating them as JSON:API', async () => {
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'ignored', instanceToken: 'secret', fetcher: async () => Response.json({ message: 'success', data: [{ id: 'legacy' }] }) });
    await expect(client.listMessages()).rejects.toMatchObject({ status: 502, message: 'Evolution Go returned an invalid JSON:API document' });
  });

  it('sanitizes JSON:API error details before exposing them to audit callers', async () => {
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'ignored', instanceToken: 'secret', fetcher: async () => Response.json({ jsonapi: { version: '1.1' }, errors: [{ status: '401', title: 'Unauthorized', detail: 'token=secret-value' }] }, { status: 401 }) });
    await expect(client.listMessages()).rejects.toMatchObject({ status: 401, message: 'token=[redacted]' });
  });

  it('does not normalize legacy-shaped resources hidden inside a JSON:API collection', async () => {
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'ignored', instanceToken: 'secret', fetcher: async () => Response.json({ jsonapi: { version: '1.1' }, data: [{ message_id: 'legacy', timestamp: 1792058400000 }] }) });
    await expect(client.listMessages()).resolves.toMatchObject({ items: [], hasMore: false });
  });

  it('starts pairing after logout and polls until a QR code is available', async () => {
    const calls: Array<{ path: string; method: string; body?: unknown }> = [];
    let qrAttempts = 0;
    const client = new EvolutionGoAdminClient({ baseUrl: 'https://evolution.invalid', globalApiKey: 'global-secret', fetcher: async (request, init) => {
      const url = new URL(String(request));
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ path: url.pathname, method: String(init?.method ?? 'GET'), body });
      if (url.pathname === '/instance/connect') return Response.json({ jsonapi: { version: '1.1' }, data: { type: 'connection', id: 'canonical-1', attributes: {} } });
      if (url.pathname === '/instance/qr') {
        qrAttempts += 1;
        if (qrAttempts < 2) return Response.json({ error: 'no QR code available' }, { status: 400 });
        return Response.json({ jsonapi: { version: '1.1' }, data: { type: 'connection', id: 'canonical-1', attributes: { qr: 'a'.repeat(120) } } });
      }
      return Response.json({ error: 'unexpected route' }, { status: 500 });
    } });

    await expect(client.renewQr('instance-secret', { subscribe: ['MESSAGE', 'CONNECTION'], retryDelayMs: 0 })).resolves.toMatchObject({ data: { attributes: { qr: expect.any(String) } } });
    expect(calls).toEqual([
      { path: '/instance/connect', method: 'POST', body: { data: { type: 'connection', attributes: { subscribe: ['MESSAGE', 'CONNECTION'], immediate: true } } } },
      { path: '/instance/qr', method: 'GET' },
      { path: '/instance/qr', method: 'GET' },
    ]);
  });

  it('matches Evolution Go FullName and Jid, and treats whitespace as the whole book', async () => {
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'ignored', instanceToken: 'secret', fetcher: async () => Response.json({
      jsonapi: { version: '1.1' },
      data: [
        { type: 'chat', id: '555491977284', attributes: { firstName: '', fullName: 'Lucas Lermen', pushName: '', businessName: '' } },
        { type: 'chat', id: '5511999999999', attributes: { fullName: '', pushName: 'Ana' } },
      ],
    }) });

    await expect(client.searchContacts('Lucas')).resolves.toMatchObject({ items: [{ jid: '555491977284', name: 'Lucas Lermen' }] });
    await expect(client.searchContacts('lermen')).resolves.toMatchObject({ items: [{ name: 'Lucas Lermen' }] });
    await expect(client.searchContacts('ana')).resolves.toMatchObject({ items: [{ pushName: 'Ana' }] });
    await expect(client.searchContacts(' ')).resolves.toMatchObject({ items: [{ name: 'Lucas Lermen' }, { pushName: 'Ana' }] });
    await expect(client.searchContacts('nobody')).resolves.toMatchObject({ items: [] });
  });

  it('searches persisted messages through the Evolution message route', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'instance-1', instanceToken: 'secret', fetcher: async (request, init) => {
      calls.push({ url: String(request), method: String(init?.method ?? 'GET') });
      return Response.json({ jsonapi: { version: '1.1' }, data: [{ type: 'message', id: 'message-1', attributes: { at: 1792058400000, encodingFormat: 'text/plain', body: { text: 'Olá' } }, meta: { chat: '5511999999999', fromMe: false }, relationships: { author: { data: { type: 'chat', id: '5511999999999' } } } }] });
    } });

    await expect(client.listMessages('Olá', 10)).resolves.toMatchObject({ items: [{ id: 'message-1', text: 'Olá', type: 'text/plain', conversationId: '5511999999999', sender: '5511999999999', timestamp: '2026-10-15T10:00:00.000Z' }] });
    expect(calls[0]).toEqual({ url: 'https://evolution.invalid/message/search?limit=10&q=Ol%C3%A1', method: 'GET' });
  });
});
