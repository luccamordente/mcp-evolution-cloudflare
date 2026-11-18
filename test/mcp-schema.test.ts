import { messageObservationSchema, messageDeliverySchema } from '../src/lib/message-observation';
import { searchOptions as listMessagesInput } from '../src/lib/mcp-options';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { outgoingMessageSchema } from '../src/lib/send-message';

describe('MCP tool inputs', () => {
  it('allows an omitted connectionId but rejects null', () => {
    const schema = z.object({ connectionId: listMessagesInput.shape.connectionId });
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ connectionId: null }).success).toBe(false);
    expect(schema.safeParse({ connectionId: 'not-a-uuid' }).success).toBe(false);
    const connectionDescription = (z.toJSONSchema(schema) as { properties?: { connectionId?: { description?: string } } }).properties?.connectionId?.description;
    expect(connectionDescription).toContain('Internal connection UUID');
  });

  it.each(['5511999999999', '5511999999999@s.whatsapp.net', '120363123456789@g.us'])('accepts conversation identifier %s without requiring a connection UUID', (conversationId) => {
    expect(listMessagesInput.parse({ conversationId: ` ${conversationId} ` })).toEqual({ conversationId, limit: 25, offset: 0 });
  });

  it.each(['', '   ', null, 5511999999999, true, {}, [], '1'.repeat(201)])('rejects invalid conversation identifier %j', (conversationId) => {
    expect(listMessagesInput.safeParse({ conversationId }).success).toBe(false);
  });

  it('applies the conversation length limit after trimming', () => {
    expect(listMessagesInput.parse({ conversationId: ` ${'1'.repeat(200)} ` }).conversationId).toBe('1'.repeat(200));
  });

  it('preserves message search defaults and bounds, including receipt inspection', () => {
    expect(listMessagesInput.parse({})).toEqual({ limit: 25, offset: 0 });
    expect(listMessagesInput.parse({ text: 'Olá', limit: 50 })).toEqual({ text: 'Olá', limit: 50, offset: 0 });
    expect(listMessagesInput.safeParse({ limit: 51 }).success).toBe(false);
    expect(listMessagesInput.safeParse({ limit: 0 }).success).toBe(false);
    expect(listMessagesInput.safeParse({ offset: 175 }).success).toBe(true);
    expect(listMessagesInput.safeParse({ offset: 176 }).success).toBe(false);
    expect(listMessagesInput.safeParse({ includeReceiptOnly: true, offset: 150, limit: 50 }).success).toBe(true);
    expect(listMessagesInput.safeParse({ includeReceiptOnly: true, offset: 151, limit: 50 }).success).toBe(false);
    expect(listMessagesInput.safeParse({ includeReceiptOnly: 'true' }).success).toBe(false);
  });

  it('accepts playback intent on videos and models GIFs as their own variant', () => {
    const media = { to: '5511999999999', source: { kind: 'base64', dataBase64: 'AQ==' } };
    for (const mimeType of ['video/mp4', ' VIDEO/MP4 ; codecs=avc1']) {
      expect(outgoingMessageSchema.safeParse({ ...media, kind: 'video', mimeType, gifPlayback: true }).success).toBe(true);
    }
    for (const mimeType of ['image/gif', 'video/mp4']) {
      expect(outgoingMessageSchema.safeParse({ ...media, kind: 'gif', mimeType }).success).toBe(true);
    }
    expect(outgoingMessageSchema.safeParse({ ...media, kind: 'image', mimeType: 'image/png', gifPlayback: true }).success).toBe(false);
    expect(outgoingMessageSchema.safeParse({ ...media, kind: 'video', mimeType: 'image/png' }).success).toBe(false);
  });
});

describe('observation metadata schemas', () => {
  it('accepts only recognized versions and consistent timestamp sources', () => {
    const observation = { version: 1, state: 'receipt_only', observedAt: 1794790925000, timestampSource: 'receipt' };
    expect(messageObservationSchema.parse({ ...observation, privateDiagnostic: 'omitted' })).toEqual(observation);
    expect(messageObservationSchema.safeParse({ ...observation, version: 2 }).success).toBe(false);
    expect(messageObservationSchema.safeParse({ ...observation, timestampSource: 'message' }).success).toBe(false);
    expect(messageObservationSchema.safeParse({ ...observation, observedAt: '1794790925000' }).success).toBe(false);
    expect(messageDeliverySchema.safeParse({ version: 1, state: 'read', at: 1794790922000 }).success).toBe(true);
    expect(messageDeliverySchema.safeParse({ version: 1, state: 'History', at: 1794790922000 }).success).toBe(false);
  });

});
