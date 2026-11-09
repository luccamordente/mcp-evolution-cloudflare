# Incidentes de Heitor: diagnóstico de 9 de novembro de 2026

A primeira etapa desta entrega foi validada localmente; a publicação posterior do patch isolado de compatibilidade está registrada no final deste relatório. Os horários e sintomas fornecidos são relatos, não traces coletados neste ambiente. Não houve envio WhatsApp real: a autenticação WaPilot disponível lista somente uma conexão de Lucca. Heitor e Neurau 0028 não estão disponíveis nesse principal. Não usar a conta de Lucca para inferir o estado das contas de Heitor.

A consulta pública em 09/11/2026 confirmou `/healthz` 200 com revisão 2026-07-28, `/mcp` sem bearer 401 e metadata OAuth canônica disponível. Isso não valida envio, ingresso, retenção nem Composio. Não foi possível obter o checkout canônico ignorado do provedor: o clone exigiu autenticação GitHub indisponível. `gh` também não está instalado. Nenhuma credencial foi solicitada pelo chat.

## Resultados por falha

| Falha relatada | Causa e grau de certeza | Alteração / estado atual | Verificação e risco restante |
| --- | --- | --- | --- |
| 1. Resposta citada com timeout e sem ID | A causa histórica do 504 não foi confirmada. Reproduzimos timeout/rede no provedor simulado. Encontramos também perda do ID quando o provedor aceita e o D1 falha ao salvar. | Mantida a reserva atômica já existente por `idempotencyKey`; a primeira resposta agora preserva o ID confirmado mesmo após falha de persistência. Envios retornam `outcome`; nova ferramenta `get_send_status` consulta a chave original sem despachar. | D1 real local: concorrência, timeout, rede, conflito, isolamento e falha de persistência. Uma escrita ao provedor nas repetições protegidas. Sem chave, após 24h ou usando outra chave/conexão/operação não há essa proteção. Um proxy ou cliente ainda pode encerrar a conexão antes da resposta. Não há reconciliação remota por chave do cliente nem garantia ilimitada de exatamente uma vez. |
| 2. Entrada sumiu do histórico | Não determinada em produção. `list_messages` consulta `/message/search` no provedor, não o webhook ou um arquivo D1. Estar conectado não comprova retenção de entrada. | Preservada a ausência de arquivo geral. Logs de seleção agora identificam a conexão e distinguem assinaturas selecionadas de ausência de interessados. | Runtime local cobre webhook autenticado, seleção, filas, recuperação, expiração e falhas. Investigar no ambiente de Heitor a persistência/retencão e o feed do provedor separadamente; não há correção comprovada da falha histórica. |
| 3. `contentUnavailable` | O normalizador encontrava linhas sem corpo/arquivo e removia o tipo genérico. A razão específica e a mensagem de exemplo não foram verificadas live. | Expostos `messageType` original e `contentUnavailableReason: not_retained_or_unknown`; erro de `get_message` também inclui esses campos. Não inventa expiração ou formato não suportado. | Testes sintéticos distinguem conteúdo ausente, texto vazio e metadados de anexos. Conteúdo nunca retido não pode ser recuperado pelo Worker. Falhas de consulta continuam erros separados. |
| 4. Sem entrega/leitura | O WaPilot não agrega recibos às mensagens. O contrato documentado representa recibos como recursos separados com `body.state` e alvo; não é um campo `status` comum. | Respostas de envio e consulta de ação dizem `deliveryStatus: unavailable` e `readStatus: unavailable`. Aceite continua distinto de entrega/leitura. | Testes verificam os campos explícitos. Não concluímos que o provedor seja incapaz de fornecer recibos; sua disponibilidade e correlação precisam de inspeção autorizada. |
| 5. Composio 400 | Reproduzido: `legacy: reject` recusa initialize/envelopes 2025 sem metadata moderna. `ACTIVE` é estado de autorização, não prova de chamada de ferramenta. Não capturamos o request real da Composio. | Adaptador SDK atende envelopes antigos com JSON e vida por request; o caminho 2026 conserva validação estrita. OAuth e escopos são compartilhados. | Regressão foi 400 antes e 200 depois para initialize, tools/list e tools/call. Tests workerd/OAuth; sem SSE, sessão ou endpoint adicional. Falta executar o toolkit real após publicação. |
| 6. Contas/orgs | O código já permite várias conexões por usuário e grants OAuth coexistentes. Toolkit de outro projeto/org é uma camada distinta. | Mantidos UUID explícito, padrão único e isolamento por usuário. Não foi provisionada nem transferida conta. | Testes de conexões e idempotência cobrem escopos. Registrar/autorizar as duas conexões sob o principal correto e configurar o toolkit no projeto Neurau requer acesso àquelas contas. |
| 7. Aceito mas atrasado | Causa histórica não determinada. Aceite com ID não confirma entrega; ausência no histórico parcial também não confirma falha. | Resposta explícita de aceite, entrega/leitura indisponíveis e consulta da ação. Não repete writes automaticamente. | Testes cobrem aceite com histórico vazio e preservação do ID. Atrasos de entrega do provedor/WhatsApp permanecem fora da evidência local. |
| 8. Sem eventos | O código atual já possui MCP Events com `message.received`, assinatura e entrega por webhook. O relato pode anteceder essa implementação ou envolver cliente sem suporte. | Não adicionamos outro arquivo/event bus. Logs distinguem seleção. | 285 testes focados passaram, incluindo ingresso/entrega/recuperação com Worker, OAuth, KV e D1 locais reais. Sem prova de callback público ou de suporte MCP Events na Composio. Sync de tools não habilita métodos events automaticamente. |

