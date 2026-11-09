import type { Env } from '../types';
import { decryptToken } from './crypto';
import { eventAuthorizationValid, eventWebhookHeaders, type EventGrantReader, type EventPrincipal } from './mcp-events';
import { CallbackSenderError, sendCallback } from './callback-sender';

const HOUR = 3600000, DAY = 86400000, LEASE = 60000, MAX_ATTEMPTS = 6;
type Subscription = {id:string; user_id:string; provider_user_id:string; grant_id:string; client_id:string; resource:string; connection_id:string; activated_at:number; expires_at:number; state:string; encrypted_secret:string|null; encrypted_previous_secret:string|null; previous_secret_until:number|null; callback_url:string};
type Delivery = {id:string; subscription_id:string; event_id:string; body:string|null; deadline_at:number; lease_until:number; attempts:number; next_attempt_at:number; state:string};
function principal(row: Subscription): EventPrincipal { return {userId:row.user_id,providerUserId:row.provider_user_id,grantId:row.grant_id,clientId:row.client_id,resource:row.resource}; }
function record(value:unknown): Record<string,unknown> {return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};}
function text(value:unknown,limit:number): value is string {return typeof value === 'string' && value.length<=limit && value.trim().length > 0;}

function notification(connectionId:string, item:Record<string,unknown>) {
  const meta=record(item.meta), attributes=record(item.attributes), body=record(attributes.body);
  const author=record(record(record(item.relationships).author).data).id;
  const at=attributes.at, format=attributes.encodingFormat;
  if ([item.id,meta.chat,author].some(value=>typeof value==='string' && value.length>200) || typeof format==='string' && format.length>127) return 'oversized';
  if (meta.fromMe === true || 'protocolKey' in meta || typeof format==='string' && !(/^(text\/plain|image\/[\w.+-]+|audio\/[\w.+-]+|video\/[\w.+-]+|application\/(pdf|octet-stream))$/.test(format))) return 'unsupported';
  if (item.type !== 'message' || !text(item.id,200) || meta.fromMe !== false
    || !text(meta.chat,200) || !text(author,200) || typeof at !== 'number' || !Number.isFinite(at) || Math.abs(at)>8640000000000000
    || !text(format,127)) return 'invalid';
  const media=record(Array.isArray(body.medias) ? body.medias[0] : body.media);
  if (format === 'text/plain' ? typeof body.text !== 'string' : !Object.keys(media).length) return 'invalid';
  const points:string[]=[];
  for (const point of typeof body.text === 'string' ? body.text : '') {
    points.push(point);
    if (points.length===2001) break;
  }
  const mimeType=text(media.encodingFormat,127) && /^[\w.+-]+\/[\w.+-]+$/.test(media.encodingFormat) ? media.encodingFormat : format;
  const fileName=text(media.fileName,255) ? media.fileName : text(attributes.filename,255) ? attributes.filename : undefined;
  const size=media.fileSize ?? media.size;
  const timestamp=new Date(at).toISOString();
  return {connectionId,conversationId:meta.chat,messageId:item.id,author,timestamp,type:format,preview:points.slice(0,2000).join(''),previewTruncated:points.length>2000,
    ...(format !== 'text/plain' ? {media:{mimeType,...(fileName ? {fileName} : {}),...(typeof size === 'number' && Number.isSafeInteger(size) && size>=0 ? {size} : {})}} : {})};
}

function conversationIds(item:Record<string,unknown>, chat:string): string[] {
  const ids=[chat], alternate=record(item.meta).senderAlt;
  const direct=/^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/;
  // A group sender is not an alternate identity for the group conversation.
  if (direct.test(chat) && text(alternate,200) && direct.test(alternate)) ids.push(alternate);
  for (const id of [...ids]) {
    const phone=/^(\d+)(?::\d+)?@s\.whatsapp\.net$/.exec(id);
    if (phone) ids.push(phone[1],`${phone[1]}@s.whatsapp.net`);
  }
  if (/^\d+$/.test(chat)) ids.push(`${chat}@s.whatsapp.net`);
  return [...new Set(ids)];
}

