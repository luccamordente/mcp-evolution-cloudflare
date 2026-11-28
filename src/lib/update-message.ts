import { z } from 'zod';
import { sha256 } from './db';

const identifier = z.string().min(1).max(200).refine(value => value.trim() === value, 'Use the exact ID without surrounding whitespace.');
const emojiPattern = new RegExp('^\\p{RGI_Emoji}$', 'v');
const targetSchema = z.strictObject({
  conversationId: identifier.describe('Conversation ID from the message on the selected connection.'),
  messageId: identifier.describe('Exact message ID from search_messages or get_message.'),
});
const operationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('edit_text'), text: z.string().min(1).max(4096).refine(text => text.trim().length > 0, 'Supply nonblank replacement text.') }),
  z.strictObject({ kind: z.literal('delete_for_everyone') }),
  z.strictObject({ kind: z.literal('mark_read') }),
  z.strictObject({ kind: z.literal('mark_played') }),
  z.strictObject({ kind: z.literal('set_reaction'), emoji: z.string().min(1).max(64).refine(emoji => emojiPattern.test(emoji), 'Supply one emoji.') }),
  z.strictObject({ kind: z.literal('remove_reaction') }),
  z.strictObject({ kind: z.literal('add_label'), labelId: identifier }),
  z.strictObject({ kind: z.literal('remove_label'), labelId: identifier }),
]);

export const updateMessageInput = z.strictObject({
  targets: z.array(targetSchema).min(1).max(10).refine(
    targets => new Set(targets.map(target => JSON.stringify([target.conversationId, target.messageId]))).size === targets.length,
    'Supply distinct message targets.',
  ).describe('One to ten distinct messages on the selected connection.'),
  operation: operationSchema.describe('Apply this operation to each selected message.'),
  options: z.strictObject({
    connectionId: z.string().uuid().optional().describe('Internal connection UUID from search_connections. Omit to use your default connection.'),
    idempotencyKey: z.string().trim().min(1).max(200).optional().describe('Use the same key and arguments to recover the result for 24 hours. Do not change the key to bypass an unknown outcome.'),
  }).optional(),
});

export type MessageAction = Pick<z.infer<typeof updateMessageInput>, 'targets' | 'operation'>;

const actionErrorCode = z.enum([
  'message_not_found', 'message_not_editable', 'message_not_revocable', 'message_not_receivable',
  'message_not_playable', 'message_target_incomplete', 'message_conversation_mismatch',
  'message_conversation_unsupported', 'message_already_revoked', 'label_not_found',
  'message_update_unavailable', 'message_update_not_started', 'message_update_unknown', 'message_update_rejected',
  'invalid_message_action',
]);
type ActionErrorCode = z.infer<typeof actionErrorCode>;
const actionFailure = z.object({ code: actionErrorCode, retryable: z.literal(false) });
export const messageActionResultSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('accepted'), actionId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).optional(), error: z.never().optional() }),
  z.object({ outcome: z.literal('rejected'), error: actionFailure }),
  z.object({ outcome: z.literal('unknown'), error: actionFailure }),
  z.object({ outcome: z.literal('not_started'), error: actionFailure }),
]);
type MessageActionResult = z.infer<typeof messageActionResultSchema>;
export type MessageActionItem = z.infer<typeof targetSchema> & MessageActionResult;

export function messageActionFailure(action: MessageAction, outcome: 'unknown' | 'not_started', code: ActionErrorCode): MessageActionItem[] {
  return action.targets.map(target => ({ ...target, outcome, error: { code, retryable: false } }));
}

export class MessageUpdateError extends Error {
  constructor(readonly code: 'idempotency_conflict' | 'message_update_pending' | 'message_update_idempotency_unavailable', message: string) {
    super(message);
  }
}

const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000;
export const MESSAGE_ACTION_TIMEOUT_MS = 30_000;
const PENDING_LOOKUP_MS = MESSAGE_ACTION_TIMEOUT_MS + 5_000;
const storedResults = z.array(messageActionResultSchema);

export async function reservedMessageUpdate(
  db: D1Database,
  input: { userId: string; connectionId: string; key: string; action: MessageAction },
  dispatch: () => Promise<MessageActionItem[]>,
): Promise<MessageActionItem[]> {
  const { action, userId, connectionId, key } = input;
  const id = crypto.randomUUID();
  const now = Date.now();
  const hash = await sha256(JSON.stringify(action));
  try {
    const reservation = await db.prepare(`INSERT INTO send_operations
      (id, user_id, connection_id, operation, idempotency_key, arguments_hash, state, expires_at)
      VALUES (?, ?, ?, 'update_message', ?, ?, 'pending', ?)
      ON CONFLICT(user_id, connection_id, operation, idempotency_key) DO UPDATE SET
        id = excluded.id, arguments_hash = excluded.arguments_hash, state = 'pending',
        result_json = NULL, expires_at = excluded.expires_at
      WHERE send_operations.expires_at <= ? RETURNING id`)
      .bind(id, userId, connectionId, key, hash, now + RESERVATION_TTL_MS, now).first<{ id: string }>();
    if (!reservation) {
      const saved = await db.prepare(`SELECT arguments_hash AS hash, result_json AS result, state, expires_at AS expiresAt
        FROM send_operations WHERE user_id = ? AND connection_id = ? AND operation = 'update_message' AND idempotency_key = ?`)
        .bind(userId, connectionId, key).first<{ hash: string; result: string | null; state: string; expiresAt: number }>();
      if (!saved) throw new Error('Missing reservation');
      if (saved.hash !== hash) throw new MessageUpdateError('idempotency_conflict', 'This key belongs to a different WaPilot message update.');
      if (saved.state === 'completed' && saved.result) {
        const parsed = storedResults.safeParse(JSON.parse(saved.result));
        if (parsed.success && parsed.data.length === action.targets.length) {
          return parsed.data.map((result, index) => ({ ...action.targets[index], ...result }));
        }
      }
      if (saved.state === 'pending' && now < saved.expiresAt - RESERVATION_TTL_MS + PENDING_LOOKUP_MS) {
        throw new MessageUpdateError('message_update_pending', 'WaPilot is waiting for the earlier message update. Use the same key and arguments to inspect it.');
      }
      return messageActionFailure(action, 'unknown', 'message_update_unknown');
    }
  } catch (error) {
    if (error instanceof MessageUpdateError) throw error;
    throw new MessageUpdateError('message_update_idempotency_unavailable', 'WaPilot could not verify the key for this message update.');
  }

  const items = await dispatch();
  try {
    const result = storedResults.parse(items);
    await db.prepare("UPDATE send_operations SET state = 'completed', result_json = ? WHERE id = ?")
      .bind(JSON.stringify(result), id).run();
  } catch {
    // The pending reservation still prevents another dispatch.
  }
  return items;
}
