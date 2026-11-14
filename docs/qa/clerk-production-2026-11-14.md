# Preparação Clerk production — #63 — 14/11/2026

**Estado: preparação remota da #63 concluída, sujeita à revisão documental final; candidata inativa, sem corte.** Continuação do [registro de 13/11](clerk-production-2026-11-13.md), preservando sua tentativa recusada e a validação histórica da candidata. A criação e o DNS de `wapilot.com.br` já estavam autorizados. O operador aceitou explicitamente os e-mails padrão do Clerk, sem upgrade de plano; a UI WaPilot e as restrições de segurança continuam obrigatórias.

## Criação e read-back efetivos

O Clerk CLI **4.1.0** confirmou autenticação do operador por `doctor`. A leitura da aplicação confirmou o alvo existente e somente development antes da escrita. Após dry-run, foi executado `POST /platform/applications/app_3M1uSBQzCMOfMfnraVHBpldbNhx/instances` com `{ "domain": "wapilot.com.br", "environment_type": "production", "clone_instance_id": null }`. A criação sem clone evitou copiar os templates personalizados incompatíveis com o plano. Não foi criada outra aplicação nem alterada development.

| Item | Read-back de 14/11/2026 |
| --- | --- |
| Aplicação | `app_3M1uSBQzCMOfMfnraVHBpldbNhx` |
| Instância production | `ins_3M6CtiWpQ9IezNbz9MyNmpRhk6C`; ambiente confirmado pelo MCP e por `GET /instance` autenticado na Backend API |
| Publishable key pública | `pk_live_Y2xlcmsud2FwaWxvdC5jb20uYnIk` |
| Domínio Clerk | `wapilot.com.br`; às 13:30 UTC, status do domínio, DNS, e-mail e SSL `complete` |
| Origem do produto/recurso OAuth | Preservados: `https://app.wapilot.com.br` e `https://app.wapilot.com.br/mcp` |
| Secret da nova instância | Capturada em arquivos locais ignorados `0600` e incluída somente como `secret_text` na versão candidata inativa; nenhum valor registrado aqui |

Após ler schema/configuração, foi preparado um patch restrito, seguido de dry-run, aplicação e read-back production. O read-back completo retornou **`v1_35bed73d`**; o hash da seleção do patch foi **`v1_da448f4e`**. São escopos diferentes, não versões intercambiáveis do mesmo objeto. O hash `v1_da448f4e` continuou igual após as conferências finais: cobre somente as chaves de autenticação e paths relativos selecionadas, sem representar Home/origem absoluta nem o controle global de autoexclusão.

- Cadastro `restricted`, e-mail imutável e código de e-mail para entrada/verificação.
- Senha com `enabled=false` e `required=false`; provedores sociais, telefone, username, passkey, biometria e Web3 sem entrada habilitada.
- Paths relativos `/sign-in` e `/accept-invitation`, com saída para `/sign-in`; a origem absoluta foi corrigida posteriormente, conforme o read-back abaixo.

A configuração development não foi substituída pelo objeto production. A inspeção somente leitura do **User model production** por GPT Terra confirmou alteração de e-mail desativada, mas **autoexclusão ativada**. O Dashboard informa que mudanças de autoexclusão afetam novos usuários. Nenhum controle foi alterado nessa inspeção; a sessão acessível pelo conector era somente leitura. Essa era a leitura inicial, anterior à desativação confirmada abaixo. `GET /users/count` às 13:18 UTC retornou **zero usuários production**; essa contagem é uma amostra anterior a qualquer convite. Às 13:22 UTC, `/v1/environment` da Frontend API também confirmou `actions.delete_self=true`, coerente com a autoexclusão então ativada. Após o operador confirmar sua desativação, a Frontend API às **13:43:54 UTC** retornou **`actions.delete_self=false`**. `GET /users/count` às **13:44 UTC** voltou a confirmar **zero usuários production**. O Dashboard também confirmou alteração de e-mail desativada; nenhum usuário foi criado para provar esses controles.

## E-mails padrão e DNS

`GET /templates/email` retornou **25 templates, zero personalizados**. Convite e `verification_code` retornaram `can_revert=false` e `delivered_by_clerk=true`, com assuntos padrão em inglês. As variáveis `action_url`, `app.name` e `otp_code` foram conferidas nos templates pertinentes, preservadas nos padrões. Isso confirma configuração de entrega pelo provedor, sem comprovar recebimento. As Display URLs e restrições foram corrigidas e relidas conforme abaixo; recebimento e redirects autenticados continuam sem prova real. Nenhum convite ou código foi enviado nesta etapa; recebimento real pertence ao bootstrap #64 e o fluxo completo à #65.