/** A candidate marker gates the entire fan-out in one transaction, including no-interest sources. */
export async function ingestEventDeliveries(env:Env, oauth:EventGrantReader, connection:{id:string;userId:string}, eventName:string, resources:Record<string,unknown>[]): Promise<void> {
  const drops={invalid:0,unsupported:0,oversized:0};
  if (eventName !== 'Message') {console.log(JSON.stringify({event:'mcp_events_ingress',connectionId:connection.id,...drops,unsupported:resources.length}));return;}
  for (const item of resources) {
    const data=notification(connection.id,item);
    if (typeof data==='string') {drops[data]++;continue;}
    const now=Date.now(), occurred=Date.parse(data.timestamp);
    if (await env.DB.prepare('SELECT id FROM event_sources WHERE connection_id = ? AND message_id = ? AND expires_at > ?').bind(connection.id,data.messageId,now).first()) continue;
    const conversations=conversationIds(item,data.conversationId);
    const candidates=await env.DB.prepare(`SELECT * FROM event_subscriptions WHERE user_id = ? AND connection_id = ? AND state = 'active' AND expires_at > ? AND activated_at <= ? AND encrypted_secret IS NOT NULL AND (conversation_id IS NULL OR conversation_id IN (${conversations.map(()=>'?').join(',')}))`)
      .bind(connection.userId,connection.id,now,occurred,...conversations).all<Subscription>();
    const selected:Subscription[]=[];
    // An unavailable Provider must fail ingress before reserving the source marker.
    for (const row of candidates.results) if (await eventAuthorizationValid(env.DB,oauth,principal(row),connection.id)) selected.push(row);
    const source=crypto.randomUUID(), eventId='evt_'+crypto.randomUUID();
    const body=JSON.stringify({eventId,name:'message.received',timestamp:data.timestamp,data,cursor:null});
    if (new TextEncoder().encode(body).byteLength>256*1024) {selected.length=0;drops.oversized++;}
    const statements=[env.DB.prepare('INSERT OR IGNORE INTO event_sources (id,connection_id,message_id,received_at,expires_at) VALUES (?,?,?,?,?)').bind(source,connection.id,data.messageId,now,now+DAY)];
    for (const sub of selected) statements.push(env.DB.prepare(`INSERT OR IGNORE INTO event_deliveries (id,source_id,subscription_id,event_id,body,state,received_at,deadline_at,expires_at,next_attempt_at)
      SELECT ?,?,?,?,?, 'pending',?,?,?,? FROM event_sources source JOIN event_subscriptions s ON s.id = ?
      JOIN users u ON u.id = s.user_id JOIN whatsapp_connections c ON c.id = s.connection_id AND c.user_id = u.id
      WHERE source.id = ? AND s.state = 'active' AND s.expires_at > ? AND s.activated_at <= ? AND u.status = 'active'
      AND NOT EXISTS (SELECT 1 FROM event_grant_revocations r WHERE r.user_id = s.user_id AND r.grant_id = s.grant_id AND r.expires_at > ?)`)
      .bind(crypto.randomUUID(),source,sub.id,eventId,body,now,now+HOUR,now+DAY,now,sub.id,source,now,occurred,now));
    await env.DB.batch(statements);
    console.info(JSON.stringify({event:'mcp_events_selection',connectionId:connection.id,selectedSubscriptions:selected.length,outcome:selected.length?'selected':'no_subscriber'}));
    const deliveries=await env.DB.prepare("SELECT id FROM event_deliveries WHERE source_id = ? AND state = 'pending'").bind(source).all<{id:string}>();
    for (const delivery of deliveries.results) if (!await publishDelivery(env,delivery.id,now)) console.log(JSON.stringify({event:'mcp_events_publication',failures:1}));
  }
  if (drops.invalid || drops.unsupported || drops.oversized) console.log(JSON.stringify({event:'mcp_events_ingress',connectionId:connection.id,...drops}));
}

