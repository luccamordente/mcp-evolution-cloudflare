import { z } from 'zod';
import { sha256 } from './db';
import { approvedMediaOrigins } from './media-origins';
import type { Env } from '../types';
import type { SendReceipt } from './send-receipt';

const identifier = z.string().trim().min(1).max(200);
const text = z.string().min(1).max(10000);
const label = z.string().trim().min(1).max(200);
const httpsUrl = z.string().url().max(4096).refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
}, 'WaPilot requires an HTTPS URL without credentials or a fragment.');
const previewUrl = httpsUrl.refine(value => /^[A-Za-z0-9:/?@!$&'()*+,;=%._-]+$/.test(value), 'WaPilot link-preview URLs require percent-encoding for unsupported characters.');
const previewUrls = (value: string) => value.match(/https?:\/\/[^\s]+/g) ?? [];
const mime = z.string().trim().min(3).max(200).describe('MIME type matching the message kind: JPEG/PNG/WebP images, MP4 video, audio/* voice notes, application/* documents, or GIF/MP4 looping media.');
const replyTo = z.object({
  messageId: identifier.describe('Identifier of the message being quoted in this conversation.'),
  participant: identifier.optional().describe('Author JID of a quoted group message, when needed.'),
}).strict();
const mentions = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('users'), jids: z.array(identifier).min(1).max(100) }).strict(),
]);
const chat = {
  to: z.string().trim().min(3).max(200).describe('Recipient number, individual JID, or group JID.'),
  replyTo: replyTo.optional(),
  delayMs: z.number().int().min(0).max(5000).optional().describe('Typing delay in milliseconds, at most 5000.'),
  formatJid: z.boolean().optional(),
  mentions: mentions.optional(),
};
const interactiveChat = { to: chat.to, replyTo: chat.replyTo, delayMs: chat.delayMs, formatJid: chat.formatJid };
const customId = { customMessageId: identifier.optional().describe('Optional WhatsApp message ID. This does not replace idempotencyKey.') };
const source = z.object({
  kind: z.literal('base64'),
  dataBase64: z.string().min(1).describe('Base64 attachment bytes without a data URL prefix.'),
}).strict();
const media = { ...chat, ...customId, mimeType: mime, source, caption: z.string().max(2000).optional() };
const button = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reply'), label, id: identifier }).strict(),
  z.object({ kind: z.literal('copy'), label, code: text }).strict(),
  z.object({ kind: z.literal('url'), label, url: httpsUrl }).strict(),
  z.object({ kind: z.literal('call'), label, phoneNumber: identifier }).strict(),
]);
const buttonSet = z.array(button).min(1).max(10).superRefine((buttons, ctx) => {
  const replies = buttons.filter(item => item.kind === 'reply').length;
  if (replies && (replies !== buttons.length || replies > 3)) ctx.addIssue({ code: 'custom', message: 'WaPilot supports up to three reply buttons together, or action buttons without replies.' });
});
const row = z.object({ title: label, description: z.string().max(1000).optional(), rowId: identifier }).strict();
const header = z.object({ title: label.optional(), subtitle: label.optional(), imageUrl: httpsUrl.optional(), videoUrl: httpsUrl.optional() }).strict().refine(value => Boolean(value.imageUrl) !== Boolean(value.videoUrl), 'WaPilot carousel cards require exactly one image or video URL.');

const eventName = z.string().trim().min(1).refine(value => value.length <= 200, 'WaPilot event names allow at most 200 UTF-16 units.');
const eventDescription = z.string().min(1).refine(value => value.length <= 10000, 'WaPilot event descriptions allow at most 10000 UTF-16 units.');
const eventAddress = z.string().min(1).refine(value => value.length <= 1000, 'WaPilot event addresses allow at most 1000 UTF-16 units.');
const eventInstant = z.iso.datetime({ offset: true, precision: 0 }).refine(value => {
  const seconds = Date.parse(value) / 1000;
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= 253402300799;
}, 'WaPilot requires a valid event instant with an explicit timezone and whole seconds.');
const eventRecipient = z.string().trim().regex(/^(?:\+?\d+|\d+@(?:s\.whatsapp\.net|lid)|\d+(?:-\d+)?@g\.us)$/).max(200);

