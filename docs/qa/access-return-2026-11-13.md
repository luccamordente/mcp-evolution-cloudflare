# Preparação do retorno Access — #61

Preflight de **13/11/2026, 16:29–16:34 UTC**, no escopo de desenvolvimento da #59. Esta entrega prepara e testa código local; não publica a fundação, não altera Access, não aplica migrations e não homologa identidades reais. **#61 permanece operacionalmente pendente.**

## Leitura atual e limites

| Alvo | Evidência desta execução |
| --- | --- |
| Worker/conta | `mcp-evolution-cloudflare`, conta `e972fc5484db86f0468fa2cf78f61870`; leitura pelo perfil Wrangler existente `wapilot`, versão 4.150.0, Node 24.13.0 |
| Tráfego | Deployment `619efe0e-288a-463b-9904-8410b8ee182a`, criado em 12/11 às 02:29:41 UTC, versão `c8936c3f-59d0-46ed-8485-88c40c46ad2e` em 100% |
| Origem declarada da versão | Metadata `workers/commit_sha=e6630a73bcdafccdcd45067f3728cdb24d43a515`, tag `native-event-7cf401a`; o commit remoto descreve o snapshot publicado de `7cf401a8e0d100ed646d9102d013063b10889b18` |
| D1 | `mcp-evolution`, ID `d25ad771-5b81-4e41-88ed-6f980a32dbf9`; `d1 migrations list DB --remote` encontrou somente `0011_clerk_identity.sql` pendente. Nenhuma migration foi aplicada; não foram lidos usuários ou conexões reais |
| KV | Binding `OAUTH_KV`, namespace `3a5b420e14594ee4ae821b720a9bf74a`; nenhum conteúdo foi lido |
| Outros bindings | `AI`, produtor `EVENT_DELIVERIES` para `wapilot-events`, namespace DO `CALLBACK_SENDER`/classe `CallbackSender` e Container `wapilot-callback-sender`; runtime `2026-10-13`, flags `nodejs_compat` e `global_fetch_strictly_public` |
| Credenciais | Metadata mantém os nomes dos três bindings Access, `CONSENT_SECRET`, `TOKEN_ENCRYPTION_KEY` e chave administrativa do serviço de mensagens. Valores desses bindings não foram solicitados ou copiados |
| GitHub | `origin/main=084d530e8357307c2118954898c97eda642aa765`; sem workflows Actions ou webhooks de repositório retornados pela API. Há check **Workers Builds: mcp-evolution-cloudflare** concluído com sucesso, build `208f72d7-ce7f-4635-919f-33bd83624e65` |
| Automação com leitura recusada | O check comprova integração Workers Builds; a API autenticada pelo perfil correto `wapilot` recusou configuração e triggers (`403`, código `10000`). Branch, comando, filtros e promoção automática continuam sem conferência. Nenhum push/merge em `main` deve ser tratado como inofensivo |
| Access com leitura incompleta | Probes anônimos de `/connections` e `/authorize` receberam `302` para o gateway Access, com cache bloqueado. Pelo perfil correto, a listagem de apps da conta respondeu `200` com coleção vazia; as leituras de apps da zona e organização foram recusadas (`403`, código `10000`). Não há app/política conferidos nem prova de ausência de proteção |
| Caminho administrativo | O perfil Wrangler conseguiu ler deployment, versão e migrations sem login WaPilot. O conector Cloudflare recusou a conta proprietária (`403`, conta fora do escopo da conexão); acesso independente ao painel/políticas Access e responsável por corte/retorno ainda precisam de confirmação |

Também foram conferidos `/healthz` e `/.well-known/oauth-protected-resource/mcp` (`200`) e `POST /mcp` sem bearer (`401`, `no-store` e desafio com `resource_metadata`). Esses probes não demonstram a barreira D1, continuidade autenticada ou funcionamento do provedor de mensagens. Não houve indisponibilidade planejada nem mudança de tráfego nesta preparação.

## Leituras suplementares pelo perfil correto

Em **13/11/2026, 16:44–16:46 UTC**, as lacunas foram efetivamente investigadas com a credencial já existente do perfil Wrangler `wapilot`, usada somente em memória, sem imprimir ou persistir portadores. Não houve reconexão, criação de credenciais, consulta de valores de bindings/Secrets, leitura de usuários/grants ou alteração de infraestrutura. O `403` anterior do conector não foi usado como substituto dessas tentativas.

A conta alvo abaixo é `e972fc5484db86f0468fa2cf78f61870`. A listagem de Workers confirmou o tag de sistema `d8437e2f8de346179af30daf82a50885` do Worker correto; a busca de zona por nome confirmou `wapilot.com.br`, zona `725a4f686e54e4322a6da21b18176e3d`, ativa e pertencente à mesma conta.

