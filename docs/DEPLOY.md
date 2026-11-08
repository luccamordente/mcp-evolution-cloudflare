# Deploy e configuração

## Container do sender

O `wrangler.jsonc` prepara a imagem de `sender/Dockerfile` como `sender`, sob a política nativa `durable_object`, e associa `CallbackSender` ao binding interno `CALLBACK_SENDER`. O controlador escolhe `instance: "lite"` ao iniciar e todas as chamadas usam o objeto de nome fixo `shared`. Essa política não aceita `max_instances` na versão fixada do Wrangler; a escolha de uma única instância é mantida pelo código da aplicação, sem um teto financeiro prometido. O perfil `local` possui seu próprio binding e Container; o perfil `stdio` os exclui.

Não é necessário cadastrar um novo segredo: o controlador deriva um token interno de `TOKEN_ENCRYPTION_KEY` e o passa ao Node como `CALLBACK_SENDER_TOKEN`, sem expor a chave original. Nenhum segredo é colocado na imagem. O processo Node trata SIGTERM e preserva chamadas em andamento durante o encerramento limitado; o controlador define um minuto de inatividade pela API nativa, sem manter um monitor permanente que prolongue a atividade. Não habilite interceptação HTTPS para esse sender, pois DNS, IP e identidade TLS devem permanecer sob o controle do Node.

Validação local: `npm run check`, `npm --prefix sender test`, `npm --prefix sender run test:container`, `npm run test:sender-container` e `npx wrangler deploy --env '' --dry-run`. O dry-run constrói a imagem e o bundle sem publicar. A suíte de Container constrói uma imagem de fixture com CA temporária e usa DNS/TLS controlados; comprova bytes, endereço aprovado, hostname/SNI/certificado e ciclo de vida no Docker/workerd local. O wrapper de rede existe apenas na fixture e não integra a imagem publicada.

Essa configuração ainda requer publicação autorizada para criar a infraestrutura remota. Antes de declarar conformidade em produção, homologue o caminho efetivo do Container na Cloudflare: inicialização e prontidão, uma única instância compartilhada, chamada ativa durante parada, inatividade e nova inicialização, bloqueios de rede, preservação de DNS/IP/TLS e corpo assinado. Ausência de uma instância rodando enquanto o serviço está ocioso é esperada; falha de inicialização não é aceite HTTP do callback e o trabalho deve permanecer sob o controle de D1/Queue. Este ticket não provisiona, publica nem altera recursos remotos.

## Leituras históricas de publicação

- Worker: `mcp-evolution-cloudflare`
- URLs: `https://app.wapilot.com.br`, `https://mcp-evolution-cloudflare.luccamordente.workers.dev`
- Revisão conferida em 8 de novembro de 2026: `1717fbe5-779b-4327-8a58-7cae868f679c`, com 100% do tráfego.
- D1: `mcp-evolution` (`d25ad771-5b81-4e41-88ed-6f980a32dbf9`), migrations `0001_init`, `0002_webhook_events`, `0003_connection_defaults` e `0004_remove_connection_runtime_state` aplicadas remotamente. O read-back de 17 de outubro de 2026 confirmou a remoção de `status`/`connection_state` e preservou os dois registros de conexão, seus `instance_id`, flags padrão e timestamps.
- KV OAuth: `3a5b420e14594ee4ae821b720a9bf74a`; preview `29bb2b67785b46bfa7c31d84bbbe9344`.

## Publicação de GIFs em 8 de novembro de 2026

O backend foi publicado no deployment `evolution-go-production`, namespace `evolution`, no cluster `evolution-cluster-production`. A imagem `0.7.4-gif-40d7e022` foi fixada pelo digest `sha256:a6c10733ed858823030025c40a1365f634cea91131db5bf7d10c949f86e54bd6`. O rollout confirmou uma réplica atualizada e pronta. A release preserva a branch de desempenho que já estava em produção, incluindo a versão mais recente da biblioteca de mensagens usada por essa branch.

