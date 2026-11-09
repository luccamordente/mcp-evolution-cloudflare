import { z } from 'zod';

const updateKind = z.enum(['message_edit', 'event_edit', 'poll_edit', 'poll_add_option', 'message_schedule', 'unknown']);
const targetId = z.string().min(1).max(200);
const unavailableReason = z.enum(['missing_original_secret', 'decryption_failed', 'invalid_target']);

export const messageUpdateSchema = z.discriminatedUnion('state', [
  z.object({ kind: z.literal('message_edit'), state: z.literal('decoded'), targetId }),
  z.object({ kind: updateKind, state: z.literal('unavailable'), targetId: targetId.optional(), reason: unavailableReason }),
  z.object({ kind: updateKind, state: z.literal('unsupported'), targetId: targetId.optional(), reason: z.literal('unsupported_subtype') }),
]);

export type MessageUpdate = z.infer<typeof messageUpdateSchema>;
export type ContentUnavailableReason = Extract<MessageUpdate, { state: 'unavailable' }>['reason'];
