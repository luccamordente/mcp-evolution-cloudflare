import { z } from 'zod';

/** Build message requests from shared fixture identity and processing options. */
export function messageArguments(input: Record<string, unknown>, processing: Record<string, unknown> = {}) {
  const { messageId, ...options } = input;
  return { messageId, options: { ...options, ...processing } };
}

/** Adapt internal outgoing-message fixtures to the public message/options envelope. */
export function sendArguments(input: Record<string, unknown>) {
  const { connectionId, idempotencyKey } = input;
  const { kind, to, replyTo, mentions, delayMs, customMessageId, formatJid, mimeType, source, ...fields } = z.record(z.string(), z.unknown()).parse(input.message);
  const status = typeof kind === 'string' && kind.startsWith('status_');
  return {
    message: { kind: status ? kind.slice(7) : kind, ...fields, ...(!mimeType && source ? { source } : {}) },
    options: { connectionId, idempotencyKey, to: status ? 'status' : to, replyTo, mentions, delayMs, customMessageId, formatJid, mimeType, ...(mimeType ? { mediaSource: source } : {}) },
  };
}
