import type { Env } from '../types';
import { invalidateEventGrant } from '../lib/mcp-events';
import { getOAuthApi, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { oauthOptions } from '../lib/oauth';
import { browserOrigin, clerkFrontend } from '../lib/auth';
import { createClerkClient } from '@clerk/backend';

interface MaintenanceEnv extends Env { MAINTENANCE_USER_ID?: string }

async function grantIds(oauth: Pick<OAuthHelpers, 'listUserGrants'>, userId: string): Promise<string[]> {
  const ids = new Set<string>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(userId, { limit: 100, ...(cursor ? { cursor } : {}) });
    for (const grant of page.items) ids.add(grant.id);
    cursor = page.cursor;
    if (cursor && seen.has(cursor)) throw new Error();
    if (cursor) seen.add(cursor);
  } while (cursor);
  return [...ids];
}

export default {
  async scheduled(_controller: ScheduledController, env: MaintenanceEnv, _ctx: ExecutionContext): Promise<void> {
    const report = { event: 'wapilot_user_deactivation', disabled: false, sessionsRevoked: false, grantsRevoked: 0, grantsRemaining: null as number | null, complete: false, errors: [] as string[] };
    const fail = (step: string) => { if (!report.errors.includes(step)) report.errors.push(step); };
    let stage = 'configuration';
    try {
      const id = env.MAINTENANCE_USER_ID;
      if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error();
      stage = 'identity';
      const user = await env.DB.prepare("UPDATE users SET status = 'disabled', invite_pending_at = NULL, updated_at = datetime('now') WHERE id = ? RETURNING id, email, clerk_user_id AS clerkUserId").bind(id).first<{ id: string; email: string; clerkUserId: string | null }>();
      if (!user) throw new Error();
      report.disabled = true;
      stage = 'local_events';
      const local = await env.DB.prepare('SELECT DISTINCT grant_id AS grantId FROM event_subscriptions WHERE user_id = ?').bind(user.id).all<{ grantId: string }>();
      for (const grant of local.results) await invalidateEventGrant(env.DB, user.id, grant.grantId);
      stage = 'provider_configuration';
      const oauth = getOAuthApi(oauthOptions(browserOrigin(env)), env);
      const subject = encodeURIComponent(user.email);
      try {
        const ids = await grantIds(oauth, subject);
        for (const grantId of ids) {
          try {
            await invalidateEventGrant(env.DB, user.id, grantId);
            await oauth.revokeGrant(grantId, subject);
            report.grantsRevoked++;
          } catch { fail('provider_revoke'); }
        }
        report.grantsRemaining = (await grantIds(oauth, subject)).length;
        if (report.grantsRemaining) fail('provider_readback');
      } catch { fail('provider_list'); }
      if (!user.clerkUserId) fail('clerk_identity_unlinked');
      else {
        try {
          if (!env.CLERK_SECRET_KEY) throw new Error();
          clerkFrontend(env);
          const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY, publishableKey: env.CLERK_PUBLISHABLE_KEY });
          const identity = await clerk.users.getUser(user.clerkUserId);
          if (identity.id !== user.clerkUserId) throw new Error();
          if (!identity.banned) await clerk.users.banUser(user.clerkUserId);
          const confirmed = await clerk.users.getUser(user.clerkUserId);
          if (confirmed.id !== user.clerkUserId || confirmed.banned !== true) throw new Error();
          report.sessionsRevoked = true;
        } catch { fail('clerk_sessions'); }
      }
      report.complete = report.errors.length === 0 && report.grantsRemaining === 0 && report.sessionsRevoked;
    } catch { fail(stage); }
    console.log(JSON.stringify(report));
  },
} satisfies ExportedHandler<MaintenanceEnv>;
