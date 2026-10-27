import { describe, expect, it } from 'vitest';
import { EvolutionGoClient } from '../src/lib/evolution';
import { callsWriteTool, hasWriteScope, imageGalleryInput, listMessagesInput, mcpBodyLimit, WRITE_TOOLS } from '../src/lib/mcp';
import { uniqueInstanceName } from '../src/index';

const msg = (id: string, at: number) => ({ type: 'message', id, attributes: { encodingFormat: 'text/plain', at, body: { text: id } }, meta: { chat: 'c', fromMe: false } });

describe('mcp:write scope', () => {
  it('requires mcp:write on the transport auth info', () => {
    expect(hasWriteScope({ http: { authInfo: { scopes: ['mcp:read', 'mcp:write'] } } })).toBe(true);
    expect(hasWriteScope({ http: { authInfo: { scopes: ['mcp:read'] } } })).toBe(false);
    expect(hasWriteScope({})).toBe(false);
    expect(hasWriteScope(undefined)).toBe(false);
  });
  it('detects write tool calls in single and batch JSON-RPC bodies', async () => {
    const req = (body: unknown) => new Request('https://x.invalid/mcp', { method: 'POST', body: JSON.stringify(body) });
    for (const name of WRITE_TOOLS) expect(await callsWriteTool(req({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name } }))).toBe(true);
    expect(await callsWriteTool(req({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_messages' } }))).toBe(false);
    expect(await callsWriteTool(req([{ method: 'tools/list' }, { method: 'tools/call', params: { name: 'send_text' } }]))).toBe(true);
    expect(await callsWriteTool(new Request('https://x.invalid/mcp', { method: 'POST', body: 'not json' }))).toBe(false);
  });
});

describe('MCP body limit', () => {
  it('fits base64 of the full media limit', () => {
    const limit = mcpBodyLimit({ MAX_MEDIA_BYTES: String(8 * 1024 * 1024) });
    expect(limit).toBeGreaterThan(Math.ceil(8 * 1024 * 1024 / 3) * 4);
    expect(mcpBodyLimit({})).toBe(limit);
  });
});

describe('list_messages pagination', () => {
  it('exposes cursor on list_messages but not on the gallery', () => {
    expect(listMessagesInput.parse({ cursor: '1700000000000' }).cursor).toBe('1700000000000');
    expect(listMessagesInput.safeParse({ cursor: 'abc' }).success).toBe(false);
    expect('cursor' in imageGalleryInput.shape).toBe(false);
  });
  const pager = (rows: Array<[string, number]>) => {
    const urls: URL[] = [];
    const client = new EvolutionGoClient({ baseUrl: 'https://e.invalid', instanceToken: 't', instanceId: 'i', fetcher: async (request: RequestInfo | URL) => {
      const url = new URL(String(request)); urls.push(url);
      const before = url.searchParams.get('before');
      const limit = Number(url.searchParams.get('limit'));
      const data = rows.filter(([, at]) => !before || at < Number(before)).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, at]) => msg(id, at));
      return Response.json({ jsonapi: { version: '1.1' }, data });
    } } as any);
    return { client, urls };
  };
  const walk = async (client: EvolutionGoClient, limit: number) => {
    const ids: string[] = []; const pages: any[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const page = await client.listMessages(undefined, limit, 'c', undefined, cursor);
      pages.push(page); ids.push(...page.items.map((m) => String(m.id)));
      if (!page.hasMore) break;
      expect(page.items.length).toBeGreaterThan(0);
      cursor = page.nextCursor;
    }
    return { ids, pages };
  };
  it('passes the cursor as before, looks one row ahead and returns the oldest timestamp as nextCursor', async () => {
    const { client, urls } = pager([['a', 3000], ['b', 2000], ['c', 1000]]);
    const page = await client.listMessages(undefined, 2, 'c', undefined, '5000');
    expect(urls[0].searchParams.get('before')).toBe('5000');
    expect(urls[0].searchParams.get('limit')).toBe('3');
    expect(page).toMatchObject({ hasMore: true, nextCursor: '2000' });
    expect(page.items.map((m) => m.id)).toEqual(['a', 'b']);
    const short = await client.listMessages(undefined, 10);
    expect(short.hasMore).toBe(false);
    expect(short.nextCursor).toBeUndefined();
  });
  it('reports hasMore false when the remaining rows exactly fill the page (QA zjB11 regression)', async () => {
    const { client } = pager([['a', 5000], ['b', 4000], ['c', 3000], ['d', 2000]]);
    const { ids, pages } = await walk(client, 2);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
    expect(pages.map((p) => p.hasMore)).toEqual([true, false]);
    expect(pages.every((p) => p.items.length > 0)).toBe(true);
  });
  it('probes once at the 50-row server cap instead of over-asking', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => [`m${i}`, 100000 - i * 10] as [string, number]);
    const { client, urls } = pager(rows);
    const page = await client.listMessages(undefined, 50, 'c');
    expect(urls.map((u) => u.searchParams.get('limit'))).toEqual(['50', '1']);
    expect(page).toEqual({ items: expect.any(Array), hasMore: false });
    const { client: more } = pager([...rows, ['older', 1]]);
    expect(await more.listMessages(undefined, 50, 'c')).toMatchObject({ hasMore: true, nextCursor: String(100000 - 49 * 10) });
  });
  it('does not drop rows that share the boundary timestamp', async () => {
    const { client } = pager([['a', 5000], ['b', 4000], ['c', 4000], ['d', 3000]]);
    const { ids, pages } = await walk(client, 2);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
    expect(pages.at(-1).hasMore).toBe(false);
  });
});

describe('onboarding instance names', () => {
  it('is unique and slugged', () => {
    const a = uniqueInstanceName('Novo WhatsApp'), b = uniqueInstanceName('Novo WhatsApp');
    expect(a).toMatch(/^novo-whatsapp-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
    expect(uniqueInstanceName('ção!!')).toMatch(/^cao-[0-9a-f]{8}$/);
  });
});
