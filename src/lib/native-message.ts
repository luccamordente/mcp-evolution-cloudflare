import { z } from 'zod';

const integer = z.number().int().safe();
const section = z.object({ title: z.string().optional(), rows: z.array(z.object({ id: z.string(), title: z.string(), description: z.string().optional() })) });
const action = z.object({ kind: z.string().min(1), id: z.string().optional(), label: z.string().optional(), url: z.string().optional(), phoneNumber: z.string().optional(), copyCode: z.string().optional(), sections: z.array(section).optional() });
const interactive = z.object({
  kind: z.enum(['list', 'buttons', 'template', 'native', 'carousel']), title: z.string().optional(), text: z.string().optional(), footer: z.string().optional(), buttonText: z.string().optional(), templateId: z.string().optional(), sections: z.array(section).optional(), actions: z.array(action).optional(),
  get cards() { return z.array(interactive).optional(); },
});
const eventResponse = z.object({ eventMessageId: z.string().min(1), response: z.enum(['GOING', 'NOT_GOING', 'MAYBE']), timestampMS: integer, extraGuestCount: integer.optional() });
export const nativeMessageSchema = z.object({
  interactive: interactive.optional(),
  interactiveResponse: z.object({ kind: z.string().min(1), id: z.string().optional(), text: z.string().optional(), originMessageId: z.string().optional() }).optional(),
  poll: z.object({ question: z.string(), options: z.array(z.object({ id: z.string(), name: z.string() })), selectableOptionsCount: integer.nonnegative().optional(), ambiguous: z.boolean().optional() }).optional(),
  event: z.object({ name: z.string(), description: z.string().optional(), startTime: integer.optional(), endTime: integer.optional(), isCanceled: z.boolean().optional(), extraGuestsAllowed: z.boolean().optional(), location: z.object({ name: z.string().optional(), address: z.string().optional(), latitude: z.number().finite().min(-90).max(90).optional(), longitude: z.number().finite().min(-180).max(180).optional() }).optional() }).optional(),
  eventResponse: eventResponse.optional(),
});
export type NativeMessage = z.infer<typeof nativeMessageSchema>;
export function hasNativeContent(message: NativeMessage): boolean {
  return Boolean(message.interactive || message.interactiveResponse || message.poll || message.event || message.eventResponse);
}
export const responseKindSchema = z.enum(['votes', 'eventResponses']);
export type ResponseKind = z.infer<typeof responseKindSchema>;
const eventAttributes = eventResponse.omit({ response: true }).extend({ respondentJid: z.string(), responseMessageId: z.string(), response: eventResponse.shape.response.optional(), diagnostic: z.object({ state: z.literal('ambiguous'), reason: z.literal('conflicting_protocol_timestamp') }).optional() }).refine(value => Boolean(value.response) !== Boolean(value.diagnostic), 'Response must be known or explicitly ambiguous.');
const voteAttributes = z.object({ pollMessageId: z.string(), pollChatJid: z.string(), voteMessageId: z.string(), voterJid: z.string(), voterPhone: z.string().optional(), voterName: z.string().optional(), selectedOptions: z.array(z.string()).nullable().optional(), diagnostic: z.object({ state: z.literal('ambiguous'), reason: z.literal('conflicting_protocol_timestamp') }).optional(), votedAt: z.string(), receivedAt: z.string(), protocolTimestampMS: integer.nullable().optional(), orderingState: z.string(), identityProvenance: z.string() }).refine(value => value.orderingState === 'ambiguous' ? Boolean(value.diagnostic) && value.selectedOptions === undefined : value.selectedOptions !== undefined && !value.diagnostic, 'Vote choices must be known or explicitly ambiguous.');
export const responsePageSchema = z.object({
  data: z.array(z.discriminatedUnion('type', [z.object({ type: z.literal('poll-vote'), id: z.string(), attributes: voteAttributes }), z.object({ type: z.literal('event-response'), id: z.string(), attributes: eventAttributes })])),
  links: z.object({ next: z.string().nullable().optional() }),
  meta: z.object({ coverage: z.string(), state: z.string().optional(), hasMore: z.boolean().optional(), snapshot: z.boolean().optional(), consistency: z.string().optional(), diagnostic: z.union([z.literal('content_not_retained'), z.object({ state: z.literal('unavailable'), reason: z.literal('original_content_unavailable') })]).optional() }),
});

export const contentDiagnosticSchema = z.object({
  version: z.literal(1), state: z.enum(['partial', 'invalid', 'unsupported', 'unavailable']),
  reason: z.enum(['content_limit', 'unsupported_action', 'invalid_action', 'template_variant', 'native_parameters', 'response_variant', 'duplicate_poll_options', 'event_coordinates', 'event_time', 'native_media_unavailable', 'missing_original_secret', 'decryption_failed', 'invalid_target', 'original_content_unavailable', 'content_not_retained', 'missing_original', 'missing_secret', 'identity_unavailable', 'invalid_response', 'unknown_response', 'invalid_protocol_time_or_guests', 'response_storage_unavailable']).optional().catch(undefined),
  targetId: z.string().min(1).max(200).optional(),
});
export type ContentDiagnostic = z.infer<typeof contentDiagnosticSchema>;
