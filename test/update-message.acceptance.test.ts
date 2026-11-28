import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eventRuntime } from './helpers/mcp-events-runtime';

const endpoint = '/message/actions';
const group = '120363000000001@g.us';
const targets = [
  { conversationId: group, messageId: 'inbound-a' },
  { conversationId: group, messageId: 'missing-b' },
];
const operation = { kind: 'mark_read' };
const providerItems = [
  { ...targets[0], outcome: 'accepted' },
  { ...targets[1], outcome: 'rejected', error: { code: 'message_not_found', retryable: false } },
];

function actionResponse(items: unknown) {
  return Response.json(
    { jsonapi: { version: '1.1' }, data: { type: 'messageActionResult', id: 'synthetic-result', attributes: { version: 1, items } } },
    { headers: { 'content-type': 'application/vnd.api+json' } },
  );
}

describe('update_message through the published MCP Worker', () => {
  let fixture: Awaited<ReturnType<typeof eventRuntime>>;
  let owner: Awaited<ReturnType<typeof fixture.issue>>;
  let reader: typeof owner;
  let other: typeof owner;
  let requests: { method: string; path: string; token: string | null; body: unknown }[] = [];
  let respond: () => Response | Promise<Response> = () => actionResponse(providerItems);

  beforeAll(async () => {
    fixture = await eventRuntime(async request => {
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        token: request.headers.get('apikey'),
        body: await request.json(),
      });
      return respond();
    });
    owner = await fixture.issue({ email: 'actions-owner@example.test', scope: 'mcp:read mcp:write' });
    reader = await fixture.issue({ email: 'actions-owner@example.test', scope: 'mcp:read' });
    other = await fixture.issue({ email: 'actions-other@example.test', scope: 'mcp:read mcp:write' });
  }, 30_000);

  afterAll(async () => { await fixture?.runtime.dispose(); });
  beforeEach(() => { requests = []; respond = () => actionResponse(providerItems); });

  function call(accessToken: string, connectionId: string, input: Record<string, unknown> = {}) {
    return fixture.rpc(accessToken, 'tools/call', {
      name: 'update_message', arguments: { targets, operation, options: { connectionId }, ...input },
    }, { 'Mcp-Name': 'update_message' });
  }

  it('advertises a potentially destructive write tool', async () => {
    const { response, body } = await fixture.rpc(owner.accessToken, 'tools/list');
    expect(response.status).toBe(200);
    const tool = body.result.tools.find((tool: { name: string }) => tool.name === 'update_message');
    expect(tool, 'update_message must appear in tools/list').toMatchObject({
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    });
    const variants = tool.inputSchema.properties.operation.oneOf ?? tool.inputSchema.properties.operation.anyOf;
    expect(variants.map((variant: { properties: { kind: { const: string } } }) => variant.properties.kind.const).sort()).toEqual([
      'add_label', 'delete_for_everyone', 'edit_text', 'mark_played', 'mark_read', 'remove_label', 'remove_reaction', 'set_reaction',
    ]);
  });

  it('rejects a read-only grant and a foreign connection without HTTP writes', async () => {
    const readOnly = await call(reader.accessToken, owner.connections[0]);
    expect(readOnly.response.status).toBe(403);
    expect(readOnly.response.headers.get('WWW-Authenticate')).toMatch(/insufficient_scope/);
    expect(readOnly.response.headers.get('WWW-Authenticate')).toMatch(/mcp:write/);

    const foreign = await call(owner.accessToken, other.connections[0]);
    expect(foreign.body).toMatchObject({ result: { isError: true, structuredContent: { data: { error: { code: 'connection_not_found' } } } } });
    expect(requests).toEqual([]);
  });

  it('returns ordered partial outcomes and reuses a completed key without dispatching again', async () => {
    const options = { connectionId: owner.connections[0], idempotencyKey: 'mixed-batch' };
    const first = await call(owner.accessToken, options.connectionId, { options });
    const repeated = await call(owner.accessToken, options.connectionId, { options });
    expect(first.body).toMatchObject({
      result: { isError: true, structuredContent: { data: {
        connectionId: options.connectionId, operation: 'mark_read', items: providerItems,
      } } },
    });
    expect(repeated.body.result.structuredContent).toEqual(first.body.result.structuredContent);

    const conflict = await call(owner.accessToken, options.connectionId, { options, targets: [targets[0]] });
    expect(conflict.body).toMatchObject({ result: { isError: true, structuredContent: { data: { error: { code: 'idempotency_conflict' } } } } });
    expect(requests).toEqual([{
      method: 'POST', path: endpoint, token: 'synthetic-instance',
      body: { data: { type: 'messageAction', attributes: { version: 1, targets, operation } } },
    }]);
  });

  it('reports an ambiguous provider response and never repeats the write on a same-key call', async () => {
    respond = () => new Response('private-provider-diagnostic', { status: 502 });
    const options = { connectionId: owner.connections[0], idempotencyKey: 'lost-result' };
    const first = await call(owner.accessToken, options.connectionId, { options });
    const repeated = await call(owner.accessToken, options.connectionId, { options });
    for (const response of [first, repeated]) {
      expect(response.body).toMatchObject({ result: { isError: true, structuredContent: { data: {
        items: targets.map(target => ({ ...target, outcome: 'unknown', error: { retryable: false } })),
      } } } });
      expect(JSON.stringify(response.body)).not.toContain('private-provider-diagnostic');
    }
    expect(requests).toHaveLength(1);
  });

  it('fences a concurrent call and an interrupted reservation without redispatching', async () => {
    const options = { connectionId: owner.connections[0], idempotencyKey: 'pending-result' };
    let dispatchStarted = () => {};
    let allowResponse = () => {};
    const started = new Promise<void>(resolve => { dispatchStarted = resolve; });
    const released = new Promise<void>(resolve => { allowResponse = resolve; });
    respond = async () => {
      dispatchStarted();
      await released;
      return actionResponse(providerItems);
    };
    const now = Date.now();
    await fixture.clock(now);
    const dispatch = call(owner.accessToken, options.connectionId, { options });
    try {
      await started;
      const inFlight = await call(owner.accessToken, options.connectionId, { options });
      expect(inFlight.body).toMatchObject({ result: { isError: true, structuredContent: { data: { error: { code: 'message_update_pending' } } } } });

      await fixture.clock(now + 36_000);
      const interrupted = await call(owner.accessToken, options.connectionId, { options });
      expect(interrupted.body).toMatchObject({ result: { isError: true, structuredContent: { data: {
        items: targets.map(target => ({ ...target, outcome: 'unknown', error: { code: 'message_update_unknown', retryable: false } })),
      } } } });
      expect(requests).toHaveLength(1);
    } finally {
      allowResponse();
      await dispatch;
      await fixture.clock();
    }
  });

  it.each([
    { kind: 'edit_text', text: 'Replacement text' },
    { kind: 'delete_for_everyone' },
    { kind: 'mark_read' },
    { kind: 'mark_played' },
    { kind: 'set_reaction', emoji: '👩🏽‍💻' },
    { kind: 'remove_reaction' },
    { kind: 'add_label', labelId: '10' },
    { kind: 'remove_label', labelId: '10' },
  ])('dispatches $kind for a single explicitly selected target', async selected => {
    const items = [{ ...targets[0], outcome: 'accepted', ...(selected.kind === 'edit_text' ? { actionId: 'synthetic-edit-action' } : {}) }];
    respond = () => actionResponse(items);
    const result = await call(owner.accessToken, owner.connections[0], { targets: [targets[0]], operation: selected });
    expect(requests).toHaveLength(1);
    expect(result.body.result.isError, JSON.stringify(result.body.result.structuredContent)).not.toBe(true);
    expect(result.body.result.structuredContent).toMatchObject({ data: { operation: selected.kind, items } });
    expect(requests[0]?.body).toEqual({
      data: { type: 'messageAction', attributes: { version: 1, targets: [targets[0]], operation: selected } },
    });
  });

  it('preserves a full ten-target batch when auditing is unavailable', async () => {
    const selection = Array.from({ length: 10 }, (_, i) => ({ conversationId: group, messageId: `inbound-${i}` }));
    const items = selection.map(target => ({ ...target, outcome: 'accepted' }));
    respond = () => actionResponse(items);
    await fixture.db.prepare(`CREATE TRIGGER update_message_audit_unavailable BEFORE INSERT ON audit_log
      WHEN NEW.operation = 'update_message' BEGIN SELECT RAISE(ABORT, 'private-audit-error'); END`).run();
    try {
      const { body } = await call(owner.accessToken, owner.connections[0], { targets: selection });
      expect(body.result.isError).not.toBe(true);
      expect(body.result.structuredContent.data.items).toEqual(items);
      expect(requests).toHaveLength(1);
      expect(JSON.stringify(body)).not.toContain('private-audit-error');
    } finally {
      await fixture.db.prepare('DROP TRIGGER update_message_audit_unavailable').run();
    }
  });

  it.each([
    { targets: [] },
    { targets: [targets[0], targets[0]] },
    { targets: Array.from({ length: 11 }, (_, i) => ({ conversationId: group, messageId: String(i) })) },
    { targets: [{ ...targets[0], fromMe: true }] },
    { operation: { kind: 'set_reaction', emoji: 'plain text' } },
    { operation: { kind: 'delete_for_me' } },
    { operation: { kind: 'mark_read', sender: 'guessed-sender' } },
  ])('rejects invalid or unsupported arguments before making an HTTP request (%j)', async invalid => {
    const { body } = await call(owner.accessToken, owner.connections[0], invalid);
    expect(body.result?.isError === true || body.error?.code === -32602).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('treats reordered or mismatched provider results as ambiguous', async () => {
    respond = () => actionResponse([...providerItems].reverse());
    const { body } = await call(owner.accessToken, owner.connections[0]);
    expect(body).toMatchObject({ result: { isError: true, structuredContent: { data: {
      items: targets.map(target => ({ ...target, outcome: 'unknown', error: { retryable: false } })),
    } } } });
    expect(requests).toHaveLength(1);
  });

  it('treats a nonfinal success status as ambiguous even when its body is valid', async () => {
    respond = async () => new Response(await actionResponse(providerItems).text(), { status: 202 });
    const { body } = await call(owner.accessToken, owner.connections[0]);
    expect(body.result.structuredContent.data.items).toEqual(targets.map(target => ({
      ...target, outcome: 'unknown', error: { code: 'message_update_unknown', retryable: false },
    })));
    expect(requests).toHaveLength(1);
  });

  it('distinguishes an unavailable route from an ambiguous dispatch', async () => {
    respond = () => Response.json({
      jsonapi: { version: '1.1' },
      errors: [{ status: '404', title: 'Not Found', detail: 'no route for POST /message/actions' }],
    }, { status: 404 });
    const { body } = await call(owner.accessToken, owner.connections[0]);
    expect(body).toMatchObject({ result: { isError: true, structuredContent: { data: {
      items: targets.map(target => ({ ...target, outcome: 'not_started', error: { code: 'message_update_unavailable' } })),
    } } } });
    expect(requests).toHaveLength(1);
  });
});
