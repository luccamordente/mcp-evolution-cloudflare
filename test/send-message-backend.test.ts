import { migrateToolArguments } from './helpers/tool-arguments';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { createMcpHandler, PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { createMcpServer } from '../src/lib/mcp';
import { createConnection, bootstrapLocalUser } from '../src/lib/db';
import { createTestD1 } from './helpers/local-d1';
import type { Env } from '../src/types';

const backendUrl = process.env.WAPILOT_SEND_ACCEPTANCE_URL;
const execute = promisify(execFile);
const capturesSchema = z.array(z.object({ to: z.string(), id: z.string(), message: z.record(z.string(), z.unknown()) }));
const resultSchema = z.object({ result: z.object({ isError: z.boolean().optional(), structuredContent: z.object({ data: z.object({ outcome: z.string(), messageId: z.string().optional() }).passthrough() }) }) });
const principal = { id: 'native-acceptance', email: 'native@example.test', claims: {} };
let local: Awaited<ReturnType<typeof createTestD1>>;
let env: Env;
let connectionId: string;
let temporary: string;
let image: string;
let video: string;
let audio: string;

function wav() {
  const samples = 16000;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(samples, 24); data.writeUInt32LE(samples * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  return data.toString('base64');
}

async function send(message: Record<string, unknown>, scopes = ['mcp:read', 'mcp:write'], idempotencyKey?: string) {
  const handler = createMcpHandler(() => createMcpServer(env, principal), { legacy: 'reject', responseMode: 'json' });
  const response = await handler.fetch(new Request('https://mcp.invalid/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': 'send_message' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'send_message', arguments: migrateToolArguments("send_message", { connectionId, message, idempotencyKey }), _meta: {
      [PROTOCOL_VERSION_META_KEY]: '2026-07-28', [CLIENT_INFO_META_KEY]: { name: 'native-acceptance', version: '1' }, [CLIENT_CAPABILITIES_META_KEY]: {},
    } } }),
  }), { authInfo: { token: 'test', clientId: 'native-acceptance', scopes } });
  return resultSchema.parse(await response.json()).result;
}

async function native(message: Record<string, unknown>) {
  const result = await send(message);
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent.data.outcome).toBe('accepted');
  const captures = capturesSchema.parse(await (await fetch(`${backendUrl}/_captures`)).json());
  const capture = captures.find(item => item.id === result.structuredContent.data.messageId);
  expect(capture).toBeDefined();
  if (!capture) throw new Error('No final WhatsApp send was captured.');
  return capture;
}

const base64 = (dataBase64: string) => ({ kind: 'base64', dataBase64 });
const chat = { to: '5511999999999', replyTo: { messageId: 'SOURCE' } };

