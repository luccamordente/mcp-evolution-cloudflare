# Deploy e configuração

## Estado publicado

- Worker: `mcp-evolution-cloudflare`
- URLs: `https://app.wapilot.com.br`, `https://mcp-evolution-cloudflare.luccamordente.workers.dev`
- Revisão ativa conferida em 30 de outubro de 2026: `317043ed-e3d2-41b3-a349-675dca777b01`, com 100% do tráfego.
- D1: `mcp-evolution` (`d25ad771-5b81-4e41-88ed-6f980a32dbf9`), migrations `0001_init`, `0002_webhook_events`, `0003_connection_defaults` e `0004_remove_connection_runtime_state` aplicadas remotamente. O read-back de 17 de outubro de 2026 confirmou a remoção de `status`/`connection_state` e preservou os dois registros de conexão, seus `instance_id`, flags padrão e timestamps.
- KV OAuth: `3a5b420e14594ee4ae821b720a9bf74a`; preview `29bb2b67785b46bfa7c31d84bbbe9344`.

## Deploy automático

O Worker está conectado ao repositório GitHub `luccamordente/mcp-evolution-cloudflare` pelo Workers Builds. Pushes em `main` executam `npm ci` e `npx wrangler deploy`, com `auto_build_enabled` ativo e sem previews.

O push do commit `371901d` gerou o build `1b2e77e1-8469-498d-826e-da7655778a88`, encerrado com sucesso. O endpoint `/healthz` publicado respondeu `200` depois do build.

O `/healthz` publicado respondeu `protocol: 2026-07-28`, e `/mcp` respondeu `401` com `resource_metadata` RFC 9728. O read-back de 17 de outubro de 2026 confirmou que a aplicação Cloudflare Access de `/connections` também cobre `/admin`, reutilizando a audiência configurada para o dashboard, One-time PIN e os dois e-mails autorizados. `/admin` e `/admin/data` também exigem a allowlist operacional explícita de Lucca e Heitor no Worker; mantenha `ADMIN_EMAILS` ausente para usar essa dupla padrão ou configure apenas essa mesma dupla. O `/user/contacts` passa a repassar o parâmetro `search` diretamente ao Evolution Go além da normalização em memória.

O painel `/admin` é somente leitura e não substitui o provisionamento em `/connections?provision=1`. Uma consulta ao painel produz um snapshot único; a atualização é manual e não há polling. Valide `/admin` e `/admin/data` com sessões Access de Lucca e de Heitor, confirme que um usuário autenticado fora da allowlist recebe `403`, e confira que usuários sem conexões ou autorizações continuam presentes. Verifique também que uma falha individual do Evolution Go, do OAuth Provider ou da auditoria aparece como fonte indisponível sem apagar os demais dados; a conexão deve distinguir auditoria indisponível de ausência de atividade. A resposta não contém tokens, claims, payloads ou metadados de auditoria.

As rotas usadas pelo dashboard (`GET /connections/authorizations`, `DELETE /connections/authorizations/:id` e `POST /connections/authorizations/:id/revoke`) devem permanecer na mesma aplicação Access de `/connections`; assim, o `fetch` não redireciona para a aplicação `/api`. Os aliases (`GET /api/authorizations`, `DELETE /api/authorizations/:id` e `POST /api/authorizations/:id/revoke`) permanecem sob a aplicação Access separada de `/api` para clientes compatíveis. Valide a listagem com um usuário autenticado, confirme que grants expirados não são exibidos, que cursores retornam a próxima página e que a revogação de um grant é refletida após o read-back da lista. A política de consentimento aceita múltiplos grants; não declare os demais clientes desconectados ao revogar apenas um.

Para entrar na interface, abra `https://app.wapilot.com.br/connections` ou `https://app.wapilot.com.br/admin`, escolha a autenticação Cloudflare Access, informe `luccamordente@gmail.com` ou `heitorsalazar@gmail.com` e digite o One-time PIN enviado por e-mail. A sessão do navegador é independente do OAuth usado por clientes MCP; não use o token MCP no navegador.

## Segredos

Foram configurados `TOKEN_ENCRYPTION_KEY`, `CONSENT_SECRET`, `ACCESS_JWKS_URL`, `ACCESS_ISSUER`, `ACCESS_AUDIENCE` e `EVOLUTION_GLOBAL_API_KEY` como Workers Secrets. `EVOLUTION_BASE_URL` está configurado como `https://zipt-zopt.neurau.com.br`. Uma chamada controlada sem token de instância respondeu `401 not authorized`, confirmando que o endpoint está acessível sem declarar uma conexão autenticada como sucesso.

Para concluir a integração, configure:

```sh
npx wrangler secret put EVOLUTION_GLOBAL_API_KEY # somente se o deployment usar chave administrativa
npx wrangler d1 migrations apply mcp-evolution --remote
npx wrangler deploy
```

Cadastre cada instância em `/connections` ou `POST /api/connections` com nome amigável, ID da instância, número opcional e token específico. A resposta de criação entrega uma única URL de webhook; não reutilize nem registre o segredo. Configure no Evolution Go os eventos `MESSAGE`, `SEND_MESSAGE`, `HISTORY_SYNC` e `GROUP` para essa URL.

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