async function publishDelivery(env:Env,id:string,now:number): Promise<boolean> {
  try {
    if (!env.EVENT_DELIVERIES) throw new Error('Queue unavailable');
    await env.EVENT_DELIVERIES.send(id,{contentType:'json'});
    await env.DB.prepare("UPDATE event_deliveries SET published_at = ? WHERE id = ? AND state = 'pending' AND body IS NOT NULL AND deadline_at > ? AND expires_at > ?")
      .bind(now,id,now,now).run();
    return true;
  } catch { return false; } // A failed publication or read-back leaves the D1 outbox recoverable.
}

async function finish(db:D1Database,id:string,lease:string,state:string,result:string): Promise<void> {
  const now=Date.now();
  const finished=await db.prepare(`UPDATE event_deliveries SET state = CASE WHEN deadline_at <= ? OR NOT EXISTS (SELECT 1 FROM event_subscriptions s WHERE s.id = event_deliveries.subscription_id AND s.expires_at > ?) THEN 'expired' ELSE ? END,
    result_code = ?, body = NULL, lease_token = NULL, lease_until = NULL WHERE id = ? AND state = 'delivering' AND lease_token = ? AND lease_until > ? RETURNING state`)
    .bind(now,now,state,result,id,lease,now).first<{state:string}>();
  if (finished) console.log(JSON.stringify({event:'mcp_events_delivery',state:finished.state,count:1}));
}

async function enforceDeliveryLimits(db:D1Database,id:string,now:number): Promise<void> {
  const results=await db.batch([
    db.prepare("UPDATE event_deliveries SET state = 'expired', body = NULL, result_code = 'deadline', lease_token = NULL, lease_until = NULL WHERE id = ? AND (deadline_at <= ? OR expires_at <= ?) AND state IN ('pending','delivering')").bind(id,now,now),
    db.prepare("UPDATE event_deliveries SET state = 'failed', body = NULL, result_code = 'attempt_limit', lease_token = NULL, lease_until = NULL WHERE id = ? AND attempts >= ? AND (state = 'pending' OR (state = 'delivering' AND lease_until <= ?))").bind(id,MAX_ATTEMPTS,now),
  ]);
  if (results[0].meta.changes || results[1].meta.changes) console.log(JSON.stringify({event:'mcp_events_limits',expired:results[0].meta.changes,failed:results[1].meta.changes}));
}

