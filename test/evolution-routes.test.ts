import { describe, expect, it } from 'vitest';
import { EvolutionGoClient } from '../src/lib/evolution';

describe('Evolution Go route contracts', () => {
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

  it('sends media as a Go data URL and downloads with the full envelope', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'ignored', instanceToken: 'secret', fetcher: async (request, init) => {
      calls.push({ url: String(request), body: typeof init?.body === 'string' ? init.body : undefined });
      if (String(request).endsWith('/message/downloadmedia')) return Response.json({ data: { base64: 'data:image/png;base64,AQ==', mimetype: 'image/png' } });
      return Response.json({ accepted: true });
    } });
    await client.sendMedia('group@g.us', { mimeType: 'image/png', fileName: 'a.png', data: Uint8Array.from([1]).buffer });
    const media = await client.downloadMedia('msg-1', { imageMessage: { url: 'https://media.invalid/file' } });
    expect(calls[0].url).toBe('https://evolution.invalid/send/media');
    expect(JSON.parse(calls[0].body ?? '{}').url).toBe('data:image/png;base64,AQ==');
    expect(calls[1].url).toBe('https://evolution.invalid/message/downloadmedia');
    expect(JSON.parse(calls[1].body ?? '{}')).toEqual({ message: { imageMessage: { url: 'https://media.invalid/file' } } });
    expect(media.mimeType).toBe('image/png');
  });
});
