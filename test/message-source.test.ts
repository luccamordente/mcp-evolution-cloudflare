import { describe, expect, it } from 'vitest';
import { withSource } from '../src/lib/mcp';

describe('withSource', () => {
  it('reports our own number as source for sent messages, not the recipient', () => {
    expect(withSource({ id: 'm', conversationId: '5511999999999', source: '5511999999999', direction: 'outbound' }, '+55 11 4200-0028').source).toBe('551142000028');
  });
  it('drops a source that only repeats the 1:1 recipient when our number is unknown', () => {
    expect(withSource({ id: 'm', conversationId: '5511999999999@s.whatsapp.net', source: '5511999999999', direction: 'outbound' })).not.toHaveProperty('source');
  });
  it('keeps inbound sources and group authors untouched', () => {
    expect(withSource({ id: 'm', conversationId: '5511999999999', source: '5511999999999', direction: 'inbound' }, '551142000028').source).toBe('5511999999999');
    expect(withSource({ id: 'm', conversationId: '120363@g.us', source: '120363', direction: 'outbound' }).source).toBe('120363');
  });
});
