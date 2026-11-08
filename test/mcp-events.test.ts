import { afterAll, beforeAll, expect, it } from 'vitest';
import { decryptToken } from '../src/lib/crypto';
import { createHmac } from 'node:crypto';
import { eventRuntime } from './helpers/mcp-events-runtime';

const secret = 'whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const callback = 'https://receiver.example.test/callback';
let mode: 'valid'|'invalid'|'truncated'|'redirect'|'blocked'|'timeout'|'malformed' = 'valid';
let blocked: (()=>void)|undefined;
let entered: (()=>void)|undefined;
const requests: {url:string;body:string;headers:Record<string,string>}[] = [];
let fixture: Awaited<ReturnType<typeof eventRuntime>>;
let account: Awaited<ReturnType<typeof fixture.issue>>;
beforeAll(async () => {
  fixture = await eventRuntime(async request => {
    const input = await request.json() as {url:string;body:string;headers:Record<string,string>};
    requests.push(input);
    if (entered) { const notify = entered; entered = undefined; notify(); await new Promise<void>(resolve => { blocked = resolve; }); }
    if (mode === 'invalid') return Response.json({status:200,body:JSON.stringify({challenge:'wrong'})});
    if (mode === 'truncated') return Response.json({status:200,body:JSON.stringify({challenge:JSON.parse(input.body).challenge}),bodyTruncated:true});
    if (mode === 'redirect') return Response.json({status:302,body:''});
    if (mode === 'blocked') return Response.json({error:'destination_blocked'},{status:400});
    if (mode === 'timeout') return Response.json({error:'callback_timeout'},{status:504});
    if (mode === 'malformed') return Response.json({status:200,body:'<html>no challenge</html>'});
    return Response.json({status:200,body:JSON.stringify({challenge:JSON.parse(input.body).challenge})});
  });
  account = await fixture.issue();
});
afterAll(async () => { await fixture?.runtime.dispose(); });