| GET autenticado pelo perfil `wapilot` | Resultado sanitizado |
| --- | --- |
| `/accounts/CONTA/workers/scripts` | `200`; Worker e tag conferidos |
| `/accounts/CONTA/builds/workers/d8437e2f8de346179af30daf82a50885` | `403`, erro Cloudflare `10000` |
| `/accounts/CONTA/builds/workers/d8437e2f8de346179af30daf82a50885/triggers` | `403`, erro Cloudflare `10000` |
| `/accounts/CONTA/access/apps?per_page=1000` | `200`, `count=0`, `total_count=0`; nenhum app utilizável para ler políticas foi retornado |
| `/zones?name=wapilot.com.br&per_page=50` | `200`, uma zona encontrada, conta conferida |
| `/zones/725a4f686e54e4322a6da21b18176e3d/access/apps?per_page=1000` | `403`, erro Cloudflare `10000` |
| `/accounts/CONTA/access/organizations` | `403`, erro Cloudflare `10000` |

A organização da outra conta já disponível no perfil, `2ebbaee1e810ab3429524fa89dd8dac1`, também recusou leitura (`403`, `10000`); não houve expansão para dados de outra aplicação. Não foi feita uma chamada fictícia de `/access/apps/:appId/policies`: a sessão não forneceu um ID confiável do app que protege o domínio. Portanto o estado de políticas e os comandos/gatilhos de publicação continuam pendentes de acesso administrativo adequado, com recusas documentadas, e não por falta de tentativa pelo perfil correto.

## Reconciliação da referência

A referência anterior `9d5983853257c1e678e87aa5a217a89139a62ca4`, baseada no `main` `084d530`, **não preserva todo o código declarado pela versão ativa**: remove histórico nativo, leitura paginada de respostas e envio de eventos. O `main` e a candidata Clerk desta integração também não contêm essas diferenças publicadas. Reconciliar a candidata antes de um futuro corte é um gate separado; este ticket não incorpora funcionalidades de mensagens na candidata.

O novo artefato local é **`e70a4e57515fba350f3d9564a7ff4b80144ad966`**, branch `rollback/59-access-published`, diretamente sobre `e6630a73`. Ele reaplica somente o endurecimento de autorização e seus testes de `9d598385`, preservando os arquivos de histórico/eventos, correção de mídia, lockfile e configuração Wrangler da revisão declarada como publicada. A comparação com produção usa a metadata de commit e runtime; não é uma comparação byte a byte do bundle remoto.

A inspeção dessa base publicada encontrou `ensureUser` com criação automática e sem filtro `active`, além da ausência do callback de autorização D1 na troca de código/refresh. Portanto **a fundação segura ainda não pode ser declarada publicada**. Os probes públicos não mudam essa conclusão; o endurecimento foi validado apenas localmente.

O artefato exige conta D1 existente e ativa nas páginas/APIs, consentimento, cada request MCP e callback de código/refresh. Ausente/desativada retorna acesso negado/`invalid_grant`; indisponibilidade do D1 responde `503 temporarily_unavailable`, preservando o grant para nova tentativa. Preserva `encodeURIComponent(emailCanonico)`, props legados, escopos anteriores e `revokeExistingGrants: false`. A migration `0011` é aditiva; o retorno não a desfaz, nem reativa contas ou restaura grants revogados.

## Validação local

A revisão do artefato reaproveita os testes existentes de `test/identity-authorization.test.ts` e `test/oauth-consent.test.ts`: navegador Access com JWT/JWKS sintéticos, conta ausente/desativada, consentimento, bearer antigo, código/refresh, falha D1 recuperável, identidade incompatível e preservação de conexões/cifras/defaults após a migration aditiva. Nenhum administrador real foi desativado, banido ou recriado. Nenhuma credencial de usuário real foi usada nesses testes.

- `npm run check`: aprovado em `e70a4e5`; build da galeria e typecheck passaram, 50 arquivos/768 testes aprovados, 1 arquivo/15 testes pulados, duração de 107,49 segundos.
- Conferência focada adicional enquanto a suíte completa ainda executava: `npx vitest run test/identity-authorization.test.ts test/oauth-consent.test.ts --reporter=verbose --maxWorkers=1`, 12 testes aprovados. A execução inicial da referência antiga foi interrompida após identificar a divergência; não é usada como evidência deste artefato.
- `npx wrangler deploy --dry-run --env '' --containers-rollout none`: aprovado, 9.136,58 KiB bruto / 3.324,02 KiB gzip; compila sem publicar nem reconstruir o Container.
- Testes conectados, WhatsApp, sender e dispositivos: não executados; não há alteração desses contratos neste artefato.