/** Queue bodies contain only IDs; ownership of a bounded attempt is conditional in D1. */
export async function consumeEventDeliveries(batch:MessageBatch<unknown>,env:Env,oauth:EventGrantReader): Promise<void> {
  if (batch.queue==='wapilot-events-failed' || batch.queue==='wapilot-events-failed-local') {
    let failures=0,invalid=0;
    for (const message of batch.messages) {
      if (typeof message.body==='string') {
        try {
          await enforceDeliveryLimits(env.DB,message.body,Date.now());
          await env.DB.prepare("UPDATE event_deliveries SET published_at = NULL WHERE id = ? AND state = 'pending' AND body IS NOT NULL AND deadline_at > ? AND expires_at > ? AND attempts < ?")
            .bind(message.body,Date.now(),Date.now(),MAX_ATTEMPTS).run();
        } catch { failures++; } // Cron independently recovers lost publications.
      } else invalid++;
      message.ack();
    }
    console.log(JSON.stringify({event:'mcp_events_dlq',drained:batch.messages.length,failures,invalid}));
    return;
  }
  for (const message of batch.messages) {
    if (typeof message.body !== 'string') {message.ack(); continue;}
    const id=message.body, lease=crypto.randomUUID(), now=Date.now();
    await enforceDeliveryLimits(env.DB,id,now);
    const delivery=await env.DB.prepare(`UPDATE event_deliveries SET state = 'delivering', lease_token = ?, lease_until = ?, attempts = attempts+1, published_at = NULL,
      next_attempt_at = MIN(deadline_at, ? + MIN(60000 * (1 << attempts), 900000))
      WHERE id = ? AND body IS NOT NULL AND deadline_at > ? AND expires_at > ? AND attempts < ? AND next_attempt_at <= ? AND (state = 'pending' OR (state = 'delivering' AND lease_until <= ?)) RETURNING *`)
      .bind(lease,now+LEASE,now,id,now,now,MAX_ATTEMPTS,now,now).first<Delivery>();
    if (!delivery) {message.ack(); continue;}
    const sub=await env.DB.prepare('SELECT * FROM event_subscriptions WHERE id = ?').bind(delivery.subscription_id).first<Subscription>();
    try {
      if (!sub || sub.state !== 'active' || sub.expires_at <= Date.now() || !sub.encrypted_secret) {
        await finish(env.DB,id,lease,'cancelled','authorization'); message.ack(); continue;
      }
      const authorizationRemaining=Math.min(sub.expires_at,delivery.deadline_at,delivery.lease_until)-Date.now();
      if (authorizationRemaining<=0) throw new CallbackSenderError('timeout');
      let authorizationTimer:ReturnType<typeof setTimeout>;
      const authorized=await Promise.race([
        new Promise<boolean>((_,reject)=>{authorizationTimer=setTimeout(()=>reject(new CallbackSenderError('timeout')),authorizationRemaining);}),
        eventAuthorizationValid(env.DB,oauth,principal(sub),sub.connection_id),
      ]).finally(()=>clearTimeout(authorizationTimer));
      if (!authorized) {
        await finish(env.DB,id,lease,'cancelled','authorization'); message.ack(); continue;
      }
      const secrets=[await decryptToken(sub.encrypted_secret,env.TOKEN_ENCRYPTION_KEY)];
      if (sub.encrypted_previous_secret && (sub.previous_secret_until ?? 0)>Date.now()) secrets.push(await decryptToken(sub.encrypted_previous_secret,env.TOKEN_ENCRYPTION_KEY));
      const headers=await eventWebhookHeaders(secrets,delivery.body!,delivery.event_id,sub.id);
      const until=Math.min(sub.expires_at,delivery.deadline_at,delivery.lease_until,secrets.length>1 ? sub.previous_secret_until! : Infinity), remaining=until-Date.now();
      if (remaining<=0) throw new CallbackSenderError('timeout');
      const current=await env.DB.prepare(`UPDATE event_deliveries SET lease_until = lease_until WHERE id = ? AND state = 'delivering' AND lease_token = ? AND lease_until > ? AND deadline_at > ? AND body IS NOT NULL
        AND EXISTS (SELECT 1 FROM event_subscriptions s JOIN users u ON u.id = s.user_id JOIN whatsapp_connections c ON c.id = s.connection_id AND c.user_id = u.id
        WHERE s.id = event_deliveries.subscription_id AND s.state = 'active' AND s.expires_at > ? AND u.status = 'active'
        AND NOT EXISTS (SELECT 1 FROM event_grant_revocations r WHERE r.user_id = s.user_id AND r.grant_id = s.grant_id AND r.expires_at > ?)) RETURNING id`)
        .bind(id,lease,Date.now(),Date.now(),Date.now(),Date.now()).first();
      if (!current) {await finish(env.DB,id,lease,'cancelled','authorization');message.ack();continue;}
      const sendRemaining=until-Date.now();
      if (sendRemaining<=0) throw new CallbackSenderError('timeout');
      const response=await sendCallback(env,{url:sub.callback_url,body:delivery.body!,headers},until);
      if (response.status>=200 && response.status<300) {await finish(env.DB,id,lease,'accepted','http_2xx');message.ack();continue;}
      if (response.status!==408 && response.status!==429 && response.status<500) {await finish(env.DB,id,lease,'failed','http_'+response.status);message.ack();continue;}
      throw new Error('Callback unavailable');
    } catch (error) {
      if (error instanceof CallbackSenderError && (error.reason==='invalid_request' || error.reason==='destination_blocked')) {
        await finish(env.DB,id,lease,'failed',error.code);message.ack();continue;
      }
      if (Date.now()>=delivery.deadline_at || (sub && Date.now()>=sub.expires_at)) {await finish(env.DB,id,lease,'expired','deadline');message.ack();continue;}
      if (delivery.attempts>=MAX_ATTEMPTS) {await finish(env.DB,id,lease,'failed','attempt_limit');message.ack();continue;}
      const next=Math.min(delivery.deadline_at,Date.now()+Math.min(60000*2**(delivery.attempts-1),900000));
      const deferred=await env.DB.prepare("UPDATE event_deliveries SET state = 'pending', next_attempt_at = ?, published_at = NULL, lease_token = NULL, lease_until = NULL, result_code = 'unavailable' WHERE id = ? AND state = 'delivering' AND lease_token = ? AND lease_until > ?")
        .bind(next,id,lease,Date.now()).run();
      if (deferred.meta.changes) {console.log(JSON.stringify({event:'mcp_events_delivery',state:'retry',count:1}));message.retry({delaySeconds:Math.max(1,Math.ceil((next-Date.now())/1000))});}
      else message.ack();
    }
  }
}

