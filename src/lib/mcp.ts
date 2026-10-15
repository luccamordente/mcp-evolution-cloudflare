import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { AuthenticatedUser, Env } from '../types';
import { EvolutionGoAdminClient, EvolutionGoClient, EvolutionApiError } from './evolution';
import { audit, ensureUser, getConnection, revealConnectionToken } from './db';

const pageInput = { cursor: z.string().optional(), limit: z.number().int().min(1).max(100).default(50) };
const connectionInput = { connectionId: z.string().uuid() };
// Tool results are JSON payloads from Evolution Go. `z.unknown()` emits an
// empty JSON Schema (`{}`), which declares no validation at all and causes
// MCP clients to report a malformed output schema. `z.json()` keeps the
// payload intentionally free-form while declaring every valid JSON value.
export const dataOutput = z.object({ data: z.json() });

/** Remove undefined values before MCP validates structuredContent as JSON. */
export function toJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => item === undefined ? null : toJsonValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, toJsonValue(item)]));
  }
  return value;
}

function ok(data: unknown) {
  const safeData = toJsonValue(data);
  return { content: [{ type: 'text' as const, text: JSON.stringify(safeData) }], structuredContent: { data: safeData } };
}
function fail(error: unknown) {
  const message = error instanceof EvolutionApiError ? error.message : error instanceof Error ? error.message : 'Unexpected error';
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function auditFailure(error: unknown): { error: string; status?: number } {
  if (error instanceof EvolutionApiError) return { error: error.message, status: error.status };
  return { error: error instanceof Error ? error.message : 'Unexpected error' };
}

function redactInstances(payload: unknown): unknown[] {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const values = Array.isArray(payload) ? payload : Array.isArray(root.data) ? root.data : [];
  return values.map((value) => {
    if (!value || typeof value !== 'object') return value;
    const { token: _token, webhook: _webhook, qrcode: _qrcode, ...safe } = value as Record<string, unknown>;
    return safe;
  });
}

export async function createMcpServer(env: Env, user: AuthenticatedUser): Promise<McpServer> {
  const ensured = await ensureUser(env.DB, user);
  const server = new McpServer({ name: 'mcp-evolution-cloudflare', version: '0.1.0' });

  async function clientFor(connectionId: string): Promise<{ client: EvolutionGoClient; connection: NonNullable<Awaited<ReturnType<typeof getConnection>>> }> {
    const connection = await getConnection(env.DB, ensured.id, connectionId);
    if (!connection) throw new Error('Connection not found');
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

  server.registerTool('list_connections', { title: 'List WhatsApp connections', description: 'Lists instances directly from Evolution Go using its administrative instance endpoint. Credentials and QR data are redacted.', outputSchema: dataOutput }, async () => {
    const payload = await new EvolutionGoAdminClient({ baseUrl: env.EVOLUTION_BASE_URL, globalApiKey: env.EVOLUTION_GLOBAL_API_KEY ?? '' }).listInstances();
    return ok(redactInstances(payload));
  });
  server.registerTool('connection_status', { title: 'Connection status', inputSchema: z.object(connectionInput), outputSchema: dataOutput }, async ({ connectionId }) => read('connection_status', connectionId, (c) => c.status()));
  server.registerTool('search_contacts', { title: 'Search contacts', inputSchema: z.object({ ...connectionInput, query: z.string().min(1).max(200), ...pageInput }), outputSchema: dataOutput }, async ({ connectionId, query, cursor, limit }) => read('search_contacts', connectionId, (c) => c.searchContacts(query, cursor, limit)));
  server.registerTool('list_groups', { title: 'List groups', inputSchema: z.object({ ...connectionInput, ...pageInput }), outputSchema: dataOutput }, async ({ connectionId, cursor, limit }) => read('list_groups', connectionId, (c) => c.listGroups(cursor, limit)));
  server.registerTool('list_messages', { title: 'Search messages', description: 'Searches messages stored by Evolution Go through its message search endpoint. Requires DATABASE_SAVE_MESSAGES to be enabled upstream.', inputSchema: z.object({ ...connectionInput, text: z.string().max(200).optional(), limit: z.number().int().min(1).max(50).default(25) }), outputSchema: dataOutput }, async ({ connectionId, text, limit }) => read('list_messages', connectionId, (c) => c.listMessages(text, limit)));

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
  server.registerTool('send_media', { title: 'Send media', inputSchema: z.object({ ...connectionInput, to: z.string().min(3).max(200), mimeType: z.string().min(3).max(200), fileName: z.string().max(255).optional(), dataBase64: z.string().min(1), caption: z.string().max(2000).optional(), replyTo: z.string().max(200).optional() }), outputSchema: dataOutput }, async ({ connectionId, to, mimeType, fileName, dataBase64, caption, replyTo }) => {
    const max = Number(env.MAX_MEDIA_BYTES ?? 8 * 1024 * 1024);
    if (dataBase64.length > max * 1.4) return fail(new Error(`Media exceeds configured limit of ${max} bytes`));
    let data: ArrayBuffer;
    try { const binary = atob(dataBase64.replace(/\s/g, '')); data = Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer; } catch { return fail(new Error('dataBase64 is invalid')); }
    if (data.byteLength > max) return fail(new Error(`Media exceeds configured limit of ${max} bytes`));
    return send('send_media', connectionId, (c) => c.sendMedia(to, { mimeType, fileName, data, caption }, replyTo));
  });


  return server;
}
