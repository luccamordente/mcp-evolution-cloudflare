import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { IMAGE_GALLERY_HTML } from '../generated/image-gallery';
import { approvedImageOrigins, galleryImage } from './image-gallery';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { AuthenticatedUser, Env } from '../types';
import { EvolutionGoClient, EvolutionApiError } from './evolution';
import { audit, ensureUser, getConnection, listConnections, resolveConnection, revealConnectionToken } from './db';

const pageInput = {
  cursor: z.string().optional().describe('Opaque cursor returned by a previous page; omit it for the first page.'),
  limit: z.number().int().min(1).max(100).default(50).describe('Maximum number of items to return in this page.')
};
export const connectionInput = {
  connectionId: z.string().uuid().optional().describe('Optional internal connection UUID. Omit it to use the user\'s default connection; the server reports an error if no unique default connection is available.')
};

export const MCP_SERVER_INSTRUCTIONS =
  'By default, omit connectionId and use the user\'s default connection. ' +
  'Call list_connections only to inspect or choose among connections, or to recover from a missing or ambiguous default. ' +
  'If the user provides a connectionId, pass it unchanged; never invent identifiers. ' +
  'Treat list_messages as partial retained history, so an empty result is inconclusive.';
export const MCP_SERVER_NAME = 'whatsapp-mcp';

export const TOOL_DESCRIPTIONS = {
  list_connections: 'List the user\'s registered WhatsApp connections. Use this to discover connection IDs or resolve which connection to use. Returns configuration metadata only; call connection_status for current availability. Credentials and pairing data are never returned.',
  connection_status: 'Read the current availability of one WhatsApp connection. Use when the user asks whether a connection is active or ready. Requires connectionId when the default connection is not unambiguous.',
  search_contacts: 'Find contacts in a WhatsApp connection by name or phone number. Use before messaging when the recipient is not yet identified. Do not use it to search message history.',
  list_groups: 'List groups available in a WhatsApp connection. Use when the user needs group names, IDs, or basic participant information. Results are paginated.',
  list_messages: 'Search partial retained message history in a WhatsApp account selected by connectionId (or the default connection). Optionally filter a contact or group conversation with conversationId and combine it with text and limit. Do not assume this is a complete historical archive; an empty result is inconclusive.',
  show_image_gallery: 'Show received and sent images from partial retained WhatsApp history in a read-only gallery. Omit connectionId for the default connection; optionally restrict conversationId, text and limit. Missing files may not be retained. Use Refresh in the gallery to renew links.',
  send_text: 'Send a new text message to an individual or group. Use only when the destination and final text are known. This creates an external side effect and must not be used to quote an existing message.',
  reply_to_message: 'Send a text reply quoting an existing message. Use only when the user explicitly wants a reply tied to a known message ID and destination. This creates an external side effect.',
  send_media: 'Send an image, document, audio, or video attachment to an individual or group. Use when the user requests media delivery and the content is available as base64. This creates an external side effect and is subject to the configured size limit.'
} as const;

// `z.unknown()` emits an empty JSON Schema (`{}`), which declares no validation
// at all and causes MCP clients to report a malformed output schema. `z.json()`
// keeps the payload intentionally free-form while declaring every JSON value.
export const dataOutput = z.object({ data: z.json() });

export const listMessagesInput = z.object({
  ...connectionInput,
  conversationId: z.string().trim().min(1).max(200).optional().describe('Optional contact number, individual or group JID selecting a conversation within the WhatsApp account; connectionId selects the account. Surrounding whitespace is removed. Searches only partial retained history; an empty result is inconclusive.'),
  text: z.string().max(200).optional().describe('Optional text fragment to search for in retained messages.'),
  limit: z.number().int().min(1).max(50).default(25).describe('Maximum number of messages to return.')
});

export const imageGalleryInput = listMessagesInput.extend({
  limit: z.number().int().min(1).max(20).default(12).describe('Maximum number of image messages to load (default 12, maximum 20). No claim of complete history.'),
}).strict();

export const sendTextInput = z.object({
  ...connectionInput,
  to: z.string().min(3).max(200).describe('Recipient JID or accepted individual/group destination.'),
  text: z.string().min(1).max(10000).describe('Final text content to send.')
});

export const replyToMessageInput = z.object({
  ...connectionInput,
  to: z.string().min(3).max(200).describe('Recipient JID or group destination for the reply.'),
  text: z.string().min(1).max(10000).describe('Final text content to send as the reply.'),
  messageId: z.string().min(1).max(200).describe('Identifier of the message being quoted.'),
  participant: z.string().max(200).optional().describe('Optional participant identifier when the quoted message belongs to a group.')
});