it('discovers message.received through authenticated stateless MCP on the pinned SDK', async () => {
  const discovery = await fixture.rpc(account.accessToken,'server/discover');
  expect(discovery.response.status).toBe(200);
  expect(discovery.body.result).toMatchObject({supportedVersions:['2026-07-28'],capabilities:{events:{}}});
  expect(discovery.response.headers.get('Mcp-Session-Id')).toBeNull();
  const catalog = await fixture.rpc(account.accessToken,'events/list');
  expect(catalog.body.result.events).toMatchObject([{name:'message.received',delivery:['webhook']}]);
  expect((await fixture.fetch('/mcp',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':'fake'}})).status).toBe(401);
});

function subscription(arguments_:Record<string,unknown> = {}, url = callback) {
  return {name:'message.received',arguments:arguments_,delivery:{mode:'webhook',url,secret},cursor:null};
}

it('verifies a signed callback and persists a finite grant-owned subscription without bearer or plaintext secrets', async () => {
  const before = Date.now();
  const result = await fixture.rpc(account.accessToken,'events/subscribe',subscription());
  expect(result.body.result).toMatchObject({id:expect.stringMatching(/^sub_/),cursor:null,truncated:false});
  expect(Date.parse(result.body.result.refreshBefore)).toBeGreaterThanOrEqual(before+7*86400000);
  expect(Date.parse(result.body.result.refreshBefore)).toBeLessThanOrEqual(Date.now()+7*86400000);
  const request = requests.at(-1)!;
  expect(JSON.parse(request.body)).toMatchObject({type:'verification',challenge:expect.any(String)});
  const signed = `${request.headers['webhook-id']}.${request.headers['webhook-timestamp']}.${request.body}`;
  expect(request.headers['webhook-signature']).toBe('v1,'+createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(signed).digest('base64'));
  expect(request.headers['X-MCP-Subscription-Id']).toBe(result.body.result.id);
  expect(Object.keys(request.headers).map(key=>key.toLowerCase()).sort()).toEqual(['content-type','webhook-id','webhook-signature','webhook-timestamp','x-mcp-subscription-id']);
  expect(Number(request.headers['webhook-timestamp'])*1000).toBeGreaterThanOrEqual(before-1000);
  const row = await fixture.db.prepare('SELECT * FROM event_subscriptions WHERE id = ?').bind(result.body.result.id).first();
  expect(row).toMatchObject({user_id:account.userId,grant_id:account.grantId,client_id:account.clientId,connection_id:account.connections[0],state:'active'});
  expect(JSON.stringify(row)).not.toContain(secret);
  expect(JSON.stringify(row)).not.toContain(account.accessToken);
});

it('renews one canonical subscription concurrently and keeps its original default connection', async () => {
  const args = {conversationId:'  conversation-a  '};
  const first = await fixture.rpc(account.accessToken,'events/subscribe',subscription(args));
  expect(first.body.result).toBeDefined();
  await fixture.db.batch([
    fixture.db.prepare('UPDATE whatsapp_connections SET is_default = 0 WHERE user_id = ?').bind(account.userId),
    fixture.db.prepare('UPDATE whatsapp_connections SET is_default = 1 WHERE id = ?').bind(account.connections[1]),
  ]);
  const refreshed = await Promise.all(Array.from({length:6},()=>fixture.rpc(account.accessToken,'events/subscribe',{...subscription({conversationId:'conversation-a'}),ttlMs:60000})));
  expect(refreshed.map(r=>r.body.result?.id)).toEqual(Array(6).fill(first.body.result.id));
  const rows = await fixture.db.prepare('SELECT connection_id, expires_at FROM event_subscriptions WHERE id = ?').bind(first.body.result.id).all();
  expect(rows.results).toHaveLength(1);
  expect(rows.results[0]).toMatchObject({connection_id:account.connections[0]});
  expect(Number(rows.results[0].expires_at)).toBeLessThanOrEqual(Date.now()+60000);
  const cancelled = await fixture.rpc(account.accessToken,'events/unsubscribe',{name:'message.received',arguments:{conversationId:'conversation-a'},delivery:{mode:'webhook',url:callback}});
  expect(cancelled.body.result).toMatchObject({resultType:'complete'});
  expect((await fixture.db.prepare('SELECT state FROM event_subscriptions WHERE id = ?').bind(first.body.result.id).first())?.state).toBe('cancelled');
});

it.each(['invalid','truncated','redirect','malformed'] as const)('does not activate a callback with a %s challenge response', async invalid => {
  mode = invalid;
  const response = await fixture.rpc(account.accessToken,'events/subscribe',subscription({},callback+'/'+invalid));
  mode = 'valid';
  expect(response.body.error).toMatchObject({code:-32015,data:{reason:'challenge_failed'}});
  const row = await fixture.db.prepare('SELECT state, encrypted_secret FROM event_subscriptions WHERE callback_url = ?').bind(callback+'/'+invalid).first();
  expect(row).toMatchObject({state:'pending',encrypted_secret:null});
});

it('does not reactivate a subscription when cancellation wins an outstanding challenge', async () => {
  const url = callback+'/cancel-race', input = subscription({},url);
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const pending = fixture.rpc(account.accessToken,'events/subscribe',input);
  await reached;
  const cancel = {name:input.name,arguments:input.arguments,delivery:{mode:'webhook',url}};
  expect((await fixture.rpc(account.accessToken,'events/unsubscribe',cancel)).body.result).toMatchObject({resultType:'complete'});
  expect((await fixture.rpc(account.accessToken,'events/unsubscribe',cancel)).body.result).toMatchObject({resultType:'complete'});
  blocked!(); blocked = undefined;
  expect((await pending).body.error).toMatchObject({code:-32015,data:{reason:'superseded'}});
  expect((await fixture.db.prepare('SELECT state, encrypted_secret FROM event_subscriptions WHERE callback_url = ?').bind(url).first())).toMatchObject({state:'cancelled',encrypted_secret:null});
});

it('refuses activation if access is disabled while a valid callback challenge is outstanding', async () => {
  const url = callback+'/disabled-race';
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const pending = fixture.rpc(account.accessToken,'events/subscribe',subscription({},url));
  await reached;
  await fixture.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind(account.userId).run();
  blocked!(); blocked = undefined;
  const result = await pending;
  await fixture.db.prepare("UPDATE users SET status = 'active' WHERE id = ?").bind(account.userId).run();
  expect(result.body.error).toMatchObject({code:-32003});
  expect((await fixture.db.prepare('SELECT state, encrypted_secret FROM event_subscriptions WHERE callback_url = ?').bind(url).first())).toMatchObject({state:'pending',encrypted_secret:null});
});

it('keeps exactly two encrypted keys for a fixed rotation window and never extends that window on same-key refresh', async () => {
  const url = callback+'/rotation', input = subscription({},url);
  const first = await fixture.rpc(account.accessToken,'events/subscribe',input);
  const replacement = 'whsec_AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  expect((await fixture.rpc(account.accessToken,'events/subscribe',{...input,delivery:{...input.delivery,secret:replacement}})).body.result.id).toBe(first.body.result.id);
  const rotated = await fixture.db.prepare('SELECT encrypted_previous_secret, previous_secret_until FROM event_subscriptions WHERE id = ?').bind(first.body.result.id).first();
  expect(rotated?.encrypted_previous_secret).toEqual(expect.any(String));
  expect(Number(rotated?.previous_secret_until)).toBeLessThanOrEqual(Date.now()+300000);
  await fixture.rpc(account.accessToken,'events/subscribe',{...input,delivery:{...input.delivery,secret:replacement}});
  expect((await fixture.db.prepare('SELECT previous_secret_until FROM event_subscriptions WHERE id = ?').bind(first.body.result.id).first())?.previous_secret_until).toBe(rotated?.previous_secret_until);
  await fixture.db.prepare('UPDATE event_subscriptions SET previous_secret_until = 1 WHERE id = ?').bind(first.body.result.id).run();
  await fixture.rpc(account.accessToken,'events/subscribe',{...input,delivery:{...input.delivery,secret:replacement}});
  expect(await fixture.db.prepare('SELECT encrypted_previous_secret, previous_secret_until FROM event_subscriptions WHERE id = ?').bind(first.body.result.id).first()).toMatchObject({encrypted_previous_secret:null,previous_secret_until:null});
});

it.each([undefined,null,30*86400000,10000])('grants a finite bounded lifetime for ttlMs %s', async ttlMs => {
  const before = Date.now(), requested = ttlMs === 10000 ? 10000 : 7*86400000;
  const result = await fixture.rpc(account.accessToken,'events/subscribe',{...subscription({},callback+'/ttl-'+String(ttlMs)),...(ttlMs !== undefined ? {ttlMs}: {})});
  expect(Date.parse(result.body.result.refreshBefore)).toBeGreaterThanOrEqual(before+requested);
  expect(Date.parse(result.body.result.refreshBefore)).toBeLessThanOrEqual(Date.now()+requested);
});

it('bounds callback verification cache by principal and URL without sliding its lifetime', async () => {
  const url = callback+'/cache', input = subscription({},url);
  await fixture.rpc(account.accessToken,'events/subscribe',input);
  const verified = await fixture.db.prepare('SELECT verified_until FROM event_subscriptions WHERE callback_url = ?').bind(url).first();
  const before = requests.length;
  await fixture.rpc(account.accessToken,'events/subscribe',subscription({conversationId:'cache-conversation'},url));
  expect(requests).toHaveLength(before);
  const times = await fixture.db.prepare('SELECT verified_until FROM event_subscriptions WHERE callback_url = ?').bind(url).all();
  expect(times.results.map(r=>r.verified_until)).toEqual([verified?.verified_until,verified?.verified_until]);
  const otherGrant = await fixture.issue({clientId:account.clientId});
  await fixture.rpc(otherGrant.accessToken,'events/subscribe',input);
  expect(requests).toHaveLength(before+1);
  await fixture.db.prepare('UPDATE event_subscriptions SET verified_until = 1 WHERE callback_url = ?').bind(url).run();
  await fixture.rpc(account.accessToken,'events/subscribe',input);
  expect(requests).toHaveLength(before+2);
  expect(JSON.parse(requests.at(-1)!.body).challenge).not.toBe(JSON.parse(requests.at(-2)!.body).challenge);
});

it('isolates accounts, grants and fixed connections, including idempotent unsubscribe', async () => {
  const input = subscription({connectionId:account.connections[0]},callback+'/isolation');
  const a = await fixture.rpc(account.accessToken,'events/subscribe',input);
  const otherGrant = await fixture.issue({clientId:account.clientId});
  const otherAccount = await fixture.issue({email:'fixture-b@example.test'});
  const a2 = await fixture.rpc(otherGrant.accessToken,'events/subscribe',input);
  expect(a2.body.result.id).not.toBe(a.body.result.id);
  expect((await fixture.rpc(otherAccount.accessToken,'events/subscribe',input)).body.error).toMatchObject({code:-32602});
  const cancel = {name:input.name,arguments:input.arguments,delivery:{mode:'webhook',url:input.delivery.url}};
  await fixture.rpc(otherAccount.accessToken,'events/unsubscribe',cancel);
  await fixture.rpc(otherGrant.accessToken,'events/unsubscribe',cancel);
  expect((await fixture.db.prepare('SELECT state FROM event_subscriptions WHERE id = ?').bind(a.body.result.id).first())?.state).toBe('active');
  expect((await fixture.db.prepare('SELECT state FROM event_subscriptions WHERE id = ?').bind(a2.body.result.id).first())?.state).toBe('cancelled');
});

it('stops a grant locally before Provider revocation without affecting another grant', async () => {
  const one = await fixture.issue(), two = await fixture.issue({clientId:one.clientId});
  const input = subscription({},callback+'/local-revoke');
  const first = await fixture.rpc(one.accessToken,'events/subscribe',input);
  const second = await fixture.rpc(two.accessToken,'events/subscribe',input);
  const response = await fixture.fetch('/connections/authorizations/'+one.grantId+'/revoke',{method:'POST'});
  expect(response.status).toBe(200);
  expect(await fixture.db.prepare('SELECT state, encrypted_secret FROM event_subscriptions WHERE id = ?').bind(first.body.result.id).first()).toMatchObject({state:'revoked',encrypted_secret:null});
  expect((await fixture.db.prepare('SELECT state FROM event_subscriptions WHERE id = ?').bind(second.body.result.id).first())?.state).toBe('active');
  expect((await fixture.rpc(one.accessToken,'events/subscribe',input)).response.status).toBe(401);
});

it('refuses activation after external Provider revocation races a valid challenge', async () => {
  const grant = await fixture.issue();
  const url = callback+'/external-revoke';
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const pending = fixture.rpc(grant.accessToken,'events/subscribe',subscription({},url));
  await reached;
  await fixture.fetch('/fixture/revoke?'+new URLSearchParams({grantId:grant.grantId,providerUserId:'fixture-a%40example.test'}));
  blocked!(); blocked = undefined;
  expect((await pending).body.error).toMatchObject({code:-32003});
  expect((await fixture.db.prepare('SELECT state, encrypted_secret FROM event_subscriptions WHERE callback_url = ?').bind(url).first())).toMatchObject({state:'pending',encrypted_secret:null});
});

it('requires read scope and rejects invalid event filters, callbacks, secrets and replay cursors', async () => {
  const readless = await fixture.issue({scope:'mcp:write'});
  expect((await fixture.rpc(readless.accessToken,'events/list')).body.error).toMatchObject({code:-32003});
  const input = subscription();
  const invalid = [
    {...input,name:'message.sent'}, {...input,arguments:{connectionId:'unknown'}}, {...input,arguments:{conversationId:'  '}},
    {...input,arguments:{other:'field'}}, {...input,delivery:{...input.delivery,url:'http://receiver.example.test'}},
    {...input,delivery:{...input.delivery,url:'https://user:password@receiver.example.test'}},
    {...input,delivery:{...input.delivery,secret:'whsec_YWJj'}}, {...input,cursor:'replay'}, {...input,ttlMs:0},
  ];
  for (const params of invalid) expect((await fixture.rpc(account.accessToken,'events/subscribe',params)).body.error).toMatchObject({code:-32602});
});

it('keeps discovery product-facing and rejects legacy transport requests', async () => {
  const metadata = await (await fixture.fetch('/.well-known/oauth-protected-resource/mcp')).json() as any;
  expect(metadata.resource_name).toBe('WaPilot');
  const legacy = await fixture.fetch('/mcp',{method:'POST',headers:{authorization:'Bearer '+account.accessToken,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'old',version:'1'}}})});
  expect(legacy.status).toBe(400);
});

