# WaPilot MCP no Cloudflare Workers

Servidor MCP remoto para conversas individuais e grupos do WhatsApp por meio do Evolution Go. O endpoint público configurado é:

`https://app.wapilot.com.br/mcp`

O protocolo publicado é **MCP 2026-07-28**, com transporte Streamable HTTP stateless, respostas JSON por troca e autenticação OAuth 2.1 + PKCE. O Worker não oferece SSE, WebSocket ou sessões persistentes. O stdio é exclusivo do desenvolvimento isolado; consulte [DEVELOPMENT.md](DEVELOPMENT.md).

## Contrato do repositório

- Worker com Hono, TypeScript, D1 e KV; publicação de MCP Events e da migração final depende de autorização separada.
- OAuth Provider oficial `@cloudflare/workers-oauth-provider` 1.2.3, discovery, CIMD/DCR compatível, Authorization Code, PKCE S256, refresh e revogação.
- Login incorporado Clerk em pt-BR para navegador, por convite e ativação administrativa. D1 mantém identidade, estado de acesso e propriedade das conexões; o OAuth do MCP continua independente. O corte externo depende dos [gates operacionais](docs/CLERK-OPERATIONS.md).
- Tokens das instâncias protegidos por AES-GCM e resolvidos apenas por UUID interno do usuário nas ferramentas de conexão; `list_connections` lista somente o cadastro do usuário.
- Ferramentas de status, contatos, grupos, mensagens retidas e leitura integral. Uma única ferramenta `send_message` cobre as variantes de envio, respostas citadas, encaminhamento e Status; veja [o contrato e a matriz de suporte](docs/SEND-MESSAGE.md).
- Webhook por conexão com segredo opaco e seleção de mensagens live para MCP Events no HTTP. D1 guarda somente prévias pendentes por até uma hora e metadados operacionais com prazo; não mantém arquivo geral nem cache de envios.
- Testes HTTP com Worker real em workerd, D1/KV locais e Clerk/serviços externos simulados, aceitação conectada com os handlers Go e dry-run do Wrangler.

## Limite do Evolution Go

O contrato usa o header `apikey` e as rotas de instância, contatos, grupos, histórico e envio descritas em [SEND-MESSAGE.md](docs/SEND-MESSAGE.md#inventário-do-provedor-e-suporte-futuro). `list_messages` consulta mensagens persistidas diretamente na API e depende de `DATABASE_SAVE_MESSAGES=true`; o fork não possui endpoint de listagem de chats. Listagem e encaminhamento usam somente mensagens retidas no provedor; disponibilidade futura não é garantida. A migration `0009_drop_legacy_message_storage.sql` remove conteúdo legado sem copiá-lo. A migration `0010_unified_send_fence.sql` protege a troca das quatro ferramentas antigas pela operação `send_message` contra reutilização de chaves ativas.

O estado publicado precisa de nova leitura antes de qualquer operação. Os testes desta transição são locais e sintéticos; não comprovam egress na Cloudflare, execução de agente na OpenAI ou disponibilidade de mensagens reais. Consulte [a ordem de publicação e homologação](docs/DEPLOY.md#publicação-futura-da-transição-de-mensagens).

## Desenvolvimento

```sh
npm install
npm run check
npm run test:acceptance:send
npx wrangler deploy --dry-run
```

Para abrir a aplicação localmente com D1/KV persistentes e uma identidade de desenvolvimento isolada:

```sh
npm run dev:local
```

Depois abra `http://localhost:8787/connections`. O comando aplica as migrations locais e cria `.dev.vars` somente com segredos de exemplo. O backend Evolution Go local é opcional; sem um mock ou uma instância de desenvolvimento em `127.0.0.1:8789`, a tela abre, mas o provisionamento de uma conexão não pode ser concluído.

Configure IDs de bindings em `wrangler.jsonc` e segredos de produção com `wrangler secret put`, somente no escopo autorizado. Credenciais de desenvolvimento ficam em arquivos locais ignorados; tokens não entram em commits, URLs ou respostas MCP. A configuração Clerk usa `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` e, opcionalmente, `CLERK_JWT_KEY` da instância correspondente ao D1. O perfil local sintético e o stdio continuam independentes desse login.

O [procedimento de identidade](docs/CLERK-OPERATIONS.md) descreve vínculo inicial, convites, desativação D1-first, revogação paginada e retorno seguro. O entrypoint separado de manutenção não integra o Worker publicado, não tem API pública e seu exemplo usa recursos locais. Configuração real, convites/e-mails, sessão por mais de 60 segundos e testes móveis permanecem gates antes do corte. Veja também [arquitetura](docs/ARCHITECTURE.md), [ferramentas](docs/TOOLS.md) e [deploy](docs/DEPLOY.md).

## Referências e atribuições

As comparações dos commits `evolution-foundation/mcp-evolution-api` (`4a84f552`) e `aiteks-ltda/mcp-evolution-whatsapp-api` (`e61528e0`) e a análise do Evolution Go estão em `.scratch/upstream-research.md`. O projeto não copia código desses repositórios; veja [ATTRIBUTIONS.md](ATTRIBUTIONS.md) para licenças e dependências.