## Matriz de protocolo

| Revisão/transporte | Antes desta alteração | Código desta alteração |
| --- | --- | --- |
| 2024-11-05 HTTP+SSE | Não | Não; `/sse` e GET stream não existem. Clientes exclusivos desse transporte devem mudar para HTTP. |
| 2025-03-26 Streamable HTTP | Rejeitado | POST stateless, resposta JSON; initialize, tools/list e tools/call testados sem headers/meta de 2026. |
| 2025-06-18 e 2025-11-25 Streamable HTTP | Rejeitado | Mesmo caminho de compatibilidade, testado. |
| 2026-07-28 stateless | Sim | Preservado: headers e `_meta` obrigatórios; declarações modernas malformadas não caem no fallback antigo. |

Não há `Mcp-Session-Id`, GET stream, DELETE de sessão, WebSocket ou stdio remoto. O stdio local permanece exclusivo de desenvolvimento. O suporte antigo é uma alteração explícita do contrato anterior, solicitada nesta tarefa; o handler moderno continua `legacy: reject` e `responseMode: json`. O adaptador antigo usa o transporte SDK com `enableJsonResponse: true`, sem gerador de sessão.

## Retenção e diagnóstico operacional

Histórico de conversa e anexos dependem da retenção configurada no provedor. Não há prazo fixo comprovado nesta sessão; verificar `DATABASE_SAVE_MESSAGES`, gravação de corpos e a política real antes de prometer dias de histórico. Nenhuma configuração remota foi alterada.

O WaPilot guarda somente prévias de notificações autorizadas pendentes por até uma hora, removidas após aceite HTTP, invalidação ou vencimento; IDs operacionais e deduplicação duram até 24 horas. Isso não é histórico pesquisável. Reservas de envio duram 24 horas desde a primeira tentativa, com limpeza periódica e validade conferida no uso.

Logs novos: `mcp_http` contém revisão allowlisted, transporte, nomes de headers ausentes, status e duração. `wapilot_send` contém operação, conexão, hash da chave opaca do cliente, latência do despacho e resultado. A chave bruta não é registrada, pois clientes podem colocar dados sensíveis nela. `mcp_events_selection` contém conexão, contagem de assinaturas selecionadas e resultado. Não registram corpo, texto, destino, bearer ou token de instância. Duração do envio é diagnóstico da operação, não benchmark nem prova de entrega.

## Ações do lado Composio

