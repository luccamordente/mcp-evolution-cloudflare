import { z } from 'zod';
import type { ErrorRecovery } from './tool-recovery';

const unixMilliseconds = z.number().int().nonnegative().safe();
export const messageObservationSchema = z.discriminatedUnion('state', [
  z.object({ version: z.literal(1), state: z.literal('receipt_only'), observedAt: unixMilliseconds, timestampSource: z.literal('receipt') }),
  z.object({ version: z.literal(1), state: z.literal('pending_decryption'), observedAt: unixMilliseconds, timestampSource: z.literal('message') }),
  z.object({ version: z.literal(1), state: z.literal('original_received'), observedAt: unixMilliseconds, timestampSource: z.literal('message') }),
]);
export const messageDeliverySchema = z.object({ version: z.literal(1), state: z.enum(['sent', 'delivered', 'read', 'played']), at: unixMilliseconds });
export type MessageObservation = z.infer<typeof messageObservationSchema>;
export type MessageDelivery = z.infer<typeof messageDeliverySchema>;

export const MESSAGE_CONTENT_NOT_RETAINED = 'WaPilot found the message, but its content is not available in retained history. This does not establish deletion or permanent loss.';
export const MESSAGE_OBSERVATION_RECOVERY = 'Keep the same connection and message ID. You may inspect this state again later. Do not automatically resend the message or repeatedly request content processing.';
export function observationRecovery(): ErrorRecovery {
  return { action: 'inspect_message', tool: 'get_message', steps: [MESSAGE_OBSERVATION_RECOVERY] };
}
export function pendingAvailability(observation?: MessageObservation) {
  if (!observation || observation.state === 'original_received') return undefined;
  return {
    state: observation.state,
    reason: observation.state,
    message: observation.state === 'receipt_only'
      ? 'WaPilot observed a delivery or read receipt for this message ID, but has not observed the original message in this connection. This record is not message content.'
      : 'WaPilot observed the message, but its content is awaiting decryption. Content may become available after WhatsApp resends the message; recovery is not guaranteed.',
    recovery: observationRecovery(),
  };
}
