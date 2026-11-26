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