O Worker foi publicado com a tag `gif-43b4863` e `--keep-vars`, após 396 testes, os testes de aceitação dos dois repositórios e o dry-run. A leitura posterior confirmou a revisão acima com 100% do tráfego. `/healthz` e a metadata OAuth responderam 200; `/mcp` sem bearer respondeu 401 com `resource_metadata`.

As funcionalidades PDF e os comprovantes de envio publicados anteriormente ainda não estavam todos no `main`. A release recuperou os fontes originais do sourcemap da revisão anterior, preservou os cinco módulos PDF e conferiu o hash do WASM publicado. Testes no workerd confirmaram inspeção de páginas e renderização PNG. Antes de outra publicação, confira a versão ativa e as funcionalidades existentes; o `main` sozinho não descreve necessariamente o estado publicado.

Um teste autorizado com GIF confirmou conversão real no container de produção para H.264/yuv420p, sem áudio, com 16 quadros em dois segundos. O envio via MCP foi aceito e a consulta posterior encontrou a mensagem como `video/mp4`, com `gifPlayback=true` e bit 64. Essa verificação não comprova a reprodução visual em todos os dispositivos.

## Deploy automático

A configuração observada anteriormente conectava o Worker ao repositório GitHub `luccamordente/mcp-evolution-cloudflare` pelo Workers Builds. Naquela configuração, pushes em `main` executavam `npm ci` e `npx wrangler deploy`, com `auto_build_enabled` ativo e sem previews.

O push do commit `371901d` gerou o build `1b2e77e1-8469-498d-826e-da7655778a88`, encerrado com sucesso. O endpoint `/healthz` publicado respondeu `200` depois do build.

O `/healthz` publicado respondeu `protocol: 2026-07-28`, e `/mcp` respondeu `401` com `resource_metadata` RFC 9728. O read-back de 17 de outubro de 2026 confirmou que a aplicação Cloudflare Access de `/connections` também cobre `/admin`, reutilizando a audiência configurada para o dashboard, One-time PIN e os dois e-mails autorizados. `/admin` e `/admin/data` também exigem a allowlist operacional explícita de Lucca e Heitor no Worker; mantenha `ADMIN_EMAILS` ausente para usar essa dupla padrão ou configure apenas essa mesma dupla. O `/user/contacts` passa a repassar o parâmetro `search` diretamente ao Evolution Go além da normalização em memória.

O painel `/admin` é somente leitura e não substitui o provisionamento em `/connections?provision=1`. Uma consulta ao painel produz um snapshot único; a atualização é manual e não há polling. Valide `/admin` e `/admin/data` com sessões Access de Lucca e de Heitor, confirme que um usuário autenticado fora da allowlist recebe `403`, e confira que usuários sem conexões ou autorizações continuam presentes. Verifique também que uma falha individual do Evolution Go, do OAuth Provider ou da auditoria aparece como fonte indisponível sem apagar os demais dados; a conexão deve distinguir auditoria indisponível de ausência de atividade. A resposta não contém tokens, claims, payloads ou metadados de auditoria.

As rotas usadas pelo dashboard (`GET /connections/authorizations`, `DELETE /connections/authorizations/:id` e `POST /connections/authorizations/:id/revoke`) devem permanecer na mesma aplicação Access de `/connections`; assim, o `fetch` não redireciona para a aplicação `/api`. Os aliases (`GET /api/authorizations`, `DELETE /api/authorizations/:id` e `POST /api/authorizations/:id/revoke`) permanecem sob a aplicação Access separada de `/api` para clientes compatíveis. Valide a listagem com um usuário autenticado, confirme que grants expirados não são exibidos, que cursores retornam a próxima página e que a revogação de um grant é refletida após o read-back da lista. A política de consentimento aceita múltiplos grants; não declare os demais clientes desconectados ao revogar apenas um.