export const sendMediaInput = z.object({
  ...connectionInput,
  to: z.string().min(3).max(200).describe('Recipient JID or accepted individual/group destination.'),
  mimeType: z.string().min(3).max(200).describe('MIME type of the attachment, such as image/jpeg or application/pdf.'),
  fileName: z.string().max(255).optional().describe('Optional file name shown to the recipient.'),
  dataBase64: z.string().min(1).describe('Base64-encoded attachment content without a data URL prefix.'),
  caption: z.string().max(2000).optional().describe('Optional caption sent with the attachment.'),
  replyTo: z.string().max(200).optional().describe('Optional message identifier to quote while sending the attachment.')
});

export const TOOL_ANNOTATIONS = {
  readOnly: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  send: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
} as const;
const readOnlyAnnotations = TOOL_ANNOTATIONS.readOnly;
const sendAnnotations = TOOL_ANNOTATIONS.send;

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

export type McpErrorCode =
  | 'connection_not_found'
  | 'no_default_connection'
  | 'multiple_default_connections'
  | 'evolution_unreachable'
  | 'evolution_http_error'
  | 'media_too_large'
  | 'invalid_base64'
  | 'token_decryption_failed'
  | 'unexpected_error';

export interface McpToolError {
  code: McpErrorCode;
  status: number;
  retryable: boolean;
  operation: string;
  message: string;
  hint: string;
}

function sanitizedMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return message
    .replace(/(token|api[-_ ]?key|password|secret)[=:]?\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240) || fallback;
}

export function classifyMcpError(error: unknown, operation: string): McpToolError {
  const message = sanitizedMessage(error, 'Unexpected error');
  if (message === 'Connection not found') {
    return { code: 'connection_not_found', status: 404, retryable: false, operation, message, hint: 'Call list_connections and retry with an existing connectionId.' };
  }
  if (message.startsWith('No default connection configured')) {
    return { code: 'no_default_connection', status: 409, retryable: false, operation, message, hint: 'Call list_connections and pass a connectionId, or configure one default connection.' };
  }
  if (message === 'Multiple default connections configured') {
    return { code: 'multiple_default_connections', status: 409, retryable: false, operation, message, hint: 'Call list_connections and pass a connectionId, then fix the default selection in the connections UI.' };
  }
  if (message === 'dataBase64 is invalid') {
    return { code: 'invalid_base64', status: 400, retryable: false, operation, message, hint: 'Send valid base64 content without a data URL prefix.' };
  }
  if (message.startsWith('Media exceeds configured limit')) {
    return { code: 'media_too_large', status: 413, retryable: false, operation, message, hint: 'Reduce the attachment below the configured byte limit and retry.' };
  }
  if (error instanceof EvolutionApiError) {
    if (message === 'Evolution Go is unreachable') {
      return { code: 'evolution_unreachable', status: 503, retryable: true, operation, message, hint: 'Retry the operation for a read, or verify Evolution Go availability before retrying a write.' };
    }
    const status = error.status;
    const retryable = status === 408 || status === 429 || status >= 500;
    return { code: 'evolution_http_error', status, retryable, operation, message, hint: retryable ? 'Retry after a short delay; writes must not be replayed automatically.' : 'Use the status and message to correct authentication, destination, or request data before retrying.' };
  }
  if (message === 'Invalid encrypted token') {
    return { code: 'token_decryption_failed', status: 500, retryable: false, operation, message, hint: 'The stored connection credential cannot be decrypted; repair the server configuration or connection.' };
  }
  return { code: 'unexpected_error', status: 500, retryable: false, operation, message, hint: 'Inspect server logs; no automatic retry is safe.' };
}

function fail(operation: string, error: unknown) {
  const errorData = classifyMcpError(error, operation);
  const payload = { error: errorData };
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: { data: payload } };
}

function auditFailure(error: unknown): { error: string; status?: number } {
  if (error instanceof EvolutionApiError) return { error: error.message, status: error.status };
  return { error: error instanceof Error ? error.message : 'Unexpected error' };
}

