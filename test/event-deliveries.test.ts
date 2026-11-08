import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { eventRuntime } from './helpers/mcp-events-runtime';

const secret = 'whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const requests: {url:string;body:string;headers:Record<string,string>}[] = [];
let fixture: Awaited<ReturnType<typeof eventRuntime>>;
let account: Awaited<ReturnType<typeof fixture.issue>>;
let hook: Awaited<ReturnType<typeof fixture.webhook>>;
let retryStatus=202;
let deliveryEntered:(()=>void)|undefined, releaseDelivery:(()=>void)|undefined;
function subscription(connectionId:string, conversationId?:string, suffix='one') {
  return {name:'message.received',arguments:{connectionId,...(conversationId ? {conversationId} : {})},delivery:{mode:'webhook',url:'https://receiver.example.test/'+suffix,secret}};
}
function message(id:string, text='Olá, mundo 🌎', at=Date.now()) {
  return {jsonapi:{version:'1.1'},meta:{event:'Message',instanceId:hook.instanceId,instanceToken:'never-store'},data:{type:'message',id,attributes:{at,encodingFormat:'text/plain',body:{text}},relationships:{author:{data:{type:'chat',id:'5511'}}},meta:{chat:'chat-a',fromMe:false}}};
}
async function ingress(payload:unknown) { return fixture.fetch(hook.path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}); }
async function drain() { const jobs=fixture.published.splice(0); await fixture.queue(jobs); return jobs; }
beforeAll(async()=>{
  fixture=await eventRuntime(async request=>{
    const input=await request.json() as typeof requests[number];
    if (JSON.parse(input.body).type !== 'verification') {
      requests.push(input);
      if (deliveryEntered) { const notify=deliveryEntered;deliveryEntered=undefined;notify();await new Promise<void>(resolve=>{releaseDelivery=resolve;}); }
    }
    return Response.json({status:JSON.parse(input.body).type === 'verification' ? 202 : retryStatus,body:JSON.stringify({challenge:JSON.parse(input.body).challenge})});
  });
  account=await fixture.issue(); hook=await fixture.webhook(account.connections[0]);
});
afterAll(async()=>{await fixture?.runtime.dispose();});
it('delivers one signed event through the validated webhook and native queue handler, then clears its content',async()=>{
  const sub=await fixture.rpc(account.accessToken,'events/subscribe',subscription(account.connections[0]));
  const payload=message('first');
  expect((await ingress(payload)).status).toBe(202);
  const jobs=await drain();
  expect(jobs).toEqual([expect.any(String)]);
  expect(requests).toHaveLength(1);
  const request=requests[0],event=JSON.parse(request.body);
  expect(event).toEqual({eventId:expect.stringMatching(/^evt_/),name:'message.received',timestamp:new Date(payload.data.attributes.at).toISOString(),data:{connectionId:account.connections[0],conversationId:'chat-a',messageId:'first',author:'5511',timestamp:new Date(payload.data.attributes.at).toISOString(),type:'text/plain',preview:'Olá, mundo 🌎',previewTruncated:false},cursor:null});
  expect(request.headers['webhook-id']).toBe(event.eventId);
  expect(request.headers['X-MCP-Subscription-Id']).toBe(sub.body.result.id);
  expect(request.headers['webhook-signature']).toBe('v1,'+createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${event.eventId}.${request.headers['webhook-timestamp']}.${request.body}`).digest('base64'));
  expect(await fixture.db.prepare('SELECT body,state FROM event_deliveries').all()).toMatchObject({results:[{body:null,state:'accepted'}]});
  expect((await fixture.db.prepare("SELECT name FROM sqlite_master WHERE name IN ('webhook_events','outbound_messages')").all()).results).toEqual([]);
});

it('filters before storing content and never fans an existing source out to a later subscription',async()=>{
  const owner=await fixture.issue({email:'filters@example.test'});
  const other=await fixture.issue({email:'isolated@example.test'});
  const original=hook; hook=await fixture.webhook(owner.connections[0]);
  const unseen=message('unselected','private unselected content');
  expect((await ingress(unseen)).status).toBe(202);
  expect(await drain()).toEqual([]);
  await fixture.rpc(owner.accessToken,'events/subscribe',subscription(owner.connections[0],'chat-a','selected'));
  await fixture.rpc(owner.accessToken,'events/subscribe',subscription(owner.connections[0],'chat-b','wrong-chat'));
  await fixture.rpc(owner.accessToken,'events/subscribe',subscription(owner.connections[1],undefined,'wrong-connection'));
  await fixture.rpc(other.accessToken,'events/subscribe',subscription(other.connections[0],undefined,'wrong-owner'));
  unseen.data.attributes.at=Date.now();
  expect((await ingress(unseen)).status).toBe(202);
  expect(await drain()).toEqual([]);
  const before=requests.length;
  const payload=message('filter-selected');
  await Promise.all([ingress(payload),ingress(payload),ingress(payload)]);
  const ids=await drain(); expect(ids).toHaveLength(1);
  expect(requests.slice(before).map(r=>r.url)).toEqual(['https://receiver.example.test/selected']);
  expect(JSON.stringify((await fixture.db.prepare('SELECT * FROM event_sources').all()).results)).not.toContain('private');
  expect((await fixture.db.prepare("SELECT name FROM sqlite_master WHERE name IN ('webhook_events','outbound_messages')").all()).results).toEqual([]);
  hook=original;
});

it('keeps the first 2000 Unicode codepoints and only allowlisted media metadata',async()=>{
  const before=requests.length;
  const payload=message('unicode','🌎'.repeat(1999)+'á'+'🌵 fim');
  await ingress(payload); await drain();
  expect(JSON.parse(requests[before].body).data).toMatchObject({preview:'🌎'.repeat(1999)+'á',previewTruncated:true});
  const media=message('media') as any;
  media.data.attributes={at:Date.now(),encodingFormat:'image/jpeg',filename:'foto.jpg',body:{medias:[{encodingFormat:'image/jpeg',fileName:'foto.jpg',fileSize:123,url:'https://private.invalid/secret',content:'base64-private',unknown:'private metadata'}]}};
  await ingress(media); await drain();
  expect(JSON.parse(requests[before+1].body).data).toEqual({connectionId:account.connections[0],conversationId:'chat-a',messageId:'media',author:'5511',timestamp:new Date(media.data.attributes.at).toISOString(),type:'image/jpeg',preview:'',previewTruncated:false,media:{mimeType:'image/jpeg',fileName:'foto.jpg',size:123}});
  expect(requests[before+1].body).not.toContain('private');
});

it('ignores history, own messages, unknown direction, protocols and unsupported formats while preserving ingress validation',async()=>{
  const before=requests.length;
  for (const update of [
    (p:any)=>p.meta.event='HistorySync',
    (p:any)=>p.meta.event='SendMessage',
    (p:any)=>p.meta.event='Receipt',
    (p:any)=>p.data.meta.fromMe=true,
    (p:any)=>delete p.data.meta.fromMe,
    (p:any)=>p.data.meta.protocolKey='protocol',
    (p:any)=>p.data.attributes.encodingFormat='application/vnd.whatsapp.receipt',
    (p:any)=>p.data.attributes.encodingFormat='application/vnd.whatsapp.reaction',
    (p:any)=>p.data.attributes.encodingFormat='future/unsupported',
    (p:any)=>p.data.attributes.at='invalid',
    (p:any)=>delete p.data.relationships.author,
  ]) {const payload=message('ignored-'+Math.random());update(payload);expect((await ingress(payload)).status).toBe(202);}
  expect(await drain()).toEqual([]);expect(requests).toHaveLength(before);
  expect((await fixture.fetch('/webhooks/evolution/wrong-secret',{method:'POST',body:JSON.stringify(message('bad'))})).status).toBe(404);
  expect((await ingress({...message('bad'),meta:{event:'Message',instanceId:'wrong'}})).status).toBe(400);
  expect((await ingress({event:'Message',data:[]})).status).toBe(400);
  expect((await ingress({...message('bad'),data:{type:'invalid',id:'invalid'}})).status).toBe(400);
  expect((await fixture.db.prepare("SELECT name FROM sqlite_master WHERE name IN ('webhook_events','outbound_messages')").all()).results).toEqual([]);
});

it('cancels pending content immediately through MCP and never resurrects it after reactivation',async()=>{
  const owner=await fixture.issue({email:'cancel@example.test'}),original=hook;
  hook=await fixture.webhook(owner.connections[0]);
  const input=subscription(owner.connections[0],undefined,'cancel');
  await fixture.rpc(owner.accessToken,'events/subscribe',input);
  await ingress(message('cancel-pending')); const ids=fixture.published.splice(0);
  await fixture.rpc(owner.accessToken,'events/unsubscribe',{name:input.name,arguments:input.arguments,delivery:{mode:'webhook',url:input.delivery.url}});
  const row=await fixture.db.prepare('SELECT body,state FROM event_deliveries WHERE id = ?').bind(ids[0]).first();
  expect(row).toEqual({body:null,state:'cancelled'});
  await fixture.rpc(owner.accessToken,'events/subscribe',input);
  const before=requests.length;
  await fixture.queue(ids);
  expect(requests).toHaveLength(before);
  hook=original;
});

it('does not reserve a source during Provider outage and defers a queued delivery without granting access',async()=>{
  await fixture.fetch('/fixture/provider-failure?enabled=1');
  expect((await ingress(message('provider-outage','not lost'))).status).toBe(503);
  expect((await fixture.db.prepare("SELECT count(*) AS count FROM event_sources WHERE message_id = 'provider-outage'").first())?.count).toBe(0);
  await fixture.fetch('/fixture/provider-failure');
  expect((await ingress(message('provider-outage','not lost'))).status).toBe(202);
  const ids=fixture.published.splice(0),before=requests.length;
  await fixture.fetch('/fixture/provider-failure?enabled=1');
  const result=await fixture.queue(ids);
  expect(result.retryMessages).toHaveLength(1);
  expect(requests).toHaveLength(before);
  const row=await fixture.db.prepare('SELECT state,body,attempts,next_attempt_at,deadline_at FROM event_deliveries WHERE id = ?').bind(ids[0]).first();
  expect(row).toMatchObject({state:'pending',body:expect.any(String),attempts:1});
  expect(Number(row?.deadline_at)-Number(row?.next_attempt_at)).toBeLessThan(3600000);
  await fixture.fetch('/fixture/provider-failure');
});

it('rolls back source reservation with fanout when a delivery insert fails',async()=>{
  const extra=subscription(account.connections[0],undefined,'atomic-second');
  await fixture.rpc(account.accessToken,'events/subscribe',extra);
  await fixture.db.exec("CREATE TRIGGER fixture_reject_delivery BEFORE INSERT ON event_deliveries WHEN (SELECT count(*) FROM event_deliveries WHERE source_id = NEW.source_id) > 0 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  expect((await ingress(message('atomic-failure'))).status).toBe(503);
  expect((await fixture.db.prepare("SELECT count(*) AS count FROM event_sources WHERE message_id = 'atomic-failure'").first())?.count).toBe(0);
  await fixture.db.exec('DROP TRIGGER fixture_reject_delivery');
  expect((await ingress(message('atomic-failure'))).status).toBe(202);
  expect(await drain()).toHaveLength(2);
  await fixture.rpc(account.accessToken,'events/unsubscribe',{name:extra.name,arguments:extra.arguments,delivery:{mode:'webhook',url:extra.delivery.url}});
});

it('revalidates Provider revocation, local revocation, disabled users, removed connections and subscription expiry before delivery',async()=>{
  for (const reason of ['provider','local','disabled','removed','expired','cache'] as const) {
    const owner=await fixture.issue({email:reason==='local' ? 'fixture-a@example.test' : reason+'@example.test'}),original=hook;
    hook=await fixture.webhook(owner.connections[0]);
    const subscribed=await fixture.rpc(owner.accessToken,'events/subscribe',subscription(owner.connections[0],undefined,reason));
    await ingress(message('invalidate-'+reason));const jobs=fixture.published.splice(0);
    const target=await fixture.db.prepare('SELECT id FROM event_deliveries WHERE subscription_id = ?').bind(subscribed.body.result.id).first<{id:string}>();
    const ids=[target!.id];
    await fixture.queue(jobs.filter(id=>id!==target!.id));
    if (reason==='provider') await fixture.fetch('/fixture/revoke?'+new URLSearchParams({grantId:owner.grantId,providerUserId:encodeURIComponent(reason+'@example.test')}));
    if (reason==='local') {
      expect((await fixture.fetch('/api/authorizations/'+owner.grantId,{method:'DELETE',headers:{authorization:'Bearer '+owner.accessToken}})).status).toBe(200);
      expect(await fixture.db.prepare('SELECT body,state FROM event_deliveries WHERE id = ?').bind(ids[0]).first()).toEqual({body:null,state:'cancelled'});
    }
    if (reason==='disabled') await fixture.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind(owner.userId).run();
    if (reason==='removed') await fixture.db.prepare('DELETE FROM whatsapp_connections WHERE id = ?').bind(owner.connections[0]).run();
    if (reason==='disabled' || reason==='removed') expect(await fixture.db.prepare('SELECT body,state FROM event_deliveries WHERE id = ?').bind(ids[0]).first()).toEqual({body:null,state:'cancelled'});
    if (reason==='expired') await fixture.db.prepare('UPDATE event_subscriptions SET expires_at = ? WHERE id = ?').bind(Date.now()-1,subscribed.body.result.id).run();
    if (reason==='cache') await fixture.db.prepare('UPDATE event_subscriptions SET verified_until = 0 WHERE id = ?').bind(subscribed.body.result.id).run();
    const before=requests.length;await fixture.queue(ids);
    expect(requests.length-before).toBe(reason==='cache' ? 1 : 0);
    expect((await fixture.db.prepare('SELECT body FROM event_deliveries WHERE id = ?').bind(ids[0]).first())?.body).toBeNull();
    hook=original;
  }
});

it('does not start delivery after its one-hour deadline and clears all operational records at their retention deadlines',async()=>{
  const owner=await fixture.issue({email:'cleanup@example.test'}),original=hook;
  hook=await fixture.webhook(owner.connections[0]);
  await fixture.rpc(owner.accessToken,'events/subscribe',subscription(owner.connections[0],undefined,'cleanup'));
  await ingress(message('deadline')); const ids=fixture.published.splice(0);
  await fixture.db.prepare('UPDATE event_deliveries SET deadline_at = ? WHERE id = ?').bind(Date.now()-1,ids[0]).run();
  const before=requests.length;await fixture.queue(ids);
  expect(requests).toHaveLength(before);
  expect(await fixture.db.prepare('SELECT body,state FROM event_deliveries WHERE id = ?').bind(ids[0]).first()).toEqual({body:null,state:'expired'});
  await ingress(message('scheduled-deadline'));fixture.published.splice(0);
  const row=await fixture.db.prepare('SELECT received_at FROM event_sources WHERE message_id = ?').bind('scheduled-deadline').first();
  const received=Number(row?.received_at);
  await fixture.db.prepare("INSERT INTO send_operations (id,user_id,connection_id,operation,idempotency_key,arguments_hash,state,expires_at) VALUES ('cleanup-op',?,?, 'send_text','cleanup','hash','pending',?)").bind(owner.userId,owner.connections[0],received+3600000).run();
  expect((await fixture.scheduled(received+3600000)).outcome).toBe('ok');
  expect((await fixture.db.prepare("SELECT body,state FROM event_deliveries WHERE source_id IN (SELECT id FROM event_sources WHERE message_id = 'scheduled-deadline')").first())).toEqual({body:null,state:'expired'});
  expect(await fixture.db.prepare("SELECT id FROM send_operations WHERE id = 'cleanup-op'").first()).toBeNull();
  expect((await fixture.scheduled(received+86400000)).outcome).toBe('ok');
  expect(await fixture.db.prepare('SELECT id FROM event_sources WHERE message_id = ?').bind('scheduled-deadline').first()).toBeNull();
  expect(await fixture.db.prepare('SELECT id FROM event_deliveries WHERE id = ?').bind(ids[0]).first()).toBeNull();
  hook=original;
});

it('leases concurrent duplicate jobs once and cancellation wins completion of an already in-flight request',async()=>{
  const owner=await fixture.issue({email:'lease@example.test'}),original=hook;
  hook=await fixture.webhook(owner.connections[0]);
  const input=subscription(owner.connections[0],undefined,'lease');
  await fixture.rpc(owner.accessToken,'events/subscribe',input);
  await ingress(message('concurrent'));const ids=fixture.published.splice(0),before=requests.length;
  const entered=new Promise<void>(resolve=>{deliveryEntered=resolve;});
  const first=fixture.queue(ids);await entered;
  await fixture.queue(ids);
  expect(requests).toHaveLength(before+1);
  await fixture.rpc(owner.accessToken,'events/unsubscribe',{name:input.name,arguments:input.arguments,delivery:{mode:'webhook',url:input.delivery.url}});
  releaseDelivery!();await first;
  expect(await fixture.db.prepare('SELECT body,state,attempts FROM event_deliveries WHERE id = ?').bind(ids[0]).first()).toEqual({body:null,state:'cancelled',attempts:1});
  await fixture.rpc(owner.accessToken,'events/subscribe',input);await fixture.queue(ids);
  expect(requests).toHaveLength(before+1);
  hook=original;
});

it('uses occurrence time to exclude old messages from subscriptions activated after source IDs are purged',async()=>{
  const owner=await fixture.issue({email:'activation@example.test'}),original=hook;
  hook=await fixture.webhook(owner.connections[0]);
  const old=message('old-source');await ingress(old);expect(await drain()).toEqual([]);
  await fixture.db.prepare("UPDATE event_sources SET expires_at = ? WHERE message_id = 'old-source'").bind(Date.now()-1).run();
  await fixture.scheduled(Date.now());
  await fixture.rpc(owner.accessToken,'events/subscribe',subscription(owner.connections[0],undefined,'activation'));
  await ingress(old);expect(await drain()).toEqual([]);
  const recent=message('new-source');await ingress(recent);expect(await drain()).toHaveLength(1);
  hook=original;
});

it('reuses immutable event bytes on a later attempt with a fresh signature and no callback after the deadline',async()=>{
  const owner=await fixture.issue({email:'retry@example.test'}),original=hook;
  hook=await fixture.webhook(owner.connections[0]);
  await fixture.rpc(owner.accessToken,'events/subscribe',subscription(owner.connections[0],undefined,'retry'));
  await ingress(message('retry'));const ids=fixture.published.splice(0),before=requests.length;
  retryStatus=503;await fixture.queue(ids);retryStatus=202;
  const first=requests[before];
  await fixture.db.prepare('UPDATE event_deliveries SET next_attempt_at = ? WHERE id = ?').bind(Date.now()-1,ids[0]).run();
  await new Promise(resolve=>setTimeout(resolve,1050));
  await fixture.queue(ids);const second=requests[before+1];
  expect(second.body).toBe(first.body);
  expect(second.headers['webhook-id']).toBe(first.headers['webhook-id']);
  expect(Number(second.headers['webhook-timestamp'])).toBeGreaterThan(Number(first.headers['webhook-timestamp']));
  expect(second.headers['webhook-signature']).not.toBe(first.headers['webhook-signature']);
  expect(await fixture.db.prepare('SELECT body,state,attempts FROM event_deliveries WHERE id = ?').bind(ids[0]).first()).toEqual({body:null,state:'accepted',attempts:2});
  hook=original;
});

it('skips identifiers beyond the tool contract and omits excessive media metadata before persistence',async()=>{
  const before=requests.length;
  for (const field of ['message','conversation','author']) {
    const payload=message('oversized-'+field);
    if (field==='message') payload.data.id='x'.repeat(201);
    if (field==='conversation') payload.data.meta.chat='x'.repeat(201);
    if (field==='author') payload.data.relationships.author.data.id='x'.repeat(201);
    await ingress(payload);expect(await drain()).toEqual([]);
  }
  const payload=message('metadata-limits') as any;
  payload.data.attributes={at:Date.now(),encodingFormat:'image/jpeg',body:{text:'prefix',media:{url:'https://private.invalid',fileName:'x'.repeat(256),encodingFormat:'x'.repeat(128)}}};
  await ingress(payload);await drain();
  expect(requests).toHaveLength(before+1);
  expect(JSON.parse(requests[before].body).data.media).toEqual({mimeType:'image/jpeg'});
});

it.each([
  {name:'full-jid',filter:'551199998888@s.whatsapp.net',chat:'551199998888@s.whatsapp.net',senderAlt:''},
  {name:'phone-number',filter:'551199998888',chat:'551199998888@s.whatsapp.net',senderAlt:''},
  {name:'linked-phone',filter:'551199998888',chat:'87654321@lid',senderAlt:'551199998888@s.whatsapp.net'},
  {name:'linked-device',filter:'551199998888@s.whatsapp.net',chat:'87654321@lid',senderAlt:'551199998888:4@s.whatsapp.net'},
  {name:'linked-id',filter:'87654321@lid',chat:'551199998888@s.whatsapp.net',senderAlt:'87654321@lid'},
  {name:'bare-chat',filter:'551199998888@s.whatsapp.net',chat:'551199998888',senderAlt:''},
])('matches equivalent direct conversation identifiers: $name',async({name,filter,chat,senderAlt})=>{
  const owner=await fixture.issue({email:name+'@example.test'}),original=hook;
  hook=await fixture.webhook(owner.connections[0]);
  try {
    await fixture.rpc(owner.accessToken,'events/subscribe',subscription(owner.connections[0],filter,name));
    const payload=message(name);
    Object.assign(payload.data.meta,{chat,...(senderAlt ? {senderAlt} : {})});
    const before=requests.length;
    expect((await ingress(payload)).status).toBe(202);
    expect(await drain()).toHaveLength(1);
    expect(JSON.parse(requests[before].body).data.conversationId).toBe(payload.data.meta.chat);
  } finally { hook=original; }
});

it.each([
  {name:'group-sender',chat:'123456@g.us',senderAlt:'551199998888@s.whatsapp.net'},
  {name:'unrelated-linked-id',chat:'551199998888@lid',senderAlt:''},
  {name:'recipient-alias',chat:'551188887777@s.whatsapp.net',senderAlt:''},
])('keeps contact subscriptions outside unrelated conversations: $name',async({name,chat,senderAlt})=>{
  const owner=await fixture.issue({email:name+'@example.test'}),original=hook;
  hook=await fixture.webhook(owner.connections[0]);
  try {
    await fixture.rpc(owner.accessToken,'events/subscribe',subscription(owner.connections[0],'551199998888',name));
    const payload=message(name);
    Object.assign(payload.data.meta,{chat,senderAlt,recipientAlt:'551199998888@s.whatsapp.net'});
    payload.data.relationships.author.data.id='551199998888';
    const before=requests.length;
    expect((await ingress(payload)).status).toBe(202);
    expect(await drain()).toEqual([]);
    expect(requests).toHaveLength(before);
    expect((await fixture.db.prepare('SELECT COUNT(*) AS count FROM event_deliveries WHERE subscription_id IN (SELECT id FROM event_subscriptions WHERE connection_id = ?)').bind(owner.connections[0]).first())?.count).toBe(0);
  } finally { hook=original; }
});
