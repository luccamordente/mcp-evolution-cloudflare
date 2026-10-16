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

  it('allows an omitted connectionId but rejects null', () => {
    const schema = z.object(connectionInput);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ connectionId: null }).success).toBe(false);
    expect(schema.safeParse({ connectionId: 'not-a-uuid' }).success).toBe(false);
    const connectionDescription = (z.toJSONSchema(schema) as { properties?: { connectionId?: { description?: string } } }).properties?.connectionId?.description;
    expect(connectionDescription).toContain('Omit it');
    expect(connectionDescription).toContain('default connection');
  });

  it('documents every registered tool without exposing an implementation provider', () => {
    const expected = ['list_connections', 'connection_status', 'search_contacts', 'list_groups', 'list_messages', 'send_text', 'reply_to_message', 'send_media'] as const;
    for (const name of expected) {
      expect(TOOL_DESCRIPTIONS[name].length).toBeGreaterThan(40);
      expect(TOOL_DESCRIPTIONS[name]).not.toMatch(/evolution|upstream|downstream/i);
    }
    expect(MCP_SERVER_INSTRUCTIONS).toContain('list_connections');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('By default, omit connectionId');
    expect(MCP_SERVER_INSTRUCTIONS).toContain('only to inspect or choose');
    expect(MCP_SERVER_INSTRUCTIONS).not.toContain('send_text');
    expect(MCP_SERVER_INSTRUCTIONS).not.toMatch(/evolution|upstream|downstream/i);
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