Os **cinco CNAMEs exigidos** foram consultados no Clerk e configurados na zona ativa `725a4f686e54e4322a6da21b18176e3d`, conta proprietária `e972fc5484db86f0468fa2cf78f61870`. A credencial OAuth do perfil Wrangler localizava a zona, mas a leitura de registros retornou `403/10000`; os escopos OAuth suportados pelo Wrangler **4.150.0** não incluíam DNS Read/Edit.

Após autorização explícita, GPT Terra criou pelo navegador um token **Zone DNS:Edit restrito somente a `wapilot.com.br`**, com expiração em 21/11 exibida na UI (`2026-11-22T05:59:59Z` na API). O token ficou exclusivamente em arquivo privado `0600`; o perfil OAuth foi preservado. Todas as operações Cloudflare CLI usaram **`--profile wapilot`**, com o token fornecido por ambiente apenas ao subprocesso. A validação confirmou token ativo e a resolução da credencial por `wrangler auth token --profile wapilot`.

Antes da escrita, os cinco nomes exigidos estavam ausentes. Foram criados somente os cinco CNAMEs, com `ttl=1` e `proxied=false`, e cada registro foi relido com correspondência ao alvo Clerk. O registro AAAA existente de `app.wapilot.com.br` foi preservado, conferido pela igualdade dos campos estáveis antes/depois; não houve troca do domínio de tráfego ou da identidade OAuth. Às **13:20 UTC**, a nova verificação Clerk retornou **DNS `complete`, e-mail `complete`, TLS Accounts `complete` e TLS Frontend API `in_progress`**. Às 13:22 UTC, a Frontend API respondeu `200` em `/v1/environment` com TLS verificado normalmente, mas o estado de certificado do Clerk continuava `in_progress`; acesso bem-sucedido isolado não encerrava esse gate. Às **13:30 UTC**, `get_domain_status` retornou **status do domínio, DNS, e-mail e SSL `complete`**. TLS direto nos dois hosts foi validado com Node e `rejectUnauthorized=true`, com CN correspondente e validade observada até 12/02/2027. Essa leitura datada comprova a preparação do domínio nessa etapa, sem garantia permanente de certificado ou DNS.

## Origem dos paths e versão ativa

As Display URLs inicialmente apontavam home, sign-in, aceitação e saída para `https://wapilot.com.br`. GPT Terra corrigiu e salvou os quatro Paths em sessão normal de navegador, independente do Dia, com read-back após recarregar: Home `https://app.wapilot.com.br`, Sign-in `/sign-in`, Sign-up `/accept-invitation` e Sign-out `/sign-in`. O domínio Clerk permaneceu `wapilot.com.br`. Às **13:45:01 UTC**, a Frontend API confirmou todas as URLs absolutas na origem canônica `https://app.wapilot.com.br`, `actions.delete_self=false` e cadastro `restricted`.

A página de entrada do Account Portal foi carregada sem login e exibiu o formulário WaPilot. Essa inspeção comprova o carregamento público, sem executar convite, login ou redirects autenticados; o fluxo real permanece em #64/#65.

A leitura atual dos deployments encontrou **`cce19d4b-683c-4b18-8937-8ec44d13950e` em 100%**, criada em **14/11 às 12:53:07 UTC**. Portanto, a versão Access `6af1ec15…` registrada em 13/11 não deve ser presumida ativa nem usada como retorno sem nova reconciliação. O read-back das configurações ativas confirmou `observability.redact_query_string=true`, compatibilidade `2026-10-13` e flags `nodejs_compat`/`global_fetch_strictly_public`. Às **13:29:42 UTC**, os probes retornaram health `200`, metadata OAuth `200`, MCP sem bearer `401` com metadata e `no-store`, e `/connections` `302` para Access com `no-store`. São amostras do serviço Access, sem homologar Clerk. As operações desta preparação não promoveram versão para tráfego. O retorno Access atual é essa revisão `cce19d4b…`, de fonte `a29ea1f20c443c497be65dca221eb43f1ef97db3`; sua continuidade autenticada e os demais testes de corte permanecem em #65.

## Artefato, configuração e secrets preparados

A fonte final **`c3e555da8c12d2f0111385a1fcae8999ed52d35b`** incorporou a API de cinco ferramentas e resolveu os quatro achados de revisão. Standards e Spec encerraram sem pendências. O check completo aprovou assets e tipos, **836 testes aprovados e 15 pulados, 56 arquivos aprovados e um pulado, em 167,19 segundos**. Esse resultado substitui o check intermediário de `dd23979` para esta candidata; não homologa login production ou continuidade de grants.

