# WaPilot MCP capability audit

Audited 2026-11-10 against the checked-out source, installed SDK 2.3.1 and the pinned [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28). This is a local implementation audit, not certification or a production deployment check. See the separate [client audit](MCP-CLIENT-AUDIT.md).

The tool inventory below was updated on 2026-11-11 for unified sending. The authenticated live catalog exposed 15 HTTP tools, including `send_message` with 18 variants. The other protocol findings retain the original audit date. WhatsApp calendar events are separate from MCP Events; see the [native event investigation](NATIVE-WHATSAPP-EVENTS.md).

## Subscriptions and channels

| Meaning | WaPilot support | Practical consequence |
| --- | --- | --- |
| OpenAI MCP Events webhook subscriptions | **Yes, HTTP only** | `events/list`, `events/subscribe`, `events/unsubscribe`; event `message.received`. Client needs an authenticated Events integration and HTTPS callback receiver. |
| Core 2026 `subscriptions/listen` | **SDK accepts it; application delivery incomplete** | Local HTTP probe opened SSE and received an acknowledgement for list-change notifications. This does not deliver WhatsApp message events. |
| Resource-specific update subscriptions | **No** | No `resources.subscribe` capability or application resource-update producer. |
| Legacy `resources/subscribe`, `resources/unsubscribe` | **No application implementation** | These were replaced in the pinned 2026 core revision. Legacy HTTP compatibility does not create a resource subscription feature. |
| Claude Code Channels | **No** | No `claude/channel` capability or `notifications/claude/channel` producer. A separate channel bridge would be needed. |

