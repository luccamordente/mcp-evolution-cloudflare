// Converts existing behavior fixtures to the five-tool API at the call site.
// This is test-only; production never accepts the removed argument shapes.
export function migrateToolArguments(name: string, value: Record<string, unknown>): Record<string, unknown> {
  const { messageId, ...options } = value;
  if (name === 'send_message') {
    const { message, connectionId, idempotencyKey } = value;
    const { kind, to, replyTo, mentions, delayMs, customMessageId, formatJid, mimeType, source, ...fields } = message as Record<string, unknown>;
    const status = typeof kind === 'string' && kind.startsWith('status_');
    return { message: { kind: status ? kind.slice(7) : kind, ...fields, ...(!mimeType && source ? { source } : {}) }, options: { connectionId, idempotencyKey, to: status ? 'status' : to, replyTo, mentions, delayMs, customMessageId, formatJid, mimeType, ...(mimeType ? { mediaSource: source } : {}) } };
  }
  const formats: Record<string, string> = { get_message_image: 'image/*', transcribe_message_audio: 'text/plain', read_message_document: 'text/plain', get_message_document: 'application/pdf', read_message_document_pages: 'image/*' };
  if (formats[name]) options.encodingFormat = formats[name];
  if (name === 'inspect_message_document') options.include = ['metadata'];
  if (name === 'list_message_responses') { options.include = [options.relationship === 'votes' ? 'poll-responses' : 'event-responses']; delete options.relationship; }
  if (name === 'connection_status') { options.include = ['status']; delete options.connectionId; }
  if (options.cursor === '') delete options.cursor;
  return { ...(messageId === undefined ? {} : { messageId }), options };
}

export function migrateToolCall(params: Record<string, unknown>): Record<string, unknown> {
  const names: Record<string, string> = { list_connections: 'search_connections', connection_status: 'search_connections', list_groups: 'search_groups', list_messages: 'search_messages', get_message_image: 'get_message', transcribe_message_audio: 'get_message', get_message_document: 'get_message', read_message_document: 'get_message', inspect_message_document: 'get_message', read_message_document_pages: 'get_message', list_message_responses: 'get_message' };
  if (typeof params.name !== 'string') return params;
  if ((params.name === 'get_message' || params.name === 'send_message') && params.arguments && !('options' in (params.arguments as Record<string, unknown>))) return { ...params, arguments: migrateToolArguments(params.name, params.arguments as Record<string, unknown>) };
  if (!names[params.name]) return params;
  return { ...params, name: names[params.name], arguments: migrateToolArguments(params.name, params.arguments as Record<string, unknown>) };
}
