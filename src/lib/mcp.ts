import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { AuthenticatedUser, Env, Message } from '../types';
import { EvolutionGoClient, EvolutionApiError } from './evolution';
import { audit, ensureUser, getConnection, listConnections, revealConnectionToken, listCapturedConversations, listCapturedMessages } from './db';

const pageInput = { cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(50) };
const connectionInput = { connectionId: z.string().uuid() };
const dataOutput = z.object({ data: z.unknown() });

function ok(data: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], structuredContent: { data } }; }
function fail(error: unknown) {
  const message = error instanceof EvolutionApiError ? error.message : error instanceof Error ? error.message : 'Unexpected error';
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function auditFailure(error: unknown): { error: string; status?: number } {
  if (error instanceof EvolutionApiError) return { error: error.message, status: error.status };
  return { error: error instanceof Error ? error.message : 'Unexpected error' };
}

export async function createMcpServer(env: Env, user: AuthenticatedUser): Promise<McpServer> {
  const ensured = await ensureUser(env.DB, user);
  const server = new McpServer({ name: 'mcp-evolution-cloudflare', version: '0.1.0' });

  async function clientFor(connectionId: string): Promise<{ client: EvolutionGoClient; connection: NonNullable<Awaited<ReturnType<typeof getConnection>>> }> {
    const connection = await getConnection(env.DB, ensured.id, connectionId);
    if (!connection) throw new Error('Connection not found');
    if (connection.status !== 'active') throw new Error('Connection is disabled or unavailable');
    const token = await revealConnectionToken(env.DB, env.TOKEN_ENCRYPTION_KEY, connection);
    return { client: new EvolutionGoClient({ baseUrl: env.EVOLUTION_BASE_URL, globalApiKey: env.EVOLUTION_GLOBAL_API_KEY, instanceId: connection.instanceId, instanceToken: token }), connection };
  }

  const read = async <T>(operation: string, connectionId: string, fn: (client: EvolutionGoClient) => Promise<T>) => {
    try {
      const { client } = await clientFor(connectionId);
      const data = await fn(client);
      await audit(env.DB, { userId: ensured.id, connectionId, operation, outcome: 'success' });
      return ok(data);
    } catch (error) {
      await audit(env.DB, { userId: ensured.id, connectionId, operation, outcome: 'failure', metadata: auditFailure(error) });
      return fail(error);
    }
  };

  const captured = async <T>(operation: string, connectionId: string, fn: () => Promise<T>) => {
    try {
      const connection = await getConnection(env.DB, ensured.id, connectionId);
      if (!connection) throw new Error('Connection not found');
      if (connection.status !== 'active') throw new Error('Connection is disabled or unavailable');
      const data = await fn();
      await audit(env.DB, { userId: ensured.id, connectionId, operation, outcome: 'success' });
      return ok(data);
    } catch (error) {
      await audit(env.DB, { userId: ensured.id, connectionId, operation, outcome: 'failure', metadata: auditFailure(error) });
      return fail(error);
    }
  };

  server.registerTool('list_connections', { title: 'List WhatsApp connections', description: 'List only the authenticated user\'s locally registered connections.', outputSchema: dataOutput }, async () => ok(await listConnections(env.DB, ensured.id)));
  server.registerTool('connection_status', { title: 'Connection status', inputSchema: z.object(connectionInput), outputSchema: dataOutput }, async ({ connectionId }) => read('connection_status', connectionId, (c) => c.status()));
  server.registerTool('search_contacts', { title: 'Search contacts', inputSchema: z.object({ ...connectionInput, query: z.string().min(1).max(200), ...pageInput }), outputSchema: dataOutput }, async ({ connectionId, query, cursor, limit }) => read('search_contacts', connectionId, (c) => c.searchContacts(query, cursor, limit)));
  server.registerTool('list_conversations', { title: 'List captured conversations', description: 'Lists conversations observed after this connection webhook was configured. Evolution Go has no retroactive find-chats endpoint.', inputSchema: z.object({ ...connectionInput, ...pageInput }), outputSchema: dataOutput }, async ({ connectionId, cursor, limit }) => captured('list_conversations', connectionId, async () => ({ source: 'webhook_capture', ...(await listCapturedConversations(env.DB, ensured.id, connectionId, cursor, limit)) })));
  server.registerTool('list_groups', { title: 'List groups', inputSchema: z.object({ ...connectionInput, ...pageInput }), outputSchema: dataOutput }, async ({ connectionId, cursor, limit }) => read('list_groups', connectionId, (c) => c.listGroups(cursor, limit)));
  server.registerTool('list_messages', { title: 'Query captured message history', description: 'Searches messages captured by the webhook after integration. It cannot retrieve message bodies that predate webhook capture.', inputSchema: z.object({ ...connectionInput, conversationId: z.string().optional(), after: z.string().datetime().optional(), before: z.string().datetime().optional(), text: z.string().max(200).optional(), ...pageInput }), outputSchema: dataOutput }, async ({ connectionId, conversationId, after, before, text, cursor, limit }) => captured('list_messages', connectionId, async () => ({ source: 'webhook_capture', ...(await listCapturedMessages(env.DB, ensured.id, connectionId, { conversationId, after, before, text, cursor, limit })) })));
  server.registerTool('recent_messages', { title: 'Recent captured incoming messages', description: 'Returns recent events received from the Evolution Go webhook.', inputSchema: z.object({ ...connectionInput, ...pageInput }), outputSchema: dataOutput }, async ({ connectionId, cursor, limit }) => captured('recent_messages', connectionId, async () => ({ source: 'webhook_capture', ...(await listCapturedMessages(env.DB, ensured.id, connectionId, { cursor, limit })) })));

  const send = async (operation: string, connectionId: string, fn: (client: EvolutionGoClient) => Promise<unknown>) => {
    try {
      const { client } = await clientFor(connectionId);
      const result = await fn(client);
      await audit(env.DB, { userId: ensured.id, connectionId, operation, outcome: 'success' });
      return ok(result);
    } catch (error) {
      await audit(env.DB, { userId: ensured.id, connectionId, operation, outcome: 'failure', metadata: auditFailure(error) });
      return fail(error);
    }
  };

  server.registerTool('send_text', { title: 'Send text message', inputSchema: z.object({ ...connectionInput, to: z.string().min(3).max(200), text: z.string().min(1).max(10000) }), outputSchema: dataOutput }, async ({ connectionId, to, text }) => send('send_text', connectionId, (c) => c.sendText(to, text)));
  server.registerTool('reply_to_message', { title: 'Reply to a message', inputSchema: z.object({ ...connectionInput, to: z.string().min(3).max(200), text: z.string().min(1).max(10000), messageId: z.string().min(1).max(200), participant: z.string().max(200).optional() }), outputSchema: dataOutput }, async ({ connectionId, to, text, messageId, participant }) => send('reply_to_message', connectionId, (c) => c.sendText(to, text, messageId, participant)));
  server.registerTool('send_media', { title: 'Send media', inputSchema: z.object({ ...connectionInput, to: z.string().min(3).max(200), mimeType: z.string().min(3).max(200), fileName: z.string().max(255).optional(), dataBase64: z.string().min(1), caption: z.string().max(2000).optional(), ptt: z.boolean().optional(), replyTo: z.string().max(200).optional() }), outputSchema: dataOutput }, async ({ connectionId, to, mimeType, fileName, dataBase64, caption, ptt, replyTo }) => {
    const max = Number(env.MAX_MEDIA_BYTES ?? 8 * 1024 * 1024);
    if (dataBase64.length > max * 1.4) return fail(new Error(`Media exceeds configured limit of ${max} bytes`));
    let data: ArrayBuffer;
    try { const binary = atob(dataBase64.replace(/\s/g, '')); data = Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer; } catch { return fail(new Error('dataBase64 is invalid')); }
    if (data.byteLength > max) return fail(new Error(`Media exceeds configured limit of ${max} bytes`));
    return send('send_media', connectionId, (c) => c.sendMedia(to, { mimeType, fileName, data, caption, ptt }, replyTo));
  });

  server.registerTool('download_media', { title: 'Download received media', description: 'Evolution Go requires the full waE2E.Message envelope. Pass the message envelope returned in a captured message raw field; an ID alone is insufficient.', inputSchema: z.object({ ...connectionInput, messageId: z.string().min(1).max(200), message: z.unknown().optional() }), outputSchema: dataOutput }, async ({ connectionId, messageId, message }) => send('download_media', connectionId, async (c) => {
    if (!message || typeof message !== 'object') throw new Error('message envelope is required by Evolution Go for media download');
    const media = await c.downloadMedia(messageId, message);
    const max = Number(env.MAX_MEDIA_BYTES ?? 8 * 1024 * 1024);
    const reader = media.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > max) { await reader.cancel(); throw new Error(`Media exceeds configured limit of ${max} bytes`); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    return { mimeType: media.mimeType, fileName: media.fileName, size: total, dataBase64: btoa(binary) };
  }));

  return server;
}
