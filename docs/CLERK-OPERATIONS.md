# Operação de identidades e corte para Clerk

Este procedimento prepara a integração da spec #53. A entrega de código não autoriza usar credenciais reais, emitir convites, alterar configuração externa, aplicar migrations remotas ou publicar. A conta permanece bloqueada quando alguma conferência ou revogação estiver pendente.

## Evidências e gates pendentes

A aplicação escolhida é `app_3M1uSBQzCMOfMfnraVHBpldbNhx`. A leitura usada para preparar esta entrega encontrou somente a instância development `ins_3M1uS6zuL7NHmAvpeezFR2uvBjV`; IDs de usuários dessa instância não servem no D1 de produção. O [alvo de configuração](clerk-development-config.json) foi validado apenas por `dry_run`; não foi aplicado. Ele desliga Google e senha, restringe cadastro a convites, usa código por e-mail e torna o e-mail imutável. Telefone, username, passkey e Web3 estavam desligados na leitura, sem garantia de que continuem assim.

A restrição de exclusão da própria conta não aparece no schema do plugin consultado. Um operador autorizado precisa conferir e desligar essa permissão no **User model** oficial antes do corte. A ausência de controles no WaPilot não comprova bloqueio na Frontend API. Os modelos de e-mail e seus textos em pt-BR também precisam de conferência.

A inspeção pública desktop feita com Terra montou a UI real e encontrou os campos principais em pt-BR. A página de convite sem ticket recusou o cadastro. A instância ainda mostrou Google, link de cadastro e os avisos em inglês do fornecedor; o alvo `dry_run` não altera isso. Não foram executados login, código de e-mail, convite, criação de conta, renovação após 60 segundos, retorno de aba fechada, saída ou teste móvel. Os rodapés do fornecedor não foram escondidos por CSS. Essa inspeção não substitui o fluxo completo de homologação.

Os testes HTTP usam o Worker real em workerd, D1/KV locais, SDK Backend real e JWT/JWKS/Backend API sintéticos. Cobrem usuários ativos, ausentes, pendentes e desativados; cookies separados, handshake, CSRF, respostas JSON das APIs e ausência de diagnósticos brutos em headers. Grants legados continuam listáveis/revogáveis por sessão Clerk, com preservação de IDs, padrão, propriedade e cifras das conexões nas fixtures.

## Vínculo deliberado dos usuários existentes

1. Com autorização para o ambiente alvo, confira a aplicação/instância Clerk, o D1 e o KV existentes e a revisão publicada. Registre somente identificadores, contagens e comparações de integridade; não exporte tokens de conexão ou props dos grants. Antes de aplicar migrations, confirme que a única migration pendente aprovada é `0010_clerk_identity.sql`. Ela é aditiva e não altera conexões. Interrompa diante de outra migration ou inventário divergente.
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

Depois da configuração e dos vínculos, homologue convite administrativo → e-mail pt-BR → aceitação incorporada → pendência → ativação → login → dashboard → consentimento explícito/PKCE → MCP, além de renovação depois de 60 segundos, aba reaberta, saída, negativa de não convidado, convite inválido/expirado/revogado e conta desativada. Confira desktop, móvel e teclado. Autorizações antigas devem continuar com seus escopos anteriores e aparecer na listagem/revogação.

Só depois desses gates e de autorização de publicação aplique o corte no Worker e retire Access das rotas de navegador. Preserve KV OAuth, recurso/issuer, segredo de consentimento e chave de cifra. Confira `observability.redact_query_string` por read-back da configuração publicada e respostas `no-store`; queries de convite não devem aparecer em logs/traces. Valide `/healthz`, metadata OAuth e `/mcp` sem bearer (`401` com descoberta), mais login, consentimento, dashboard e grants legados no domínio canônico.

O retorno seguro é o commit Access endurecido `06182f24d8fbd4603515f2fcde6fb9420cede901`, também preservado pelo merge `bd9eeb6`. Ele conserva a barreira D1 contra autocadastro e `disabled`. Mantenha a migration aditiva, os vínculos Clerk, o KV e as revogações; não reverta dados ou permissões para restaurar o login. Não existe fallback automático que aceite os dois provedores em produção. Os registros históricos de deploy em [DEPLOY.md](DEPLOY.md) continuam evidências datadas e não comprovam esse corte.
