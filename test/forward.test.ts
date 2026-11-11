import { describe, expect, it } from 'vitest';
import { EvolutionGoClient } from '../src/lib/evolution';
import type { OutgoingMessage } from '../src/lib/send-message';

describe('sendMessage forwarding', () => {
  type Retained = { id?: string; text?: string; flags?: number; media?: { mimeType: string; url: string; fileName?: string; gifPlayback?: boolean } };
  const make = (requests: Array<{ url: string; body: unknown }>, source: Retained) => new EvolutionGoClient({
    baseUrl: 'https://evolution.invalid', instanceToken: 't', instanceId: 'i', globalApiKey: 'g',
    fetcher: async (request, init) => {
      const url = String(request);
      if (url.includes('/message/')) return Response.json({ jsonapi: { version: '1.1' }, data: [{
        type: 'message', id: source.id ?? 'SRC',
        attributes: { encodingFormat: source.media?.mimeType ?? 'text/plain', body: {
          ...(source.text ? { text: source.text } : {}),
          ...(source.media ? { media: { encodingFormat: source.media.mimeType, url: source.media.url, fileName: source.media.fileName, gifPlayback: source.media.gifPlayback } } : {}),
        } }, meta: { chat: 'from@s.whatsapp.net', flags: source.flags },
      }] });
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json({ jsonapi: { version: '1.1' }, data: { type: 'message', id: 'NEW1', relationships: { recipient: { data: { type: 'chat', id: 'to@s.whatsapp.net' } } } } });
    },
  });
  const forward = { kind: 'forward', to: 'to@s.whatsapp.net', source: { conversationId: 'from@s.whatsapp.net', messageId: 'SRC' } } satisfies OutgoingMessage;

  it('forwards retained text with forwardingScore via /send/text', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const result = await make(requests, { text: 'olá' }).sendMessage(forward);
    expect(requests).toEqual([{ url: 'https://evolution.invalid/send/text', body: {
      data: { type: 'message', attributes: { encodingFormat: 'text/plain', body: { text: 'olá' }, forwardingScore: 1 }, relationships: { recipient: { data: { type: 'chat', id: 'to@s.whatsapp.net' } } } },
    } }]);
    expect(result.messageId).toBe('NEW1');
  });

  it('forwards retained media by URL via /send/media', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    await make(requests, { text: 'cap', media: { mimeType: 'image/jpeg', url: 'https://s.invalid/a.jpg' } }).sendMessage(forward);
    expect(requests[0]).toMatchObject({ url: 'https://evolution.invalid/send/media', body: { data: { attributes: { encodingFormat: 'image/jpeg', body: { text: 'cap', media: { url: 'https://s.invalid/a.jpg' } }, forwardingScore: 1 } } } });
  });

  it('preserves the filename of a retained document', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    await make(requests, { media: { mimeType: 'application/pdf', fileName: 'relatorio.pdf', url: 'https://s.invalid/doc.pdf' } }).sendMessage(forward);
    expect(requests[0]).toMatchObject({ url: 'https://evolution.invalid/send/media', body: { data: { attributes: { encodingFormat: 'application/pdf', filename: 'relatorio.pdf', body: { media: { url: 'https://s.invalid/doc.pdf' } }, forwardingScore: 1 } } } });
  });

  it('rejects retained messages with nothing to forward', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    await expect(make(requests, {}).sendMessage(forward)).rejects.toMatchObject({ status: 422 });
    expect(requests).toEqual([]);
  });

  it.each([64, 65])('preserves GIF playback from retained video flags %d', async flags => {
    const requests: Array<{ url: string; body: unknown }> = [];
    await make(requests, { flags, text: 'Loop', media: { mimeType: 'video/mp4', fileName: 'loop.mp4', url: 'https://s.invalid/loop.mp4' } }).sendMessage(forward);
    expect(requests[0].body).toMatchObject({ data: { attributes: { encodingFormat: 'video/mp4', filename: 'loop.mp4', forwardingScore: 1, gifPlayback: true, body: { text: 'Loop', media: { url: 'https://s.invalid/loop.mp4' } } } } });
  });

  it('keeps retained GIF playback while ordinary video stays ordinary', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    await make(requests, { flags: 64, media: { mimeType: 'video/mp4', url: 'https://s.invalid/loop.mp4' } }).sendMessage(forward);
    await make(requests, { media: { mimeType: 'video/mp4', url: 'https://s.invalid/video.mp4' } }).sendMessage(forward);
    expect(requests[0].body).toMatchObject({ data: { attributes: { gifPlayback: true } } });
    expect(requests[1].body).not.toHaveProperty('data.attributes.gifPlayback');
  });
});
