# Preparação Clerk production — #63 — 13/11/2026

**Estado: preparação documental; produção ainda não provisionada nem pronta para o corte.** Este registro acompanha a [#63](https://github.com/luccamordente/mcp-evolution-cloudflare/issues/63), subordinada à [#59](https://github.com/luccamordente/mcp-evolution-cloudflare/issues/59). O operador autorizou explicitamente criar production clonando development e configurar o DNS de `wapilot.com.br`. A tentativa de criação foi recusada pelo Clerk antes do provisionamento; não houve mudança DNS ou de secrets.

## Alvos e leituras efetivas

| Item | Resultado de 13/11/2026 |
| --- | --- |
| Aplicação Clerk | `app_3M1uSBQzCMOfMfnraVHBpldbNhx`, WaPilot; reutilizar esta aplicação |
| Workspace conectado | `org_3M1uPamYZliVcI10X26L2xuUWKf`; conferido por `whoami` |
| Instâncias | `get_application` retornou somente development `ins_3M1uS6zuL7NHmAvpeezFR2uvBjV`; production ausente |
| Domínio escolhido pelo operador | `wapilot.com.br`; ainda sem instância/domain ID production ou certificado conferido |
| Origem do produto | Preservar `https://app.wapilot.com.br` e recurso OAuth `https://app.wapilot.com.br/mcp` |
| Configuração development | Read-back completo `v1_50e489a7`; alvo parcial anterior `v1_ec69bf3a` não é a versão do objeto completo |
| Worker e retorno | `mcp-evolution-cloudflare`; baseline Access `6af1ec15-cef2-4f01-b4c6-31c0c21e64dc`, registrado em 100% na [#61](access-return-2026-11-13.md); reconferir antes de qualquer escrita |
| Cloudflare | Perfil Wrangler `wapilot`, conta proprietária `e972fc5484db86f0468fa2cf78f61870`; conexão Cloudflare de outra conta não serve como alvo |
| Migrations | Baseline da preparação encontrou somente `0011_clerk_identity.sql` pendente; esta entrega não aplicou migrations nem leu inventário privado de usuários/grants |

O read-back development confirmou `restricted`, código de e-mail na entrada e verificação, e-mail imutável, senha desativada, Google desativado, telefone/username/passkey/biometria/Web3 sem uso de entrada e paths `/sign-in`, `/accept-invitation`, saída para `/sign-in`. Outros conectores sociais que expõem `enabled` retornaram `false`. Isso descreve development e não comprova os controles da futura production. O `user_model` retornado pelo plugin expõe nomes; não expõe o bloqueio de autoexclusão. A conferência development desse bloqueio e dos e-mails está na [#62](../CLERK-DEVELOPMENT-ACCEPTANCE.md).

## Tentativa autorizada e bloqueio efetivo

Após a preparação somente leitura, o operador autorizou a criação production por clone e o DNS. O agente responsável pela operação preparou RSA dedicado, com chave privada ignorada e permissão `0600`, e chamou `create_production_instance` na aplicação/domínio aprovados. O Clerk recusou com `unsupported_subscription_plan_features`, recurso `app:custom_email_template`: os templates personalizados pt-BR copiados de development exigem suporte no plano production. O read-back posterior confirmou production ainda ausente.

Nenhuma configuração development foi removida para contornar a restrição. Não houve alteração de billing, DNS ou secrets. Foi enviado feedback ao Clerk `fbk_3M5CwAAuhn7V4rrVmAMeMNw8XKJ` sobre ausência de preflight/opção para excluir recurso incompatível do clone, sem dados sensíveis. Naquele momento, foi pedida a decisão entre habilitar o recurso no plano ou rever a exigência de e-mails. Em seguida, o operador escolheu **rever a exigência de e-mails**: production aceita os e-mails padrão do Clerk, dispensando templates personalizados pt-BR e marca WaPilot nesses e-mails. A UI do produto permanece WaPilot em pt-BR; somente convidados, e-mail imutável e bloqueio de autoexclusão permanecem obrigatórios. Não há autorização para upgrade de plano. A decisão não comprova criação/configuração production nem recebimento: idioma, aparência, links e entrega efetivos continuam sujeitos a read-back e homologação autorizada. As traduções e evidências development são históricas e permanecem preservadas. A conexão Cloudflare consultada também não enxerga a zona `wapilot.com.br`; a operação DNS precisará conferir acesso na conta proprietária após resolver a criação.

## Sequência restante, ainda pendente

1. Preparar um caminho suportado de criação com e-mails padrão, sem upgrade de plano; revalidar aplicação/workspace, ausência de production e domínio. A autorização da criação irreversível e DNS já foi concedida para estes alvos. Criar production na mesma aplicação com `domain=wapilot.com.br`; não repetir o clone incompatível sem resolver a inclusão dos templates personalizados. Não remover as traduções development para contornar a restrição. Se outro operador já a criou, ler a instância existente antes de continuar; não criar outra aplicação.
2. Preparar previamente uma chave RSA local de 2048–4096 bits, expoente 65537, com arquivo privado protegido fora do Git. O contrato da ferramenta aceita `recipient_public_key` e devolve a secret key cifrada com RSA-OAEP/SHA-256. Decifrar somente no ambiente privado do operador, sem imprimir o valor, e transferir para arquivo de secrets restrito. Registrar somente instance ID, publishable key pública e metadata sanitizada. Se a credencial não puder ser recebida com segurança, resolver sua entrega antes da criação.
3. Usar exclusivamente os registros DNS retornados pelo Clerk, conferir zona/hosts/conflitos antes de escrever e reler cada registro. Não trocar o registro de tráfego `app.wapilot.com.br`, o domínio do Worker nem a identidade OAuth. Reconsultar domínio e certificados no Clerk até verificados; propagação pendente bloqueia a conclusão da #63 e não fica para a janela de corte.
4. Ler schema/configuração production, preparar patch restrito e fazer `dry_run` antes da aplicação. Conferir novamente somente convidados, código por e-mail, demais métodos não previstos desligados, e-mail imutável e paths incorporados. Registrar os hashes do preview e do read-back com seus respectivos escopos. Não enviar o arquivo development inteiro como substituição de configuração production.
5. Conferir e registrar o bloqueio real de autoexclusão no User model/Dashboard ou API oficial que o exponha. Falta de campo no plugin ou botão ausente no WaPilot não prova esse bloqueio. Conferir por read-back que convite e código usam e-mails padrão do Clerk, registrando idioma, aparência, links e variáveis efetivos sem portadores. O recebimento e o fluxo completo exigem homologação autorizada; configuração lida não comprova entrega.
6. Conferir o Account Portal production e suas restrições para o bootstrap anterior ao corte: aceitação deve funcionar sem página Clerk já publicada no WaPilot, sem permitir alteração de e-mail ou exclusão da conta. Esta etapa não emite convite. Se incompatível, interromper e preparar caminho de bootstrap revisado antes de qualquer envio. O vínculo dos usuários existentes pertence à #64; IDs development nunca são reutilizados.
7. Preparar a candidata e seus secrets pelo fluxo versionado abaixo. Registrar versão criada e comparação de metadata, sem encaminhar tráfego. Encerrar a #63 somente após todos os gates remotos; candidata final, vínculos, corte e estabilização continuam em #64–66.

## Código, configuração e secrets na mesma versão

A ajuda local do Wrangler **4.150.0** e a [documentação oficial de secrets](https://developers.cloudflare.com/workers/configuration/secrets/#upload-secrets-alongside-code), consultadas em 13/11/2026, suportam `versions upload --secrets-file`: código/configuração e secrets são enviados juntos, sem publicação de tráfego; secrets omitidos são preservados. Não usar `secret put/delete` como staging, pois esses comandos publicam imediatamente. Não encadear `versions secret bulk` sobre uma suposta versão-base fixa: a implementação consultada pelo operador usa `versions/latest`, sujeita a concorrência.

Antes do upload autorizado:

- Reconferir versão ativa, últimas versões, Workers Builds pausado e ausência de upload concorrente. Registrar o commit exato da candidata e preservar o retorno Access.
- Preparar configuração de release privada com `src/worker.ts`, assets e mesmos bindings, compatibilidade, observabilidade, Cron, Queues, Durable Object e imagem Container do read-back ativo. Incluir `CLERK_PUBLISHABLE_KEY` production como variável pública, manter `MCP_PUBLIC_URL=https://app.wapilot.com.br` e `observability.redact_query_string=true`. Usar `CLERK_JWT_KEY` somente se corresponder à mesma instância; não herdar uma chave development.
- Preservar `TOKEN_ENCRYPTION_KEY`, `CONSENT_SECRET`, KV OAuth, dados D1 e credenciais Access. O arquivo privado `0600` de secrets contém apenas o novo `CLERK_SECRET_KEY`; nenhuma secret vai para vars, argumentos, Git ou logs.
- Conferir no artefato o tratamento da imagem sender antes de qualquer upload. `versions upload` não oferece `--containers-rollout`; não copiar essa flag de `deploy`. Se a preservação da metadata/imagem não estiver demonstrada, parar e resolver o artefato antes do upload.
- Executar os checks e dry-run da candidata revisada no gate #65. Esta preparação documental não os repete nem declara aprovação da candidata final.

Formato revisável do upload futuro, com caminhos privados a substituir e executar pelo wrapper que captura saída em memória e publica somente resumo sanitizado:

```sh
WRANGLER_WRITE_LOGS=false npx wrangler versions upload --profile wapilot --env '' --config /caminho/privado/release.jsonc --keep-vars --strict --secrets-file /caminho/privado/clerk-production-secrets.json
```

O comando acima **não foi executado**. Após executá-lo, comparar versão/artefato, nomes de secrets, vars, assets, bindings, observabilidade e metadata da imagem com o plano. Confirmar que a versão ativa/percentual de tráfego continuam no Access e que somente a candidata contém a configuração Clerk. Sem read-back coerente, não promover. A publicação explícita de uma versão para 100% do tráfego pertence ao corte autorizado da #65; não misturar percentuais Access/Clerk no login.

## Evidência exigida para concluir a #63

| Gate | Estado nesta preparação |
| --- | --- |
| Aplicação/workspace e domínio escolhido | Conferidos; criação e DNS autorizados, tentativa recusada pelo plano |
| Production criada na aplicação correta, ID registrado | Bloqueada por `app:custom_email_template`; read-back confirma ausência |
| DNS e certificado production verificados por read-back | Pendente |
| Métodos, e-mail imutável e autoexclusão production conferidos | Pendente |
| E-mails padrão Clerk (idioma/aparência/links e recebimento) e Account Portal production conferidos | Pendente; dispensa de templates personalizados aceita pelo operador |
| Versão coerente com publishable key/secrets preparada e relida | Pendente; apenas plano/ajuda verificados |
| Redaction nos sistemas que receberão convites | Worker baseline documentado; demais sistemas e conferência anterior ao envio pendentes |

Houve uma tentativa autorizada de criação, recusada pelo provedor, seguida de read-back. Não houve instância criada, alteração DNS/configuração, leitura de usuários production, convite, atualização D1/KV, upload, publicação, push ou corte. Não há tempo de indisponibilidade a medir para esta etapa documental. A #63 permanece aberta.

Validação desta preparação documental da #63: revisão dos documentos de operação/arquitetura, issue #63, schema de chamada de criação, read-backs Clerk e ajuda `versions upload`; links relativos e `git diff --check`. Essa parte não acrescentou runtime, parser, script ou testes. A skill TDD foi consultada; as provas comportamentais reais continuam nos gates próprios, não são substituídas por testes de texto. A reconciliação da candidata e seus testes estão registrados abaixo.

## Candidata integrada e verificação final

Preparação local integrada em `integration/59-production`, revisão de código `17bf43c`, em 13/11/2026 (America/Chicago; as leituras abaixo ocorreram em 14/11 UTC). A reconciliação `014e28d` preserva os contratos de histórico nativo, respostas, criação de evento, vCard e metadados já publicados no artefato Access `16452515`, mantendo a autenticação Clerk da candidata. Não é uma nova publicação desses recursos. A correção `fa5a938` restringe o launcher de aceitação a um DSN local explícito; sua regressão foi reproduzida antes da correção.

- `npm run check -- -- --maxWorkers=1`: assets e tipos aprovados; **838 testes aprovados, 15 pulados**, 180,72 segundos na execução final. A primeira execução teve 823 aprovados e três falhas Clerk por conflito com `dev:clerk` nas portas locais; com o servidor temporariamente parado, os 12 testes desse perfil e a suíte completa passaram sem mudar as asserções ou o código Clerk.
- `npx wrangler deploy --dry-run --env '' --containers-rollout none`: aprovado, **9.500,86 KiB bruto / 3.389,51 KiB gzip**. Saída capturada em memória com `WRANGLER_WRITE_LOGS=false`. O dry-run antecedeu somente alterações de script/teste/documentação, sem diferença posterior em `src`, `ui`, `public`, lockfile ou configuração do Worker.
- Revisões independentes Standards e Spec por GPT Sol xhigh: os dois achados (destino efetivo do DSN e referência do ticket de corte) foram corrigidos e relidos; nenhum achado acionável remanescente. A aceitação com Go/PostgreSQL e os testes conectados pulados não foram executados.
- Read-back do Worker manteve a versão Access `6af1ec15-cef2-4f01-b4c6-31c0c21e64dc` em 100%. D1 confirmou `0010` registrada e ausência das colunas Clerk, coerente com somente `0011` pendente; apenas schema/migrations foram lidos, sem inventário de usuários, conexões ou grants e sem linhas escritas.
- Probes às **04:43:43 UTC**: health e metadata OAuth `200`; MCP sem bearer `401` com metadata e `no-store`; navegação sem sessão em `/connections` redirecionou ao Access. São amostras do serviço atual, não homologação Clerk production nem medição contínua de disponibilidade.

As três worktrees temporárias foram removidas depois dos merges, preservando os commits na integração. O par RSA sem uso foi removido após a criação recusada. `dev:clerk` foi reiniciado no mesmo terminal e sua origem HTTPS/recusa sem sessão passou no self-check, com persistência local preservada. Naquele encerramento, a #63 estava bloqueada pela decisão sobre o plano/templates. A decisão posterior aceita e-mails padrão, mas a criação/configuração e seus gates continuam pendentes; #64–66 continuam pendentes e nenhuma issue foi declarada concluída. Não houve push, upload, migration remota, vínculo de identidade ou corte.
