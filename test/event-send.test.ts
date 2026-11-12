import { describe, expect, it } from 'vitest';
import { messagePresentation, outgoingMessageSchema, prepareSendMessage } from '../src/lib/send-message';
import { EvolutionGoClient } from '../src/lib/evolution';

const event = { kind: 'event', to: '12025550123', name: ' Meeting ', startTime: '2026-11-20T18:00:00Z' };

describe('native event creation', () => {
  it('normalizes equivalent instants and recipients before idempotency', async () => {
    const first = await prepareSendMessage(outgoingMessageSchema.parse(event), { EVOLUTION_BASE_URL: 'https://provider.invalid' });
    const second = await prepareSendMessage(outgoingMessageSchema.parse({ ...event, to: '12025550123@s.whatsapp.net', startTime: '2026-11-20T15:00:00-03:00' }), { EVOLUTION_BASE_URL: 'https://provider.invalid' });
    expect(first.fingerprint).toEqual(second.fingerprint);
    expect(messagePresentation(first.message)).toMatchObject({ text: 'Evento: Meeting\n2026-11-20T18:00:00.000Z' });
  });
  it.each([
    { startTime: '2026-02-30T18:00:00Z' }, { startTime: '2026-11-20T18:00:00' },
    { startTime: '2026-11-20T18:00:00.123Z' }, { startTime: '1969-12-31T23:59:59Z' },
    { endTime: '2026-11-20T18:00:00Z' }, { isCanceled: true }, { extraGuestsAllowed: true },
    { to: 'status@broadcast' }, { to: 'group@g.us' }, { to: '123@g.us', replyTo: { messageId: 'source' } },
    { name: '😀'.repeat(101) }, { location: { name: 'Here', latitude: 0 } },
  ])('rejects invalid creation %j', value => {
    expect(outgoingMessageSchema.safeParse({ ...event, ...value }).success).toBe(false);
  });
  it('sends the strict event envelope, including zero coordinates and a group quote', async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const client = new EvolutionGoClient({ baseUrl: 'https://provider.invalid', instanceId: 'instance', instanceToken: 'synthetic', fetcher: async (path, init) => {
      calls.push({ path: String(path), init });
      return Response.json({ jsonapi: { version: '1.1' }, data: { type: 'message', id: 'EVENT' } });
    } });
    const prepared = await prepareSendMessage(outgoingMessageSchema.parse({ ...event, to: '123-456@g.us', endTime: '2026-11-20T19:00:00Z', location: { name: ' Here ', latitude: 0, longitude: 0 }, replyTo: { messageId: 'source', participant: '12025550123@s.whatsapp.net' } }), { EVOLUTION_BASE_URL: 'https://provider.invalid' });
    await expect(client.sendMessage(prepared.message)).resolves.toMatchObject({ messageId: 'EVENT', accepted: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('https://provider.invalid/send/event');
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ data: { type: 'message', attributes: { encodingFormat: 'application/vnd.whatsapp.event', body: { event: { name: 'Meeting', startTime: 1795197600, endTime: 1795201200, location: { name: 'Here', latitude: 0, longitude: 0 } } } }, relationships: { recipient: { data: { type: 'chat', id: '123-456@g.us' } }, quoted: { data: { type: 'message', id: 'source', meta: { participant: '12025550123@s.whatsapp.net' } } } } } });
  });
});
