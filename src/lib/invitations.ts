import { createClerkClient } from '@clerk/backend';
import { isClerkAPIResponseError } from '@clerk/backend/errors';
import { browserOrigin } from './auth';
import type { Env } from '../types';

export class InvitationError extends Error {
  constructor(public readonly status: 409 | 502 | 503, message: string) { super(message); }
}

type InvitationResult = { userId: string; state: 'pending' | 'awaiting_activation' | 'active' };
type PendingUser = { id: string; email: string; status: string; clerkUserId: string | null; pendingAt: string | null };
const conflict = () => new InvitationError(409, 'O estado desta conta exige conferência administrativa no WaPilot.');
const unavailable = () => new InvitationError(503, 'Não foi possível conferir o convite ao WaPilot.');
const canonicalEmail = (email: string) => email.trim().toLowerCase();

function clerkFailure(error: unknown): never {
  if (error instanceof InvitationError) throw error;
  const status = isClerkAPIResponseError(error) ? error.status : undefined;
  throw new InvitationError(status && status < 500 && status !== 429 ? 502 : 503, 'Não foi possível confirmar a operação de convite no WaPilot.');
}

async function invitationState(client: ReturnType<typeof createClerkClient>, email: string): Promise<'pending' | 'awaiting_activation' | 'revoked' | 'expired' | undefined> {
  let offset = 0;
  do {
    const page = await client.users.getUserList({ emailAddress: [email], limit: 100, offset });
    if (page.data.some(user => user.emailAddresses.some(address => canonicalEmail(address.emailAddress) === email))) return 'awaiting_activation';
    offset += page.data.length;
    if (!Number.isSafeInteger(page.totalCount) || page.totalCount < 0 || (!page.data.length && offset < page.totalCount)) throw unavailable();
    if (offset >= page.totalCount) break;
  } while (true);
  for (const status of ['pending', 'accepted', 'revoked', 'expired'] as const) {
    offset = 0;
    do {
      const page = await client.invitations.getInvitationList({ query: email, status, limit: 100, offset });
      const invitation = page.data.find(invite => canonicalEmail(invite.emailAddress) === email);
      if (invitation) {
        if (invitation.status === 'accepted') return 'awaiting_activation';
        if (['pending', 'revoked', 'expired'].includes(invitation.status)) return invitation.status as 'pending' | 'revoked' | 'expired';
        throw unavailable();
      }
      offset += page.data.length;
      if (!Number.isSafeInteger(page.totalCount) || page.totalCount < 0 || (!page.data.length && offset < page.totalCount)) throw unavailable();
      if (offset >= page.totalCount) break;
    } while (true);
  }
}

export async function inviteUser(env: Env, email: string): Promise<[InvitationResult, 200 | 201]> {
  const userId = crypto.randomUUID();
  const reserved = await env.DB.prepare("INSERT INTO users (id, email, status, invite_pending_at) VALUES (?, ?, 'disabled', ?) ON CONFLICT(email) DO NOTHING").bind(userId, email, new Date().toISOString()).run();
  const owner = await env.DB.prepare('SELECT id, email, status, clerk_user_id AS clerkUserId, invite_pending_at AS pendingAt FROM users WHERE email = ?').bind(email).first<PendingUser>();
  if (!owner || owner.status !== 'disabled' || !owner.pendingAt || owner.clerkUserId) throw conflict();
  const client = createClerkClient({ secretKey: env.CLERK_SECRET_KEY, publishableKey: env.CLERK_PUBLISHABLE_KEY });
  const state = await invitationState(client, email).catch(clerkFailure);
  if (state === 'revoked' || state === 'expired') throw conflict();
  if (state) return [{ userId: owner.id, state }, 200];
  // An existing reservation may have an in-flight or unconfirmed send; only read it back.
  if (reserved.meta.changes !== 1) throw unavailable();
  const invitation = await client.invitations.createInvitation({ emailAddress: email, redirectUrl: browserOrigin(env) + '/accept-invitation', ignoreExisting: false }).catch(clerkFailure);
  if (!invitation.id || invitation.emailAddress !== email || invitation.status !== 'pending') throw new InvitationError(502, 'O envio do convite ao WaPilot precisa de conferência administrativa.');
  return [{ userId: owner.id, state: 'pending' }, 201];
}

export async function activateInvitedUser(env: Env, userId: string, clerkUserId: string): Promise<InvitationResult> {
  const owner = await env.DB.prepare('SELECT id, email, status, clerk_user_id AS clerkUserId, invite_pending_at AS pendingAt FROM users WHERE id = ?').bind(userId).first<PendingUser>();
  if (!owner || !((owner.status === 'disabled' && owner.pendingAt && !owner.clerkUserId) || (owner.status === 'active' && owner.clerkUserId === clerkUserId && !owner.pendingAt))) throw conflict();
  const client = createClerkClient({ secretKey: env.CLERK_SECRET_KEY, publishableKey: env.CLERK_PUBLISHABLE_KEY });
  const user = await client.users.getUser(clerkUserId).catch(error => {
    if (isClerkAPIResponseError(error) && error.status === 404) throw conflict();
    return clerkFailure(error);
  });
  if (!user || ('deleted' in user && user.deleted === true) || !Array.isArray(user.emailAddresses)) throw conflict();
  const primary = user.emailAddresses.find(address => address.id === user.primaryEmailAddressId);
  if (user.id !== clerkUserId || user.banned !== false || user.locked || user.deprovisioned || !primary || primary.verification?.status !== 'verified' || canonicalEmail(primary.emailAddress) !== owner.email) throw conflict();
  if (owner.status === 'disabled') await env.DB.prepare(`UPDATE users SET clerk_user_id = ?1, status = 'active', invite_pending_at = NULL, updated_at = datetime('now')
    WHERE id = ?2 AND email = ?3 AND status = 'disabled' AND invite_pending_at = ?4 AND clerk_user_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM users WHERE clerk_user_id = ?1 AND id != ?2)`).bind(clerkUserId, userId, owner.email, owner.pendingAt).run();
  const current = await env.DB.prepare('SELECT status, clerk_user_id AS clerkUserId, invite_pending_at AS pendingAt FROM users WHERE id = ?').bind(userId).first<Pick<PendingUser, 'status' | 'clerkUserId' | 'pendingAt'>>();
  if (current?.status !== 'active' || current.clerkUserId !== clerkUserId || current.pendingAt) throw conflict();
  return { userId, state: 'active' };
}
