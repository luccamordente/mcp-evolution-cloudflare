import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  classifyMcpError,
  MCP_SERVER_INSTRUCTIONS,
  MCP_SERVER_NAME,
  TOOL_ANNOTATIONS,
  TOOL_DESCRIPTIONS,
  connectionInput,
  dataOutput,
  listMessagesInput,
  replyToMessageInput,
  sendMediaInput,
  sendTextInput,
  toJsonValue
} from '../src/lib/mcp';
import { EvolutionApiError } from '../src/lib/evolution';

describe('MCP tool output schema', () => {
  it('classifies and sanitizes upstream errors without exposing details', () => {
    const error = classifyMcpError(new EvolutionApiError(503, 'upstream token=secret-value', { token: 'secret-value', payload: 'private' }), 'search_contacts');
    expect(error).toMatchObject({
      code: 'evolution_http_error', status: 503, retryable: true, operation: 'search_contacts',
      message: 'upstream token=[redacted]',
    });
    expect(error.hint).toContain('Retry');
    expect(JSON.stringify(error)).not.toContain('secret-value');
    expect(JSON.stringify(error)).not.toContain('private');
  });

  it('does not mark authentication or request errors as retryable', () => {
    expect(classifyMcpError(new EvolutionApiError(401, 'not authorized'), 'send_text')).toMatchObject({
      code: 'evolution_http_error', status: 401, retryable: false, operation: 'send_text',
    });
    expect(classifyMcpError(new Error('dataBase64 is invalid'), 'send_media')).toMatchObject({
      code: 'invalid_base64', status: 400, retryable: false, operation: 'send_media',
    });
  });

  it('declares data as a JSON value instead of an unconstrained schema', () => {
    const schema = z.toJSONSchema(dataOutput) as {
      properties?: { data?: { $ref?: string } };
      $defs?: Record<string, { anyOf?: unknown[] }>;
    };
    const dataSchema = schema.properties?.data;

    expect(dataSchema?.$ref).toBeDefined();
    expect(schema.$defs?.[dataSchema?.$ref?.split('/').pop() ?? '']?.anyOf).toBeDefined();
    expect(dataSchema).not.toEqual({});
  });

  it('removes undefined fields before structured content validation', () => {
    const safe = toJsonValue({ items: [{ jid: '1@s.whatsapp.net', name: undefined }], next: undefined });
    expect(dataOutput.parse({ data: safe })).toEqual({ data: { items: [{ jid: '1@s.whatsapp.net' }] } });
  });

  it('preserves media URLs returned by the provider', () => {
    const url = 'https://example.com/file.jpg?signature=abc';
    expect(toJsonValue({ media: { url } })).toEqual({ media: { url } });
  });

  it('allows an omitted connectionId but rejects null', () => {
    const schema = z.object(connectionInput);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ connectionId: null }).success).toBe(false);
    expect(schema.safeParse({ connectionId: 'not-a-uuid' }).success).toBe(false);
    const connectionDescription = (z.toJSONSchema(schema) as { properties?: { connectionId?: { description?: string } } }).properties?.connectionId?.description;
    expect(connectionDescription).toContain('Omit it');
    expect(connectionDescription).toContain('default connection');
  });

  it.each(['5511999999999', '5511999999999@s.whatsapp.net', '120363123456789@g.us'])('accepts conversation identifier %s without requiring a connection UUID', (conversationId) => {
    expect(listMessagesInput.parse({ conversationId: ` ${conversationId} ` })).toEqual({ conversationId, limit: 25 });
  });

  it.each(['', '   ', null, 5511999999999, true, {}, [], '1'.repeat(201)])('rejects invalid conversation identifier %j', (conversationId) => {
    expect(listMessagesInput.safeParse({ conversationId }).success).toBe(false);
  });

  it('applies the conversation length limit after trimming', () => {
    expect(listMessagesInput.parse({ conversationId: ` ${'1'.repeat(200)} ` }).conversationId).toBe('1'.repeat(200));
  });

  it('preserves message search defaults and bounds', () => {
    expect(listMessagesInput.parse({})).toEqual({ limit: 25 });
    expect(listMessagesInput.parse({ text: 'Olá', limit: 50 })).toEqual({ text: 'Olá', limit: 50 });
    expect(listMessagesInput.safeParse({ limit: 51 }).success).toBe(false);
    expect(listMessagesInput.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('documents every registered tool without exposing an implementation provider', () => {
    const expected = ['list_connections', 'connection_status', 'search_contacts', 'list_groups', 'list_messages', 'get_message_image', 'transcribe_message_audio', 'show_image_gallery', 'send_text', 'reply_to_message', 'send_media', 'forward_message'] as const;
    for (const name of expected) {
      expect(TOOL_DESCRIPTIONS[name].length).toBeGreaterThan(40);
      expect(TOOL_DESCRIPTIONS[name]).not.toMatch(/evolution|upstream|downstream/i);
    }
    expect(MCP_SERVER_INSTRUCTIONS).toContain('list_connections');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('By default, omit connectionId');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('only to inspect or choose');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('transcribe_message_audio');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('even without an explicit transcription request');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('at least 6 minutes');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('do not retry it automatically');
    expect(MCP_SERVER_INSTRUCTIONS).not.toContain('send_text');
    expect(MCP_SERVER_INSTRUCTIONS).not.toMatch(/evolution|upstream|downstream/i);
    expect(TOOL_DESCRIPTIONS.list_connections).toContain('configuration metadata only');
    expect(TOOL_DESCRIPTIONS.list_connections).toContain('connection_status');
    expect(MCP_SERVER_NAME).toBe('whatsapp-mcp');
    expect(MCP_SERVER_NAME).not.toMatch(/evolution|upstream|downstream/i);
  });

  it('marks read and send tools with distinct behavior hints', () => {
    expect(TOOL_ANNOTATIONS.readOnly).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    expect(TOOL_ANNOTATIONS.send).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false });
  });

  it('describes the semantic meaning of message tool fields', () => {
    const schemas = [sendTextInput, replyToMessageInput, sendMediaInput, listMessagesInput];
    for (const schema of schemas) {
      const json = z.toJSONSchema(schema) as { properties?: Record<string, { description?: string }> };
      for (const [name, property] of Object.entries(json.properties ?? {})) {
        if (name === 'connectionId' || name === 'cursor' || name === 'limit') expect(property.description).toBeTruthy();
      }
    }
    const sendMediaJson = z.toJSONSchema(sendMediaInput) as { properties?: Record<string, { description?: string }> };
    expect(sendMediaJson.properties?.dataBase64?.description).toContain('Base64');
    const replyJson = z.toJSONSchema(replyToMessageInput) as { properties?: Record<string, { description?: string }> };
    expect(replyJson.properties?.messageId?.description).toContain('quoted');
  });
});
