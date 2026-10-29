import { afterEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

it('serves the shared tools and resources with a persistent default connection over stdio', async () => {
  const state = await mkdtemp(resolve(tmpdir(), 'wapilot-stdio-'));
  cleanup.push(() => rm(state, { recursive: true, force: true }));
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
    response.end(JSON.stringify({ jsonapi: { version: '1.1' }, data }));
  });
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  cleanup.push(() => new Promise<void>((done) => upstream.close(() => done())));
  const address = upstream.address() as { port: number };
  async function open() {
    const transport = new StdioClientTransport({ command: process.execPath, args: ['scripts/dev-stdio.mjs'], cwd: resolve('.'), stderr: 'pipe', env: {
      PATH: process.env.PATH!, WAPILOT_STDIO_STATE_DIR: state, EVOLUTION_BASE_URL: `http://127.0.0.1:${address.port}`,
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
  const sent = await first.client.callTool({ name: 'send_text', arguments: { to: '5511999999999', text: 'Local fixture send' } });
  expect(sent.isError).not.toBe(true);
  expect(sent.structuredContent).toMatchObject({ data: { messageId: 'local-send-1' } });
  const mediaArgs = { to: '5511999999999', mimeType: 'application/pdf', dataBase64: Buffer.alloc(8 * 1024 * 1024).toString('base64') };
  const media = await first.client.callTool({ name: 'send_media', arguments: mediaArgs });
  expect(media.isError).not.toBe(true);
  expect(receivedMediaBytes).toBe(8 * 1024 * 1024);
  const oversized = await first.client.callTool({ name: 'send_media', arguments: { ...mediaArgs, dataBase64: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') } });
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
  expect((history.structuredContent as { data: { items: Array<{ id: string; text?: string }> } }).data.items).toContainEqual(expect.objectContaining({ id: 'local-send-1', text: 'Local fixture send' }));
  for (const tool of [
    { name: 'reply_to_message', arguments: { to: '5511999999999', text: 'Fixture reply', messageId: 'local-send-1' } },
    { name: 'forward_message', arguments: { to: '5511999999999', conversationId: '5511999999999', messageId: 'local-send-1' } },
  ]) expect((await second.client.callTool(tool)).isError).not.toBe(true);
  await second.close();
  expect(await readFile(resolve(state, 'encryption.key'), 'utf8') === keyBefore).toBe(true);
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: resolve('wrangler.jsonc'), environment: 'stdio', remoteBindings: false, envFiles: [], persist: { path: resolve(state, 'bindings/v3') } });
  try {
    const row = await proxy.env.DB.prepare('SELECT encrypted_token as token FROM whatsapp_connections').first<{ token: string }>();
    expect(Boolean(row?.token && !row.token.includes('fixture-instance-credential') && row.token.includes('.'))).toBe(true);
    const audit = await proxy.env.DB.prepare("SELECT COUNT(*) as count FROM audit_log WHERE operation = 'send_text' AND outcome = 'success'").first<{ count: number }>();
    expect(audit?.count).toBe(1);
  } finally { await proxy.dispose(); }
  const restartEnv = { PATH: process.env.PATH!, WAPILOT_STDIO_STATE_DIR: state, EVOLUTION_BASE_URL: `http://127.0.0.1:${address.port}`, LOCAL_INSTANCE_ID: 'local-instance', LOCAL_INSTANCE_TOKEN: 'fixture-instance-credential' };
  acceptedToken = 'different-fixture-secret';
  const changed = await failedSetup({ ...restartEnv, LOCAL_INSTANCE_TOKEN: 'different-fixture-secret' });
  expect(changed.code).toBe(1);
  expect(changed.stderr).toContain('credencial diverge');
  expect(changed.stderr.includes('different-fixture-secret')).toBe(false);
  acceptedToken = 'fixture-instance-credential';
  await rm(resolve(state, 'encryption.key'));
  const missing = await failedSetup(restartEnv);
  expect(missing.code).toBe(1);
  expect(missing.stderr).toContain('chave local está ausente');
  await expect(readFile(resolve(state, 'encryption.key'))).rejects.toMatchObject({ code: 'ENOENT' });
  await writeFile(resolve(state, 'encryption.key'), Buffer.alloc(32, 7).toString('base64url'));
  const wrong = await failedSetup(restartEnv);
  expect(wrong.code).toBe(1);
  expect(wrong.stderr).toContain('Restaure a chave original');
  await writeFile(resolve(state, 'encryption.key'), keyBefore);
  reportedInstance = 'another-instance';
  const changedInstance = await failedSetup({ ...restartEnv, LOCAL_INSTANCE_ID: 'another-instance' });
  expect(changedInstance.code).toBe(1);
  expect(changedInstance.stderr).toContain('configuração diverge');
  expect(requests.filter((request) => !request.startsWith('GET '))).toEqual(['POST /send/text', 'POST /send/media', 'POST /send/text', 'POST /send/text']);
}, 60_000);

async function failedSetup(env: Record<string, string>, endInput = false) {
  const child = spawn(process.execPath, ['scripts/dev-stdio.mjs'], { cwd: resolve('.'), env: { PATH: process.env.PATH!, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
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
  const state = await mkdtemp(resolve(tmpdir(), 'wapilot-stdio-invalid-'));
  cleanup.push(() => rm(state, { recursive: true, force: true }));
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
  const result = await failedSetup({ WAPILOT_STDIO_STATE_DIR: state, EVOLUTION_BASE_URL: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`, LOCAL_INSTANCE_ID: 'fixture-instance', LOCAL_INSTANCE_TOKEN: 'fixture-secret' });
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