describe.runIf(Boolean(backendUrl))('MCP to real Go native-message acceptance', () => {
  beforeAll(async () => {
    local = await createTestD1();
    const owner = await bootstrapLocalUser(local.db, principal);
    const key = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    connectionId = (await createConnection(local.db, key, { userId: owner.id, friendlyName: 'Native acceptance', instanceId: 'instance', token: 'instance-token' })).id;
    env = { DB: local.db, TOKEN_ENCRYPTION_KEY: key, EVOLUTION_BASE_URL: backendUrl ?? '', ENVIRONMENT: 'local', SEND_MEDIA_ORIGINS: 'https://media.example.test' };
    image = Buffer.from(await (await fetch(`${backendUrl}/_image`)).arrayBuffer()).toString('base64');
    audio = wav();
    temporary = await mkdtemp(join(tmpdir(), 'wapilot-native-media-'));
    const file = join(temporary, 'fixture.mp4');
    await execute('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file]);
    video = (await readFile(file)).toString('base64');
  }, 30000);
  afterAll(async () => { await local?.dispose(); if (temporary) await rm(temporary, { recursive: true, force: true }); });

  it('constructs text with native quote contents and mentions', async () => {
    const capture = await native({ kind: 'text', to: '120363123456789@g.us', replyTo: { messageId: 'SOURCE', participant: '5511999999999@s.whatsapp.net' }, text: 'Native text', mentions: { kind: 'users', jids: ['5511777777777@s.whatsapp.net'] } });
    expect(capture.message).toMatchObject({ extendedTextMessage: { text: 'Native text', contextInfo: { stanzaID: 'SOURCE', quotedMessage: { conversation: 'Quoted fixture' }, mentionedJID: ['5511777777777@s.whatsapp.net'] } } });
  });

  it('constructs a quoted native poll with ordered options', async () => {
    const capture = await native({ kind: 'poll', ...chat, question: 'Qual horário?', options: ['10h', '14h'], maxAnswers: 1 });
    expect(capture.message).toMatchObject({ pollCreationMessage: { name: 'Qual horário?', options: [{ optionName: '10h' }, { optionName: '14h' }], selectableOptionsCount: 1, contextInfo: { stanzaID: 'SOURCE', quotedMessage: { conversation: 'Quoted fixture' } } } });
  });

  it('constructs a quoted native list with stable row IDs', async () => {
    const capture = await native({ kind: 'list', ...chat, title: 'Planos', description: 'Escolha um plano', buttonText: 'Abrir', footerText: 'WaPilot', sections: [{ title: 'Opções', rows: [{ title: 'Básico', rowId: 'basic' }, { title: 'Completo', rowId: 'full' }] }] });
    expect(capture.message).toMatchObject({ documentWithCaptionMessage: { message: { listMessage: { title: 'Planos', buttonText: 'Abrir', sections: [{ title: 'Opções', rows: [{ title: 'Básico', rowID: 'basic' }, { title: 'Completo', rowID: 'full' }] }], contextInfo: { stanzaID: 'SOURCE', quotedMessage: { conversation: 'Quoted fixture' } } } } } });
  });

  it('constructs native image, video, and document attachments', async () => {
    const imageMessage = await native({ kind: 'image', ...chat, mimeType: 'image/png', source: base64(image), caption: 'An image' });
    expect(imageMessage.message).toMatchObject({ imageMessage: { mimetype: 'image/png', caption: 'An image', contextInfo: { stanzaID: 'SOURCE' } } });
    const videoMessage = await native({ kind: 'video', ...chat, mimeType: 'video/mp4', source: base64(video), caption: 'A video' });
    expect(videoMessage.message).toMatchObject({ videoMessage: { mimetype: 'video/mp4', caption: 'A video', contextInfo: { stanzaID: 'SOURCE' } } });
    const document = await native({ kind: 'document', ...chat, mimeType: 'application/octet-stream', source: base64(Buffer.from('document fixture').toString('base64')), fileName: 'fixture.bin' });
    expect(document.message).toMatchObject({ documentMessage: { fileName: 'fixture.bin', contextInfo: { stanzaID: 'SOURCE' } } });
  });

  it('constructs a voice note and a silent looping GIF video', async () => {
    const voice = await native({ kind: 'voice_note', ...chat, mimeType: 'audio/wav', source: base64(audio) });
    expect(voice.message).toMatchObject({ audioMessage: { PTT: true, mimetype: 'audio/ogg; codecs=opus', contextInfo: { stanzaID: 'SOURCE' } } });
    const gif = await native({ kind: 'gif', ...chat, mimeType: 'video/mp4', source: base64(video) });
    expect(gif.message).toMatchObject({ videoMessage: { gifPlayback: true, contextInfo: { stanzaID: 'SOURCE' } } });
  });

  it('constructs a contact and location with their native values', async () => {
    const contact = await native({ kind: 'contact', ...chat, fullName: 'Sample Contact', organization: 'Sample Org', phone: '5511777777777' });
    expect(contact.message).toMatchObject({ contactMessage: { displayName: 'Sample Contact', contextInfo: { stanzaID: 'SOURCE' } } });
    const location = await native({ kind: 'location', ...chat, name: 'Praça', latitude: -19.9, longitude: -43.9, address: 'Endereço de exemplo' });
    expect(location.message).toMatchObject({ locationMessage: { degreesLatitude: -19.9, degreesLongitude: -43.9, name: 'Praça', address: 'Endereço de exemplo' } });
  });

  it('constructs link previews and static stickers using approved media', async () => {
    const link = await native({ kind: 'link', ...chat, text: 'Sample preview https://media.example.test/page' });
    expect(link.message).toMatchObject({ extendedTextMessage: { text: 'Sample preview https://media.example.test/page', title: 'Sample title', description: 'Sample description' } });
    const sticker = await native({ kind: 'sticker', ...chat, url: 'https://media.example.test/image.png' });
    expect(sticker.message).toHaveProperty('stickerMessage');
  });

  it('constructs reply buttons and carousel card actions', async () => {
    const buttons = await native({ kind: 'buttons', ...chat, title: 'Opções', description: 'Escolha', footer: 'WaPilot', buttons: [{ kind: 'reply', label: 'Sim', id: 'yes' }] });
    expect(JSON.stringify(buttons.message)).toContain('yes');
    const carousel = await native({ kind: 'carousel', to: chat.to, footer: 'WaPilot', cards: [{ header: { imageUrl: 'https://media.example.test/image.png' }, body: { text: 'Card text' }, buttons: [{ kind: 'url', label: 'Abrir', url: 'https://example.test/product' }] }] });
    expect(carousel.message).toMatchObject({ interactiveMessage: { InteractiveMessage: { CarouselMessage: { cards: [{ body: { text: 'Card text' } }] } } } });
    expect(JSON.stringify(carousel.message)).toContain('https://example.test/product');
  });

  it('preserves quotes and line breaks in carousel action labels and copy codes', async () => {
    const label = 'Copy "offer"';
    const code = 'FIRST\n"SECOND"';
    const carousel = await native({ kind: 'carousel', to: chat.to, cards: [{ header: { imageUrl: 'https://media.example.test/image.png' }, body: { text: 'Card text' }, buttons: [{ kind: 'copy', label, code }] }] });
    const structure = z.object({ interactiveMessage: z.object({ InteractiveMessage: z.object({ CarouselMessage: z.object({ cards: z.array(z.object({ InteractiveMessage: z.object({ NativeFlowMessage: z.object({ buttons: z.array(z.object({ buttonParamsJSON: z.string() })) }) }) })) }) }) }) }).parse(carousel.message);
    const params = structure.interactiveMessage.InteractiveMessage.CarouselMessage.cards[0].InteractiveMessage.NativeFlowMessage.buttons[0].buttonParamsJSON;
    expect(JSON.parse(params)).toMatchObject({ display_text: label, copy_code: code });
  });

  it('publishes text and multipart media to Status', async () => {
    const text = await native({ kind: 'status_text', text: 'Sample Status' });
    expect(text.to).toBe('status@broadcast');
    expect(text.message).toMatchObject({ extendedTextMessage: { text: 'Sample Status' } });
    const imageMessage = await native({ kind: 'status_image', mimeType: 'image/png', source: base64(image), caption: 'Status image' });
    expect(imageMessage.to).toBe('status@broadcast');
    expect(imageMessage.message).toMatchObject({ imageMessage: { caption: 'Status image', mimetype: 'image/png' } });
    const videoMessage = await native({ kind: 'status_video', mimeType: 'video/mp4', source: base64(video), caption: 'Status video' });
    expect(videoMessage.to).toBe('status@broadcast');
    expect(videoMessage.message).toHaveProperty('videoMessage');
  });

  it('reserves one final native send for repeated action keys', async () => {
    const message = { kind: 'text', to: chat.to, text: 'One native action' };
    const before = capturesSchema.parse(await (await fetch(`${backendUrl}/_captures`)).json()).length;
    const first = await send(message, undefined, 'native-action');
    const repeated = await send(message, undefined, 'native-action');
    expect(first.structuredContent.data.outcome).toBe('accepted');
    expect(repeated.structuredContent).toEqual(first.structuredContent);
    expect(capturesSchema.parse(await (await fetch(`${backendUrl}/_captures`)).json())).toHaveLength(before + 1);
  });

  it('denies writes without mcp:write before the final native boundary', async () => {
    const before = capturesSchema.parse(await (await fetch(`${backendUrl}/_captures`)).json()).length;
    const result = await send({ kind: 'text', to: chat.to, text: 'Must not send' }, ['mcp:read']);
    expect(result.isError).toBe(true);
    expect(capturesSchema.parse(await (await fetch(`${backendUrl}/_captures`)).json())).toHaveLength(before);
  });
});