it('fails closed with a sanitized error when public Provider grant enumeration is unavailable', async () => {
  const response = await fixture.rpc(account.accessToken,'events/subscribe',subscription({},callback+'/provider-failure'),{'x-fixture-provider-failure':'1'});
  expect(response.body.error).toMatchObject({code:-32603,message:'WaPilot could not complete the event request.'});
  expect(JSON.stringify(response.body)).not.toMatch(/do-not-return|private fixture payload|token=/);
  expect((await fixture.db.prepare('SELECT COUNT(*) AS count FROM event_subscriptions WHERE callback_url = ?').bind(callback+'/provider-failure').first())?.count).toBe(0);
});

it('does not let a late stale rotation overwrite a newer secret', async () => {
  const url = callback+'/rotation-race', input = subscription({},url);
  const first = await fixture.rpc(account.accessToken,'events/subscribe',input);
  await fixture.db.prepare('UPDATE event_subscriptions SET verified_until = 1 WHERE id = ?').bind(first.body.result.id).run();
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const secretB = 'whsec_AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const secretC = 'whsec_AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=';
  const pending = fixture.rpc(account.accessToken,'events/subscribe',{...input,delivery:{...input.delivery,secret:secretB}});
  await reached;
  const newest = await fixture.rpc(account.accessToken,'events/subscribe',{...input,delivery:{...input.delivery,secret:secretC}});
  expect(newest.body.result.id).toBe(first.body.result.id);
  blocked!(); blocked = undefined;
  expect((await pending).body.error).toMatchObject({code:-32015,data:{reason:'superseded'}});
  const snapshot = await fixture.db.prepare('SELECT encrypted_secret, previous_secret_until FROM event_subscriptions WHERE id = ?').bind(first.body.result.id).first();
  expect(await decryptToken(String(snapshot?.encrypted_secret),'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(secretC);
  await fixture.rpc(account.accessToken,'events/subscribe',{...input,delivery:{...input.delivery,secret:secretC}});
  expect((await fixture.db.prepare('SELECT previous_secret_until FROM event_subscriptions WHERE id = ?').bind(first.body.result.id).first())?.previous_secret_until).toBe(snapshot?.previous_secret_until);
});

it('reactivates an expired subscription on its fixed connection without reviving expired signing keys', async () => {
  const url = callback+'/expired', input = subscription({},url);
  const first = await fixture.rpc(account.accessToken,'events/subscribe',input);
  const initial = await fixture.db.prepare('SELECT connection_id FROM event_subscriptions WHERE id = ?').bind(first.body.result.id).first();
  await fixture.db.prepare('UPDATE event_subscriptions SET expires_at = 1, activated_at = 1 WHERE id = ?').bind(first.body.result.id).run();
  const before = Date.now();
  const replacement = 'whsec_AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
  const refreshed = await fixture.rpc(account.accessToken,'events/subscribe',{...input,delivery:{...input.delivery,secret:replacement}});
  expect(refreshed.body.result.id).toBe(first.body.result.id);
  expect(await fixture.db.prepare('SELECT connection_id, activated_at, encrypted_previous_secret FROM event_subscriptions WHERE id = ?').bind(first.body.result.id).first()).toMatchObject({connection_id:initial?.connection_id,activated_at:expect.any(Number),encrypted_previous_secret:null});
  expect(Number((await fixture.db.prepare('SELECT activated_at FROM event_subscriptions WHERE id = ?').bind(first.body.result.id).first())?.activated_at)).toBeGreaterThanOrEqual(before);
});

it('preserves subscription identity when the OAuth access token refreshes within the same grant', async () => {
  const grant = await fixture.issue({scope:'mcp:read offline_access'});
  const input = subscription({},callback+'/token-refresh');
  const first = await fixture.rpc(grant.accessToken,'events/subscribe',input);
  const tokenResponse = await fixture.fetch('/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',refresh_token:grant.refreshToken,client_id:grant.clientId,resource:'https://mcp.invalid/mcp'})});
  expect(tokenResponse.status).toBe(200);
  const token = await tokenResponse.json() as {access_token:string};
  expect((await fixture.rpc(token.access_token,'events/subscribe',input)).body.result.id).toBe(first.body.result.id);
});

