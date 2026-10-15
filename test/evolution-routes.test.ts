import { describe, expect, it } from 'vitest';
import { EvolutionGoAdminClient, EvolutionGoClient } from '../src/lib/evolution';

describe('Evolution Go route contracts', () => {
  it('lists instances through the administrative route with the global key', async () => {
    let seen: { url: string; headers: Headers } | undefined;
    const client = new EvolutionGoAdminClient({ baseUrl: 'https://evolution.invalid/', globalApiKey: 'global-secret', fetcher: async (request, init) => {
      seen = { url: String(request), headers: new Headers(init?.headers) };
      return Response.json({ message: 'success', data: [{ id: 'instance-1' }] });
    } });

    await expect(client.listInstances()).resolves.toEqual({ message: 'success', data: [{ id: 'instance-1' }] });
    expect(seen?.url).toBe('https://evolution.invalid/instance/all');
    expect(seen?.headers.get('apikey')).toBe('global-secret');
  });

  it('uses the Go text route and quoted message shape', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'ignored-by-go', instanceToken: 'instance-secret', fetcher: async (request, init) => {
      seen = { url: String(request), init: init as RequestInit };
      return Response.json({ data: { Info: { ID: 'msg-1' } } });
    } });
    const result = await client.sendText('5511999999999', 'Olá', 'quoted-1', '5511888888888');
    expect(result).toBeTruthy();
    expect(seen?.url).toBe('https://evolution.invalid/send/text');
    expect(JSON.parse(String(seen?.init.body))).toEqual({ number: '5511999999999', text: 'Olá', quoted: { messageId: 'quoted-1', participant: '5511888888888' } });
    expect(new Headers(seen?.init.headers).get('apikey')).toBe('instance-secret');
  });

  it('maps application MIME types to Evolution Go documents', async () => {
    let body = '';
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'ignored', instanceToken: 'secret', fetcher: async (_request, init) => {
      body = String(init?.body ?? '');
      return Response.json({ accepted: true });
    } });

    await client.sendMedia('5511999999999', { mimeType: 'application/pdf', fileName: 'arquivo.pdf', data: Uint8Array.from([1]).buffer });
    expect(JSON.parse(body)).toMatchObject({ type: 'document', filename: 'arquivo.pdf', url: 'AQ==' });
    expect(JSON.parse(body)).not.toHaveProperty('ptt');
  });

  it('retries transient GET failures before returning an Evolution error', async () => {
    let attempts = 0;
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'ignored', instanceToken: 'secret', fetcher: async () => {
      attempts += 1;
      if (attempts < 3) return Response.json({ message: 'temporary upstream failure' }, { status: 503 });
      return Response.json({ data: [{ jid: '5511999999999@s.whatsapp.net' }] });
    } });

    await expect(client.searchContacts('5511')).resolves.toMatchObject({ items: [{ jid: '5511999999999@s.whatsapp.net' }] });
    expect(attempts).toBe(3);
  });

  it('matches Evolution Go FullName and Jid, and treats whitespace as the whole book', async () => {
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'ignored', instanceToken: 'secret', fetcher: async () => Response.json({
      data: [
        { Jid: '555491977284@s.whatsapp.net', Found: true, FirstName: '', FullName: 'Lucas Lermen', PushName: '', BusinessName: '' },
        { Jid: '5511999999999@s.whatsapp.net', FullName: '', PushName: 'Ana' },
      ],
    }) });

    await expect(client.searchContacts('Lucas')).resolves.toMatchObject({ items: [{ jid: '555491977284@s.whatsapp.net', name: 'Lucas Lermen' }] });
    await expect(client.searchContacts('lermen')).resolves.toMatchObject({ items: [{ name: 'Lucas Lermen' }] });
    await expect(client.searchContacts('ana')).resolves.toMatchObject({ items: [{ pushName: 'Ana' }] });
    await expect(client.searchContacts(' ')).resolves.toMatchObject({ items: [{ name: 'Lucas Lermen' }, { pushName: 'Ana' }] });
    await expect(client.searchContacts('nobody')).resolves.toMatchObject({ items: [] });
  });

  it('searches persisted messages through the Evolution message route', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'instance-1', instanceToken: 'secret', fetcher: async (request, init) => {
      calls.push({ url: String(request), method: String(init?.method ?? 'GET') });
      return Response.json({ message: 'success', data: [{ message_id: 'message-1', body: 'Olá', timestamp: '2026-10-15T10:00:00Z' }] });
    } });

    await expect(client.listMessages('Olá', 10)).resolves.toMatchObject({ items: [{ id: 'message-1', text: 'Olá' }] });
    expect(calls[0]).toEqual({ url: 'https://evolution.invalid/message/search?limit=10&q=Ol%C3%A1', method: 'GET' });
  });
});
