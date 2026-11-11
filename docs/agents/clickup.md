# ClickUp access through Composio

This repository configures the Composio remote MCP server in
`.codex/config.toml` for development agents. It does not add ClickUp tools to
the published WaPilot server. GitHub Issues remains the repository's issue
tracker; use ClickUp when the user requests that external task context.

## Connect once per agent host/account

Run from this repository in a trusted Codex project:

```sh
codex mcp list
codex mcp login composio --no-browser
```

Open the authorization URL printed by Codex, sign in to Composio and authorize
the connection. Paste the complete callback URL into that command's hidden
prompt, even if the browser cannot load the localhost callback. The callback
belongs to that login attempt; do not save it in the repository.

Restart the Codex agent session after adding the server. The running session
does not gain new tools just because the configuration file changed. Check
`/mcp` for the active connection, then ask the agent to connect ClickUp through
Composio. Complete ClickUp authorization for the workspace containing the task.
Composio authentication and ClickUp authorization are separate steps.

OAuth credentials belong to the agent host's credential store. The tracked
configuration contains only the public endpoint and timeouts. Do not add API
keys, access tokens, callback URLs, or exported task content to it. New hosts
and other users need their own login; the repository cannot grant account
access. Worktrees based on a revision containing this configuration inherit it.

## Verify the actual outcome

`codex mcp list` proves configuration/credential status, not task access. In a
fresh session:

1. Confirm Composio appears in the active MCP tools.
2. Complete ClickUp connection if Composio requests it.
3. Read the exact task URL supplied by the user.
4. Confirm its ID, title and requested description/comments were returned.

Only that read establishes access to the requested task. Do not create or
modify tasks as a connectivity test. Do not treat server reachability or an
authenticated Composio account as proof of ClickUp workspace permissions.

## Troubleshooting

- Server absent: launch from this repository, trust the project and restart the
  agent. Project configuration is skipped for untrusted projects.
- OAuth expired or missing: rerun `codex mcp login composio --no-browser`.
- Composio connected but ClickUp unavailable: authorize ClickUp in the correct
  Composio account and workspace, then retry the read.
- Task unavailable: check the task URL and ClickUp permissions. Do not switch
  accounts or broaden access automatically.
- Hosted ChatGPT Work: local `.codex/config.toml` is not loaded by ChatGPT web.
  Install an appropriate remote MCP plugin there instead; this project setup
  applies to Codex hosts that load its project configuration.

## Sources

- [OpenAI: MCP configuration, project trust, OAuth and hosted Work limits](https://learn.chatgpt.com/docs/extend/mcp)
- [Composio: ClickUp with Codex](https://composio.dev/toolkits/clickup/framework/codex)

Setup checked on 2026-11-10: the installed Codex CLI loaded the project entry,
reported it enabled and started the browser OAuth flow without a consumer API
key. Account authorization and an actual task read must still be verified;
this observation is not a permanent availability guarantee.
