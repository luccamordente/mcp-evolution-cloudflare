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

  it('forwards retained document with filename preserved via /send/media', async () => {
    const requests: Array<{ url: string; body: any }> = [];
    await make(requests).forwardMessage('to@s.whatsapp.net', { id: 'SRC', media: { mimeType: 'application/pdf', fileName: 'relatorio.pdf', url: 'https://s.invalid/doc.pdf' } });
    expect(requests[0].url).toBe('https://evolution.invalid/send/media');
    expect(requests[0].body.data.attributes).toEqual({ encodingFormat: 'application/pdf', filename: 'relatorio.pdf', body: { media: { url: 'https://s.invalid/doc.pdf' } }, forwardingScore: 1 });
  });

  it('rejects messages with nothing to forward', async () => {
    await expect(make([]).forwardMessage('to', { id: 'SRC' })).rejects.toThrow(/no forwardable/);
  });

  it.each([64, 65])('preserves GIF playback from retained video flags %d', async (flags) => {
    const requests: Array<{ url: string; body: any }> = [];
    await make(requests).forwardMessage('to@s.whatsapp.net', { id: 'GIF', flags, text: 'Loop', media: { mimeType: 'video/mp4', fileName: 'loop.mp4', url: 'https://s.invalid/loop.mp4' } });
    expect(requests[0].body.data.attributes).toEqual({ encodingFormat: 'video/mp4', filename: 'loop.mp4', forwardingScore: 1, gifPlayback: true, body: { text: 'Loop', media: { url: 'https://s.invalid/loop.mp4' } } });
  });

  it('preserves playback from local media metadata while ordinary video stays ordinary', async () => {
    const requests: Array<{ url: string; body: any }> = [];
    const client = make(requests);
    await client.forwardMessage('to@s.whatsapp.net', { media: { mimeType: 'video/mp4', url: 'https://s.invalid/loop.mp4', gifPlayback: true } });
    await client.forwardMessage('to@s.whatsapp.net', { media: { mimeType: 'video/mp4', url: 'https://s.invalid/video.mp4' } });
    expect(requests[0].body.data.attributes.gifPlayback).toBe(true);
    expect(requests[1].body.data.attributes).not.toHaveProperty('gifPlayback');
  });
});