A configuração de release privada partiu do Wrangler de produção e preservou as vars ativas, IDs D1/KV, imagem atual do sender fixada por digest, compatibilidade e exports, mantendo redaction explícita e adicionando a publishable key production. Código/configuração e o arquivo privado contendo somente a nova secret Clerk passaram juntos no dry-run de `versions upload --secrets-file --profile wapilot`: **8.743,92 KiB bruto / 3.164,40 KiB gzip**, sem build Docker.

O primeiro upload com `--strict` foi bloqueado pelo guard do Wrangler porque a última atualização havia ocorrido via script/API; esse bloqueio não criou versão nem mudou tráfego. Após comparar e reconciliar o código/configuração atuais (`a29ea1f…`/`cce19d4b…`), reler deployment/lista de versões e confirmar especificamente o destino e as alterações já revisados, o operador responsável documentou a exceção e repetiu o upload sem `--strict`. Foi uma exceção deliberada ao guard de origem da atualização, não uma rejeição de aprovação automática. A operação preparou somente uma versão inativa.

| Read-back às 14:12 UTC | Resultado |
| --- | --- |
| Versão candidata | **`ed29ef2e-efa4-4a77-8271-5bf4f83ca26f`**, tag `clerk-59-c3e555da` |
| Bindings existentes | `existingBindingChanges=[]` |
| Adições exatas | `CLERK_PUBLISHABLE_KEY` correspondente à production e `CLERK_SECRET_KEY` do tipo `secret_text` |
| Container, exports e compatibilidade | Imagem e metadata preservadas em relação ao alvo revisado |
| Deployment com tráfego | **`cce19d4b-683c-4b18-8937-8ec44d13950e` em 100%**; candidata inativa |

O ajuste existente de workers.dev/previews habilitados foi preservado. URLs de versão não são isolamento e não foram usadas para testes autenticados. Saídas brutas do CLI ficaram apenas em arquivos privados `0600`, com `WRANGLER_WRITE_LOGS=false`; nenhum valor de secret foi incluído neste registro. Não houve alteração de usuários/convites/grants, D1/KV, migrations, policies, Queues ou Cron, nem deployment de tráfego.

## Gates de preparação e etapas posteriores

| Gate da #63 | Estado em 14/11/2026 |
| --- | --- |
| Production na aplicação/domínio autorizados | Concluído por criação e dois read-backs |
| Cadastro, métodos e e-mail imutável | Aplicados e relidos; hashes por escopo acima |
| Origem absoluta dos paths | Corrigida no Dashboard e confirmada pela Frontend API às 13:45:01 UTC na origem `https://app.wapilot.com.br` |
| Autoexclusão production | Desativada; Frontend API confirmou `false` às 13:43:54 e 13:45:01 UTC, antes de criar usuários |
| DNS, certificado e domínio verificados | Concluído às 13:30 UTC: cinco CNAMEs relidos, status/DNS/e-mail/SSL `complete` e TLS direto validado nos dois hosts |
| E-mails padrão e entrega configurada | Padrões, assuntos em inglês, variáveis e entrega relidos; recebimento/fluxo completo pertencem a #64/#65, com os paths corrigidos |
| Account Portal e bootstrap seguro anterior ao corte | Formulário público WaPilot carregado; convite/login/redirects autenticados ainda não executados (#64/#65) |
| Versão coerente de código/configuração/secrets | Concluído: candidata `ed29ef2e…` inativa, adições e preservação confirmadas às 14:12 UTC; retorno Access atual identificado |
| Redaction nos sistemas que receberão convites | Confirmada no Worker ativo e na configuração candidata; reconferir demais sistemas antes do envio real |

O [plano de upload versionado de 13/11](clerk-production-2026-11-13.md#código-configuração-e-secrets-na-mesma-versão) foi executado com a exceção documentada de `--strict` acima. O gate de artefato/configuração/secrets e seu read-back está concluído. A #63 está preparada remotamente e aguarda revisão documental final; este registro não altera o estado da issue no GitHub. Bootstrap/vínculos e recebimento real (#64), continuidade autenticada e corte (#65), e estabilização (#66) continuam pendentes.

Não houve alteração de billing ou Access, aplicação de migration, convite, usuário, grant, push ou mudança de tráfego. A criação da candidata inativa não é o corte. Os **838 testes aprovados e 15 pulados** e o dry-run de 13/11 permanecem evidência histórica; a validação final desta candidata está registrada acima.

Validação documental: revisão das fontes operacionais e do relato sanitizado das operações efetivas, links relativos e `git diff --check`. A skill TDD foi consultada; não há mudança de runtime nem lógica nova que justifique teste de texto. Este complemento documental não repetiu testes, dry-run ou consultas ao backend de mensagens; registra as validações e operações realizadas pelo responsável pela preparação.
