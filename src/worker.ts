import { createOAuthProvider, oauthOptions } from './lib/oauth';
import { getOAuthApi } from '@cloudflare/workers-oauth-provider';
import { consumeEventDeliveries, cleanupEventDeliveries, recoverEventDeliveries } from './lib/event-deliveries';
import { cleanupEventSubscriptions } from './lib/mcp-events';
import { cleanupSendOperations } from './lib/send-idempotency';
import app from './index';
import type { Env } from './types';

export { CallbackSender } from './lib/sender-container';

/** OAuthProvider owns `/mcp`, discovery, PKCE, token, registration and
 * revocation. Hono is the fallback for health/UI/webhook routes. */
export default {
  async queue(batch:MessageBatch<unknown>,env:Env): Promise<void> {
    const base=(env.MCP_PUBLIC_URL ?? '').replace(/\/$/,'');
    try {await consumeEventDeliveries(batch,env,getOAuthApi(oauthOptions(base),env));}
    catch {console.log(JSON.stringify({event:'mcp_events_queue',infrastructure_failures:1}));batch.retryAll({delaySeconds:60});}
  },
  async scheduled(controller:ScheduledController,env:Env): Promise<void> {
    const now=Math.max(Date.now(),controller.scheduledTime);
    const due=await env.DB.prepare(`SELECT
      (SELECT MIN(CASE WHEN body IS NOT NULL THEN MIN(deadline_at,expires_at) ELSE expires_at END) FROM event_deliveries) AS deliveries,
      (SELECT MIN(expires_at) FROM event_sources) AS sources,
      (SELECT MIN(expires_at+86400000) FROM event_subscriptions) AS subscriptions,
      (SELECT MIN(expires_at) FROM event_subscriptions WHERE encrypted_secret IS NOT NULL) AS subscription_secrets,
      (SELECT MIN(previous_secret_until) FROM event_subscriptions WHERE encrypted_previous_secret IS NOT NULL) AS rotation_keys,
      (SELECT MIN(expires_at) FROM event_grant_revocations) AS revocations,
      (SELECT MIN(expires_at) FROM send_operations) AS sends`).first<Record<string,number|null>>();
    const cleanupLag=Math.max(0,now-Math.min(now,...Object.values(due ?? {}).map(value=>value ?? now)));
    await cleanupEventDeliveries(env.DB,now);
    await cleanupEventSubscriptions(env.DB,now);
    await cleanupSendOperations(env.DB,now);
    const recovery=await recoverEventDeliveries(env,now);
    console.log(JSON.stringify({event:'mcp_events_maintenance',...recovery,cleanup_lag_ms:cleanupLag,schedule_lag_ms:Math.max(0,Date.now()-controller.scheduledTime)}));
  },
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = new URL(request.url).origin;
    const base = origin.includes('localhost') ? (env.MCP_PUBLIC_URL ?? origin) : origin;
    return createOAuthProvider(base, app.fetch.bind(app)).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
