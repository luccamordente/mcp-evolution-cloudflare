import { afterAll, beforeAll, expect, it } from 'vitest';
import { eventRuntime } from './helpers/mcp-events-runtime';

let fixture: Awaited<ReturnType<typeof eventRuntime>>;
let account: Awaited<ReturnType<typeof fixture.issue>>;
beforeAll(async () => {
  fixture = await eventRuntime(async () => Response.json({ jsonapi: { version: '1.1' }, data: [] }));
  account = await fixture.issue();
});
afterAll(async () => { await fixture?.runtime.dispose(); });

it.each(['2025-03-26', '2025-06-18', '2025-11-25'])('accepts a %s client without modern headers or metadata', async protocolVersion => {
  const post = (body: unknown, version?: string) => fixture.fetch('/mcp', {
    method: 'POST', headers: { authorization: `Bearer ${account.accessToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(version ? {'MCP-Protocol-Version': version} : {}) }, body: JSON.stringify(body),
  });
  const initialized = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: {name:'compatibility-test',version:'1'} } });
  expect(initialized.status).toBe(200);
  expect(initialized.headers.get('content-type')).toContain('application/json');
  expect((await initialized.json() as {result:{protocolVersion:string}}).result.protocolVersion).toBe(protocolVersion);
  const listed = await post({jsonrpc:'2.0',id:2,method:'tools/list',params:{}}, protocolVersion);
  expect(listed.status).toBe(200);
  expect(listed.headers.get('Mcp-Session-Id')).toBeNull();
  expect((await listed.json() as {result:{tools:{name:string}[]}}).result.tools.some(tool=>tool.name==='list_connections')).toBe(true);
  const called = await post({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'list_connections',arguments:{}}}, protocolVersion);
  expect(called.status).toBe(200);
  expect((await called.json() as {result:{isError?:boolean}}).result.isError).not.toBe(true);
});

it('keeps modern validation strict and session endpoints unavailable', async () => {
  const response = await fixture.fetch('/mcp', {method:'POST',headers:{authorization:`Bearer ${account.accessToken}`,'content-type':'application/json',accept:'application/json','MCP-Protocol-Version':'2026-07-28'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  expect(response.status).toBe(400);
  for (const method of ['GET','DELETE']) expect((await fixture.fetch('/mcp',{method,headers:{authorization:`Bearer ${account.accessToken}`}})).status).toBe(405);
  expect((await fixture.fetch('/mcp',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':'fake'}})).status).toBe(401);
});

it('logs protocol diagnostics without tokens or request payloads', async () => {
  await fixture.rpc(account.accessToken,'server/discover');
  const logs = fixture.logs.filter(line=>line.includes('mcp_http'));
  expect(logs.length).toBeGreaterThan(0);
  expect(logs.join(' ')).toContain('protocolVersion');
  expect(logs.join(' ')).toContain('missingHeaders');
  expect(logs.join(' ')).not.toContain(account.accessToken);
});

it('applies OAuth write scope checks to legacy calls', async () => {
  const result = await fixture.fetch('/mcp',{method:'POST',headers:{authorization:`Bearer ${account.accessToken}`,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'send_text',arguments:{to:'5511999999999',text:'must not send'}}})});
  expect(result.status).toBe(403);
  expect(result.headers.get('www-authenticate')).toContain('insufficient_scope');
});
