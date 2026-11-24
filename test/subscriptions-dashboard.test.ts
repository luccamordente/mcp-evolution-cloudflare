import { expect, it } from 'vitest';
import { eventRuntime } from './helpers/mcp-events-runtime';

it('shows only the selected owner’s subscriptions and delivery metadata, and keeps a dashboard stop across cleanup and renewals', async () => {
  let holdNextVerification = false;
  let verificationStarted: (() => void) | undefined;
  let releaseVerification: (() => void) | undefined;
  let requests = 0;
  const fixture = await eventRuntime(async request => {
    requests++;
    const callback = await request.json() as { body: string };
    if (holdNextVerification) {
      holdNextVerification = false;
      await new Promise<void>(resolve => {
        releaseVerification = resolve;
        verificationStarted?.();
      });
    }
    return Response.json({ status: 200, body: JSON.stringify({ challenge: JSON.parse(callback.body).challenge }) });
  });
  try {
    const owner = await fixture.issue();
    const foreign = await fixture.issue({ email: 'foreign@example.test' });
    const path = (connectionId: string) => '/connections/api/connections/' + connectionId + '/subscriptions';
    const connectionId = owner.connections[0];
    const url = 'https://receiver.example.test/callback/path?key=fixture-only';
    const secret = 'whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
    const input = { name: 'message.received', arguments: { connectionId, conversationId: 'conversation-a' }, delivery: { mode: 'webhook', url, secret } };
    const registered = await fixture.rpc(owner.accessToken, 'events/subscribe', input);
    const id = registered.body.result.id as string;
    const sibling = await fixture.rpc(owner.accessToken, 'events/subscribe', { ...input, arguments: { connectionId, conversationId: 'conversation-b' } });
    const detailPath = path(connectionId) + '/' + id;
    const now = Date.now();
    await fixture.db.batch(Array.from({length: 22}, (_, index) => {
      const sourceId = crypto.randomUUID(), deliveryId = crypto.randomUUID();
      const receivedAt = now - index * 1000;
      return [
        fixture.db.prepare('INSERT INTO event_sources (id, connection_id, message_id, received_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(sourceId, connectionId, 'message-' + index, receivedAt, receivedAt + 86_400_000),
        fixture.db.prepare("INSERT INTO event_deliveries (id, source_id, subscription_id, event_id, body, state, received_at, deadline_at, expires_at, attempts, next_attempt_at, result_code) VALUES (?,?,?,?,?,'pending',?,?,?,2,?,'unavailable')")
          .bind(deliveryId, sourceId, id, 'event-' + index, 'private-preview', receivedAt, receivedAt + 3_600_000, receivedAt + 86_400_000, receivedAt + 1000),
      ];
    }).flat());

    const list = await fixture.fetch(path(connectionId));
    expect(list.headers.get('cache-control')).toBe('no-store');
    const { subscriptions } = await list.json() as { subscriptions: Array<{ id: string; [key: string]: unknown }> };
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions.find(item => item.id === id)).toMatchObject({
      id, appName: 'Fixture', authorizationId: owner.grantId, authorization: 'valid', state: 'active', callbackUrl: url,
      conversationId: 'conversation-a', eventName: input.name, activatedAt: expect.any(String), expiresAt: expect.any(String),
    });
    expect(JSON.stringify(subscriptions)).not.toMatch(/encrypted_secret|providerUserId|whsec_/);
    expect((await fixture.fetch(path(owner.connections[1]) + '/' + id)).status).toBe(404);
    expect((await fixture.fetch(path(foreign.connections[0]))).status).toBe(404);
    expect((await fixture.fetch(path(owner.connections[1]) + '/' + id, { method: 'DELETE' })).status).toBe(404);

    const details = await (await fixture.fetch(detailPath)).json() as { deliveries: Array<{ messageId: string }>; nextCursor: string };
    expect(details.deliveries).toHaveLength(20);
    expect(details.deliveries[0]).toMatchObject({ messageId: 'message-0', state: 'pending', result: 'unavailable', attempts: 2, receivedAt: new Date(now).toISOString() });
    expect(JSON.stringify(details)).not.toContain('private-preview');
    const more = await (await fixture.fetch(detailPath + '?cursor=' + encodeURIComponent(details.nextCursor))).json() as typeof details;
    expect(more.deliveries.map(entry => entry.messageId)).toEqual(['message-20', 'message-21']);
    expect((await fixture.fetch(detailPath + '?cursor=bad')).status).toBe(400);

    // A renewal already verifying its callback cannot win after the owner stops the subscription.
    await fixture.db.prepare('UPDATE event_subscriptions SET verified_until = 1 WHERE id IN (?, ?)').bind(id, sibling.body.result.id).run();
    const started = new Promise<void>(resolve => { verificationStarted = resolve; });
    holdNextVerification = true;
    const renewal = fixture.rpc(owner.accessToken, 'events/subscribe', input);
    await started;
    const stopped = await fixture.fetch(detailPath, { method: 'DELETE' });
    releaseVerification!();
    expect(stopped.status).toBe(200);
    expect((await renewal).body.error).toMatchObject({ code: -32003, message: expect.stringContaining('owner ended') });
    expect((await fixture.fetch(detailPath, { method: 'DELETE' })).status).toBe(200);
    expect(await fixture.db.prepare('SELECT state, body FROM event_deliveries WHERE subscription_id = ? GROUP BY state, body').bind(id).all())
      .toMatchObject({ results: [{ state: 'cancelled', body: null }] });
    expect(await (await fixture.fetch(path(connectionId))).json()).toMatchObject({ subscriptions: [{ id: sibling.body.result.id, state: 'active' }] });
    expect(await (await fixture.fetch(path(connectionId) + '?recent=1')).json()).toMatchObject({ subscriptions: [{ id, state: 'cancelled', endedAt: expect.any(String) }] });

    const ended = await fixture.db.prepare('SELECT expires_at FROM event_subscriptions WHERE id = ?').bind(id).first<{ expires_at: number }>();
    expect((await fixture.scheduled(ended!.expires_at + 86_400_000)).outcome).toBe('ok');
    expect((await fixture.fetch(detailPath)).status).toBe(404);
    const beforeRetry = requests;
    expect((await fixture.rpc(owner.accessToken, 'events/subscribe', input)).body.error.code).toBe(-32003);
    expect(requests).toBe(beforeRetry);

    const newGrant = await fixture.issue({ clientId: owner.clientId });
    const newSubscription = await fixture.rpc(newGrant.accessToken, 'events/subscribe', input);
    expect(newSubscription.body.result.id).toMatch(/^sub_/);
    expect(newSubscription.body.result.id).not.toBe(id);
  } finally {
    releaseVerification?.();
    await fixture.runtime.dispose();
  }
}, 20_000);
