# Documented MCP client compatibility

Primary sources checked on 2026-11-10. This matrix describes public documentation, without connection tests in these clients. `Yes` means explicit support. `No` means explicit exclusion. `?` means the consulted sources do not establish support. Omission from a feature list does not establish that a feature is unimplemented. Account availability and workspace policies require confirmation in the client.

For WaPilot's implementation and observed behavior, see the [MCP capability audit](MCP-CAPABILITY-AUDIT.md).

## Transport and primitives

HTTP means Streamable HTTP. OAuth refers to authentication with remote servers. UI resources do not establish support for general resource discovery and reading.

| Client and surface | stdio | HTTP | OAuth | Tools | Resources | Prompts | Sampling | Elicitation | Apps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude app, remote connectors [C1] | Not applicable | Yes | Yes | Yes | Yes | Yes | No | ? | Yes [C2] |
| Claude Desktop [C1, C3] | Yes | Yes | Yes | Yes | Yes | Yes | No for remote connectors | ? | Yes [C2] |
| Claude Code, direct client [C4] | Yes | Yes | Yes | Yes | Yes | Yes | ? | Yes, form and URL | ? |
| ChatGPT web, plugins [O1, O2] | Not applicable | Yes | Yes | Yes | UI yes; general ? | ? | ? | Yes [O3] | Yes [O2] |
| Local Codex, CLI and IDE [O4, O5] | Yes | Yes | Yes | Yes | Yes | ? | ? | Yes, form and URL [O5] | ? |
| VS Code GitHub Copilot [V1] | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Cursor [U1] | Yes | Yes | Yes | Yes | Yes | Yes | ? | Yes | Yes |
| Gemini CLI [G1, G2] | Yes | Yes | Yes | Yes | Yes | Yes | ? | ? | ? |

Claude, Claude Code, VS Code, Cursor, Gemini CLI, and ChatGPT plugins also document legacy HTTP+SSE. This does not require WaPilot to publish that transport. Claude Code recommends HTTP and marks SSE as deprecated. [C1, C4, V1, U1, G1, O1]

OpenAI documentation distinguishes hosted plugins from servers configured on a Codex host. The ChatGPT desktop app can share MCP configuration with that host. The ChatGPT web row does not describe that local mode. [O4]

## Events, subscriptions, and channels

These mechanisms have different contracts. Support for one does not establish support for the others.

| Client | MCP Events, OpenAI profile | MCP change subscriptions | Claude channels |
| --- | --- | --- | --- |
| Claude app and Desktop | ? | Resource subscriptions explicitly unsupported in remote connectors [C1] | ? |
| Claude Code | ? | Receives `list_changed`; v2 runtime maintains a stream, with reconnection limits [C4]. `subscriptions/listen` unconfirmed | Yes, research preview, opt-in [C5, C6] |
| ChatGPT | Yes in Work web, desktop Work with Cloud, and dots [O6] | ? | ? |
| Local Codex | ? | ? | ? |
| VS Code GitHub Copilot | ? | ? | ? |
| Cursor | ? | ? | ? |
| Gemini CLI | ? | ? | ? |

The **MCP Events** profile documented by OpenAI advertises `events` and uses `events/list`, `events/subscribe`, and `events/unsubscribe`, with webhook delivery. ChatGPT documents discovery through `initialize` over Streamable HTTP or through MCP `2026-07-28`. Availability is specific to the listed surfaces and subject to workspace controls. These sources do not confirm that adding a server to Codex CLI provides this event receiver. [O6]

Change subscriptions include catalog and resource notifications, with contracts that depend on the MCP revision. A generic “full MCP specification” claim, such as VS Code's, does not establish a specific implementation of `subscriptions/listen` from revision `2026-07-28`. The matrix leaves that point open pending specific documentation or a client test. [V1]

**Claude channels** uses `capabilities.experimental['claude/channel']` and `notifications/claude/channel` over stdio. It injects messages into an open Claude Code session and requires explicit activation. The documentation does not describe it as an implementation of `events/subscribe` or a receiver for MCP Events webhooks. Emission receives no acknowledgment that Claude processed the message. [C5, C6]

## Audit limits

Claude connector documentation excludes sampling and resource subscriptions. Claude Code documentation provides more detail about elicitation and dynamic updates, so these surfaces remain separate. Reading a `ui://` resource in Claude Code does not establish that the terminal renders an MCP App. [C1, C4]

Codex documents resource reading and elicitation through App Server. That App Server's thread and turn events belong to Codex's own API. They do not establish support for an external server's MCP Events profile. [O5]

Forum reports were not used as evidence of support. The community MCP matrix also does not replace product documentation or actual capability negotiation. No `Yes` cell guarantees complete compatibility with the MCP revision pinned by WaPilot.

## Primary sources

- [C1: Claude, Build an MCP server](https://claude.com/docs/connectors/building).
- [C2: Claude, Use interactive connectors](https://support.claude.com/en/articles/13454812-use-interactive-connectors-in-claude).
- [C3: Claude Desktop, local MCP servers](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).
- [C4: Claude Code, MCP](https://code.claude.com/docs/en/mcp).
- [C5: Claude Code, channels](https://code.claude.com/docs/en/channels).
- [C6: Claude Code, channels reference](https://code.claude.com/docs/en/channels-reference).
- [O1: OpenAI, Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server).
- [O2: OpenAI, MCP server and UI quickstart](https://developers.openai.com/plugins/build/app-quickstart).
- [O3: OpenAI, Build an MCP server](https://developers.openai.com/plugins/build/mcp-server).
- [O4: OpenAI, Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp).
- [O5: OpenAI, Codex App Server](https://learn.chatgpt.com/docs/app-server).
- [O6: OpenAI, MCP Events](https://developers.openai.com/plugins/build/mcp-events).
- [V1: Microsoft, MCP developer guide](https://code.visualstudio.com/api/extension-guides/ai/mcp).
- [U1: Cursor, MCP](https://cursor.com/docs/mcp).
- [G1: Gemini CLI, MCP servers](https://geminicli.com/docs/tools/mcp-server/).
- [G2: Gemini CLI, MCP resource tools](https://geminicli.com/docs/tools/mcp-resources/).