These are different contracts. [OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events) delivers signed webhooks; the [2026 core changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog) define a POST response stream for catalog/resource notifications; [Claude Channels](https://code.claude.com/docs/en/channels-reference) uses a Claude-specific capability and notification over a local stdio process. Supporting one does not establish support for another.

## Capability inventory

“Yes” means an implemented application feature or an observed SDK behavior. “No” means no application registration/use was found. “SDK” means inherited behavior, which should not be confused with a complete WaPilot feature.

| Capability / protocol surface | Published HTTP entrypoint | Development stdio | Evidence / limits |
| --- | --- | --- | --- |
| JSON-RPC and 2026 per-request negotiation | Yes | Yes, SDK | `src/lib/mcp-http.ts`, `src/dev/stdio.ts`; modern metadata/header validation exercised by compatibility tests. |
| `server/discover`, identity, instructions | Yes | SDK | HTTP probe returned version `2026-07-28`, capabilities and instructions. |
| Legacy initialize handshake | Yes for 2025-03-26, 2025-06-18, 2025-11-25 | SDK compatibility | HTTP versions tested in `test/mcp-compatibility.test.ts`; do not infer every legacy optional feature. |
| Streamable HTTP POST JSON | Yes | N/A | Ordinary HTTP RPCs return JSON; per-request server factory. |
| HTTP transport sessions | No | N/A | No `Mcp-Session-Id`; GET/DELETE return 405. |
| Legacy HTTP+SSE `/sse`, WebSocket | No | N/A | No application endpoint/transport. |
| Core subscription SSE stream | SDK exposure, contrary to intended policy | SDK machinery; not separately probed | `createMcpHandler` intercepts `subscriptions/listen`, including in JSON response mode; see finding below. |
| OAuth resource protection and discovery | Yes | N/A | OAuth Provider; `/mcp` requires OAuth bearer, not Access assertion. UI Access is separate. See `src/lib/oauth.ts` and `docs/ARCHITECTURE.md`. |
| Read/write scopes, user/connection isolation | Yes | Trusted local read/write configuration | HTTP sends require `mcp:write`; Events requires `mcp:read`; connection resolution is scoped to user. |
| Tools: `tools/list`, `tools/call` | Yes: 15 tools | Yes: 10 tools | Shared factory, five HTTP-only media/PDF tools; inventory below. |
| Input/output schemas and tool annotations | Yes | Yes | Zod input, `outputSchema`, `structuredContent`, text fallback and read/write annotations in `src/lib/mcp.ts`. |
| Native image results | Yes | Yes for message images | `get_message_image`; HTTP PDF page rendering also returns native images. Rendering/model vision depends on host. |
| Embedded binary resources in tool results | Yes for original PDF | No PDF tool | `get_message_document`; host must support receiving binary resource content. |
| Native audio output | No | No | Audio transcription returns text, not an audio content block. |
| Resources: list/read | Yes | Yes | Two registered UI resources; no general message-resource collection. |
| Resource templates | Empty catalog | No templates registered | HTTP `resources/templates/list` returned an empty array. |
| Resource-specific change notifications | No | No application producer | `resources.subscribe` absent; see [resource capabilities](https://modelcontextprotocol.io/specification/2026-07-28/server/resources). |
| Catalog change notifications | Advertised by SDK; no useful cross-request update path demonstrated | Advertised by shared SDK registration | Observed `tools.listChanged:true`, `resources.listChanged:true`; application catalogs are registered afresh for each request. |
| Prompts: list/get | No | No | No prompt registration; HTTP `prompts/list` returned method-not-found. Server instructions are not MCP prompts. |
| Argument completion | No | No | No completion callbacks; HTTP `completion/complete` returned method-not-found. |
| Pagination | Tool-specific; SDK catalog behavior | Tool-specific | Contacts/groups/messages and PDF inspection use cursors; this is distinct from protocol catalog pagination. No large-catalog pagination proof. |
| Protocol cache hints | SDK | SDK | Observed discover result `ttlMs:0`, `cacheScope:private`; no custom cache policy. This is not a message cache. |
| Progress notifications | No application emission | No application emission | JSON mode drops mid-call notifications; no progress producer found. |
| Cancellation | Partial, request-bound | Partial, request-bound | Media handlers consume `ctx.mcpReq.signal`; not all calls cancel underlying processing. No separate durable cancellation feature. |
| MRTR / `input_required` | No application flow | No application flow | No elicitation, roots or sampling input requests. SDK availability alone is not use. |
| Elicitation, form/URL modes | No | No | OAuth browser consent is not MCP elicitation. |
| Sampling and roots | No | No | Not requested by server; both deprecated in pinned revision. |
| MCP logging | No application protocol logs | No application protocol logs | Operational logs/stderr are separate; logging is deprecated in pinned revision. |
| MCP Apps | Yes, UI resources and tool metadata | Same registrations; host-dependent | Gallery and send receipt; meaningful text/structured fallback. Discovery did not advertise `extensions.io.modelcontextprotocol/ui`; see finding below. |
| OpenAI MCP Events | Yes | No | `events:{}` registration in `src/lib/mcp-events.ts`, only attached by OAuth HTTP handler. This is an OpenAI profile, not a core capability of the pinned spec. |
| Tasks extension | No | No | No task handles or `tasks/get`/`tasks/update`; internal queues are event delivery, not MCP Tasks. |
| Skills over MCP / Server Cards | No | No | No corresponding registrations or advertised extension. Repo agent skills are unrelated. |
| Client credentials / enterprise authorization extensions | No explicit implementation | N/A | Existing Access protection and OAuth are not proof of these extension contracts. |
| Claude Channels / permission relay | No | No | No Claude-specific capability, notification or permission-relay implementation. |

The pinned revision [deprecates roots, sampling and logging and moves Tasks into an extension](https://modelcontextprotocol.io/specification/2026-07-28/changelog). Missing optional capabilities are not by themselves conformance failures. Extension inventory is based on the [official extension overview](https://modelcontextprotocol.io/extensions/overview), plus the two vendor profiles explicitly requested here.

## Tool catalog

| Group | Tools | HTTP | stdio |
| --- | --- | --- | --- |
| Connections and status | `list_connections`, `connection_status`, `get_send_status` | Yes | Yes |
| Contacts, groups and history | `search_contacts`, `list_groups`, `list_messages`, `get_message` | Yes | Yes |
| Images and UI | `get_message_image`, `show_image_gallery` | Yes | Yes; UI host-dependent |
| Documents and transcription | `inspect_message_document`, `read_message_document_pages`, `get_message_document`, `read_message_document`, `transcribe_message_audio` | Yes | No |
| Sending | `send_message`, discriminated by `message.kind` | Yes, write scope | Yes, trusted local scope |

Tool availability is not proof that configured storage origins, inference bindings or retained message contents are available in production. Original PDFs, native images and MCP Apps also require client support beyond basic tool calls.

The retired send tools are no longer registered. `get_send_status` still accepts their operation names only to inspect existing records. See [the send contract](SEND-MESSAGE.md) for quoting, media sources, unsupported event types, and migration limits.

## Events behavior

Subscriptions are bound to user, OAuth grant, client, resource and resolved connection. They can filter `conversationId`, use signed callback verification, renew and rotate secrets, and unsubscribe idempotently. Default and maximum lifetime are seven days; refresh is required. There is no replay cursor. Queues/Cron support recovery and delivery at least once, so a receiver must deduplicate stable event IDs. Pending previews are temporary, not a general message archive. See [TOOLS](TOOLS.md#assinaturas-mcp-events), [ARCHITECTURE](ARCHITECTURE.md) and `src/lib/mcp-events.ts`.

## Findings requiring follow-up

1. **Subscription stream contradicts the documented no-SSE invariant.** The installed SDK explicitly serves `subscriptions/listen` via SSE regardless of `responseMode:'json'`. A valid authenticated local request returned HTTP 200 `text/event-stream` with `notifications/subscriptions/acknowledged`. The project also inherits list-change capability bits. A fresh `createMcpHandler` on every request provides no demonstrated route for later request factories to notify existing listeners. Decide whether to reject this method and disable the unused capability bits, or explicitly design and document streaming. This audit changes no runtime behavior.
2. **MCP Apps discovery is incomplete.** Actual HTTP discovery advertised only `tools`, `resources` and `events`, with no `extensions` field. UI resources/tool metadata exist, but the official [extension negotiation rules](https://modelcontextprotocol.io/extensions/overview) say an absent extension should be treated as unsupported. Verify and declare the UI extension with compatible SDK support before claiming complete 2026 extension negotiation.
3. **Server version metadata is stale.** Factory reports `0.1.0`; package version is `0.7.3`. This does not identify what production is running.
4. **Client support must be checked per surface.** Remote tools do not imply webhook monitoring, embedded PDF transfer, image forwarding, or UI rendering. No live client interoperability or production state was established by this audit.

## Verification

The original read-only runtime probe used the existing `eventRuntime` harness with local workerd, real local OAuth/KV/D1 and synthetic credentials. It observed discovery, the then-current 18 HTTP tools, both UI resource URIs, empty templates, unsupported prompts/completion, and subscription stream acknowledgement. That probe used no personal accounts, retained messages, external callbacks or production mutations. SDK source inspection confirmed the SSE interception and default capability bits. The later authenticated catalog check above does not repeat the subscription or client interoperability probes.

Targeted verification completed: `npx vitest run test/mcp-events.test.ts test/mcp-compatibility.test.ts test/stdio.test.ts test/mcp-gallery.test.ts` — **4 files, 72 tests passed**. This does not exercise production or certify the full protocol.