Para entrar na interface, abra `https://app.wapilot.com.br/connections` ou `https://app.wapilot.com.br/admin`, escolha a autenticação Cloudflare Access, informe `luccamordente@gmail.com` ou `heitorsalazar@gmail.com` e digite o One-time PIN enviado por e-mail. A sessão do navegador é independente do OAuth usado por clientes MCP; não use o token MCP no navegador.

## Segredos

Foram configurados `TOKEN_ENCRYPTION_KEY`, `CONSENT_SECRET`, `ACCESS_JWKS_URL`, `ACCESS_ISSUER`, `ACCESS_AUDIENCE` e `EVOLUTION_GLOBAL_API_KEY` como Workers Secrets. `EVOLUTION_BASE_URL` está configurado como `https://zipt-zopt.neurau.com.br`. Uma chamada controlada sem token de instância respondeu `401 not authorized`, confirmando que o endpoint está acessível sem declarar uma conexão autenticada como sucesso.

Revalide os segredos e bindings no ambiente antes de publicar. A transição de mensagens exige a ordem abaixo; aplicar todas as migrations enquanto o Worker antigo ainda grava nas tabelas legadas quebra o ingresso e os envios antigos. Publicação, segredos e migrations remotas precisam de autorização específica.

Cadastre cada instância em `/connections` ou `POST /api/connections` com nome amigável, ID da instância, número opcional e token específico. A resposta de criação entrega uma única URL de webhook; não reutilize nem registre o segredo. Para MCP Events, habilite o evento live `Message` no formato JSON:API aceito pelo contrato da instância. Histórico, envios próprios e eventos de protocolo não geram notificações; o endpoint não é um arquivo geral.

## Verificação

```sh
curl -i https://app.wapilot.com.br/healthz
curl -i https://app.wapilot.com.br/mcp
curl -i https://app.wapilot.com.br/.well-known/oauth-protected-resource/mcp
```

O teste com um cliente real MCP e qualquer envio WhatsApp dependem da autenticação do cliente e de uma conexão Evolution Go real. Não execute envio real sem destinatário e conteúdo definidos.

## Configuração da leitura de PDFs

`read_message_document` usa o binding `AI` já declarado no `wrangler.jsonc`, pelo método `toMarkdown`, sem nova chave ou serviço de OCR. Configure `DOCUMENT_STORAGE_ORIGINS` com origens HTTPS exatas aprovadas para PDFs; essa allowlist é independente das de áudio e imagem e exclui a origem de `EVOLUTION_BASE_URL`. Sem configuração válida, o download falha fechado. A alteração de configuração só entra em produção após publicação autorizada.

Atualize o catálogo do cliente após publicar e permita pelo menos **90.000 ms** por chamada. O WaPilot espera até 60.000 ms, aceita até 8 MiB ou `MAX_MEDIA_BYTES` menor e devolve até 200.000 caracteres, sem truncamento. O binding não garante cancelamento remoto de conversão em andamento; evite repetir automaticamente uma chamada interrompida. PDF e texto não são persistidos pelo WaPilot.

