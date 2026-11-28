# Update one or more WhatsApp messages

Add one WaPilot tool, `update_message`, for actions on explicitly identified existing messages. One call applies one action to one or more messages on one connection. This includes reactions and poll votes, which send protocol updates that target an existing message. Replies, forwards, and new Status posts belong to `send_message`. Chat unread markers, typing, and conversation settings operate on the conversation. [Upstream inventory](../research/message-write-operations.md)

## Tool contract

Pass the message and conversation IDs returned by `search_messages` or `get_message`. A single message uses the same array shape as a batch.

```json
{
  "targets": [
    {"conversationId": "120363000000001@g.us", "messageId": "message-a"},
    {"conversationId": "120363000000001@g.us", "messageId": "message-b"}
  ],
  "operation": {"kind": "mark_read"},
  "options": {"idempotencyKey": "read-selected-messages-1"}
}
```

```json
{
  "targets": [{"conversationId": "15550001111@s.whatsapp.net", "messageId": "message-c"}],
  "operation": {"kind": "edit_text", "text": "I meant Thursday."}
}
```

The initial schema has eight operation variants. Each accepts the fields listed here.

| Kind | Fields and effect |
| --- | --- |
| `edit_text` | `text`. Replace the text of an eligible self-authored text message. Every selected message gets the supplied text. |
| `delete_for_everyone` | Revoke an eligible self-authored message for participants. Group-admin revocation of another author's message is a later extension. |
| `mark_read` | Dispatch a read receipt for each eligible incoming message, subject to WhatsApp receipt privacy behavior. |
| `mark_played` | Dispatch a played receipt for each eligible incoming voice message. |
| `set_reaction` | `emoji`. Set or replace this account's reaction. |
| `remove_reaction` | Clear this account's reaction. |
| `add_label` | `labelId`. Apply an existing Business label to the message. |
| `remove_label` | `labelId`. Remove that Business label from the message. |

Start with 1–10 targets per call and validate that limit with the real stack before release. Use a strict discriminated union for `operation.kind`, strict target and option objects, and the existing message and connection ID conventions. Reject structurally duplicate targets before dispatch. Resolve aliases to one canonical target and reject duplicate canonical targets before dispatch. The input cap is 4,096 UTF-16 units for replacement text and 200 for each identifier. A reaction takes one emoji. Verify these inputs on linked devices before release. An optional `options.connectionId` uses the existing default connection resolution when omitted. An optional `options.idempotencyKey` enables same-key result recovery.

Each result identifies its input target and appears in input order. One batch can succeed in part. A structured result carries `data.connectionId`, `data.operation`, and `data.items`. Set `isError` when any item has a failure or unknown outcome and preserve successful items.

| Item outcome | Meaning |
| --- | --- |
| `accepted` | The write completed at its dispatch boundary. This can be a send acknowledgement, a receipt dispatch, or an app-state write response. Visibility to recipients or linked devices is a separate observation. |
| `rejected` | An authoritative rule or explicit provider rejection prevented the action. Examples include an outbound message selected for a read receipt, a mismatched conversation, or a missing retained target. |
| `unknown` | Dispatch may have taken effect. The outcome could not be established. |
| `not_started` | The system can establish that dispatch never began. Examples include a deadline before the item started or a disconnected connection detected during preflight. |

Include stable, sanitized error codes and an optional action ID, distinct from the target message ID. Timeouts, lost responses, and malformed success responses after starting a write return `unknown` with `retryable: false`. A transport failure that loses the entire provider response can make the whole submitted batch unknown. A batch is a collection of writes with individual outcomes. A completed write stands if a later item fails.

The choice of one operation plus explicit targets keeps the batch intent visible and supports grouping read receipts behind the provider boundary. A mixed `commands[]` design would support different edits in one call. It would also introduce same-target ordering, dependencies between effects, and more complicated partial recovery. Use separate calls for different actions or replacement texts.

## Evolution Go contract

