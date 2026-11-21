import { describe, expect, it } from 'vitest';
import { EvolutionGoClient } from '../src/lib/evolution';

function receiptPager(count: number) {
  const at = 1794793600000;
  const rows = Array.from({ length: count }, (_, i) => ({
    type: 'message', id: `receipt-${String(count - i).padStart(3, '0')}`, attributes: { at },
    meta: { observation: { version: 1, state: 'receipt_only', observedAt: at, timestampSource: 'receipt' } },
  }));
  const urls: URL[] = [];
  const client = new EvolutionGoClient({ baseUrl: 'https://provider.invalid', instanceToken: 'synthetic', instanceId: 'synthetic', fetcher: async input => {
    const url = new URL(String(input));
    urls.push(url);
    const anchor = url.searchParams.get('beforeId');
    const before = url.searchParams.get('before');
    const data = rows.filter(row => anchor ? row.id < anchor : !before || row.attributes.at < Number(before)).slice(0, Number(url.searchParams.get('limit')));
    return Response.json({ jsonapi: { version: '1.1' }, meta: { messageSearchCursor: 'beforeId' }, data });
  } });
  return { client, rows, urls };
}

describe('receipt search pagination', () => {
  it('reaches every receipt in a timestamp tie larger than the provider limit', async () => {
    const { client, rows, urls } = receiptPager(60);
    const first = await client.searchMessages({ offset: 0, limit: 50, includeReceiptOnly: true });
    expect(first.items).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    const last = await client.searchMessages({ offset: 50, limit: 50, includeReceiptOnly: true });
    expect(last.hasMore).toBe(false);
    expect([...first.items, ...last.items].map(row => row.id)).toEqual(rows.map(row => row.id));
    expect(urls.every(url => Number(url.searchParams.get('limit')) <= 50 && url.searchParams.get('includeReceiptOnly') === 'true')).toBe(true);
  });
  it('forwards the reaction include through cursor and look-ahead requests without changing page membership', async () => {
    const { client, urls } = receiptPager(60);
    const search = { offset: 50, limit: 8, includeReceiptOnly: true };
    const plain = await client.searchMessages(search);
    urls.length = 0;
    const enriched = await client.searchMessages({ ...search, include: ['reactions'] });
    expect(enriched.items.map(row => row.id)).toEqual(plain.items.map(row => row.id));
    expect(enriched.hasMore).toBe(plain.hasMore);
    expect(urls.some(url => url.searchParams.get('limit') === '1')).toBe(true);
    expect(urls.every(url => url.searchParams.get('include') === 'reactions')).toBe(true);
  });
  it('rejects a provider capability downgrade during an ID continuation', async () => {
    const { rows } = receiptPager(60);
    let requests = 0;
    const client = new EvolutionGoClient({ baseUrl: 'https://provider.invalid', instanceToken: 'synthetic', instanceId: 'synthetic', fetcher: async () => {
      requests++;
      return Response.json({ jsonapi: { version: '1.1' }, ...(requests === 1 ? { meta: { messageSearchCursor: 'beforeId' } } : {}), data: rows.slice(0, 3) });
    } });
    const first = await client.listMessages(undefined, 2);
    await expect(client.listMessages(undefined, 2, undefined, undefined, first.nextCursor)).rejects.toMatchObject({ status: 502 });
    expect(requests).toBe(2);
  });
  it('walks the full 200-row offset window without duplicates or cursor loops', async () => {
    const { client, rows } = receiptPager(205);
    const result = await client.searchMessages({ offset: 150, limit: 50, includeReceiptOnly: true });
    expect(result.items.map(row => row.id)).toEqual(rows.slice(150, 200).map(row => row.id));
    expect(result.hasMore).toBe(true);
  });
});
