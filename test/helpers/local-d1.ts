import { readdir, readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

/** Real, isolated D1 binding; migrations never contact a remote database. */
export async function createTestD1() {
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-10-13',
    script: 'export default { fetch() { return new Response(); } };',
    d1Databases: { DB: 'test' },
  }));
  try {
    const db = await runtime.getD1Database('DB');
    for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql')).sort()) {
      await db.batch(unstable_splitSqlQuery(await readFile(`migrations/${file}`, 'utf8')).map(sql => db.prepare(sql)));
    }
    return { db, dispose: () => runtime.dispose() };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}
