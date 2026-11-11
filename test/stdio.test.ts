import { afterEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createServer } from 'node:http';
import { cp, mkdtemp, rm, readFile, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixtureWorkspace() {
  const workspace = await mkdtemp(resolve(tmpdir(), 'wapilot-stdio-'));
  cleanup.push(() => rm(workspace, { recursive: true, force: true }));
  for (const path of ['src', 'scripts', 'migrations', 'public', 'package.json', 'tsconfig.json', 'wrangler.jsonc']) {
    await cp(resolve(path), resolve(workspace, path), { recursive: true });
  }
  await symlink(resolve('node_modules'), resolve(workspace, 'node_modules'), 'dir');
  return workspace;
}

it('serves the shared tools and resources with a persistent default connection over stdio', async () => {
  const workspace = await fixtureWorkspace();
  const state = resolve(workspace, '.wrangler/stdio');
  const requests: string[] = [];
  let reportedInstance = 'local-instance';
  let acceptedToken = 'fixture-instance-credential';
  let receivedMediaBytes = 0;
  let sends = 0;
  const upstream = createServer(async (request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.setHeader('content-type', 'application/vnd.api+json');
    if (request.headers.apikey !== acceptedToken) {
      response.writeHead(401);
      response.end(JSON.stringify({ jsonapi: { version: '1.1' }, errors: [{ status: '401', title: 'Unauthorized' }] }));
      return;
    }
    if (request.url === '/send/text' || request.url === '/send/media') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (request.url === '/send/media') receivedMediaBytes = Buffer.from(body.data.attributes.body.media.url, 'base64').byteLength;
      response.end(JSON.stringify({ jsonapi: { version: '1.1' }, data: { type: 'message', id: `local-send-${++sends}`, meta: { chat: '5511999999999' } } }));
      return;
    }
    const data = request.url === '/instance/status' ? { type: 'connection', id: reportedInstance, attributes: { connected: true } }
      : request.url?.startsWith('/user/contacts') ? [{ type: 'chat', id: '5511999999999', attributes: { name: 'Fixture contact' } }]
      : request.url?.startsWith('/group/list') ? [{ type: 'chat', id: 'fixture-group@g.us', attributes: { name: 'Fixture group' } }]
      : [{ type: 'message', id: 'fixture-message', attributes: { at: 1792058400000, encodingFormat: 'text/plain', body: { text: 'Fixture message' } }, meta: { chat: '5511999999999' } }];
    response.end(JSON.stringify({ jsonapi: { version: '1.1' }, data: request.url === '/message/status' && Array.isArray(data) ? data[0] : data }));
  });
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  cleanup.push(() => new Promise<void>((done) => upstream.close(() => done())));
  const address = upstream.address() as { port: number };
  async function open() {
    const transport = new StdioClientTransport({ command: process.execPath, args: ['scripts/dev-stdio.mjs'], cwd: workspace, stderr: 'pipe', env: {
      PATH: process.env.PATH!, EVOLUTION_BASE_URL: `http://127.0.0.1:${address.port}`,
      LOCAL_INSTANCE_ID: 'local-instance', LOCAL_INSTANCE_TOKEN: 'fixture-instance-credential',
    } });
    let stderr = '';
    transport.stderr!.on('data', (chunk) => { stderr += chunk.toString(); });
    const client = new Client({ name: 'stdio-tests', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    const errors: unknown[] = [];
    client.onerror = (error) => { errors.push(error); };
    await client.connect(transport);
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      const start = Date.now();
      await client.close();
      expect(Date.now() - start).toBeLessThan(1800);
      expect(errors.length).toBe(0);
    };
    cleanup.push(close);
    return { client, close, stderr: () => stderr };
  }
  const first = await open();
  expect(first.client.getServerCapabilities()).not.toHaveProperty('events');
  expect((await first.client.listTools()).tools.map((tool) => tool.name)).toContain('connection_status');
  const resources = await first.client.listResources();
  expect((await first.client.readResource({ uri: resources.resources[0].uri })).contents).toHaveLength(1);
  const listed = await first.client.callTool({ name: 'list_connections', arguments: {} });
  const connections = (listed.structuredContent as { data: Array<{ id: string; isDefault: number }> }).data;
  expect(connections).toHaveLength(1);
  expect(connections[0].isDefault).toBe(1);
  expect((await first.client.callTool({ name: 'connection_status', arguments: {} })).isError).not.toBe(true);
  for (const tool of [{ name: 'search_contacts', arguments: { query: 'Fixture' } }, { name: 'list_groups', arguments: {} }, { name: 'list_messages', arguments: {} }]) {
    const result = await first.client.callTool(tool);
    expect(result.isError).not.toBe(true);
    expect((result.structuredContent as { data: { items: unknown[] } }).data.items).toHaveLength(1);
  }
  const sent = await first.client.callTool({ name: 'send_message', arguments: { message: { kind: 'text', to: '5511999999999', text: 'Local fixture send' } } });
  expect(sent.isError).not.toBe(true);
  expect(sent.structuredContent).toMatchObject({ data: { messageId: 'local-send-1' } });
  const mediaArgs = { message: { kind: 'document', to: '5511999999999', mimeType: 'application/pdf', source: { kind: 'base64', dataBase64: Buffer.alloc(8 * 1024 * 1024).toString('base64') } } };
  const media = await first.client.callTool({ name: 'send_message', arguments: mediaArgs });
  expect(media.isError).not.toBe(true);
  expect(receivedMediaBytes).toBe(8 * 1024 * 1024);
  const oversized = await first.client.callTool({ name: 'send_message', arguments: { message: { ...mediaArgs.message, source: { kind: 'base64', dataBase64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') } } } });
  expect(oversized.structuredContent).toMatchObject({ data: { error: { code: 'media_too_large' } } });
  expect(first.stderr().includes('fixture-instance-credential')).toBe(false);
  await first.close();
  const keyBefore = await readFile(resolve(state, 'encryption.key'), 'utf8');
  expect(Buffer.from(keyBefore, 'base64url').byteLength).toBe(32);
  const second = await open();
  const reopened = await second.client.callTool({ name: 'list_connections', arguments: {} });
  expect((reopened.structuredContent as { data: Array<{ id: string }> }).data.map((item) => item.id)).toEqual([connections[0].id]);
  expect((await second.client.callTool({ name: 'connection_status', arguments: { connectionId: connections[0].id } })).isError).not.toBe(true);
  const history = await second.client.callTool({ name: 'list_messages', arguments: {} });
  expect((history.structuredContent as { data: { items: Array<{ id: string }> } }).data.items.map(item => item.id)).toEqual(['fixture-message']);
  for (const tool of [
    { name: 'send_message', arguments: { message: { kind: 'text', to: '5511999999999', text: 'Fixture reply', replyTo: { messageId: 'local-send-1' } } } },
    { name: 'send_message', arguments: { message: { kind: 'forward', to: '5511999999999', source: { conversationId: '5511999999999', messageId: 'fixture-message' } } } },
  ]) expect((await second.client.callTool(tool)).isError).not.toBe(true);
  await second.close();
  expect(await readFile(resolve(state, 'encryption.key'), 'utf8') === keyBefore).toBe(true);
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: resolve(workspace, 'wrangler.jsonc'), environment: 'stdio', remoteBindings: false, envFiles: [], persist: { path: resolve(state, 'bindings/v3') } });
  try {
    const row = await proxy.env.DB.prepare('SELECT encrypted_token as token FROM whatsapp_connections').first<{ token: string }>();
    expect(Boolean(row?.token && !row.token.includes('fixture-instance-credential') && row.token.includes('.'))).toBe(true);
    const audit = await proxy.env.DB.prepare("SELECT COUNT(*) as count FROM audit_log WHERE operation = 'send_message' AND outcome = 'success'").first<{ count: number }>();
    expect(audit?.count).toBe(4);
  } finally { await proxy.dispose(); }
  const restartEnv = { PATH: process.env.PATH!, EVOLUTION_BASE_URL: `http://127.0.0.1:${address.port}`, LOCAL_INSTANCE_ID: 'local-instance', LOCAL_INSTANCE_TOKEN: 'fixture-instance-credential' };
  acceptedToken = 'different-fixture-secret';
  const changed = await failedSetup({ ...restartEnv, LOCAL_INSTANCE_TOKEN: 'different-fixture-secret' }, false, workspace);
  expect(changed.code).toBe(1);
  expect(changed.stderr).toContain('credencial diverge');
  expect(changed.stderr.includes('different-fixture-secret')).toBe(false);
  acceptedToken = 'fixture-instance-credential';
  await rm(resolve(state, 'encryption.key'));
  const missing = await failedSetup(restartEnv, false, workspace);
  expect(missing.code).toBe(1);
  expect(missing.stderr).toContain('chave local está ausente');
  await expect(readFile(resolve(state, 'encryption.key'))).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(resolve(state, 'encryption.key'), Buffer.alloc(32, 7).toString('base64url'));
  const wrong = await failedSetup(restartEnv, false, workspace);
  expect(wrong.code).toBe(1);
  expect(wrong.stderr).toContain('Restaure a chave original');
  await writeFile(resolve(state, 'encryption.key'), keyBefore);
  reportedInstance = 'another-instance';
  const changedInstance = await failedSetup({ ...restartEnv, LOCAL_INSTANCE_ID: 'another-instance' }, false, workspace);
  expect(changedInstance.code).toBe(1);
  expect(changedInstance.stderr).toContain('configuração diverge');
  expect(requests.filter((request) => !request.startsWith('GET '))).toEqual(['POST /send/text', 'POST /send/media', 'POST /send/text', 'POST /send/text']);
}, 60_000);

async function failedSetup(env: Record<string, string>, endInput = false, workspace?: string) {
  workspace ??= await fixtureWorkspace();
  const child = spawn(process.execPath, ['scripts/dev-stdio.mjs'], { cwd: workspace, env: { PATH: process.env.PATH!, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (data) => { stdout += data.toString(); });
  child.stderr.on('data', (data) => { stderr += data.toString(); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  try {
    if (endInput) child.stdin.end();
    const code = await new Promise<number | null>((done) => child.on('exit', done));
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); child.stdin.destroy(); }
}

it('rejects missing credentials without printing configuration or MCP noise', async () => {
  const result = await failedSetup({ EVOLUTION_BASE_URL: 'https://provider.invalid', LOCAL_INSTANCE_ID: 'fixture-id', LOCAL_INSTANCE_TOKEN: '' });
  expect(result.code).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Informe EVOLUTION_BASE_URL');
  expect(result.stderr.includes('fixture-id')).toBe(false);
});

it.each(['unauthorized', 'mismatch', 'unavailable', 'network'] as const)('rejects %s setup without registering or reconfiguring an instance', async (failure) => {
  const workspace = await fixtureWorkspace();
  const state = resolve(workspace, '.wrangler/stdio');
  const requests: string[] = [];
  const upstream = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (failure === 'network') { request.socket.destroy(); return; }
    response.setHeader('content-type', 'application/vnd.api+json');
    response.statusCode = failure === 'unauthorized' ? 401 : failure === 'unavailable' ? 503 : 200;
    response.end(JSON.stringify(failure === 'mismatch'
      ? { jsonapi: { version: '1.1' }, data: { type: 'connection', id: 'another-instance' } }
      : { jsonapi: { version: '1.1' }, errors: [{ status: String(response.statusCode), title: 'fixture-secret' }] }));
  });
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  cleanup.push(() => new Promise<void>((done) => upstream.close(() => done())));
  const result = await failedSetup({ EVOLUTION_BASE_URL: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`, LOCAL_INSTANCE_ID: 'fixture-instance', LOCAL_INSTANCE_TOKEN: 'fixture-secret' }, false, workspace);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('WaPilot:');
  expect(result.stderr.includes('fixture-secret')).toBe(false);
  await expect(readFile(resolve(state, 'encryption.key'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(requests.every((request) => request === 'GET /instance/status')).toBe(true);
});

it('exits promptly when stdin closes during setup', async () => {
  const upstream = createServer(() => {});
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  cleanup.push(async () => { upstream.closeAllConnections(); await new Promise<void>((done) => upstream.close(() => done())); });
  const start = Date.now();
  const result = await failedSetup({ EVOLUTION_BASE_URL: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`, LOCAL_INSTANCE_ID: 'fixture-instance', LOCAL_INSTANCE_TOKEN: 'fixture-secret' }, true);
  expect(result.code).toBe(0);
  expect(result.stdout).toBe('');
  expect(Date.now() - start).toBeLessThan(2000);
});

it('cleans expired send metadata on startup and during an idle local stdio session without polling messages', async () => {
  const workspace = await fixtureWorkspace();
  const migrationPath = resolve(workspace, 'migrations/0009_drop_legacy_message_storage.sql');
  const migration = await readFile(migrationPath, 'utf8');
  await rm(migrationPath);
  const requests: string[] = [];
  const upstream = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.setHeader('content-type', 'application/vnd.api+json');
    response.end(JSON.stringify({ jsonapi: { version: '1.1' }, data: { type: 'connection', id: 'retention-instance', attributes: { connected: true } } }));
  });
  await new Promise<void>(done => upstream.listen(0, '127.0.0.1', done));
  cleanup.push(() => new Promise<void>(done => upstream.close(() => done())));
  async function open() {
    const transport = new StdioClientTransport({ command: process.execPath, args: ['scripts/dev-stdio.mjs'], cwd: workspace, stderr: 'pipe', env: {
      PATH: process.env.PATH!, EVOLUTION_BASE_URL: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`,
      LOCAL_INSTANCE_ID: 'retention-instance', LOCAL_INSTANCE_TOKEN: 'retention-credential',
    } });
    let stderr = '';
    transport.stderr!.on('data', chunk => { stderr += chunk.toString(); });
    const client = new Client({ name: 'retention-tests', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    const errors: unknown[] = [];
    client.onerror = error => { errors.push(error); };
    await client.connect(transport);
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      const start = Date.now();
      await client.close();
      expect(Date.now() - start).toBeLessThan(1800);
      expect(errors).toEqual([]);
      expect(stderr).not.toContain('retention-credential');
      expect(stderr).not.toContain('WaPilot: não foi possível limpar');
    };
    cleanup.push(close);
    return { client, close };
  }
  const { getPlatformProxy } = await import('wrangler');
  async function database<T>(run: (db: D1Database) => Promise<T>) {
    const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: resolve(workspace, 'wrangler.jsonc'), environment: 'stdio', remoteBindings: false, envFiles: [], persist: { path: resolve(workspace, '.wrangler/stdio/bindings/v3') } });
    try { return await run(proxy.env.DB); } finally { await proxy.dispose(); }
  }
  const initial = await open();
  await initial.close();
  const keyBefore = await readFile(resolve(workspace, '.wrangler/stdio/encryption.key'), 'utf8');
  const connectionBefore = await database(async db => {
    const connection = await db.prepare('SELECT * FROM whatsapp_connections').first<{ id: string; user_id: string }>();
    await db.prepare("INSERT INTO webhook_events (id,connection_id,event_name,message_json) VALUES ('legacy-hook',?,'Message','synthetic legacy webhook')").bind(connection!.id).run();
    await db.prepare("INSERT INTO outbound_messages (connection_id,message_id,encoding_format,text,sent_at) VALUES (?,'legacy-send','text/plain','synthetic legacy send',datetime('now'))").bind(connection!.id).run();
    for (const state of ['completed', 'pending', 'unknown']) await db.prepare("INSERT INTO send_operations (id,user_id,connection_id,operation,idempotency_key,arguments_hash,state,result_json,expires_at) VALUES (?,?,?,'send_text',?,'synthetic-hash',?,?,?)")
      .bind(state, connection!.user_id, connection!.id, state, state, state === 'completed' ? '{"messageId":"old-send"}' : null, Date.now() - 1000).run();
    await db.prepare("INSERT INTO send_operations (id,user_id,connection_id,operation,idempotency_key,arguments_hash,state,expires_at) VALUES ('live',?,?,'send_text','live','live-hash','pending',?)").bind(connection!.user_id, connection!.id, Date.now() + 86400000).run();
    await db.prepare("INSERT INTO audit_log (id,user_id,connection_id,operation,outcome) VALUES ('retained-audit',?,?,'send_text','success')").bind(connection!.user_id, connection!.id).run();
    return connection;
  });
  await writeFile(migrationPath, migration);
  const restarted = await open();
  expect((await restarted.client.listTools()).tools.length).toBeGreaterThan(0);
  await restarted.close();
  const expiresAt = await database(async db => {
    expect((await db.prepare('SELECT id FROM send_operations ORDER BY id').all()).results).toEqual([{ id: 'live' }]);
    expect(await db.prepare('SELECT * FROM whatsapp_connections').first()).toEqual(connectionBefore);
    expect(await db.prepare("SELECT id FROM audit_log WHERE id = 'retained-audit'").first()).toEqual({ id: 'retained-audit' });
    expect((await db.prepare("SELECT name FROM sqlite_master WHERE name IN ('webhook_events','outbound_messages')").all()).results).toEqual([]);
    const expiry = Date.now() + 20_000;
    await db.prepare("INSERT INTO send_operations (id,user_id,connection_id,operation,idempotency_key,arguments_hash,state,expires_at) VALUES ('soon',?,?,'send_text','soon','soon-hash','unknown',?)").bind(connectionBefore!.user_id, connectionBefore!.id, expiry).run();
    return expiry;
  });
  const idle = await open();
  expect(Date.now()).toBeLessThan(expiresAt);
  const count = requests.length;
  // One real minute exercises Node's production timer while no tool calls keep the process busy.
  await new Promise(resolve => setTimeout(resolve, 65_000));
  expect(requests).toHaveLength(count);
  await idle.close();
  await database(async db => {
    expect((await db.prepare('SELECT id FROM send_operations ORDER BY id').all()).results).toEqual([{ id: 'live' }]);
    expect(await db.prepare('SELECT * FROM whatsapp_connections').first()).toEqual(connectionBefore);
  });
  expect(await readFile(resolve(workspace, '.wrangler/stdio/encryption.key'), 'utf8')).toBe(keyBefore);
  expect(requests.every(request => request === 'GET /instance/status')).toBe(true);
}, 100_000);