export const outgoingMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), ...chat, ...customId, text, forwardingScore: z.number().int().min(0).max(100).optional() }).strict(),
  z.object({ kind: z.literal('link'), ...chat, ...customId, text }).strict(),
  z.object({ kind: z.literal('image'), ...media }).strict(),
  z.object({ kind: z.literal('video'), ...media, fileName: label.optional(), gifPlayback: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('voice_note'), ...chat, ...customId, mimeType: mime, source }).strict(),
  z.object({ kind: z.literal('document'), ...media, fileName: label.optional() }).strict(),
  z.object({ kind: z.literal('gif'), ...media, fileName: label.optional() }).strict(),
  z.object({ kind: z.literal('event'), to: eventRecipient, replyTo: replyTo.optional(), name: eventName, description: eventDescription.optional(), startTime: eventInstant, endTime: eventInstant.optional(), location: z.object({ name: eventName, address: eventAddress.optional(), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).strict().optional() }).strict(),
  z.object({ kind: z.literal('poll'), ...chat, ...customId, question: text, options: z.array(label).min(2).max(12), maxAnswers: z.number().int().min(1).default(1) }).strict(),
  z.object({ kind: z.literal('list'), ...interactiveChat, title: label, description: text, buttonText: label, footerText: label, sections: z.array(z.object({ title: label.optional(), rows: z.array(row).min(1).max(10) }).strict()).min(1).max(10) }).strict(),
  z.object({ kind: z.literal('location'), ...chat, ...customId, name: label, latitude: z.number().min(-90).max(90).refine(value => value !== 0, 'WaPilot cannot send zero latitude with the current service.'), longitude: z.number().min(-180).max(180).refine(value => value !== 0, 'WaPilot cannot send zero longitude with the current service.'), address: text }).strict(),
  z.object({ kind: z.literal('contact'), ...chat, ...customId, fullName: label, organization: label.optional(), phone: identifier }).strict(),
  z.object({ kind: z.literal('sticker'), ...chat, ...customId, url: httpsUrl }).strict(),
  z.object({ kind: z.literal('buttons'), ...interactiveChat, title: label, description: text, footer: label, buttons: buttonSet, header: z.object({ kind: z.enum(['image', 'video']), url: httpsUrl }).strict().optional() }).strict(),
  z.object({ kind: z.literal('carousel'), to: chat.to, delayMs: chat.delayMs, footer: label.optional(), cards: z.array(z.object({ header, body: z.object({ text }).strict(), footer: label.optional(), buttons: buttonSet.optional() }).strict()).min(1).max(10) }).strict(),
  z.object({ kind: z.literal('forward'), to: chat.to, source: z.object({ conversationId: identifier, messageId: identifier }).strict() }).strict(),
  z.object({ kind: z.literal('status_text'), ...customId, text }).strict(),
  z.object({ kind: z.literal('status_image'), ...customId, mimeType: mime, source, caption: z.string().max(2000).optional() }).strict(),
  z.object({ kind: z.literal('status_video'), ...customId, mimeType: mime, source, caption: z.string().max(2000).optional() }).strict(),
]).superRefine((message, ctx) => {
  if (message.kind === 'event') {
    if (message.endTime && Date.parse(message.endTime) <= Date.parse(message.startTime)) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'WaPilot event end must follow its start.' });
    if (message.replyTo && message.to.endsWith('@g.us') && !message.replyTo.participant) ctx.addIssue({ code: 'custom', path: ['replyTo', 'participant'], message: 'WaPilot requires the author of a quoted group message.' });
    if (message.replyTo?.participant && !/^\d+@(?:s\.whatsapp\.net|lid)$/.test(message.replyTo.participant)) ctx.addIssue({ code: 'custom', path: ['replyTo', 'participant'], message: 'WaPilot requires a full participant identifier.' });
  }
  if ('mimeType' in message) {
    const mimeType = message.mimeType.split(';')[0].trim().toLowerCase();
    const allowed = message.kind === 'image' || message.kind === 'status_image' ? ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)
      : message.kind === 'video' || message.kind === 'status_video' ? mimeType === 'video/mp4'
      : message.kind === 'gif' ? ['image/gif', 'video/mp4'].includes(mimeType)
      : message.kind === 'voice_note' ? mimeType.startsWith('audio/')
      : mimeType.startsWith('application/');
    if (!allowed) ctx.addIssue({ code: 'custom', path: ['mimeType'], message: 'WaPilot MIME type does not match this message kind.' });
  }
  if (message.kind === 'video' && message.fileName && !message.gifPlayback) ctx.addIssue({ code: 'custom', path: ['fileName'], message: 'WaPilot accepts a video file name only for looping playback metadata.' });
  if ('mentions' in message && message.mentions && !message.to.endsWith('@g.us')) ctx.addIssue({ code: 'custom', path: ['mentions'], message: 'WaPilot mentions require a group recipient.' });
  if (message.kind === 'link' && (previewUrls(message.text).length === 0 || previewUrls(message.text).some(value => !previewUrl.safeParse(value).success))) ctx.addIssue({ code: 'custom', path: ['text'], message: 'WaPilot link previews require an HTTPS URL in the text.' });
  if (message.kind === 'poll' && (message.maxAnswers > message.options.length || new Set(message.options).size !== message.options.length)) ctx.addIssue({ code: 'custom', path: ['options'], message: 'WaPilot poll options must be distinct and maxAnswers cannot exceed the option count.' });
  if (message.kind === 'list') {
    const rows = message.sections.flatMap(section => section.rows);
    if (rows.length > 10 || new Set(rows.map(item => item.rowId)).size !== rows.length) ctx.addIssue({ code: 'custom', path: ['sections'], message: 'WaPilot lists support at most ten rows with distinct IDs.' });
  }
  if (message.kind === 'buttons' && message.header && message.buttons.some(item => item.kind !== 'reply')) ctx.addIssue({ code: 'custom', path: ['header'], message: 'WaPilot media headers require reply buttons.' });
});

