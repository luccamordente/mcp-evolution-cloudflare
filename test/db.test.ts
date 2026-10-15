import { describe, expect, it } from 'vitest';
import { findWebhookMessage } from '../src/lib/db';

describe('webhook message lookup', () => {
  it('returns the captured Evolution message envelope scoped to the user connection', async () => {
    let query = '';
    const db = {
      prepare(sql: string) {
        query = sql;
        return {
          bind() {
            return { first: async () => ({ messageJson: JSON.stringify({ info: { ID: 'msg-1' }, message: { imageMessage: { url: 'https://media.invalid/file' } } }) }) };
          },
        };
      },
    } as unknown as D1Database;

    await expect(findWebhookMessage(db, 'user-1', 'connection-1', 'msg-1')).resolves.toEqual({ imageMessage: { url: 'https://media.invalid/file' } });
    expect(query).toContain('e.received_at DESC');
    expect(query).toContain('c.user_id = ?3');
  });
});
