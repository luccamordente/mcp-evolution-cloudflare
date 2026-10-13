# Platform checks (2026-10-13, America/Sao_Paulo)

Read-only preflight for the Evolution Go MCP Worker. No GitHub, Cloudflare, WhatsApp, D1, KV, Worker, secret, or invitation resource was created or changed by this check.

## Local checkout

- Working directory: `/Users/luccamordente/orca/projects/whatsapp-mcp`
- Git branch: `main`; only the initial local commit `3c4d637` exists at check time.
- No Git remote is configured yet.
- The checkout has untracked implementation files from the active build; this check did not edit source files.
- `node v24.13.0`, `npm 11.12.1`.
- `wrangler` is not installed globally; `npx wrangler` resolves Wrangler `4.150.0`.

## GitHub account and repository preflight

`gh 2.92.0` is authenticated as `luccamordente` via the local keyring. `gh auth status` reports active GitHub token scopes `gist`, `read:org`, and `repo`; the `repo` scope includes repository creation and invitations for repositories owned by this account.

`gh repo list luccamordente --limit 200` returned no repository whose name contains `evolution`, `mcp`, or `whatsapp`. A global repository search for the exact proposed name `mcp-evolution-cloudflare` found no equivalent owned by this account. The requested name is therefore available based on this read-only check; creation still needs to be performed by the owning agent.

GitHub CLI creation command to run after the source is ready (do not run before review):

```sh
gh repo create luccamordente/mcp-evolution-cloudflare --private --source=. --remote=origin --push
```

GitHub's collaborator endpoint requires a GitHub login in the path, not an e-mail address:

```sh
gh api -X PUT repos/luccamordente/mcp-evolution-cloudflare/collaborators/<github-login> \
  -f permission=push
```

A read-only lookup of `heitorsalazar`, `HeitorSalazar`, `heitor-salazar`, and `heitorsalazar1` returned 404. A public user search for `heitorsalazar` returned an unrelated `Pickachu` result. The e-mail `heitorsalazar@gmail.com` cannot be safely mapped to a GitHub login from the authenticated API (private e-mail addresses are not searchable). **Blocking input:** the owner's GitHub username is required before sending an invitation. Do not guess a login. After invitation, verify with:

```sh
gh api repos/luccamordente/mcp-evolution-cloudflare/invitations \
  --jq '.[] | {id,invitee:.invitee.login,created_at,expired}'
```

Primary GitHub references:

- [Create repository with GitHub CLI](https://cli.github.com/manual/gh_repo_create)
- [Add a repository collaborator](https://docs.github.com/en/rest/collaborators/collaborators#add-a-repository-collaborator)
- [Repository invitation endpoints](https://docs.github.com/en/rest/collaborators/invitations)

## Cloudflare account and resource preflight

`npx wrangler whoami` succeeded with an OAuth token for `luccamordente@gmail.com`:

- Account name: `Luccamordente@gmail.com's Account`
- Account ID: `e972fc5484db86f0468fa2cf78f61870`
- Token scopes reported by Wrangler include Workers scripts/routes/write, D1 write, Workers KV write, Secrets Store write, and Workers tail read.

Read-only resource checks:

- `npx wrangler d1 list --json` returned one existing database, `barbearia-290` (`uuid=4738fb4e-9e46-4955-93da-fbe7f9d534ff`, 0 tables). It is unrelated to this project and must not be reused without an explicit decision.
- `npx wrangler kv namespace list` returned `[]`; no KV namespace is currently visible.
- `npx wrangler deployments list --name mcp-evolution-cloudflare` failed with Cloudflare API code `10007` (`This Worker does not exist on your account`), confirming no Worker with the proposed name is deployed.
- `npx wrangler pages project list` returned only `checklist-reuniao-evandro`; no related Pages project exists.
- The repository has no Wrangler config yet at check time, so no binding, public hostname, or production environment can be confirmed.

Wrangler commands to execute only after code/config review and resource names are final:

```sh
npx wrangler d1 create mcp-evolution-cloudflare --use-remote --update-config --binding DB
npx wrangler kv namespace create MCP_OAUTH --use-remote --update-config --binding OAUTH_KV
npx wrangler d1 migrations apply DB --remote
npx wrangler secret put EVOLUTION_GO_API_KEY --name mcp-evolution-cloudflare
npx wrangler secret put TOKEN_ENCRYPTION_KEY --name mcp-evolution-cloudflare
npx wrangler deploy --strict
```

Do not place API keys, instance tokens, encryption keys, or Access credentials in `wrangler.jsonc`, `vars`, `.env.example`, Git, logs, or MCP responses. Use Worker secrets and record only the secret names and read-back status.

Primary Cloudflare references:

- [Wrangler configuration and required secrets](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Wrangler deploy](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy)
- [D1 Wrangler commands and migrations](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
- [Workers versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)

## MCP protocol/version finding

The current published MCP revision is **`2026-07-28`**. The official release notes describe a stateless protocol core: no `initialize`/`notifications/initialized` handshake and no `Mcp-Session-Id` transport session; requests carry protocol metadata and use Streamable HTTP. This matches the requested stateless `/mcp` boundary.

The checkout currently has `@modelcontextprotocol/sdk` `1.32.1`, which is the v1 maintenance line and implements up to MCP `2025-11-25`; it is not sufficient evidence of MCP `2026-07-28` support. NPM currently reports `@modelcontextprotocol/server` `2.3.1` and `@modelcontextprotocol/client` `2.3.1` (Apache-2.0) as the v2 packages for the 2026 protocol. Confirm imports and Worker compatibility before pinning the lockfile; do not claim MCP 2026 support while depending only on SDK v1.

Official references:

- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [MCP 2026-07-28 changelog](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/changelog.mdx)
- [TypeScript SDK versioning](https://ts.sdk.modelcontextprotocol.io/)

## Installed/current dependency snapshot

| Package | Installed in checkout | npm current at check | License reported by npm |
|---|---:|---:|---|
| `@modelcontextprotocol/sdk` | 1.32.1 | 1.32.1 | MIT |
| `@modelcontextprotocol/server` | not installed | 2.3.1 | Apache-2.0 |
| `@modelcontextprotocol/client` | not installed | 2.3.1 | Apache-2.0 |
| `@cloudflare/workers-oauth-provider` | 0.8.0 | 1.2.3 | MIT |
| `hono` | 4.13.13 | 4.13.13 | MIT |
| `jose` | 6.1.3 | 6.2.12 | MIT |
| `zod` | 4.6.7 | 4.6.7 | MIT |

`npm view` timestamps were queried on 2026-10-13; lockfile versions must be intentionally pinned after compatibility validation.

## Blocks and next actions

1. The project has no remote GitHub repository, Worker, public URL, D1 database, KV namespace, or configured secrets yet. These are pending implementation and explicit deployment execution by the owning agent.
2. GitHub invitation is blocked only by the missing GitHub login for `heitorsalazar@gmail.com`; the public e-mail cannot be resolved safely to a username.
3. The package manifest currently targets MCP SDK v1.32.1; update to and validate the v2 package/API for MCP `2026-07-28` before declaring protocol compliance.
4. No Evolution Go endpoint, instance ID, API key, or instance token was available in this platform check; no backend call was attempted.