export const sendMessageInput = z.object({
  connectionId: z.string().uuid().optional().describe('Omit it to use the user\'s default connection, or pass an internal connection UUID.'),
  idempotencyKey: z.string().trim().min(1).max(200).optional().describe('Opaque action key without message content. Reuse the same key for the same action for 24 hours. Never change it to retry an unconfirmed send.'),
  message: outgoingMessageSchema.describe('Choose one message kind and provide only the fields supported by that variant.'),
}).strict();
export type OutgoingMessage = z.infer<typeof outgoingMessageSchema>;
export type SendMessageInput = z.infer<typeof sendMessageInput>;

export class SendMessageInputError extends Error {
  constructor(public readonly code: 'invalid_base64' | 'media_too_large' | 'media_origin_not_allowed', public readonly status: number, message: string) { super(message); }
}

export async function prepareSendMessage(message: OutgoingMessage, env: Pick<Env, 'MAX_MEDIA_BYTES' | 'SEND_MEDIA_ORIGINS' | 'EVOLUTION_BASE_URL'>) {
  if (message.kind === 'event') message = { ...message, to: message.to.includes('@') ? message.to : `${message.to.replace(/^\+/, '')}@s.whatsapp.net`, startTime: new Date(message.startTime).toISOString(), ...(message.endTime ? { endTime: new Date(message.endTime).toISOString() } : {}) };
  const max = Number(env.MAX_MEDIA_BYTES ?? 8 * 1024 * 1024);
  let contentHash: string | undefined;
  if ('mimeType' in message) {
    message = { ...message, mimeType: message.mimeType.split(';')[0].trim().toLowerCase() };
    const encoded = message.source.dataBase64;
    if (encoded.length > Math.ceil(max * 1.4)) throw new SendMessageInputError('media_too_large', 413, 'WaPilot attachment exceeds the configured byte limit.');
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      const binary = atob(encoded.replace(/\s/g, ''));
      bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    } catch { throw new SendMessageInputError('invalid_base64', 400, 'WaPilot attachment requires valid Base64 without a data URL prefix.'); }
    if (!bytes.byteLength) throw new SendMessageInputError('invalid_base64', 400, 'WaPilot attachments cannot be empty.');
    if (bytes.byteLength > max) throw new SendMessageInputError('media_too_large', 413, 'WaPilot attachment exceeds the configured byte limit.');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    message = { ...message, source: { kind: 'base64', dataBase64: btoa(binary) } };
    contentHash = await sha256(bytes.buffer);
  }
  const downloadUrls: string[] = [];
  if (message.kind === 'sticker') downloadUrls.push(message.url);
  if (message.kind === 'link') downloadUrls.push(...previewUrls(message.text));
  if (message.kind === 'buttons' && message.header) downloadUrls.push(message.header.url);
  if (message.kind === 'carousel') for (const card of message.cards) {
    if (card.header.imageUrl) downloadUrls.push(card.header.imageUrl);
    if (card.header.videoUrl) downloadUrls.push(card.header.videoUrl);
  }
  const origins = approvedMediaOrigins(env.SEND_MEDIA_ORIGINS, env.EVOLUTION_BASE_URL);
  for (const url of downloadUrls) if (!origins.includes(new URL(url).origin)) throw new SendMessageInputError('media_origin_not_allowed', 400, 'WaPilot only accepts download URLs from operator-approved media origins.');
  const fingerprint = 'mimeType' in message
    ? { ...message, source: { kind: 'base64', contentHash } } : message;
  return { message, fingerprint };
}