export async function createMcpServer(env: Env, user: AuthenticatedUser): Promise<McpServer> {
  const ensured = await ensureUser(env.DB, user);
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: '0.1.0' },
    { instructions: MCP_SERVER_INSTRUCTIONS }
  );

  async function clientFor(connectionId?: string): Promise<{ client: EvolutionGoClient; connection: NonNullable<Awaited<ReturnType<typeof getConnection>>> }> {
    const connection = await resolveConnection(env.DB, ensured.id, connectionId);
    const token = await revealConnectionToken(env.DB, env.TOKEN_ENCRYPTION_KEY, connection);
    return { client: new EvolutionGoClient({ baseUrl: env.EVOLUTION_BASE_URL, globalApiKey: env.EVOLUTION_GLOBAL_API_KEY, instanceId: connection.instanceId, instanceToken: token }), connection };
  }

  const read = async <T>(operation: string, connectionId: string | undefined, fn: (client: EvolutionGoClient) => Promise<T>) => {
    let resolvedConnectionId: string | undefined;
    try {
      const { client, connection } = await clientFor(connectionId);
      resolvedConnectionId = connection.id;
      const data = await fn(client);
      await audit(env.DB, { userId: ensured.id, connectionId: connection.id, operation, outcome: 'success' });
      return ok(data);
    } catch (error) {
      try {
        await audit(env.DB, { userId: ensured.id, connectionId: resolvedConnectionId, operation, outcome: 'failure', metadata: auditFailure(error) });
      } catch {
        // An audit failure must not replace the operation error being reported.
      }
      return fail(operation, error);
    }
  };

  server.registerTool('list_connections', { title: 'List WhatsApp connections', description: TOOL_DESCRIPTIONS.list_connections, annotations: readOnlyAnnotations, outputSchema: dataOutput }, async () => {
    // The administrative /instance/all route is global to the Evolution server.
    // Use the authenticated user's D1-owned connections as the source of truth
    // so one user's MCP token can never enumerate another user's instances.
    return ok(await listConnections(env.DB, ensured.id));
  });
  server.registerTool('connection_status', { title: 'Connection status', description: TOOL_DESCRIPTIONS.connection_status, inputSchema: z.object(connectionInput), annotations: readOnlyAnnotations, outputSchema: dataOutput }, async ({ connectionId }) => read('connection_status', connectionId, (c) => c.status()));
  server.registerTool('search_contacts', { title: 'Search contacts', description: TOOL_DESCRIPTIONS.search_contacts, inputSchema: z.object({ ...connectionInput, query: z.string().min(1).max(200).describe('Name or phone fragment to search for.'), ...pageInput }), annotations: readOnlyAnnotations, outputSchema: dataOutput }, async ({ connectionId, query, cursor, limit }) => read('search_contacts', connectionId, (c) => c.searchContacts(query, cursor, limit)));
  server.registerTool('list_groups', { title: 'List groups', description: TOOL_DESCRIPTIONS.list_groups, inputSchema: z.object({ ...connectionInput, ...pageInput }), annotations: readOnlyAnnotations, outputSchema: dataOutput }, async ({ connectionId, cursor, limit }) => read('list_groups', connectionId, (c) => c.listGroups(cursor, limit)));
  server.registerTool('list_messages', { title: 'Search messages', description: TOOL_DESCRIPTIONS.list_messages, inputSchema: listMessagesInput, annotations: readOnlyAnnotations, outputSchema: dataOutput }, async ({ connectionId, conversationId, text, limit }) => read('list_messages', connectionId, (c) => c.listMessages(text, limit, conversationId)));
  const galleryUri = 'ui://whatsapp/image-gallery-v2.html';
  const galleryOrigins = approvedImageOrigins(env.IMAGE_STORAGE_ORIGINS, env.EVOLUTION_BASE_URL);
  const galleryCsp = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src 'none'; img-src ${galleryOrigins.join(' ') || "'none'"}; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const galleryHtml = IMAGE_GALLERY_HTML.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="${galleryCsp}">`);
  const galleryResourceMeta = { ui: { csp: { resourceDomains: galleryOrigins, connectDomains: [], frameDomains: [], baseUriDomains: [] } } };
  registerAppResource(server, 'WhatsApp image gallery', galleryUri, { _meta: galleryResourceMeta }, async () => ({
    contents: [{ uri: galleryUri, mimeType: RESOURCE_MIME_TYPE, text: galleryHtml, _meta: galleryResourceMeta }],
  }));
  registerAppTool(server, 'show_image_gallery', {
    title: 'Show WhatsApp images', description: TOOL_DESCRIPTIONS.show_image_gallery,
    inputSchema: imageGalleryInput, outputSchema: dataOutput, annotations: readOnlyAnnotations,
    _meta: { ui: { resourceUri: galleryUri, visibility: ['model', 'app'] } },
  }, async ({ connectionId, conversationId, text, limit }) => {
    let resolvedConnectionId: string | undefined;
    try {
      const { client, connection } = await clientFor(connectionId);
      resolvedConnectionId = connection.id;
      const page = await client.listMessages(text, limit, conversationId, 'image/*');
      const approvedOrigins = approvedImageOrigins(env.IMAGE_STORAGE_ORIGINS, env.EVOLUTION_BASE_URL);
      const items = page.items.slice(0, limit).map(message => galleryImage(message, approvedOrigins));
      const available = items.filter(item => item.state === 'ready').length;
      await audit(env.DB, { userId: ensured.id, connectionId: connection.id, operation: 'show_image_gallery', outcome: 'success' });
      const summary = { count: items.length, available, unavailable: items.length - available,
        note: 'Partial retained image history. Missing or expired files may be unavailable. Open the gallery in a compatible MCP Apps host; Refresh renews available links.' };
      return { ...ok(summary), _meta: { gallery: toJsonValue({ connectionId: connection.id, conversationId, text, limit, approvedOrigins, items }) } };
    } catch (error) {
      // Never forward upstream details, URLs, captions or service credentials to
      // the model or audit log. Keep only the useful HTTP status for this tool.
      const initial = classifyMcpError(error, 'show_image_gallery');
      const safeError = error instanceof EvolutionApiError
        ? new EvolutionApiError(error.status, 'Image history is unavailable; retry a read or verify storage availability.')
        : ['connection_not_found', 'no_default_connection', 'multiple_default_connections', 'token_decryption_failed'].includes(initial.code) ? error : new Error('Image gallery is unavailable.');
      const classified = classifyMcpError(safeError, 'show_image_gallery');
      try { await audit(env.DB, { userId: ensured.id, connectionId: resolvedConnectionId, operation: 'show_image_gallery', outcome: 'failure', metadata: { code: classified.code, status: classified.status } }); } catch { /* Preserve the original safe operation result. */ }
      return { ...fail('show_image_gallery', safeError), ...(resolvedConnectionId ? { _meta: { gallery: toJsonValue({ connectionId: resolvedConnectionId, conversationId, text, limit, approvedOrigins: galleryOrigins, items: [] }) } } : {}) };
    }
  });


  const send = async (operation: string, connectionId: string | undefined, fn: (client: EvolutionGoClient) => Promise<unknown>) => {
    let resolvedConnectionId: string | undefined;
    try {
      const { client, connection } = await clientFor(connectionId);
      resolvedConnectionId = connection.id;
      const result = await fn(client);
      await audit(env.DB, { userId: ensured.id, connectionId: connection.id, operation, outcome: 'success' });
      return ok(result);
    } catch (error) {
      try {
        await audit(env.DB, { userId: ensured.id, connectionId: resolvedConnectionId, operation, outcome: 'failure', metadata: auditFailure(error) });
      } catch {
        // An audit failure must not replace the operation error being reported.
      }
      return fail(operation, error);
    }
  };

  server.registerTool('send_text', { title: 'Send text message', description: TOOL_DESCRIPTIONS.send_text, inputSchema: sendTextInput, annotations: sendAnnotations, outputSchema: dataOutput }, async ({ connectionId, to, text }) => send('send_text', connectionId, (c) => c.sendText(to, text)));
  server.registerTool('reply_to_message', { title: 'Reply to a message', description: TOOL_DESCRIPTIONS.reply_to_message, inputSchema: replyToMessageInput, annotations: sendAnnotations, outputSchema: dataOutput }, async ({ connectionId, to, text, messageId, participant }) => send('reply_to_message', connectionId, (c) => c.sendText(to, text, messageId, participant)));
  server.registerTool('send_media', { title: 'Send media', description: TOOL_DESCRIPTIONS.send_media, inputSchema: sendMediaInput, annotations: sendAnnotations, outputSchema: dataOutput }, async ({ connectionId, to, mimeType, fileName, dataBase64, caption, replyTo }) => {
    const max = Number(env.MAX_MEDIA_BYTES ?? 8 * 1024 * 1024);
    if (dataBase64.length > max * 1.4) return fail('send_media', new Error(`Media exceeds configured limit of ${max} bytes`));
    let data: ArrayBuffer;
    try { const binary = atob(dataBase64.replace(/\s/g, '')); data = Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer; } catch { return fail('send_media', new Error('dataBase64 is invalid')); }
    if (data.byteLength > max) return fail('send_media', new Error(`Media exceeds configured limit of ${max} bytes`));
    return send('send_media', connectionId, (c) => c.sendMedia(to, { mimeType, fileName, data, caption }, replyTo));
  });

  return server;
}
