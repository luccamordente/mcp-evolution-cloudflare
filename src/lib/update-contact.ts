import { z } from 'zod';
import { sha256 } from './db';
import { EvolutionApiError } from './evolution';

export const contactId = z
  .string()
  .trim()
  .regex(/^(?:\+?[1-9]\d{3,19}|\d{1,20}@(lid|s\.whatsapp\.net))$/);
const labelId = z.string().trim().min(1).max(200);
const operation = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('add_label'), labelId }),
  z.strictObject({ kind: z.literal('remove_label'), labelId }),
  z.strictObject({ kind: z.literal('block') }),
  z.strictObject({ kind: z.literal('unblock') }),
]);
export const updateContactInput = z.strictObject({
  contactId,
  operation,
  options: z
    .strictObject({
      connectionId: z.uuid().optional(),
      idempotencyKey: z.string().trim().min(1).max(200).optional(),
    })
    .optional(),
});
export type ContactCommand = Pick<
  z.infer<typeof updateContactInput>,
  'contactId' | 'operation'
>;
export const contactResult = z.object({
  contactId,
  operation: z.enum(['add_label', 'remove_label', 'block', 'unblock']),
  status: z.enum(['unchanged', 'confirmed', 'accepted']),
});
export type ContactResult = z.infer<typeof contactResult>;
export class ContactUpdateError extends Error {
  constructor(
    readonly code:
      | 'contact_result_unknown'
      | 'idempotency_conflict'
      | 'contact_update_pending',
    message: string,
  ) {
    super(message);
  }
}

export async function reservedContactUpdate(
  db: D1Database,
  userId: string,
  connectionId: string,
  key: string,
  command: ContactCommand,
  dispatch: () => Promise<ContactResult>,
): Promise<ContactResult> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const hash = await sha256(JSON.stringify(command));
  const row = await db
    .prepare(
      `INSERT INTO send_operations
    (id,user_id,connection_id,operation,idempotency_key,arguments_hash,state,expires_at)
    VALUES (?,?,?,'update_contact',?,?,'pending',?)
    ON CONFLICT(user_id,connection_id,operation,idempotency_key) DO UPDATE SET
    id=excluded.id, arguments_hash=excluded.arguments_hash,state='pending',result_json=NULL,expires_at=excluded.expires_at
    WHERE send_operations.expires_at<=? RETURNING id`,
    )
    .bind(id, userId, connectionId, key, hash, now + 86400000, now)
    .first();
  if (!row) {
    const saved = await db
      .prepare(
        "SELECT arguments_hash,state,result_json FROM send_operations WHERE user_id=? AND connection_id=? AND operation='update_contact' AND idempotency_key=?",
      )
      .bind(userId, connectionId, key)
      .first<{ arguments_hash: string; state: string; result_json: string }>();
    if (saved && saved.arguments_hash !== hash)
      throw new ContactUpdateError(
        'idempotency_conflict',
        'This key belongs to a different contact update.',
      );
    if (saved?.state === 'unknown')
      throw new ContactUpdateError(
        'contact_result_unknown',
        'The earlier update may have applied. Inspect the contact.',
      );
    if (saved?.state === 'completed')
      return contactResult.parse(JSON.parse(saved.result_json));
    throw new ContactUpdateError(
      'contact_update_pending',
      'Inspect the contact before taking further action.',
    );
  }
  let result: ContactResult;
  try {
    result = await dispatch();
  } catch (error) {
    if (
      error instanceof EvolutionApiError &&
      [400, 401, 403, 404, 422].includes(error.status)
    ) {
      await db.prepare('DELETE FROM send_operations WHERE id=?').bind(id).run();
    } else {
      await db
        .prepare("UPDATE send_operations SET state='unknown' WHERE id=?")
        .bind(id)
        .run()
        .catch(() => undefined);
    }
    throw error;
  }
  try {
    await db
      .prepare(
        "UPDATE send_operations SET state='completed',result_json=? WHERE id=?",
      )
      .bind(JSON.stringify(result), id)
      .run();
  } catch {
    /* The pending reservation still prevents duplicate dispatch. */
  }
  return result;
}