export async function cleanupEventDeliveries(db:D1Database,now=Date.now()): Promise<void> {
  await db.batch([
    db.prepare("UPDATE event_deliveries SET state = CASE WHEN deadline_at <= ? THEN 'expired' ELSE 'cancelled' END, body = NULL, lease_token = NULL, lease_until = NULL, result_code = 'expired_or_invalid' WHERE state IN ('pending','delivering') AND (deadline_at <= ? OR NOT EXISTS (SELECT 1 FROM event_subscriptions s JOIN users u ON u.id = s.user_id JOIN whatsapp_connections c ON c.id = s.connection_id AND c.user_id = u.id WHERE s.id = event_deliveries.subscription_id AND s.state = 'active' AND s.expires_at > ? AND u.status = 'active' AND NOT EXISTS (SELECT 1 FROM event_grant_revocations r WHERE r.user_id = s.user_id AND r.grant_id = s.grant_id AND r.expires_at > ?)))").bind(now,now,now,now),
    db.prepare('DELETE FROM event_deliveries WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM event_sources WHERE expires_at <= ?').bind(now),
  ]);
}

/** D1, rather than broker attempts or publication count, owns the delivery budget. */
export async function recoverEventDeliveries(env:Env,now=Date.now()) {
  const exhausted=await env.DB.prepare("UPDATE event_deliveries SET state = 'failed', body = NULL, lease_token = NULL, lease_until = NULL, result_code = 'attempt_limit' WHERE attempts >= ? AND (state = 'pending' OR (state = 'delivering' AND lease_until <= ?))")
    .bind(MAX_ATTEMPTS,now).run();
  const recovered=await env.DB.prepare("UPDATE event_deliveries SET state = 'pending', lease_token = NULL, lease_until = NULL, published_at = NULL, result_code = 'lease_expired' WHERE state = 'delivering' AND lease_until <= ? AND deadline_at > ? AND expires_at > ? AND body IS NOT NULL")
    .bind(now,now,now).run();
  const due=await env.DB.prepare("SELECT id FROM event_deliveries WHERE state = 'pending' AND body IS NOT NULL AND deadline_at > ? AND expires_at > ? AND attempts < ? AND next_attempt_at <= ? AND (published_at IS NULL OR published_at <= ?) ORDER BY COALESCE(published_at,0),received_at LIMIT 100")
    .bind(now,now,MAX_ATTEMPTS,now,now-LEASE).all<{id:string}>();
  let publications=0,failures=0;
  for (const row of due.results) {if (await publishDelivery(env,row.id,now)) publications++;else failures++;}
  const gauges=await env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN state IN ('pending','delivering') AND body IS NOT NULL THEN 1 ELSE 0 END),0) AS backlog, COALESCE(SUM(MAX(attempts-1,0)),0) AS retries, COALESCE(SUM(state = 'failed'),0) AS failures FROM event_deliveries WHERE expires_at > ?")
    .bind(now).first<{backlog:number;retries:number;failures:number}>();
  return {...gauges,lease_recoveries:recovered.meta.changes,attempt_limit_failures:exhausted.meta.changes,publication_recoveries:publications,publication_failures:failures};
}
