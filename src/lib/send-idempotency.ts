import type { SendMessageResult } from '../types';
import { sha256 } from './db';

export class SendOperationError extends Error {
  constructor(public readonly code: 'idempotency_conflict' | 'send_in_progress' | 'send_result_unknown' | 'send_idempotency_unavailable', message: string) { super(message); }
}

export async function idempotentSend(db: D1Database, input: {
  userId: string; connectionId: string; operation: string; key: string; arguments: unknown;
}, send: () => Promise<SendMessageResult>): Promise<SendMessageResult> {
  const now = Date.now();
  const id = crypto.randomUUID();
  const hash = await sha256(JSON.stringify(input.arguments));
  try {
    const reserved = await db.prepare(`INSERT INTO send_operations
      (id, user_id, connection_id, operation, idempotency_key, arguments_hash, state, expires_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)
      ON CONFLICT(user_id, connection_id, operation, idempotency_key) DO UPDATE SET
        id = excluded.id, arguments_hash = excluded.arguments_hash, state = 'pending',
        result_json = NULL, expires_at = excluded.expires_at
      WHERE send_operations.expires_at <= ?8 RETURNING id`)
      .bind(id, input.userId, input.connectionId, input.operation, input.key, hash, now + 24 * 60 * 60 * 1000, now).first<{ id: string }>();
    if (!reserved) {
      const previous = await db.prepare(`SELECT arguments_hash AS argumentsHash, state, result_json AS resultJson FROM send_operations
      WHERE user_id = ?1 AND connection_id = ?2 AND operation = ?3 AND idempotency_key = ?4 AND expires_at > ?5`)
        .bind(input.userId, input.connectionId, input.operation, input.key, now).first<{ argumentsHash: string; state: string; resultJson: string | null }>();
      if (!previous) throw new Error('Reservation unavailable');
      if (previous.argumentsHash !== hash) throw new SendOperationError('idempotency_conflict', 'WaPilot received different arguments for the same action key.');
      if (previous.state === 'completed' && previous.resultJson) return JSON.parse(previous.resultJson);
      if (previous.state === 'unknown') throw new SendOperationError('send_result_unknown', 'WaPilot could not confirm the earlier send. Do not resend it automatically.');
      throw new SendOperationError('send_in_progress', 'WaPilot cannot confirm this send yet. Do not resend it automatically.');
    }
  } catch (error) {
    if (error instanceof SendOperationError) throw error;
    throw new SendOperationError('send_idempotency_unavailable', 'WaPilot could not reserve this action safely. No send was started.');
  }
  let result: SendMessageResult | undefined;
  try {
    result = await send();
    const stored = { accepted: result.accepted, messageId: result.messageId, conversationId: result.conversationId, jid: result.jid };
    await db.prepare("UPDATE send_operations SET state = 'completed', result_json = ?1 WHERE id = ?2")
      .bind(JSON.stringify(stored), id).run();
    return stored;
  }
  catch (error) {
    try { await db.prepare("UPDATE send_operations SET state = 'unknown' WHERE id = ?1").bind(id).run(); }
    catch { /* The pending reservation still prevents another send. */ }
    if (result) throw new SendOperationError('send_result_unknown', 'WaPilot could not record the send result. Do not resend it automatically.');
    throw error;
  }
}

export async function cleanupSendOperations(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare('DELETE FROM send_operations WHERE expires_at <= ?1').bind(now).run();
}
