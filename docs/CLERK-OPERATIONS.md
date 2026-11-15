# Operação de identidades e corte para Clerk

Este procedimento prepara a integração da spec #53. A entrega de código não autoriza usar credenciais reais, emitir convites, alterar configuração externa, aplicar migrations remotas ou publicar. A conta permanece bloqueada quando alguma conferência ou revogação estiver pendente.

## Evidências e gates pendentes

A aplicação escolhida é `app_3M1uSBQzCMOfMfnraVHBpldbNhx`, somente com a instância development `ins_3M1uS6zuL7NHmAvpeezFR2uvBjV` na leitura de 13/11/2026; IDs de usuários dessa instância não servem no D1 de produção. Após autorização do operador, o [alvo de configuração](clerk-development-config.json) foi novamente validado por `dry_run`, aplicado exclusivamente em development e conferido por read-back (`v1_ec69bf3a`): Google e senha desligados, cadastro restrito a convites, código por e-mail, e-mail imutável e paths incorporados configurados. Telefone, username, passkey, biometria e Web3 também estavam desligados na leitura anterior à aplicação. Essas são evidências development de 13/11; a preparação production posterior está registrada abaixo.

A restrição de exclusão da própria conta não aparece no schema do plugin consultado. O operador a desligou no **User model**; GPT Terra confirmou autoexclusão e alteração de e-mail desligadas antes/depois de recarregar, ainda com zero usuários development. Após o fornecimento da chave development, os templates de convite e código foram traduzidos pela Backend API, com prévias desktop/móvel e read-back, preservando entrega e variáveis. O primeiro convite administrativo foi aceito no Account Portal; read-back confirmou e-mail primário verificado e conta sem bloqueio/autoexclusão antes do vínculo somente na fixture D1 local. Sessão, renovação, nova aba, saída e consentimento/PKCE/MCP/refresh reais passaram pela origem Tailscale privada, incluindo continuidade do grant após logout. O segundo convite foi enviado uma vez pelos endpoints WaPilot, aceito e verificado; a negativa enquanto pendente foi comprovada antes da ativação pelo endpoint administrativo com sessão/CSRF reais. A mesma linha foi ativada, inventário preservado e login do convidado liberou somente seu painel vazio, mantendo `/admin` bloqueado. Os textos principais foram confirmados em português pelo operador. Consulte as [evidências e limites da #62](CLERK-DEVELOPMENT-ACCEPTANCE.md). Produção permanece fora desta prova.

A inspeção pública desktop anterior à aplicação, feita com Terra, montou a UI real e encontrou os campos principais em pt-BR. A página de convite sem ticket recusou o cadastro. Naquele momento a instância mostrou Google, link de cadastro e os avisos em inglês do fornecedor; essa observação é histórica e não é read-back do novo alvo. Nessa inspeção não foram executados login, código de e-mail, convite, criação de conta, renovação após 60 segundos, retorno de aba fechada, saída ou teste móvel. Os rodapés do fornecedor não foram escondidos por CSS. Essa inspeção não substitui o fluxo completo de homologação.

Os testes HTTP usam o Worker real em workerd, D1/KV locais, SDK Backend real e JWT/JWKS/Backend API sintéticos. Cobrem usuários ativos, ausentes, pendentes e desativados; cookies separados, handshake, CSRF, respostas JSON das APIs e ausência de diagnósticos brutos em headers. Grants legados continuam listáveis/revogáveis por sessão Clerk, com preservação de IDs, padrão, propriedade e cifras das conexões nas fixtures.

A [preparação production da #63 em 13/11/2026](qa/clerk-production-2026-11-13.md) registra o domínio escolhido `wapilot.com.br`, preservando a origem `https://app.wapilot.com.br`, os read-backs e o fluxo versionado de código/configuração/secrets. A criação e o DNS foram autorizados, mas o Clerk recusou o clone por `app:custom_email_template` incompatível com o plano. Após esse bloqueio, o operador escolheu rever a exigência de e-mails: production pode usar os e-mails padrão do Clerk, sem templates personalizados pt-BR ou marca WaPilot nesses e-mails; a UI do produto permanece WaPilot em pt-BR. Essa exceção não autoriza upgrade de plano nem reduz somente convidados, e-mail imutável ou bloqueio de autoexclusão. Na #63, conferir por read-back templates padrão, idioma, aparência, links/variáveis e entrega habilitada; recebimento real no bootstrap #64 e homologação completa na #65, após o bootstrap, permanecem pendentes. Na [continuação de 14/11](qa/clerk-production-2026-11-14.md), production `ins_3M6CtiWpQ9IezNbz9MyNmpRhk6C` foi criada sem clone na mesma aplicação, e cadastro/métodos/e-mail imutável/paths foram aplicados e relidos. Templates padrão e entrega foram conferidos, sem envio; cinco CNAMEs foram criados e relidos, com domínio/DNS/e-mail/SSL completos às 13:30 UTC. Autoexclusão foi desativada e paths absolutos corrigidos, com read-back pela Frontend API; o formulário público do Account Portal carregou, sem login. A candidata `ed29ef2e-efa4-4a77-8271-5bf4f83ca26f`, fonte `c3e555d`, foi preparada com código/configuração/secrets e relida inativa às 14:12 UTC; esse é o checkpoint histórico da preparação inicial, sem vínculos ou corte nessa etapa. A leitura histórica às 14:12 UTC encontrou a revisão Worker `cce19d4b-683c-4b18-8937-8ec44d13950e`, fonte `a29ea1f…`. O read-back posterior às 14:47 UTC confirmou como retorno Access atual a revisão `8e9211a5-c451-4bc5-ab22-192556e1963d`, fonte `8c82f3af3842700b7bacb9e85262dbfe341c59c9`, com seis ferramentas, publicada em paralelo; o [suplemento da #63](qa/clerk-production-2026-11-14.md#reconciliação-com-a-publicação-paralela-de-seis-ferramentas) registra a candidata reconciliada `353fcb1e-5210-413e-b880-7caf4fe41e02`, fonte `fe2d8ed4…`, inativa por read-back às 14:53:43 UTC, sem corte e sujeita à revisão documental final da #63. Continuidade autenticada e promoção de tráfego pertencem à #65.

### Autorização posterior e adiamento pessoal

Em 14/11/2026, o operador autorizou retomar a publicação Clerk, abrir PR e integrar ao `main`, adiando explicitamente a aceitação de Heitor. A [decisão e seus limites](qa/clerk-identity-linking-2026-11-14.md#autorização-posterior-para-corte-e-integração) permitem o corte sem declarar homologação de Heitor. Sua linha D1 permanece ativa, sem vínculo e sem pendência forjada: grants OAuth legados seguem a barreira D1, e o navegador Clerk nega acesso até o vínculo verificado. O adiamento não autoriza desativação, recriação ou verificação administrativa de e-mail.

Os checkpoints de versão acima são históricos. Antes da promoção, reler o deployment vigente e reconciliar a candidata com o cleanup posterior no `main`, preservando os seis tools, OAuth/KV, migrations, cifras e imagem. A decisão não substitui a validação canônica de Lucca e a continuidade de grants; a aceitação, o vínculo e a homologação de Heitor continuam pendentes.

## Vínculo deliberado dos usuários existentes

O [registro da #64 em 14/11/2026](qa/clerk-identity-linking-2026-11-14.md) documenta o inventário, a aplicação exclusiva da migration aditiva, os dois convites administrativos production e o vínculo de Lucca após verificação/read-back. Heitor continua com convite pendente e sem vínculo; a #64 e o corte permanecem pendentes. O mesmo registro distingue a versão Access histórica do novo read-back da publicação paralela `8e9211a5…`, com seis ferramentas, e aponta para a candidata Clerk reconciliada `353fcb1e…`, ainda inativa. O login no Worker permanece sem prova.

1. Com autorização para o ambiente alvo, confira a aplicação/instância Clerk, o D1 e o KV existentes e a revisão publicada. Registre somente identificadores, contagens e comparações de integridade; não exporte tokens de conexão ou props dos grants. Antes de aplicar migrations, confirme `0010_unified_send_fence.sql` já aplicada e somente `0011_clerk_identity.sql` pendente e aprovada. Ela é aditiva e não altera conexões. Interrompa diante de outra migration ou inventário divergente.
2. No D1 correspondente, leia `users.id`, e-mail canônico, estado e vínculo atual dos dois usuários. Preserve esses IDs e as FKs. Confira os IDs/defaults e a integridade das cifras no ambiente confiável antes/depois; os testes locais não substituem essa leitura remota.
3. Para cada pessoa, faça read-back do ID Clerk e do e-mail **primário verificado** na instância correta. Confirme que o usuário não foi banido/excluído. Uma busca por e-mail ajuda a localizar a identidade; ela não autoriza uma associação automática. Não use o antigo `sub` Access como `users.id`.
4. Prepare uma atualização SQL privada, revisada com os valores conferidos, que apenas preencha `clerk_user_id` na linha existente e ativa. Condicione por ID/e-mail canônico, vínculo ainda vazio e ausência de pendência. Exemplo de formato, com placeholders a substituir por identificadores validados e literais SQL corretamente escapados:

   ```sql
   UPDATE users SET clerk_user_id = 'VERIFIED_CLERK_ID', updated_at = datetime('now')
   WHERE id = 'EXISTING_D1_ID' AND email = 'VERIFIED_CANONICAL_EMAIL'
     AND status = 'active' AND clerk_user_id IS NULL AND invite_pending_at IS NULL;
   SELECT id, email, status, clerk_user_id FROM users WHERE id = 'EXISTING_D1_ID';
   ```

   Execute o arquivo apenas no D1 aprovado, com `npx wrangler d1 execute DB --remote --file /caminho/privado/vinculo-revisado.sql`. Confira a linha e a unicidade do vínculo por nova leitura. Zero alterações ou conflito de unicidade exigem reconciliação; não mude propriedade, padrão, e-mail ou estado para contornar o conflito.
5. Complete o fluxo com a sessão da pessoa e confira suas conexões e autorizações anteriores. Os convites novos e a ativação seguem os [endpoints administrativos próprios](DEPLOY.md#convites-e-ativação-administrativa); o painel continua somente leitura.

## Desativação recuperável

O entrypoint [deactivate-user.ts](../src/maintenance/deactivate-user.ts) oferece somente `scheduled`, sem `fetch`, sem rota no produto e sem importação pelo Worker publicado. Ele lê exclusivamente o usuário indicado em `MAINTENANCE_USER_ID`; não cria usuários, não reativa contas e não altera conexões. O [exemplo de configuração](../wrangler.maintenance.example.jsonc) conecta apenas D1/KV **locais**, sem credencial real. Não publique esse entrypoint nem o associe a Cron remoto.

Ao ser invocado, ele:

1. Marca a linha D1 como `disabled` e limpa `invite_pending_at` antes de qualquer serviço externo. Uma ativação em andamento perde sua condição de atualização. Se D1 falhar, a operação relata a etapa sem presumir que o bloqueio aconteceu.
2. Reutiliza `invalidateEventGrant` para todas as assinaturas locais do usuário, apagando prévias/segredos e cancelando novas tentativas antes de consultar o Provider. Preserva os prazos de retenção existentes.
3. Enumera todas as páginas de grants sob `encodeURIComponent(emailCanonico)`, reúne os IDs antes de deletar e detecta cursor repetido. Para cada grant, registra a invalidação local antes de chamar `revokeGrant`. Uma nova enumeração confirma os grants restantes.
4. Consulta o usuário Clerk vinculado. Se ainda não estiver banido, chama `banUser`; depois faz read-back de `banned=true`. Se uma resposta de banimento se perder, uma nova execução confere o estado antes de repetir o POST. Banimento revoga sessões e impede novo login; o bloqueio D1 já impede os JWTs curtos anteriormente emitidos de acessar o WaPilot.

O resumo `wapilot_user_deactivation` contém apenas `disabled`, contagens de grants, `sessionsRevoked`, `complete` e nomes de etapas com falha. Não contém e-mail, IDs de grants, cookies, tokens ou erros brutos. `complete=true` exige read-back sem grants e banimento Clerk confirmado. Uma pessoa sem vínculo Clerk produz `clerk_identity_unlinked`, `sessionsRevoked=false` e `complete=false`: é uma pendência de reconciliação, mesmo que seus grants já tenham sido revogados.

Em falha parcial, mantenha D1 `disabled`, corrija a etapa indisponível e repita a mesma operação para o mesmo ID. Ela percorre novamente todas as páginas e preserva as invalidações. Um vínculo ausente ou de outro ambiente deve ser reconciliado deliberadamente com read-back de identidade, mantendo `disabled`; não use a ativação de convites para reabrir a conta. Usuário Clerk ausente/deletado também exige conferência de ambiente, em vez de uma garantia falsa de revogação. Não há promessa de cancelar um callback que já estava em voo.

### Prova local do entrypoint

As seguintes ações usam exclusivamente um D1/KV de fixture e o usuário sem vínculo semeado pelas migrations:

```sh
WAPILOT_MAINTENANCE_STATE=$(mktemp -d)
npx wrangler d1 migrations apply DB --local --config wrangler.maintenance.example.jsonc --persist-to "$WAPILOT_MAINTENANCE_STATE"
npx wrangler dev --local --config wrangler.maintenance.example.jsonc --ip 127.0.0.1 --port 8796 --test-scheduled --persist-to "$WAPILOT_MAINTENANCE_STATE" --var MAINTENANCE_USER_ID:seed-lucca
```

Em outro terminal, dispare `curl --fail http://127.0.0.1:8796/cdn-cgi/local/scheduled` e observe o resumo no terminal do Wrangler. Sem vínculo/chave Clerk, o resultado esperado é bloqueio D1 confirmado e revogação de sessões pendente; HTTP `200` do disparo não significa `complete=true`. Pare o servidor ao terminar. A suíte `test/user-deactivation.test.ts` exercita também 101 grants, preview pendente, falha parcial do KV/Clerk, cursor repetido e repetição após um banimento de resultado desconhecido.

### Execução em recursos reais, somente após autorização

O runtime continua local. [Bindings remotos do Wrangler](https://developers.cloudflare.com/workers/local-development/) podem encaminhar operações D1/KV aos recursos existentes, sem publicar esse entrypoint. Prepare fora do repo uma configuração temporária baseada no exemplo; revise `main` como caminho absoluto para o entrypoint, o D1, o KV, a origem canônica e o único ID alvo. Marque `remote:true` somente nesses dois bindings. Não altere os perfis normais local/stdio nem seus bindings.

O operador fornece `CLERK_PUBLISHABLE_KEY` e `CLERK_SECRET_KEY` da instância correta num arquivo privado de ambiente com permissão restrita. Não são necessárias a chave global do serviço de mensagens nem a chave de cifra de conexões: o procedimento não descriptografa conexões. O OAuth Provider trabalha com seu KV real. Não copie credenciais para o JSON, Git, linha de comando ou logs.

Após revisar a configuração e a autorização do alvo, o formato do comando é:

```sh
npx wrangler dev --config /caminho/privado/wrangler-maintenance.jsonc --env-file /caminho/privado/maintenance.env --ip 127.0.0.1 --port 8796 --test-scheduled
```

Esse comando omite `--local`, porque essa opção desliga os bindings remotos deliberadamente configurados; também omite `--remote`, pois o código deve continuar local. Não use túnel. Dispare o scheduled pelo loopback, confira o resumo e os read-backs de D1/Provider/Clerk e encerre o servidor imediatamente. Remova a configuração/arquivo de ambiente privados conforme a política operacional. A conexão a recursos remotos e essa execução não foram realizadas nesta entrega.

## Corte e retorno

## Atualização operacional de 14/11/2026

A reconciliação da candidata Clerk preserva a API publicada de seis ferramentas descrita em [TOOLS.md](TOOLS.md). Para a continuidade OAuth, use `search_connections` com `{ "options": {} }`, sem `include`: a resposta fica em `result.structuredContent.data.items` e consulta somente D1. Compare IDs, propriedade, padrão e nome amigável de forma privada; percorra offset/limit caso haja mais de 50 conexões. Teste primeiro o bearer pré-corte, depois o refresh original, preservando issuer/recurso canônico e escopos. Não consulte status live nem mensagens para essa prova.

O retorno Access de 13/11 abaixo é evidência histórica. A publicação corrente confirmada pelo read-back operacional de 14/11 às 14:47 UTC é `8c82f3af3842700b7bacb9e85262dbfe341c59c9`, versão `8e9211a5-c451-4bc5-ab22-192556e1963d`, com seis ferramentas; `a29ea1f…`/`cce19d4b…` é a referência histórica das 14:12 UTC; a versão `6af1ec15…` restaura nomes e envelopes MCP antigos e deixou de ser o retorno preferido. Antes do corte #65, registre novamente o artefato exato e o inventário de configuração, bindings e imagem da versão vigente. O read-back de 14/11 confirmou `observability.redact_query_string=true` ativo; a omissão no fonte dessa publicação não demonstra regressão live. Mantenha `true` explícito na candidata e em qualquer upload de retorno, e confira depois da publicação. Preserve `0011_clerk_identity.sql`, vínculos, KV, dados e revogações; não reative Builds automaticamente.


Depois da configuração e dos vínculos, homologue convite administrativo → e-mail recebido (padrão Clerk aceito em production; recebimento e fluxo completo são gates #64/#65 posteriores à configuração/read-back da #63) → aceitação incorporada → pendência → ativação → login → dashboard → consentimento explícito/PKCE → MCP, além de renovação depois de 60 segundos, aba reaberta, saída, negativa de não convidado, convite inválido/expirado/revogado e conta desativada. Confira desktop, móvel e teclado. Autorizações antigas devem continuar com seus escopos anteriores e aparecer na listagem/revogação.

Só depois dos gates aplicáveis, considerando o adiamento pessoal explicitamente autorizado acima, e de autorização de publicação aplique o corte no Worker e retire Access das rotas de navegador. Preserve KV OAuth, recurso/issuer, segredo de consentimento e chave de cifra. Confira `observability.redact_query_string` por read-back da configuração publicada e respostas `no-store`; queries de convite não devem aparecer em logs/traces. Valide `/healthz`, metadata OAuth e `/mcp` sem bearer (`401` com descoberta), mais login, consentimento, dashboard e grants legados no domínio canônico.

A janela autorizada de #61 em 13/11/2026 publicou a fundação Access em `0ffeb7a`/versão `37efb5c0…` e depois corrigiu o cache das respostas autenticadas em `16452515cd819d85557894821225937a9f26b660`. O retorno preferido naquela janela foi a versão final **`6af1ec15-cef2-4f01-b4c6-31c0c21e64dc`**, conferida em 100%, com D1 `active` obrigatório, sem autocadastro, callback D1 em código/refresh, redaction de query habilitada e `no-store` em HTML/JSON autenticados. Ela preserva histórico/eventos nativos e recursos da revisão publicada que não estavam no `main`; não substitui a árvore Clerk da integração. Consulte a [evidência, duas transições OAuth e sequência de retorno de #61](qa/access-return-2026-11-13.md).

O mesmo grant descartável atravessou as duas publicações, com bearer/refresh anteriores, mesma conexão e os três escopos reais preservados. O Access legado mostra/concede read, write e offline juntos; o teste executou somente leituras. Ao terminar, o grant próprio foi revogado, o bearer recebeu 401, os outros seis grants ficaram intactos e os tokens locais foram apagados; restou apenas metadata pública do cliente DCR, sem grant ativo. Nenhuma policy Access, Secret, usuário, vínculo ou migration foi alterado para a prova. Clerk production e #63–66 não foram executados; os resultados não substituem seus gates.

Workers Builds de `main` está **pausado** e deve permanecer assim até a reconciliação de um `main` seguro e decisão explícita de reativação. O Dashboard Cloudflare independente e o registro privado dos campos de retorno estão disponíveis. Um futuro corte deve preservar os mesmos objetos Access e seus campos não alterados, registrando antes/depois de cada mudança reversível. Mantenha migration aditiva, vínculos Clerk, KV e revogações; não restaure dados ou permissões para voltar o login. Não existe fallback automático que aceite os dois provedores em produção. Para operar Wrangler com bindings reais, use `WRANGLER_WRITE_LOGS=false`, capture as saídas em memória e registre só resumos sanitizados. As verificações de disponibilidade foram amostradas, sem monitoramento contínuo durante os uploads.