it('finds the authorization beyond the first public Provider grant page', async () => {
  const email = 'pagination@example.test';
  const grants = [await fixture.issue({email})];
  for (let i=0; i<100; i++) grants.push(await fixture.issue({email,clientId:grants[0].clientId}));
  const first = await (await fixture.fetch('/fixture/grants?'+new URLSearchParams({user:encodeURIComponent(email)}))).json() as {items:{id:string}[];cursor:string};
  expect(first.items).toHaveLength(100);
  const second = await (await fixture.fetch('/fixture/grants?'+new URLSearchParams({user:encodeURIComponent(email),cursor:first.cursor}))).json() as {items:{id:string}[]};
  const last = grants.find(g=>g.grantId === second.items[0].id)!;
  expect((await fixture.rpc(last.accessToken,'events/subscribe',subscription({},callback+'/pagination'))).body.result).toMatchObject({id:expect.stringMatching(/^sub_/)});
},20000);

it('converges concurrent first registrations with equivalent original arguments to a single D1 subscription', async () => {
  const url = callback+'/concurrent-create';
  const args = {connectionId:account.connections[0],conversationId:'canonical'};
  const reversed = {conversationId:'canonical',connectionId:account.connections[0]};
  const results = await Promise.all([args,reversed,args,reversed].map(arguments_=>fixture.rpc(account.accessToken,'events/subscribe',subscription(arguments_,url))));
  expect(results.every(r=>r.body.result?.id === results[0].body.result?.id && !!r.body.result)).toBe(true);
  expect((await fixture.db.prepare('SELECT COUNT(*) AS count FROM event_subscriptions WHERE callback_url = ?').bind(url).first())?.count).toBe(1);
});

