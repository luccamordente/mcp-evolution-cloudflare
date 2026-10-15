import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { connectionInput, dataOutput, toJsonValue } from '../src/lib/mcp';

describe('MCP tool output schema', () => {
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
    expect((z.toJSONSchema(schema) as { properties?: { connectionId?: { description?: string } } }).properties?.connectionId?.description).toContain('default connection');
  });
});