export function messagePresentation(message: OutgoingMessage): Pick<SendReceipt, 'to' | 'text' | 'isReply'> {
  let summary: string;
  switch (message.kind) {
    case 'text': case 'link': case 'status_text': summary = message.text; break;
    case 'event': summary = `Evento: ${message.name}\n${message.startTime}`; break;
    case 'poll': summary = `${message.question}\n${message.options.map((item, index) => `${index + 1}. ${item}`).join('\n')}`; break;
    case 'list': summary = `${message.title}\n${message.description}\n${message.sections.flatMap(section => section.rows.map(item => item.title)).join('\n')}`; break;
    case 'buttons': summary = `${message.title}\n${message.description}\n${message.buttons.map(item => item.label).join(' · ')}`; break;
    case 'carousel': summary = message.cards.map(card => card.body.text).join('\n'); break;
    case 'contact': summary = `Contato: ${message.fullName}`; break;
    case 'location': summary = `Localização: ${message.name}\n${message.address}`; break;
    case 'forward': summary = 'Mensagem encaminhada'; break;
    case 'sticker': summary = 'Figurinha'; break;
    case 'voice_note': summary = 'Mensagem de voz'; break;
    case 'image': case 'video': case 'document': case 'gif': case 'status_image': case 'status_video': summary = message.caption ?? ({ image: 'Imagem', video: 'Vídeo', voice_note: 'Mensagem de voz', document: 'Documento', gif: 'GIF', status_image: 'Imagem no Status', status_video: 'Vídeo no Status' }[message.kind]); break;
  }
  return { to: 'to' in message ? message.to : 'Status', text: summary, ...('replyTo' in message && message.replyTo ? { isReply: true } : {}) };
}
