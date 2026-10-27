import { describe, expect, it } from 'vitest';
import { EvolutionGoClient } from '../src/lib/evolution';

describe('forwardMessage', () => {
  const make = (requests: Array<{ url: string; body: any }>) => new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceToken: 't', instanceId: 'i', globalApiKey: 'g', fetcher: async (request: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(request), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return Response.json({ jsonapi: { version: '1.1' }, data: { type: 'message', id: 'NEW1', relationships: { recipient: { data: { type: 'chat', id: 'to@s.whatsapp.net' } } } } });
  } } as any);

  it('forwards text with forwardingScore via /send/text', async () => {
    const requests: Array<{ url: string; body: any }> = [];
    const result = await make(requests).forwardMessage('to@s.whatsapp.net', { id: 'SRC', text: 'olá' });
    expect(requests[0].url).toBe('https://evolution.invalid/send/text');
    expect(requests[0].body.data.attributes).toEqual({ encodingFormat: 'text/plain', body: { text: 'olá' }, forwardingScore: 1 });
    expect(result.messageId).toBe('NEW1');
  });

  it('forwards retained media by URL via /send/media', async () => {
    const requests: Array<{ url: string; body: any }> = [];
    await make(requests).forwardMessage('to@s.whatsapp.net', { id: 'SRC', text: 'cap', media: { mimeType: 'image/jpeg', url: 'https://s.invalid/a.jpg' } });
    expect(requests[0].url).toBe('https://evolution.invalid/send/media');
    expect(requests[0].body.data.attributes).toEqual({ encodingFormat: 'image/jpeg', body: { text: 'cap', media: { url: 'https://s.invalid/a.jpg' } }, forwardingScore: 1 });
  });

  it('rejects messages with nothing to forward', async () => {
    await expect(make([]).forwardMessage('to', { id: 'SRC' })).rejects.toThrow(/no forwardable/);
  });
});