Add an instance-authenticated `POST /message/actions` with a versioned JSON:API request and result. The contract under test uses request `data.type = "messageAction"` and `data.attributes = {version: 1, targets, operation}`. A processed batch returns HTTP 200 with `data.type = "messageActionResult"`, a result resource ID, and `data.attributes = {version: 1, items}`. Each item carries the input `conversationId` and `messageId`, its outcome, and applicable error or action ID. The result resource ID identifies the batch response. Retain the existing routes for their consumers and implement the new work in the message service. A single typed request contains the operation, explicit target pairs, and bounded action parameters. The endpoint recognizes one [Unicode 17 RGI emoji](https://www.unicode.org/Public/17.0.0/emoji/emoji-sequences.txt) per reaction. The response contains one action result per target. Make whole-request validation and endpoint-unavailable errors distinguishable from a response lost after dispatch. Use request context and one end-to-end deadline. Set the provider deadline inside the WaPilot request budget so the provider has time to return partial outcomes.

Before dispatch, resolve each target inside the authenticated instance's retained message catalog. Verify the supplied conversation through the authoritative alias resolver. Resolve the underlying canonical chat JID and, when needed, original sender, direction, timestamp, and message type. Do not take a caller-supplied participant or authorship flag. Report an unavailable or incomplete target when a required fact is missing. Receipt-only or pending-decryption rows can qualify for an action only when the stored metadata proves every fact that action requires. Start with direct chats and groups. Add Status and channels after verifying their addressing, permissions, and device behavior.

- **Read and played.** Partition eligible IDs by canonical chat, and by canonical original author for groups. Dispatch once per partition and attach the dispatch outcome to each ID. Correct the legacy receipt implementation where possible without changing its public shape. Groups require real sender metadata. Report receipt dispatch separately from chat-list unread state.
- **Edit and revoke.** Enforce own-message eligibility and the documented windows of 15 minutes for edits and 48 hours for revoke. Verify those limits on a linked-device fixture. [WhatsApp Help Center](https://faq.whatsapp.com/1370476507114859/) Canonicalize the chat used in the operation's message key, and keep the action ID separate from the target. Verify whether old callers need to retain their current response shapes.
- **Reaction and label.** Derive reaction sender/direction from the verified target, keep the existing fresh reaction action ID and history projection, and validate label IDs against the authorized account. Check linked-device visibility for label changes.
- **Retained history.** Test what `get_message` and `search_messages` return for the original after an edit or revoke. If the provider accepts the action and the retained original stays stale, update the provider projection before promising read-back. Reuse the existing edit projection where it fits. For revoke, define a tombstone or equivalent representation that prevents revoked content or attachments from being returned once the revocation has been projected. Verify original rows, replayed observations, and old WaPilot attachment links. Delete-for-me needs its own semantics and must not imply a revoke for other participants. Keep all history and mutation observation within provider retention.

The provider can proceed past a target-specific rejection to return results for other targets. An ambiguous dispatch may stop the rest of the batch if connection state or deadline is uncertain. The provider can mark those remaining targets `not_started` when its execution record establishes that fact.

## WaPilot integration

- Register the tool through `src/lib/mcp.ts` and the shared `WRITE_TOOLS` set. Require `mcp:write` before any provider call and reuse the existing active-user and connection resolver before decrypting the instance token. Use the shared server in HTTP and local stdio. Mark the MCP annotations as write-capable, potentially destructive, open-world, and non-idempotent. Same-key result recovery is an explicit client option and does not change the default annotation. [MCP tool definition](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) · [MCP annotations schema](https://modelcontextprotocol.io/specification/2026-07-28/schema#toolannotations)
- Define the strict input and typed result in `src/lib/update-message.ts`. Keep the wire request, validation of the provider response, and mutation HTTP error classification in `src/lib/evolution.ts`. Verify that every response item matches exactly one input target. Keep outbound action handling distinct from the existing history update decoder in `src/lib/message-update.ts`.
- For keyed calls, atomically reserve a row in the existing operations ledger with an `update_message` operation namespace and the current 24-hour TTL. Key the row by user, connection, operation, and client key. Hash the normalized action and ordered input targets. A matching in-flight key cannot start a second dispatch. A matching completed key returns the recorded results after current authorization. Reuse of a key with different arguments conflicts. A lost or interrupted response after possible dispatch yields an unknown result. A provider response lost after dispatch cannot be reconstructed by the WaPilot ledger. Replays must never resume an interrupted batch automatically. Persist only the request hash and the minimum sanitized outcome fields needed for recovery.
- Audit kind, count, outcome counts, and safe error codes. Keep text, emojis, message envelopes, identifiers of participants, and credentials out of logs. A failed audit write preserves the observed result. Update `docs/TOOLS.md`, `docs/ARCHITECTURE.md`, and the shared tool catalog tests when implementing the contract.

## Implementation and acceptance

1. Add the provider route with text edit, delete for everyone, and read receipts. Test real handlers with a fake WhatsApp boundary. Cover direct chats, a group with two senders, PN/LID aliases, a wrong conversation, IDs shared across instances, missing originals, incoming edits and revokes from linked devices, late history replay, and context cancellation. Use SQLite fixtures and the existing PostgreSQL history checks for any projection change.
2. Add played receipts, set and remove reaction, and message labels to the same provider contract. Test reaction replace/remove, the recipient-side read or played indicator, and linked-device state for labels. Cover receipt privacy and eligibility for the account type.
3. Add the WaPilot tool adapter and registration. Verify the MCP catalog and OAuth write gate in HTTP and stdio. Mock the exact provider wire contract and assert one outbound request, ordered mixed results, wrong-connection denial before dispatch, interrupted same-key calls, idempotency conflicts, and no retries after ambiguous failures. Run `npm run check` and `npx wrangler deploy --dry-run`.
4. Run the provider and WaPilot together on a disposable instance with a second test account or linked device. Compare action dispatch, device effects, and subsequent `get_message` or `search_messages` read-back. Verify the actual provider build before advertising the operations. Confirm one direct chat and a group with multiple authors before opening group receipts.
5. Extend the same tool with star and poll voting once verified. Scope admin revoke, captions, message pin, delete-for-me, channel actions, and event RSVP as distinct follow-ups. Keep disappearing-message actions and specialized poll/event wire updates in characterization until there is a reproducible outbound round trip. The [audit](../research/message-write-operations.md) records the SDK and provider gaps for each.

### Acceptance suites

Run the tests from their respective checkouts. Both suites start with isolated synthetic accounts and fixtures. The Worker and Go HTTP suites run in their regular test packages. The connected suite launches a disposable local provider.

| Suite | Command | Observable cases |
| --- | --- | --- |
| WaPilot Worker | `npx vitest run test/update-message.acceptance.test.ts` | Discovery advertises write annotations. A read-only authorization receives a 403 challenge that names `mcp:write`. A foreign connection produces no provider call. A mixed batch preserves results in order. A completed key replays the result, a changed selection conflicts, and an ambiguous upstream failure stays unknown without a second write. |
| Evolution Go HTTP | `go test ./pkg/message/acceptance -run '^TestMessageActionsHTTP$'` | The real router requires the instance token. A duplicate target fails validation. An incoming text edit and an ID retained only by another instance return distinct per-target rejection codes without a connected WhatsApp client. |

The Go HTTP and connected fixtures exercise all eight initial variants with captured WhatsApp dispatches. The connected fixture uses the real Worker and Go router. Run `WAPILOT_ACTIONS_GO_ROOT=/workspace/evolution-go npm run test:acceptance:update` with both checkouts available. SQLite runs by default. Pass `-postgres-dsn` to the Go repository package to check history projection against an isolated PostgreSQL schema.

| Scenario | Pass condition |
| --- | --- |
| Same group, two senders | Submit three messages in order A1, B1, A2. The external boundary receives one receipt for A1/A2 and one for B1, both with the correct author and group. The tool returns A1, B1, A2 in input order. Repeat for played receipts with voice fixtures. |
| Identity and incomplete history | Supply a known message ID with an unrelated conversation, then with a verified PN/LID alias. Only the verified match can reach the dispatch boundary. Reject aliases of the same target in one batch. A pending-content record with missing author fails eligibility for a group receipt. |
| Text edit and revoke | Use separate eligible self-authored originals. The outgoing action references the original ID and returns a distinct action ID. An edit changes original text in subsequent reads. After projected revocation, reads and previously issued WaPilot attachment links cannot retrieve the original content. A replay of the old message must preserve the projected change. |
| Reaction and message label | Set an emoji, replace it, then remove it. Query active reactions and verify the account's reaction changes at every step. Add and remove a known Business label and observe each action on a linked device. |
| Partial dispatch and cancellation | Cancel between two controlled dispatches. Keep the first observed acceptance and return `not_started` for the second when no write began. Drop the response after dispatch starts and expect `unknown` with no automatic replay. |
| Local stdio authorization | List and call the shared tool through the stdio entrypoint with read-only and write-enabled trusted scopes. Only the latter can dispatch. |
| Device and deployment | Verify the provider build under test, exercise direct and group chats with test accounts, and check read receipt privacy and voice playback on the second account. Record evidence independently for dispatch, linked-device visibility, and read-back. |

### Action inventory acceptance gate

At release review, record the tested WaPilot revision, Evolution Go revision and deployed build, and the Whatsmeow dependency pin. Compare WaPilot `tools/list` and the Evolution Go HTTP router with the [upstream write audit](../research/message-write-operations.md). Recheck operations added since the audited commits. Record each action as available, planned, or deferred, with a source or test result. Review both HTTP and local stdio for the WaPilot catalog.

Before this change, the WaPilot catalog exposed no write that targeted an existing message. `send_message` creates messages, `update_contact` acts on contacts, and `manage_webhook_subscription` acts on subscriptions. The audited provider routes and the expected coverage for this change are below.

| Message action | Evolution Go source status | WaPilot disposition and acceptance evidence |
| --- | --- | --- |
| Edit text | `/message/edit` handles own text. | First release. The Go suite covers inbound edit rejection and foreign history. Add successful dispatch and original-message read-back in both layers. |
| Edit media caption | No dedicated route. | Deferred. Verify supported content types and preservation of media and quote context. |
| Delete for everyone | `/message/delete` builds an own-message revoke. | First release for own messages. Add dispatch and retained-history read-back in both layers. Group-admin revocation of another author's message is deferred and requires an admin-permission test. |
| Delete for me | No route. | Deferred. Verify linked-device behavior and retained-history visibility. |
| Mark read | `/message/markread` accepts multiple IDs. Group sender resolution needs a fix. | First release. The WaPilot suite covers batch outcomes against a simulated provider. Add native direct and multi-author group receipt checks. |
| Mark played | `/message/markplayed` has the same group sender issue. | First release. Add voice eligibility and native direct and multi-author group dispatch checks. |
| Set, replace, or remove reaction | `/message/react` supports all three. | First release. Add action target, author, and active-reaction read-back checks. |
| Add or remove a message label | `/label/message` and `/unlabel/message`. | First release. Add account and label validation and verify add/remove on a linked device. |
| Star or unstar | No route. Whatsmeow has a builder. | Follow-up. Verify both states in linked-device app state. |
| Pin or unpin an individual message | No route. Whatsmeow has wire support. | Deferred. Verify outbound dispatch and participant visibility. |
| Keep or undo keep for a disappearing message | No route. Whatsmeow has wire support. | Deferred. Verify eligibility and participant visibility. |
| Vote, change a vote, or clear a vote | Poll reads exist. Whatsmeow has an outbound vote builder. | Follow-up. Verify selection limits, missing poll secrets, and vote read-back. |
| Edit a poll, add a poll option, edit or cancel an event, or schedule an existing message | No matching write routes. The audit found wire support. | Deferred. Require reproducible outbound behavior for each variant before adding it. |
| RSVP to an event | Event response reads exist. | Deferred. Require an outbound implementation and response read-back. |
| View or react to a channel post | No dedicated action routes. Whatsmeow has channel-specific methods. | Deferred. Verify channel IDs and action semantics. Treat Status addressing as its own follow-up. |

For each operation advertised at release, require executable evidence of the supported effect through the Go API and through the connected WaPilot tool. Check the returned target, outcome, and observable effect. Check that deferred operations remain absent from the accepted input variants. Review neighboring conversation, contact, group, session, and server writes using the [adjacent upstream inventory](../research/message-write-operations.md#other-write-operations).


Live device observation and the deployed build check are release gates. A direct storage URL issued by the provider expires independently of a WaPilot attachment link. A linked-device revoke observed before any matching original is retained cannot currently be applied to a future original.