Usar o endpoint HTTPS `/mcp` com Streamable HTTP e `Accept: application/json, text/event-stream`. Depois da publicação, repetir uma leitura pelo toolkit real e registrar apenas horário UTC, status e identificador de execução redigido. A [issue 2152](https://github.com/ComposioHQ/composio/issues/2152) trata de negociação de Accept e registra depreciação de SSE; ela não prova o envelope usado pelo cliente atual.

A [documentação Custom MCP](https://docs.composio.dev/docs/extending-sessions/custom-mcp) confirma HTTPS remoto, DCR OAuth, sincronização inicial e ausência de resync automático. A correção de transporte isolada não exige recriar o toolkit. Esta entrega adiciona `get_send_status`: sincronizar manualmente com uma conexão ativa para obter a ferramenta e conferir os schemas de idempotência. Não apagar o toolkit para isso. Autorizar novamente somente se faltarem escopos ou o grant estiver inválido.

A org/projeto Neurau precisa de seu próprio toolkit/conta conectada com autorização correta; o toolkit privado pessoal não atravessa esse limite. O guia [Sessions via MCP](https://docs.composio.dev/docs/sessions-via-mcp) descreve expor uma sessão Composio, que é o sentido inverso de importar o WaPilot. Não há evidência de suporte do custom toolkit a `events/subscribe`; isso deve ser confirmado com Composio, sem prometer que resync cria eventos.

A [especificação oficial Streamable HTTP](https://modelcontextprotocol.io/specification/draft/basic/transports/streamable-http) descreve a troca 2025 para 2026; o projeto mantém a revisão [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28) no caminho moderno.

## Próxima validação no ambiente autorizado

Confirmar as duas conexões por OAuth de Heitor; consultar estado e histórico de um self-chat identificado. Capturar uma entrada de teste com ID/horário e seguir separadamente sua retenção no provedor e seleção no webhook. Enviar uma única mensagem de teste com chave opaca, repetir com a mesma chave e conferir ID e uma única cópia. Fazer o mesmo com resposta citada. Não simular falha de rede em envio real antes de comprovar a proteção no ambiente publicado. Conferir resultados por ID/chave; páginas vazias não são prova de não envio.

Nenhuma migração nova é necessária para este patch; ele depende de `send_operations` já existente. Não aplicar migrations destrutivas legadas como parte desta entrega. Publicação, ferramentas Composio e testes pessoais permanecem pendentes de ambiente/autorização apropriados.

## Validação executada

- `npm run typecheck`: passou no estado final.
- `npx vitest run test/mcp-compatibility.test.ts test/mcp-events.test.ts test/event-deliveries.test.ts test/event-recovery.test.ts test/mcp-messages.test.ts test/send-idempotency.test.ts test/outbound-history.test.ts`: **285 passaram**, sete arquivos, no estado final.
- `npm run check`: galeria e typecheck passaram; a execução completa registrou **565 testes passando e dois falhando**, antes das cinco últimas asserções/casos focados. As duas falhas são `worktree-env.test.ts` (fixture `.env.stdio` ausente) e `worktree-setup.test.ts` (fixture `.tokensave/config.json` ausente). Também falham isoladas; seus helpers não foram alterados. Não declaramos o check completo verde.
- `git diff --check`: passou.
- `npx wrangler deploy --dry-run`: bloqueado pelo Docker CLI ausente para construir o Container já configurado. Nenhum deploy, push ou alteração de infraestrutura foi feito.

Os testes de compatibilidade e perda do ID foram executados falhando antes da correção e passando depois. Os testes locais usam números sintéticos e provedores simulados; não comprovam os incidentes de produção. Nenhuma mensagem foi enviada a clientes ou a contas reais.

## Read-back após nova falha de sync/reconexão na Composio

Em 09/11/2026, aproximadamente 19:08–19:11 UTC, a sessão local do Wrangler conseguiu consultar a conta proprietária de produção. A integração Cloudflare conectada aponta para outras contas e não contém esse Worker; não confundir essa ausência com indisponibilidade do serviço.

O read-back encontrou a implantação de 16:32:17 UTC, versão `17e00fc4-2ddc-4139-97df-8f29a2565b9c`, em 100% do tráfego. A leitura do bundle publicado confirmou o handler OAuth com `legacy: 'reject'`, sem `serveMcpHttp`, `get_send_status` ou os logs `mcp_http` do patch local. Portanto resync/reconexão não aplica a correção de compatibilidade: ela ainda não está publicada.

A consulta histórica em Workers Observability retornou 403 com as credenciais disponíveis. O tail live funcionou e mostrou requests modernos `/mcp/` com os três headers obrigatórios e status 200. Esses requests não foram atribuídos à Composio. Nenhum trace da tentativa relatada foi recuperado; a mensagem genérica da Composio, isoladamente, não permite distinguir erro OAuth de erro de descoberta. Solicitada nova tentativa durante o tail para correlacionar o estágio e o status. Nenhuma alteração de produção foi feita nessa investigação.

### Retry de sync observado às 19:11:08–19:11:09 UTC

Após o usuário repetir sync durante o tail, foram observados dois `POST /mcp` com respostas 400: `19:11:08.827Z` e `19:11:09.328Z`. Ambos tinham `Accept: application/json, text/event-stream`, mas nenhum dos headers `MCP-Protocol-Version`, `Mcp-Method` e `Mcp-Name`. O runtime registrou `outcome: ok`, sem exceção: rejeição HTTP, não crash do Worker. Um request moderno imediatamente anterior, com os três headers, retornou 200. Não foram coletados bearer, cookies ou corpo dos requests; por isso não se afirma ter inspecionado `_meta` dessa tentativa.

A correlação com o retry informado e a leitura do handler publicado confirmam a incompatibilidade de transporte como causa observada da falha de sync. O patch compatível continua local; resync/reconexão não publica código. Não é necessário coletar novas credenciais para esse diagnóstico. A correção exige publicação do patch revisado e um novo sync posterior; esta investigação não autorizou nem executou deploy.

## Publicação autorizada do patch isolado

Após autorização do usuário, o patch de compatibilidade foi isolado sobre o último `main` conferido. A revisão `101a1fc3-50ee-4c32-b020-2f7f3a8bfda0` entrou em 100% do tráfego em 09/11/2026, às 19:21:26 UTC. GitHub `main` e a branch de release estão em `b67a3b4b956b02d68f518f45d947c08c273a3801`; o read-back do sourcemap confirmou todos os 33 fontes de aplicação idênticos ao último `main`. A release passou galeria, typecheck, 568 testes e dry-run. As falhas anteriores de fixtures foram resolvidas executando os testes com um diretório temporário executável fora do pacote ESM, sem mudar os testes.

Bindings, variáveis, Secrets, assets, Container, dois consumidores de Queue e Cron foram preservados/read-back. O Wrangler publicou o Worker com `--containers-rollout none --keep-vars`; o status final não zero veio da tentativa recusada de reaplicar consumidores de Queue, que permaneceram com sua configuração anterior. Os probes com curl responderam 200 em health/metadata e 401 com metadata em MCP sem bearer; a listagem pelo cliente moderno autenticado passou. O patch não muda catálogo, portanto não exige recriação do toolkit. O usuário foi convidado a repetir sync na Composio; sucesso nesse cliente específico não foi afirmado sem novo resultado.

Somente compatibilidade foi publicada: as mudanças mais amplas de envio/histórico deste checkout continuam locais. A branch `fix/secret-encrypted-update` também permanece separada, com dois commits não incorporados. Nem toda branch histórica está mesclada por ancestralidade; alguns patches já possuem equivalentes no `main`. Consulte `docs/DEPLOY.md` da release para o registro operacional.

## Integração de encerramento

O usuário autorizou integrar, versionar, enviar ao GitHub e publicar o trabalho restante. Esta etapa incorpora os dois commits de `fix/secret-encrypted-update` e as mudanças locais de envios, consultas, diagnósticos e logs, preservando a compatibilidade publicada. “Secret” no nome da branch se refere às atualizações de mensagens criptografadas; nenhum commit inclui chaves privadas ou tokens. Os estados “pendente/local” anteriores neste relatório descrevem os respectivos momentos da investigação, não o estado final desta integração. O registro final de release está em `DEPLOY.md`.

### Estado final consolidado

Todos os patches desta sessão, incluindo os dois commits de updates cifrados, foram incorporados ao merge `3d783b4` no `main`. A release passou 592 testes em 40 arquivos, typecheck, galeria e dry-run. O deploy manual `d3e46208` foi seguido pelo automático `c691265b`, ambos com o código combinado; os 34 fontes publicados coincidiram com o `main`. O checkout original ficou sem alterações pendentes. O detalhamento do rollout, reconstrução automática do Container e read-back dos consumidores está em `DEPLOY.md`.

Essa consolidação não transforma causas históricas ainda não reproduzidas em incidentes resolvidos. A retenção de entrada, o atraso de entrega antigo, a recuperação de envelopes já descartados e o suporte de eventos no cliente Composio conservam os limites registrados acima. Nenhum segredo ou token faz parte dos commits.
