import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { eventRuntime } from './helpers/mcp-events-runtime';

const secret='whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
let fixture:Awaited<ReturnType<typeof eventRuntime>>, sequence=0, status=202, senderError:string|undefined;
let hold:(()=>Promise<void>)|undefined, startupDelay=0;
const requests:{url:string;body:string;headers:Record<string,string>}[]=[];
beforeAll(async()=>{ fixture=await eventRuntime(async request=>{
  const input=await request.json() as typeof requests[number], body=JSON.parse(input.body);
  if (body.type==='verification') return Response.json({status:202,body:JSON.stringify({challenge:body.challenge})});
  if (startupDelay) {await new Promise(resolve=>setTimeout(resolve,startupDelay));if (Date.now()>=Number(request.headers.get('x-wapilot-deadline'))) return Response.json({error:'callback_timeout'},{status:504});}
  requests.push(input);
  if (hold) await hold();
  if (senderError) return Response.json({error:senderError},{status:senderError==='callback_timeout' ? 504 : 400});
  return Response.json({status,body:''});
}); });
beforeEach(async()=>{ status=202; senderError=undefined; hold=undefined; startupDelay=0; await fixture.clock(); });
afterAll(async()=>{await fixture?.runtime.dispose();});
async function pending(email?:string) {
  const owner=await fixture.issue({email:email ?? `recovery-${sequence+1}@example.test`});sequence++;
  const hook=await fixture.webhook(owner.connections[0]);
  const input={name:'message.received',arguments:{connectionId:owner.connections[0]},delivery:{mode:'webhook',url:`https://receiver.example.test/${sequence}`,secret}};
  const sub=await fixture.rpc(owner.accessToken,'events/subscribe',input);
  const payload={jsonapi:{version:'1.1'},meta:{event:'Message',instanceId:hook.instanceId},data:{type:'message',id:`message-${sequence}`,attributes:{at:Date.now(),encodingFormat:'text/plain',body:{text:'Conteúdo temporário 🌎'}},relationships:{author:{data:{type:'chat',id:'5511'}}},meta:{chat:'chat',fromMe:false}}};
  const response=await fixture.fetch(hook.path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  expect(response.status).toBe(202);
  const row=await fixture.db.prepare('SELECT * FROM event_deliveries WHERE subscription_id = ?').bind(sub.body.result.id).first<Record<string,any>>();
  fixture.published.splice(0);
  return {owner,input,payload,hook,id:row!.id as string,row:row!};
}

it('retries HTTP 408 through the native queue without changing the original event or retention',async()=>{
  const delivery=await pending(); status=408;
  const result=await fixture.queue([delivery.id]);
  expect(result.retryMessages).toHaveLength(1);
  expect(await fixture.db.prepare('SELECT state,body,attempts,deadline_at,expires_at FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:'pending',body:delivery.row.body,attempts:1,deadline_at:delivery.row.deadline_at,expires_at:delivery.row.expires_at});
});

it.each([200,204,299,301,307,400,401,403,404,409,410,413,422,429,500,502,503,504,599])('classifies callback HTTP %i without retrying permanent failures',async code=>{
  const delivery=await pending(); status=code;
  const retry=code===429 || code>=500, accepted=code>=200 && code<300;
  const result=await fixture.queue([delivery.id]);
  expect(result.retryMessages).toHaveLength(retry ? 1 : 0);
  expect(await fixture.db.prepare('SELECT state,body,result_code FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:retry ? 'pending' : accepted ? 'accepted' : 'failed',body:retry ? delivery.row.body : null,result_code:retry ? 'unavailable' : accepted ? 'http_2xx' : 'http_'+code});
});

it.each(['destination_blocked','invalid_request','callback_timeout','sender_unavailable'])('handles sender %s safely',async reason=>{
  const delivery=await pending(); senderError=reason;
  const retry=reason==='callback_timeout' || reason==='sender_unavailable';
  const result=await fixture.queue([delivery.id]);
  expect(result.retryMessages).toHaveLength(retry ? 1 : 0);
  expect(await fixture.db.prepare('SELECT state,body FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:retry ? 'pending' : 'failed',body:retry ? delivery.row.body : null});
});

it('bounds cumulative attempts and backoff across duplicate jobs and a worker restart',async()=>{
  const delivery=await pending(); status=503;
  const start=delivery.row.received_at;
  let now=start;
  for (const [index,delay] of [60000,120000,240000,480000,900000,0].entries()) {
    await fixture.clock(now);
    const result=await fixture.queue([delivery.id,delivery.id]);
    const row=await fixture.db.prepare('SELECT * FROM event_deliveries WHERE id = ?').bind(delivery.id).first<Record<string,any>>();
    expect(row!.attempts).toBe(index+1);
    expect(row!.deadline_at).toBe(start+3600000);
    expect(row!.expires_at).toBe(start+86400000);
    if (delay) {
      expect(result.retryMessages).toHaveLength(1);
      expect(row!.next_attempt_at).toBe(now+delay);
      expect(row!.body).toBe(delivery.row.body);
      now+=delay;
    } else {
      expect(result.retryMessages).toHaveLength(0);
      expect(row).toMatchObject({state:'failed',body:null,result_code:'attempt_limit'});
    }
    if (index===1) await fixture.restart();
  }
  const before=requests.length;
  await fixture.queue([delivery.id]); await fixture.scheduled(now+60000);
  expect(requests).toHaveLength(before);
  expect(fixture.published).not.toContain(delivery.id);
});

it('recovers an outbox committed before publication and a lost publication without extending its lifetime',async()=>{
  await fixture.fetch('/fixture/queue-failure?enabled=1');
  const delivery=await pending();
  expect(delivery.row.published_at).toBeNull();
  await fixture.restart();
  const now=delivery.row.received_at+60000;
  await fixture.clock(now); await fixture.scheduled(now);
  expect(fixture.published).toContain(delivery.id);
  fixture.published.splice(0); // The broker lost this publication before invoking the consumer.
  await fixture.clock(now+60000); await fixture.scheduled(now+60000);
  expect(fixture.published).toContain(delivery.id);
  await fixture.queue([delivery.id]);
  expect(await fixture.db.prepare('SELECT state,body,attempts,deadline_at,expires_at FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:'accepted',body:null,attempts:1,deadline_at:delivery.row.deadline_at,expires_at:delivery.row.expires_at});
});

it('drains ID-only DLQ jobs without sending or resetting delivery state and lets Cron recover due work',async()=>{
  const delivery=await pending(),before=requests.length;
  await fixture.queue([delivery.id,delivery.id,null,{body:'must not be consumed'}],'wapilot-events-failed');
  expect(requests).toHaveLength(before);
  expect(await fixture.db.prepare('SELECT state,body,attempts,deadline_at,expires_at FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:'pending',body:delivery.row.body,attempts:0,deadline_at:delivery.row.deadline_at,expires_at:delivery.row.expires_at});
  await fixture.scheduled(Date.now());
  expect(fixture.published).toContain(delivery.id);
  expect(fixture.published.every(id=>typeof id==='string')).toBe(true);
  await fixture.queue([delivery.id]);
  await fixture.queue([delivery.id],'wapilot-events-failed'); await fixture.scheduled(Date.now()+60000);
  expect(requests).toHaveLength(before+1);
  expect(await fixture.db.prepare('SELECT state,body,attempts FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:'accepted',body:null,attempts:1});
});

it('fences a response after its lease expires and recovers the interrupted attempt without resetting its budget',async()=>{
  const delivery=await pending(); let entered!:()=>void, release!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;});
  hold=async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});};
  const first=fixture.queue([delivery.id]);await waiting;
  const owned=await fixture.db.prepare('SELECT lease_until FROM event_deliveries WHERE id = ?').bind(delivery.id).first<{lease_until:number}>();
  const now=owned!.lease_until+1;
  await fixture.clock(now);
  hold=undefined;release();await first;
  expect(await fixture.db.prepare('SELECT state,body,attempts FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:'delivering',body:delivery.row.body,attempts:1});
  await fixture.scheduled(now);
  expect(fixture.published).toContain(delivery.id);
  await fixture.queue([delivery.id]);
  expect(await fixture.db.prepare('SELECT state,body,attempts FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:'accepted',body:null,attempts:2});
});

it('recovers a retry ACKed before it was due and permits a duplicate after HTTP acceptance could not be stored',async()=>{
  const delivery=await pending(),before=requests.length;
  await fixture.db.exec("CREATE TRIGGER fixture_completion_failure BEFORE UPDATE ON event_deliveries WHEN NEW.state = 'accepted' BEGIN SELECT RAISE(ABORT,'Synthetic completion failure'); END;");
  try {expect((await fixture.queue([delivery.id])).retryMessages).toHaveLength(1);}
  finally {await fixture.db.exec('DROP TRIGGER fixture_completion_failure');}
  expect(requests).toHaveLength(before+1);
  const row=await fixture.db.prepare('SELECT * FROM event_deliveries WHERE id = ?').bind(delivery.id).first<Record<string,any>>();
  expect(row).toMatchObject({state:'pending',body:delivery.row.body,attempts:1});
  await fixture.queue([delivery.id]); // Early broker retry is ACKed; D1 still owns the due work.
  expect(requests).toHaveLength(before+1);
  await fixture.restart(); await fixture.clock(row!.next_attempt_at);
  await fixture.scheduled(row!.next_attempt_at);
  expect(fixture.published).toContain(delivery.id);
  await fixture.queue([delivery.id]);
  expect(requests).toHaveLength(before+2);
  expect(requests[before+1].body).toBe(requests[before].body);
  expect(requests[before+1].headers['webhook-id']).toBe(requests[before].headers['webhook-id']);
  expect(requests[before+1].headers['webhook-timestamp']).not.toBe(requests[before].headers['webhook-timestamp']);
  expect(await fixture.db.prepare('SELECT state,body,attempts FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:'accepted',body:null,attempts:2});
});

it('keeps event bytes fixed while retries honor the original old-key rotation window',async()=>{
  const delivery=await pending(),before=requests.length; status=503;
  await fixture.clock(delivery.row.received_at);await fixture.queue([delivery.id]);
  const rotated='whsec_BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
  await fixture.rpc(delivery.owner.accessToken,'events/subscribe',{...delivery.input,delivery:{...delivery.input.delivery,secret:rotated}});
  const sub=await fixture.db.prepare('SELECT previous_secret_until FROM event_subscriptions WHERE id = ?').bind(delivery.row.subscription_id).first<{previous_secret_until:number}>();
  await fixture.clock(delivery.row.received_at+60000);await fixture.queue([delivery.id]);
  const during=requests[before+1];
  for (const key of [rotated,secret]) expect(during.headers['webhook-signature']).toContain('v1,'+createHmac('sha256',Buffer.from(key.slice(6),'base64')).update(`${during.headers['webhook-id']}.${during.headers['webhook-timestamp']}.${during.body}`).digest('base64'));
  await fixture.clock(sub!.previous_secret_until);status=202;await fixture.queue([delivery.id]);
  const after=requests[before+2];
  expect(after.body).toBe(requests[before].body);
  expect(after.headers['webhook-signature'].split(' ')).toHaveLength(1);
  expect(after.headers['webhook-signature']).toBe('v1,'+createHmac('sha256',Buffer.from(rotated.slice(6),'base64')).update(`${after.headers['webhook-id']}.${after.headers['webhook-timestamp']}.${after.body}`).digest('base64'));
});

it('exposes aggregate recovery, retries, failures, cleanup lag and ingress drops without sensitive values',async()=>{
  const delivery=await pending(); status=503;
  await fixture.queue([delivery.id]);
  const invalid=structuredClone(delivery.payload);invalid.data.id='sensitive-id-'.repeat(30);
  const unsupported=structuredClone(delivery.payload);unsupported.data.attributes.encodingFormat='future/unsupported';
  const missing=structuredClone(delivery.payload);missing.data.attributes.at=NaN;
  for (const payload of [invalid,unsupported,missing]) await fixture.fetch(delivery.hook.path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  const due=await fixture.db.prepare('SELECT next_attempt_at FROM event_deliveries WHERE id = ?').bind(delivery.id).first<{next_attempt_at:number}>();
  await fixture.clock(due!.next_attempt_at);expect((await fixture.scheduled(due!.next_attempt_at)).outcome,fixture.logs.join('\n')).toBe('ok');
  await expect.poll(()=>fixture.logs.join('\n')).toContain('mcp_events_maintenance');
  const logs=fixture.logs.join('\n');
  expect(logs).toContain('mcp_events_maintenance');
  expect(logs).toMatch(/"publication_recoveries":[1-9]/);
  expect(logs).toContain('"backlog":');expect(logs).toContain('"retries":');expect(logs).toContain('"failures":');expect(logs).toContain('"cleanup_lag_ms":');
  for (const reason of ['invalid','unsupported','oversized']) expect(logs).toContain(`"${reason}":1`);
  for (const sensitive of [secret,delivery.id,delivery.input.delivery.url,'Conteúdo temporário','sensitive-id-','webhook-signature']) expect(logs).not.toContain(sensitive);
});

it.each(['cancel','revoke','disable','remove','expiry','provider-outage'])('revalidates %s after a transient failure before the next attempt',async reason=>{
  const delivery=await pending();status=503;await fixture.queue([delivery.id]);status=202;
  if (reason==='cancel') await fixture.rpc(delivery.owner.accessToken,'events/unsubscribe',{name:delivery.input.name,arguments:delivery.input.arguments,delivery:{mode:'webhook',url:delivery.input.delivery.url}});
  if (reason==='revoke') await fixture.fetch('/fixture/revoke?'+new URLSearchParams({grantId:delivery.owner.grantId,providerUserId:encodeURIComponent(`recovery-${sequence}@example.test`)}));
  if (reason==='disable') await fixture.db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind(delivery.owner.userId).run();
  if (reason==='remove') await fixture.db.prepare('DELETE FROM whatsapp_connections WHERE id = ?').bind(delivery.owner.connections[0]).run();
  if (reason==='expiry') await fixture.db.prepare('UPDATE event_subscriptions SET expires_at = ? WHERE id = ?').bind(delivery.row.received_at+60000,delivery.row.subscription_id).run();
  if (reason==='provider-outage') await fixture.fetch('/fixture/provider-failure?enabled=1');
  await fixture.clock(delivery.row.received_at+120000);
  const before=requests.length;
  await fixture.scheduled(delivery.row.received_at+120000);await fixture.queue([delivery.id]);
  expect(requests).toHaveLength(before);
  const row=await fixture.db.prepare('SELECT state,body FROM event_deliveries WHERE id = ?').bind(delivery.id).first();
  expect(row).toEqual({state:reason==='provider-outage' ? 'pending' : 'cancelled',body:reason==='provider-outage' ? delivery.row.body : null});
  await fixture.fetch('/fixture/provider-failure');
});

it('clears content at the exact hour without Cron and expires result identifiers at the exact original 24 hours',async()=>{
  const delivery=await pending();const before=requests.length;
  await fixture.clock(delivery.row.received_at+3600000);
  await fixture.queue([delivery.id]);
  expect(requests).toHaveLength(before);
  expect(await fixture.db.prepare('SELECT state,body FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:'expired',body:null});
  await fixture.queue([delivery.id],'wapilot-events-failed');
  const expired=delivery.row.received_at+86400000;
  await fixture.clock(expired-1);await fixture.scheduled(expired-1);
  expect(await fixture.db.prepare('SELECT id FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({id:delivery.id});
  await fixture.clock(expired);await fixture.scheduled(expired);
  expect(await fixture.db.prepare('SELECT id FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toBeNull();
  expect(await fixture.db.prepare('SELECT id FROM event_sources WHERE id = ?').bind(delivery.row.source_id).first()).toBeNull();
  fixture.published.splice(0);await fixture.queue([delivery.id],'wapilot-events-failed');await fixture.scheduled(expired);
  expect(fixture.published).not.toContain(delivery.id);expect(requests).toHaveLength(before);
});

it.each(['delivery','subscription'])('bounds sender startup by the remaining %s deadline and clears content after timeout',async budget=>{
  const delivery=await pending(),before=requests.length;startupDelay=150;
  if (budget==='delivery') await fixture.db.prepare('UPDATE event_deliveries SET deadline_at = ? WHERE id = ?').bind(Date.now()+60,delivery.id).run();
  else await fixture.db.prepare('UPDATE event_subscriptions SET expires_at = ? WHERE id = ?').bind(Date.now()+60,delivery.row.subscription_id).run();
  await fixture.queue([delivery.id]);
  expect(await fixture.db.prepare('SELECT state,body FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:'expired',body:null});
  await new Promise(resolve=>setTimeout(resolve,180));
  expect(requests).toHaveLength(before);
});

it('defers across a rotation-window deadline during startup and later signs with only the current key',async()=>{
  const delivery=await pending(),before=requests.length;
  const rotated='whsec_BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
  await fixture.rpc(delivery.owner.accessToken,'events/subscribe',{...delivery.input,delivery:{...delivery.input.delivery,secret:rotated}});
  await fixture.db.prepare('UPDATE event_subscriptions SET previous_secret_until = ? WHERE id = ?').bind(Date.now()+60,delivery.row.subscription_id).run();
  startupDelay=150;await fixture.queue([delivery.id]);await new Promise(resolve=>setTimeout(resolve,180));
  expect(requests).toHaveLength(before);
  const row=await fixture.db.prepare('SELECT state,body,next_attempt_at FROM event_deliveries WHERE id = ?').bind(delivery.id).first<Record<string,any>>();
  expect(row).toMatchObject({state:'pending',body:delivery.row.body});
  startupDelay=0;await fixture.clock(row!.next_attempt_at);await fixture.queue([delivery.id]);
  expect(requests[before].body).toBe(delivery.row.body);
  expect(requests[before].headers['webhook-signature'].split(' ')).toHaveLength(1);
});

it('bounds an unavailable authorization lookup by the remaining attempt deadline without granting access',async()=>{
  const delivery=await pending(),before=requests.length;
  await fixture.db.prepare('UPDATE event_deliveries SET deadline_at = ? WHERE id = ?').bind(Date.now()+100,delivery.id).run();
  await fixture.fetch('/fixture/provider-delay?ms=400');
  const started=Date.now();
  try {await fixture.queue([delivery.id]);}
  finally {await fixture.fetch('/fixture/provider-delay');}
  expect(Date.now()-started).toBeLessThan(300);
  expect(requests).toHaveLength(before);
  expect(await fixture.db.prepare('SELECT state,body FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:'expired',body:null});
});

it('recovers an interrupted consumer after both completion and defer storage fail without losing the attempt budget',async()=>{
  const delivery=await pending(),before=requests.length;
  await fixture.db.exec("CREATE TRIGGER fixture_storage_failure BEFORE UPDATE ON event_deliveries WHEN OLD.state = 'delivering' AND NEW.state != 'delivering' BEGIN SELECT RAISE(ABORT,'private fixture failure'); END;");
  let owned:Record<string,any>|null;
  try {
    const result=await fixture.queue([delivery.id]);
    expect(result.outcome).toBe('ok');
    expect(result.retryBatch).toMatchObject({retry:true,delaySeconds:60});
    owned=await fixture.db.prepare('SELECT * FROM event_deliveries WHERE id = ?').bind(delivery.id).first<Record<string,any>>();
    expect(owned).toMatchObject({state:'delivering',attempts:1,body:delivery.row.body});
  } finally {await fixture.db.exec('DROP TRIGGER fixture_storage_failure');}
  await fixture.restart();await fixture.clock(owned!.lease_until+1);await fixture.scheduled(owned!.lease_until+1);
  expect(fixture.published).toContain(delivery.id);
  await fixture.queue([delivery.id]);
  expect(requests).toHaveLength(before+2);
  expect(requests[before+1].body).toBe(requests[before].body);
  expect(await fixture.db.prepare('SELECT state,body,attempts FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:'accepted',body:null,attempts:2});
  expect(fixture.logs.join('\n')).not.toContain('private fixture failure');
});

it('lets a newer lease result win over an older in-flight response',async()=>{
  const delivery=await pending();let entered!:()=>void,release!:()=>void;
  const waiting=new Promise<void>(resolve=>{entered=resolve;});
  hold=async()=>{entered();await new Promise<void>(resolve=>{release=resolve;});};
  const first=fixture.queue([delivery.id]);await waiting;
  const owned=await fixture.db.prepare('SELECT lease_until FROM event_deliveries WHERE id = ?').bind(delivery.id).first<{lease_until:number}>();
  await fixture.clock(owned!.lease_until);await fixture.scheduled(owned!.lease_until);
  hold=undefined;await fixture.queue([delivery.id]);
  status=410;release();await first;
  expect(await fixture.db.prepare('SELECT state,body,attempts,result_code FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:'accepted',body:null,attempts:2,result_code:'http_2xx'});
});

it('clears an expired delivery when its stale ID reaches the DLQ even before Cron runs',async()=>{
  const delivery=await pending(),before=requests.length;
  await fixture.clock(delivery.row.deadline_at);
  await fixture.queue([delivery.id],'wapilot-events-failed');
  expect(await fixture.db.prepare('SELECT state,body,attempts FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:'expired',body:null,attempts:0});
  expect(requests).toHaveLength(before);
  await fixture.scheduled(delivery.row.deadline_at);await fixture.queue([delivery.id]);
  expect(requests).toHaveLength(before);
});

it('reports cleanup lag for expired subscription secrets before the 24-hour metadata purge is due',async()=>{
  const delivery=await pending(),expires=delivery.row.received_at+1000;
  await fixture.db.prepare('UPDATE event_subscriptions SET expires_at = ? WHERE id = ?').bind(expires,delivery.row.subscription_id).run();
  fixture.logs.splice(0);await fixture.clock(expires+5000);await fixture.scheduled(expires+5000);
  await expect.poll(()=>fixture.logs.find(line=>line.includes('mcp_events_maintenance'))).toBeDefined();
  const metrics=JSON.parse(fixture.logs.find(line=>line.includes('mcp_events_maintenance'))!);
  expect(metrics.cleanup_lag_ms).toBeGreaterThanOrEqual(5000);
  expect(await fixture.db.prepare('SELECT body FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({body:null});
});

it('reports delayed cleanup and preserves only the minimal grant fence for seven days after revocation',async()=>{
  const delivery=await pending('fixture-a@example.test');
  const overdue=delivery.row.received_at+3605000;
  await fixture.clock(overdue);await fixture.scheduled(delivery.row.received_at);
  expect(await fixture.db.prepare('SELECT state,body FROM event_deliveries WHERE id = ?').bind(delivery.id).first()).toEqual({state:'expired',body:null});
  await expect.poll(()=>fixture.logs.filter(line=>line.includes('mcp_events_maintenance')).at(-1)).toContain('cleanup_lag_ms');
  const metrics=JSON.parse(fixture.logs.filter(line=>line.includes('mcp_events_maintenance')).at(-1)!);
  expect(metrics.cleanup_lag_ms).toBeGreaterThanOrEqual(5000);
  expect(metrics.schedule_lag_ms).toBeGreaterThanOrEqual(3605000);
  await fixture.clock();
  expect((await fixture.fetch('/api/authorizations/'+delivery.owner.grantId,{method:'DELETE',headers:{authorization:'Bearer '+delivery.owner.accessToken}})).status).toBe(200);
  const sub=await fixture.db.prepare('SELECT expires_at FROM event_subscriptions WHERE id = ?').bind(delivery.row.subscription_id).first<{expires_at:number}>();
  const fence=await fixture.db.prepare('SELECT expires_at FROM event_grant_revocations WHERE user_id = ? AND grant_id = ?').bind(delivery.owner.userId,delivery.owner.grantId).first<{expires_at:number}>();
  await fixture.clock(sub!.expires_at+86400000-1);await fixture.scheduled(sub!.expires_at+86400000-1);
  expect(await fixture.db.prepare('SELECT id FROM event_subscriptions WHERE id = ?').bind(delivery.row.subscription_id).first()).not.toBeNull();
  await fixture.clock(sub!.expires_at+86400000);await fixture.scheduled(sub!.expires_at+86400000);
  expect(await fixture.db.prepare('SELECT id FROM event_subscriptions WHERE id = ?').bind(delivery.row.subscription_id).first()).toBeNull();
  await fixture.clock(fence!.expires_at-1);await fixture.scheduled(fence!.expires_at-1);
  expect(await fixture.db.prepare('SELECT grant_id FROM event_grant_revocations WHERE user_id = ? AND grant_id = ?').bind(delivery.owner.userId,delivery.owner.grantId).first()).not.toBeNull();
  await fixture.clock(fence!.expires_at);await fixture.scheduled(fence!.expires_at);
  expect(await fixture.db.prepare('SELECT grant_id FROM event_grant_revocations WHERE user_id = ? AND grant_id = ?').bind(delivery.owner.userId,delivery.owner.grantId).first()).toBeNull();
});
