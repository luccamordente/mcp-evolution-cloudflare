# Preparação Clerk production — #63 — 14/11/2026

**Estado: instância production, domínio e controles de acesso conferidos; #63 permanece aberta, sem corte.** Continuação do [registro de 13/11](clerk-production-2026-11-13.md), preservando sua tentativa recusada e a validação histórica da candidata. A criação e o DNS de `wapilot.com.br` já estavam autorizados. O operador aceitou explicitamente os e-mails padrão do Clerk, sem upgrade de plano; a UI WaPilot e as restrições de segurança continuam obrigatórias.

## Criação e read-back efetivos

O Clerk CLI **4.1.0** confirmou autenticação do operador por `doctor`. A leitura da aplicação confirmou o alvo existente e somente development antes da escrita. Após dry-run, foi executado `POST /platform/applications/app_3M1uSBQzCMOfMfnraVHBpldbNhx/instances` com `{ "domain": "wapilot.com.br", "environment_type": "production", "clone_instance_id": null }`. A criação sem clone evitou copiar os templates personalizados incompatíveis com o plano. Não foi criada outra aplicação nem alterada development.

| Item | Read-back de 14/11/2026 |
| --- | --- |
| Aplicação | `app_3M1uSBQzCMOfMfnraVHBpldbNhx` |
| Instância production | `ins_3M6CtiWpQ9IezNbz9MyNmpRhk6C`; ambiente confirmado pelo MCP e por `GET /instance` autenticado na Backend API |
| Publishable key pública | `pk_live_Y2xlcmsud2FwaWxvdC5jb20uYnIk` |
| Domínio Clerk | `wapilot.com.br`; às 13:30 UTC, status do domínio, DNS, e-mail e SSL `complete` |
| Origem do produto/recurso OAuth | Preservados: `https://app.wapilot.com.br` e `https://app.wapilot.com.br/mcp` |
| Secret da nova instância | Capturada somente em arquivos locais ignorados com permissão `0600`; não enviada ao Worker nem incluída em versão candidata |

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

A leitura atual dos deployments encontrou **`cce19d4b-683c-4b18-8937-8ec44d13950e` em 100%**, criada em **14/11 às 12:53:07 UTC**. Portanto, a versão Access `6af1ec15…` registrada em 13/11 não deve ser presumida ativa nem usada como retorno sem nova reconciliação. O read-back das configurações ativas confirmou `observability.redact_query_string=true`, compatibilidade `2026-10-13` e flags `nodejs_compat`/`global_fetch_strictly_public`. Às **13:29:42 UTC**, os probes retornaram health `200`, metadata OAuth `200`, MCP sem bearer `401` com metadata e `no-store`, e `/connections` `302` para Access com `no-store`. São amostras do serviço Access, sem homologar Clerk. As operações desta preparação não publicaram Worker. Antes da #65, reconciliar o artefato servido, a candidata com a API Clerk atual e um retorno seguro; os testes históricos da candidata não comprovam equivalência com essa revisão.

## Gates restantes

| Gate da #63 | Estado em 14/11/2026 |
| --- | --- |
| Production na aplicação/domínio autorizados | Concluído por criação e dois read-backs |
| Cadastro, métodos e e-mail imutável | Aplicados e relidos; hashes por escopo acima |
| Origem absoluta dos paths | Corrigida no Dashboard e confirmada pela Frontend API às 13:45:01 UTC na origem `https://app.wapilot.com.br` |
| Autoexclusão production | Desativada; Frontend API confirmou `false` às 13:43:54 e 13:45:01 UTC, antes de criar usuários |
| DNS, certificado e domínio verificados | Concluído às 13:30 UTC: cinco CNAMEs relidos, status/DNS/e-mail/SSL `complete` e TLS direto validado nos dois hosts |
| E-mails padrão e entrega configurada | Padrões, assuntos em inglês, variáveis e entrega relidos; recebimento/fluxo completo pertencem a #64/#65, com os paths corrigidos |
| Account Portal e bootstrap seguro anterior ao corte | Formulário público WaPilot carregado; convite/login/redirects autenticados ainda não executados (#64/#65) |
| Versão coerente de código/configuração/secrets | Pendente; reconciliar revisão ativa nova, candidata e retorno antes da #65; nenhum upload nesta etapa |
| Redaction nos sistemas que receberão convites | Worker ativo confirmado; demais sistemas e conferência anterior ao envio permanecem gates |

O [plano de upload versionado de 13/11](clerk-production-2026-11-13.md#código-configuração-e-secrets-na-mesma-versão) continua aplicável: `versions upload --secrets-file --profile wapilot`, com configuração privada revisada, preservação dos demais secrets/bindings e read-back antes de qualquer promoção. Não usar `secret put/delete` para staging. Revalidar Worker ativo, Builds pausado e ausência de concorrência antes dessa escrita; as leituras históricas não atestam o estado atual.

Não houve alteração de billing, Access, Worker, D1/KV, usuários ou grants, migration, convite, upload, publicação ou push nesta etapa. #64–66 continuam pendentes. Os **838 testes aprovados e 15 pulados** e o dry-run da candidata são evidências históricas de 13/11, não uma nova execução ou homologação production.

A reconciliação local da API de cinco ferramentas foi integrada em `dd239799324f9334138b586c0cf567f8ce2ae073` e passou no check completo: **825 testes aprovados e 15 pulados, 184,23 segundos**. A revisão Standards identificou ajustes de MIME, prazos, orientação e link na fonte atual; as correções da candidata e sua nova validação estavam em andamento no fechamento deste complemento. Esse resultado intermediário não aprova a candidata final nem substitui artefato/configuração/secrets versionados, read-back e plano atual de retorno exigidos para concluir a #63.

Validação documental: revisão das fontes operacionais e do relato sanitizado das operações efetivas, links relativos e `git diff --check`. A skill TDD foi consultada; não há mudança de runtime nem lógica nova que justifique teste de texto. Não foram repetidos testes, dry-run de Worker ou consultas ao backend de mensagens para este registro.