## Sequência de restauração preparada

Estes comandos são um procedimento para operação **futura e autorizada**. Não foram executados comandos de publicação ou retorno nesta preparação.

1. Designar responsável com acesso independente ao Cloudflare/Access e conferir, por leitura, a versão ativa, configuração Workers Builds e políticas/audiences/paths Access. Registrar uma cópia privada das políticas e configuração necessárias ao retorno. Conferir Queue consumers, Cron, imagem Container e redaction de query, além dos bindings listados acima; a metadata da versão não substitui a leitura dessas configurações separadas.
2. Preparar a revisão Access `e70a4e57515fba350f3d9564a7ff4b80144ad966` numa worktree separada. Confirmar que nenhuma publicação posterior exige nova reconciliação; repetir checks/dry-run se o alvo ou código mudou. Não substituir a árvore Clerk da integração. O objeto deve permanecer alcançável no histórico local da integração antes de remover a worktree de verificação.
3. Com autorização explícita para a fundação segura, publicar **essa revisão Access** na conta/Worker conferidos, preservando vars, segredos e Container. Não executar `secret put/delete`, migrations remotas ou alterações de políticas como efeito implícito. Formato validado na ajuda do Wrangler instalado:

   ```sh
   CLOUDFLARE_ACCOUNT_ID=e972fc5484db86f0468fa2cf78f61870 npx wrangler deploy --env '' --profile wapilot --keep-vars --containers-rollout none --message 'Access com autorização D1; retorno preparado #61'
   ```

   O deploy também pode tentar reconciliar Queue consumers. Uma falha depois do upload pode deixar a nova versão ativa; reler deployment/versão e consumidores antes de qualquer repetição. Conferir se os recursos e a configuração exigem um caminho operacional diferente antes de autorizar esse comando.
4. Ler `deployments list` e `versions view` novamente e registrar o ID real da **versão Access endurecida validada**, em 100%, com seus bindings e políticas. Validar login de teste autorizado, consentimento, bearer/refresh anteriores e negativas de fixture. Sem esse ID e essa validação não existe retorno remoto seguro pronto. Não usar `c8936c3f…` ou outra versão antiga não endurecida como atalho.
5. Somente após os demais gates da #59, um corte Clerk separado pode ocorrer. Antes dele, manter os três secrets Access e o snapshot privado das políticas/configuração de retorno disponíveis. Preparar um cliente/grant descartável autorizado para comprovar continuidade; não revogar grants cotidianos para testar.
6. Se o corte precisar voltar, restaurar primeiro a cobertura e as políticas Access nas rotas de navegador aprovadas, sem proteger `/mcp` ou a descoberta OAuth com challenge Access. Confirmar o gateway ativo antes de servir novamente um backend que confia em sua assertion. Restaurar a versão endurecida por ID conferido (substituir o marcador abaixo):

   ```sh
   CLOUDFLARE_ACCOUNT_ID=e972fc5484db86f0468fa2cf78f61870 npx wrangler rollback ID_DA_VERSAO_ACCESS_ENDURECIDA --name mcp-evolution-cloudflare --env '' --profile wapilot --message 'Retorno autorizado do login WaPilot'
   ```

   Usar o painel independente para restaurar as políticas a partir do snapshot privado; IDs/conteúdo exatos ainda não foram obtidos nesta sessão. Se o rollback não for permitido pelas regras de lifecycle/recursos da Cloudflare, interromper e preparar uma publicação da revisão compatível com a configuração atual, sem restaurar banco antigo.
7. Reler a versão em 100%; validar os três probes públicos, login Access autorizado, conexões corretas, consentimento, leitura e refresh do grant descartável anterior, escopos, `no-store` e negativas. Preservar D1/KV, migration `0011`, vínculos Clerk, contas `disabled`, revogações e invalidações. Registrar horários, falhas por superfície e decisão do responsável; só encerrar a janela após read-back e aceite.

Rollback de código não restaura os recursos ou dados associados e pode ser impedido por mudanças no lifecycle de Durable Objects ou recursos removidos. A sequência segue as [limitações oficiais de rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) e a [distinção de builds, uploads e promoção de tráfego](https://developers.cloudflare.com/workers/ci-cd/builds/), consultadas em 13/11/2026.

## Pendências que impedem fechar #61

Acesso às políticas Access e gatilhos Workers Builds da conta proprietária, responsável e snapshot privado de retorno, autorização/publicação da fundação endurecida, ID remoto dessa versão e testes conectados autorizados. O inventário de contas/conexões/grants reais não foi inspecionado no escopo development. A preparação local e os mocks não comprovam esses itens.
