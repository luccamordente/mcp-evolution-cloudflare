# Webhook subscriptions for clients without MCP Events

WaPilot exposes one fallback tool, `manage_webhook_subscription`, for agents using authenticated HTTP. Owners configure each watch through their MCP client.

## Contract

| Operation | Arguments | Result |
| --- | --- | --- |
| `subscribe` | `url`, `senderKey`, `filter: { connectionId, conversationId }`, and optional `ttlMs`. | `subscriptionId`, effective filter, and `refreshBefore`. The same grant, URL, and canonical filter renew the same watch and can replace its key. |
| `unsubscribe` | `subscriptionId`. | Cancels the watch for the issuing OAuth grant. |

Require an active WaPilot user, `mcp:read`, and ownership of the explicit WhatsApp connection. Hide the fallback from configured OAuth client IDs known to support MCP Events. The tool description directs hosts with that capability to use their built-in workflow.

Only the configured HTTPS routine host and webhook path are eligible. The Worker encrypts the key before storing it. Tool results and dashboard activity omit the key and full routine URL. WaPilot checks the exact conversation before storing the preview or queuing a delivery. It reuses the existing alias matching, queue, and delivery limits. The existing dashboard subscription activity and owner stop control still work.

## Acceptance tests

| Case | Exercise | Expected result |
| --- | --- | --- |
| A1 | Discover and call the MCP tool with eligible and known MCP Events clients. | The eligible client sees one fallback tool. The native client sees the existing Events methods. |
| A2 | Subscribe with credentials and renew using an equivalent direct-chat ID. Attempt another host, a wildcard filter, and a cancellation from another grant. | The valid calls share one ID. Host and wildcard inputs fail. The other grant cannot stop the watch. |
| A3 | Ingest events from two chats on one connection, repeat the matching event, unsubscribe, and ingest another matching event. | Only the first matching event reaches the receiver. |
| A4 | Renew a watch with a new bearer key, then cancel or revoke. | The sender uses the current key. Cancellation removes the key and eliminates pending delivery content. |
| A5 | Run the controlled TLS sender suite and exercise invalid endpoints and ambiguous outcomes. | Only the configured destination receives credentials. Ambiguous dispatches become terminal. |
| A6 | In production, use an authorized synthetic Grok routine and two test chat events. Verify the run history, stop the watch, then verify a native signed callback. | Only the matching event starts the routine. The watch stops and native delivery still works. |

## Display webhook details in Assinaturas de mensagens

Add a **Webhook** item to the expanded details of each subscription created through `manage_webhook_subscription`. Keep the subscription in the existing **Assinaturas de mensagens** list for its connection. The item is read-only. The existing **Encerrar assinatura** action still applies to the whole subscription.

| Field | Display |
| --- | --- |
| **Destino** | The saved label and HTTPS hostname. Show only the hostname when the label is the generic `Webhook`. |
| **Última entrega** | The newest retained delivery's reception time and localized outcome from the existing activity response, or **Nenhuma entrega recente**. Use **Resultado desconhecido** when the request may have reached the routine. |
| **Conversa e vigência** | Use the existing conversation and expiry fields in the same expanded subscription. |

Keep the full routine URL, sender key, and authorization headers out of the API projection and rendered HTML. An HTTP acceptance confirms receipt by the destination. Grok's run history is the evidence of routine execution.

Read the newest row from the first page of the existing delivery activity when the owner expands the subscription. The display adds zero writes, zero polling, and zero extra requests. The delivery worker keeps its existing retry and retention behavior whether or not the dashboard is open.

### Implementation sequence

1. In `src/lib/event-subscriptions.ts`, identify webhook subscriptions using the stored destination reference. Keep the owner, connection, and grant join when projecting the safe label and hostname. Return an explicit webhook type for the UI. If destination metadata is unavailable, show **Destino indisponível**. Preserve the existing signed MCP Events projection.
2. In `src/ui/connection-subscriptions.ts`, render the **Webhook** item for that type. Use the existing detail fetch and activity response for the latest delivery. Keep pagination in the existing activity list and preserve the empty and error states of the detail fetch.
3. Add `delivery_unknown` to the delivery result allowlist. The UI already has a Portuguese label, but the API currently drops the value.
4. Add acceptance tests on the authenticated subscription API and dashboard. Update the architecture docs to describe the display and its redaction contract.

### Dashboard acceptance tests

| Case | Expected result |
| --- | --- |
| A7 | An owner expands a webhook subscription for the selected connection and sees the hostname, conversation, expiry, and latest delivery outcome. The API and HTML expose neither the full routine URL nor the key. |
| A8 | A webhook subscription without delivery history shows the empty state. An ambiguous delivery shows **Resultado desconhecido** and never appears as accepted. |
| A9 | Switching connections keeps webhook details scoped to the selected connection. Another owner cannot load the subscription. Existing signed subscriptions and the owner stop action still work. |
