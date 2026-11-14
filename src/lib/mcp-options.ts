import { z } from 'zod';

export class OptionsError extends Error {
  constructor(public readonly code: 'invalid_options' | 'incompatible_include' | 'unsupported_include' | 'incompatible_encoding_format', message: string) { super(message); }
}
const connectionId = z.string().uuid().optional();
const pagination = { offset: z.number().int().safe().min(0).default(0), limit: z.number().int().min(1).max(100).default(50) };
export const connectionOptions = z.object({ ...pagination, query: z.string().max(200).optional(), include: z.array(z.literal('status')).optional() }).strict();
export const groupOptions = z.object({ ...pagination, connectionId, query: z.string().max(200).optional(), include: z.array(z.literal('participants')).optional() }).strict();
export const searchOptions = z.object({ ...pagination, connectionId, conversationId: z.string().trim().min(1).max(200).optional(), text: z.string().max(200).optional(), limit: z.number().int().min(1).max(50).default(25) }).strict().refine(o => o.offset + o.limit <= 200, 'WaPilot search requires offset + limit <= 200. Narrow the conversation or text filter.');
export const getOptions = z.object({
  ...pagination, limit: z.number().int().min(1).max(100).default(5), connectionId,
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
  encodingFormat: z.enum(['text/plain', 'image/*', 'application/pdf']).optional(),
  include: z.array(z.enum(['metadata', 'poll-responses', 'event-responses', 'quoted', 'reactions'])).optional(),
  page: z.number().int().min(1).optional(), pages: z.array(z.number().int().min(1)).min(1).max(3).optional(),
  preset: z.enum(['preview', 'reading', 'detail']).default('reading'),
  crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict().refine(c => c.x + c.width <= 1 && c.y + c.height <= 1, 'Crop must remain inside the page.').optional(),
  cursor: z.string().regex(/^[1-9]\d{0,3}:\d{1,9}$/).optional(), bookmarkCursor: z.number().int().min(0).max(1900).optional(),
}).strict().refine(o => !(o.page !== undefined && o.pages !== undefined) && (!o.pages || new Set(o.pages).size === o.pages.length), 'Choose page or distinct pages, not both.').refine(o => !o.crop || !o.pages || o.pages.length === 1, 'A crop requires one page.').refine(o => !o.include?.includes('metadata') || o.limit <= 5, 'PDF metadata limit must be 1..5.').refine(o => !(o.page || o.pages || o.crop) || o.encodingFormat === 'image/*', 'Page options require image/* encoding.');
// Advertise the options shape; validate constraints inside the handler so errors
// have the same product error code across HTTP and stdio.
function input<T extends z.ZodRawShape>(shape: T) {
  return z.object({ options: z.object(shape).partial().loose().optional() }).strict();
}
const loosePagination = { offset: z.number().optional(), limit: z.number().optional() };
export const searchConnectionsInput = input({ ...connectionOptions.shape, ...loosePagination });
export const searchGroupsInput = input({ ...groupOptions.shape, ...loosePagination });
export const searchMessagesInput = input({ ...searchOptions.shape, ...loosePagination });
export const getMessageInput = input({ ...getOptions.shape, ...loosePagination, page: z.number().optional(), pages: z.array(z.number()).optional(), crop: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional() }).extend({ messageId: z.string().trim().min(1).max(200).optional() });