A entrega não inclui OCR. Valide separadamente PDFs textuais, digitalizados e mistos, conferindo que a limitação seja comunicada e que texto parcial não seja apresentado como cobertura completa. Testes automatizados usam conversão simulada e não comprovam extração, qualidade ou latência reais. Consulte o [contrato da ferramenta](TOOLS.md#leitura-de-pdfs), a [API de conversão](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/usage/binding/) e o [processamento de PDFs](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/#pdfs). O stdio local não anuncia a ferramenta e mantém bindings remotos desativados.

## Configuração da transcrição de áudio

O `wrangler.jsonc` declara o binding `ai: { binding: "AI" }` para `transcribe_message_audio` no MCP HTTP. A inferência usa o modelo `@cf/openai/whisper-large-v3-turbo` diretamente pelo binding, sem token REST adicional ou AI Gateway. Cada chamada gera consumo de Workers AI; não há cache nem retry de inferência. O binding só passa a existir no Worker publicado após um deploy autorizado; o perfil stdio não o utiliza nem habilita bindings remotos.

Configure `AUDIO_STORAGE_ORIGINS` com as origens HTTPS exatas aprovadas para o download de áudios, separadas por vírgula. Use somente origens sem curingas, caminhos, queries ou credenciais; a origem de `EVOLUTION_BASE_URL` é excluída mesmo se cadastrada. Esta allowlist é independente de `IMAGE_STORAGE_ORIGINS` e não amplia a CSP da galeria. A ferramenta exige mensagem e áudio retidos, aplica até 8 MiB (ou `MAX_MEDIA_BYTES`, se menor) e falha explicitamente quando o arquivo não está disponível.

Após uma publicação autorizada, atualize o catálogo do cliente e configure seu timeout para pelo menos **360.000 ms**. O WaPilot usa 300.000 ms para a operação completa; o cliente ou o serviço de inferência podem encerrar a chamada antes. Valide com uma amostra autorizada de nota de voz Ogg/Opus e de anexo de áudio, incluindo idioma original, formato de saída e ausência de áudio/URLs/credenciais na resposta e na auditoria. Os testes mockados não comprovam codec, qualidade ou latência reais. Não confunda `deploy --dry-run` com publicação ou validação de uma inferência remota.

Em 30 de outubro de 2026, a primeira revisão de transcrição, `dc18ea3d-f4ce-41cc-b1e8-42f6b3f09fee`, foi publicada após `npm run check` (291 testes) e dry-run. O read-back confirmou o binding `AI`, `AUDIO_STORAGE_ORIGINS` e os segredos existentes. `/healthz` e a metadata OAuth responderam `200`; `/mcp` sem bearer respondeu `401` com o desafio OAuth. Uma chamada autenticada de `connection_status` pelo plugin WaPilot também funcionou. Essa validação inicial ainda não incluía transcrição de áudio real. A revisão anterior era `42f49c15-f664-4e1c-9982-bb5840786219`.

Na mesma data, o diagnóstico reproduziu `audio_unavailable`/502 em dois áudios: o runtime Workers rejeitava `redirect: 'error'` antes de acessar o storage. A revisão ativa acima trocou a opção por `manual` nos downloads de áudio e imagem, preservando a rejeição de respostas 3xx. Antes do deploy autorizado, passaram `npm run check` (293 testes) e dry-run; o teste de regressão no workerd falhou com o código anterior e passou após a correção. O read-back confirmou 100% do tráfego na nova versão. As verificações públicas mantiveram os resultados esperados e as duas mensagens de áudio informadas pelo usuário foram transcritas com sucesso pelo plugin WaPilot em produção. Essa observação comprova essas amostras naquela sessão; outros formatos e a qualidade da transcrição não foram avaliados em produção.

Consulte o [contrato da ferramenta](TOOLS.md#transcrição-de-áudio) e as fontes oficiais de [binding Workers AI](https://developers.cloudflare.com/workers-ai/configuration/bindings/), [Whisper Large v3 Turbo](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/), [uso de dados](https://developers.cloudflare.com/workers-ai/platform/data-usage/) e [limites de duração do Worker](https://developers.cloudflare.com/workers/platform/limits/#duration).

## Configuração da galeria MCP Apps

A galeria precisa que o Evolution Go retenha mensagens (`DATABASE_SAVE_MESSAGES=true`) e mídia em storage, e que a versão instalada implemente o filtro `encodingFormat` na busca. O contrato foi conferido no checkout canônico local do upstream; isso não comprova configuração, retenção ou disponibilidade em produção. A busca assina novamente as URLs dos arquivos que continuam disponíveis; não há recuperação por ID nem alterações no upstream.

Configure `IMAGE_STORAGE_ORIGINS` com as origens HTTPS exatas que o operador aprova para arquivos raster, separadas por vírgula, por exemplo `https://storage.example.test,https://images.example.test`. Não inclua curingas, caminhos, queries, tokens ou credenciais. Essa variável não é derivada do modelo nem das URLs recebidas. A origem de `EVOLUTION_BASE_URL` é sempre excluída, mesmo se cadastrada por engano, para impedir acesso direto da UI à API. Sem origens válidas, a ferramenta continua respondendo com resumo/estados indisponíveis, e a CSP bloqueia todas as imagens externas. O recurso declara somente essas origens e nenhuma conexão direta de rede; a CSP adicional do documento restringe seu uso a imagens. Permitir uma origem não garante que os arquivos possam ser carregados ou que seus links ainda sejam válidos.

O build da UI deve preceder testes e empacotamento do Worker: `npm run build:gallery` gera `src/generated/image-gallery.ts`, e o hook de build do Wrangler executa o mesmo comando. O artefato é estático e não contém dados de usuários. `npm run check` verifica tipos, sincronização do artefato e testes de protocolo/segurança/UI. `npx wrangler deploy --dry-run` verifica o bundle sem publicar. Nenhum segredo ou binding adicional é necessário.

Em 19 de outubro de 2026, uma leitura autenticada de mensagens retidas confirmou `https://storage.neurau.com.br` como origem das URLs de mídia, incluindo uma imagem. Essa origem está configurada em `vars.IMAGE_STORAGE_ORIGINS` no `wrangler.jsonc`; a configuração só passa a valer em produção após um deploy autorizado. Caminhos de arquivos, assinaturas e conteúdo das mensagens não foram registrados nesta documentação. Essa observação não garante retenção permanente nem disponibilidade de todos os arquivos.

Após publicar alterações da ferramenta ou do recurso UI, atualize o catálogo do cliente e abra uma nova galeria. Confirme descoberta, leitura do recurso, exibição de imagens recebidas e enviadas já retidas, ampliação e retorno de foco. Teste separadamente cada host utilizado: o registro HTTP/OAuth do servidor não garante suporte à renderização de MCP Apps.

## Assinaturas MCP Events

As migrations `0007_event_subscriptions.sql` e `0008_event_deliveries.sql` criam assinaturas, marcadores de revogação, deduplicação e outbox de entregas. Reutilizam D1, OAuth KV, `TOKEN_ENCRYPTION_KEY` e `CALLBACK_SENDER`, sem novo segredo. Não aplicam migrations remotas nem publicam recursos. O código interrompe todas as gravações e leituras do arquivo geral/cache de envios. A migration `0009_drop_legacy_message_storage.sql` elimina as duas tabelas legadas sem copiar payloads; ela está preparada e testada localmente, sem aplicação remota nesta entrega.

`test/mcp-events.test.ts` executa o Provider 1.2.3 real com KV e D1 locais no workerd, credenciais sintéticas criadas por APIs públicas e sender HTTP controlado. Confere discovery do SDK 2.3.1 sem atualização de dependências, autorização, desafio/assinatura, prazos, concorrência, rotação, cancelamento e revogação. O `2xx` da verificação comprova somente o desafio. O handler agendado já integra a limpeza e cada entrega revalida autorização; a publicação futura deve homologar o ciclo completo no cliente OpenAI com autorização específica; não confundir os testes locais com essa homologação.


### Filas e retenção de MCP Events

O HTTP configura `EVENT_DELIVERIES` como produtor de `wapilot-events`, consumidor nativo nessa mesma fila e DLQ `wapilot-events-failed`. A DLQ tem consumidor de drenagem, `max_retries: 0` e nenhuma outra DLQ. As duas filas contêm somente IDs; corpo, assinatura e callback ficam fora do broker. O Cron `* * * * *` limpa entregas/origens, assinaturas e operações de envio, depois recupera trabalhos pendentes. O perfil `local` usa filas com sufixo `-local`, D1/KV sintéticos explicitamente locais e produtor com `remote: false`. O perfil `stdio` declara filas e Cron vazios, sem Container, KV ou bindings remotos.

Antes de qualquer publicação autorizada, criar ou atualizar **tanto a fila principal quanto a DLQ** com retenção de no máximo **86.400 segundos**. O schema instalado do Wrangler 4.150 não expõe retenção no `wrangler.jsonc`; a CLI oferece a opção `--message-retention-period-secs`. Exemplos somente para futura execução autorizada, não executados nesta implementação:

```sh
npx wrangler queues create wapilot-events --message-retention-period-secs 86400
npx wrangler queues create wapilot-events-failed --message-retention-period-secs 86400
# Para filas já existentes, usar queues update <nome> com a mesma opção.
```

Criar a DLQ explicitamente antes do deploy evita depender de criação automática com retenção padrão. Conferir as duas configurações no controle remoto após eventual criação; o dry-run não comprova existência nem retenção. [Comandos oficiais de Queues](https://developers.cloudflare.com/queues/reference/wrangler-commands/) e [configuração de DLQ](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/) descrevem essas operações. Esta etapa não executou `queues create/update`, deploy, migração remota ou mensagens reais.

O D1 limita cada entrega a seis tentativas e mantém os intervalos de 1, 2, 4, 8 e 15 minutos e a hora original, inclusive após queda, restart, publicação repetida ou DLQ. São transitórios `408`, `429`, `5xx`, rede, inicialização e timeout; `410`, `413`, redirects, outros status permanentes e destinos/contratos bloqueados encerram o trabalho. O Cron recupera até 100 IDs devidos por minuto, priorizando publicação ausente/mais antiga. Uma publicação sem consumo pode ser repetida após um minuto; o consumidor usa posse condicional de 60 segundos para conter duplicatas. A DLQ apenas reconhece o ID e libera publicação pendente, sem envio direto ou reset de orçamento. Não reenvie jobs manualmente alterando estado, contadores ou prazos no D1. Corrija a dependência indisponível e deixe Cron/consumidor usar o estado existente; entregas terminais ou vencidas exigem novos eventos live, sem replay.

Monitore os logs JSON `mcp_events_maintenance`: `backlog`, `retries` (reattempts nos registros retidos), `failures`, `publication_recoveries`, `publication_failures`, `lease_recoveries`, `attempt_limit_failures`, `cleanup_lag_ms` e `schedule_lag_ms`. Backlog crescente com falhas de publicação aponta a fila; leases recuperados repetidamente apontam interrupções/armazenamento; retries/falhas com fila saudável apontam autorização, sender ou callback. Atrasos de limpeza/agendamento acima da cadência de um minuto pedem investigação do Cron e D1. `mcp_events_ingress` conta descartes inválidos, não suportados e excessivos; `mcp_events_delivery`, `mcp_events_queue` e `mcp_events_dlq` contam transições, falhas de infraestrutura e drenagem. Os logs não contêm valores de mensagens, IDs, callbacks completos, segredos ou assinaturas. Esses sinais não consultam mensagens periodicamente.

`test/event-recovery.test.ts` complementa `test/event-deliveries.test.ts` pelas entradas reais HTTP/Queue/agendamento no workerd, com D1 e Provider/KV locais reais. Cobre perda de publicação, backoff, restart, falha ao guardar aceite, concorrência/posse antiga, autorização, prazos exatos, DLQ e métricas sanitizadas. Um aceite externo seguido de falha local pode duplicar a notificação; `2xx` não comprova execução do agente. O transporte interno usa prazo absoluto validado também no Node, sem depender de propagação de cancelamento; testes Container cobrem prontidão lenta e DNS/TLS tardios. Essas provas locais não comprovam broker remoto, retenção das filas, egress da Cloudflare ou execução no cliente OpenAI.


## Publicação futura da transição de mensagens

Esta implementação não publica nem autoriza a exclusão de dados de produção. Os registros de publicação acima são históricos; antes da etapa remota, confirme Worker, revisão com tráfego, automação de builds, migrations aplicadas, filas e retenção, segredos, bindings e versão do provedor. Suspenda publicações automáticas concorrentes durante a mudança autorizada.

A ordem segura separa a expansão do schema da remoção:

1. Prepare um checkout de release do commit revisado. Para a primeira aplicação de migrations, mantenha nesse checkout somente `0001`–`0008` em `migrations/`; deixe `0009` fora do diretório temporariamente, preservada no Git. Confira a lista pendente com `npx wrangler d1 migrations list mcp-evolution --remote`. Aplique o prefixo com `npx wrangler d1 migrations apply mcp-evolution --remote` somente após conferir essa lista. As tabelas antigas continuam disponíveis para a revisão anterior; não reescreva migrations já aplicadas.
2. Crie ou confira ambas as filas com a retenção descrita acima e publique o bundle revisado com `npx wrangler deploy --env ''`. Esse código funciona com as tabelas legadas ainda presentes, sem acessá-las. Confirme 100% do tráfego na revisão nova, ausência de produtores antigos e saúde de MCP/UI/webhook, filas, Cron e sender. Não use divisão de tráfego com revisões antigas durante o DROP.
3. Abra uma janela de manutenção para o corte destrutivo: pause ingresso de webhook no provedor e novas operações MCP, aguarde chamadas antigas em andamento terminarem e confirme que nenhum outro Worker ou consumidor usa as tabelas legadas. Se não puder confirmar a ausência de escritores antigos, adie o DROP. Recoloque `0009` no diretório do mesmo checkout, confira que é a única migration pendente e aplique-a. Não copie seus payloads para outra tabela, exportação ou cache. Confira por consultas sem conteúdo a ausência de `webhook_events`/`outbound_messages`, integridade de FKs e preservação de usuários, conexões, defaults, ciphertext, hashes de webhook, auditoria e registros operacionais válidos; OAuth continua no mesmo Provider/KV.
4. Retome o ingresso e as operações, valide os endpoints de saúde e OAuth e execute o ciclo de homologação autorizado abaixo. Compare a configuração preservada por IDs e resultados seguros, sem expor tokens ou conteúdo. Observe backlog, falhas e atraso de limpeza por pelo menos um ciclo do Cron.

Depois do DROP, rollback para código que consulta ou grava as tabelas antigas é incompatível. Prefira correção para frente ou uma revisão já compatível com o schema final. Restaurar código não restaura D1; não recrie histórico nem restaure payloads para contornar a remoção. Antes do DROP ainda é possível voltar ao código anterior, mas ele retomaria a retenção legada; mantenha a manutenção até decidir o próximo passo autorizado. Não publique os perfis de desenvolvimento `local`/`stdio`.

Homologação pendente, separadamente autorizada: com receptor controlado, comprove no Container real da Cloudflare resolução DNS, IP conectado, SNI/hostname/certificado, rejeição de redes privadas/redirects, bytes assinados, prazo absoluto e parada/retomada. Depois, no cliente OpenAI autenticado, verifique discovery, desafio, assinatura, evento sintético via webhook, callback, execução observada do agente, `get_message` e uma ação com a mesma chave de idempotência. Só então repita com uma mensagem real expressamente permitida, destinatário e conteúdo finais autorizados. Confirme cancelamento via `events/unsubscribe`, revogação e limpeza. Logs e resultados devem permanecer redigidos. Um `2xx`, teste local ou dry-run não comprova execução do agente, e a instância compartilhada não é teto de custo.

O contrato final mantém vigência de assinatura de até sete dias; corpo pendente por até uma hora desde o recebimento e remoção após aceite ou encerramento; IDs/resultados por 24 horas; metadados de assinaturas inativas até 24 horas após o fim; marcador mínimo de revogação por sete dias. Idempotência de envio guarda somente metadados por 24 horas. Consulte [ARCHITECTURE.md](ARCHITECTURE.md) para o detalhe e [TOOLS.md](TOOLS.md#assinaturas-mcp-events) para cancelamento, conteúdo não confiável e limites. Histórico integral depende exclusivamente da retenção do provedor, sem promessa de disponibilidade, replay ou entrega exatamente uma vez; aceite seguido de falha de armazenamento pode duplicar notificações.