it.each([['blocked','destination_blocked'],['timeout','timeout']] as const)('returns a safe callback reason for %s sender responses', async (failure, reason) => {
  mode = failure;
  const result = await fixture.rpc(account.accessToken,'events/subscribe',subscription({},callback+'/'+failure));
  mode = 'valid';
  expect(result.body.error).toMatchObject({code:-32015,data:{reason}});
});

it('cleans expired secrets immediately and metadata only after their bounded retention', async () => {
  const input = subscription({},callback+'/cleanup');
  const registered = await fixture.rpc(account.accessToken,'events/subscribe',input);
  await fixture.rpc(account.accessToken,'events/unsubscribe',{name:input.name,arguments:input.arguments,delivery:{mode:'webhook',url:input.delivery.url}});
  const ended = await fixture.db.prepare('SELECT expires_at FROM event_subscriptions WHERE id = ?').bind(registered.body.result.id).first();
  const now = Number(ended?.expires_at);
  expect((await fixture.scheduled(now+86400000-1)).outcome).toBe('ok');
  expect(await fixture.db.prepare('SELECT encrypted_secret FROM event_subscriptions WHERE id = ?').bind(registered.body.result.id).first()).toMatchObject({encrypted_secret:null});
  expect(await fixture.db.prepare('SELECT encrypted_secret FROM event_subscriptions WHERE callback_url = ?').bind(callback+'/ttl-10000').first()).toMatchObject({encrypted_secret:null});
  expect((await fixture.scheduled(now+86400000)).outcome).toBe('ok');
  expect(await fixture.db.prepare('SELECT id FROM event_subscriptions WHERE id = ?').bind(registered.body.result.id).first()).toBeNull();
  const control = await fixture.db.prepare('SELECT user_id,grant_id,expires_at FROM event_grant_revocations LIMIT 1').first();
  expect(control).not.toBeNull();
  expect((await fixture.scheduled(Number(control?.expires_at))).outcome).toBe('ok');
  expect(await fixture.db.prepare('SELECT grant_id FROM event_grant_revocations WHERE grant_id = ?').bind(control?.grant_id).first()).toBeNull();
});

it('redacts actual D1 failures at the authenticated events boundary', async () => {
  await fixture.db.prepare('DROP TABLE event_grant_revocations').run();
  const result = await fixture.rpc(account.accessToken,'events/list');
  expect(result.body.error).toMatchObject({code:-32603,message:'WaPilot could not complete the event request.'});
  expect(JSON.stringify(result.body)).not.toMatch(/D1_ERROR|SQLITE|no such table|event_grant_revocations/);
});
