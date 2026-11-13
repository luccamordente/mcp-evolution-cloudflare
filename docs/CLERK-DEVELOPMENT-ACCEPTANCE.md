# Homologação Clerk development — andamento da #62

**Estado em 13/11/2026: perfil local integrado, Clerk real não homologado.** A #60 foi integrada em `228e490`; seus testes focados passaram (19 testes e typecheck), incluindo HTTPS com CA temporária e validação TLS, sem instalar confiança no sistema ou usar navegador real. Os testes abaixo usam dados locais e Clerk simulado; não comprovam entrega de e-mail ou sessão real. A configuração development descrita abaixo foi aplicada; nenhum convite foi enviado.

## Leitura do ambiente

- O read-back inicial identificou a aplicação WaPilot `app_3M1uSBQzCMOfMfnraVHBpldbNhx`, instância development `ins_3M1uS6zuL7NHmAvpeezFR2uvBjV`, configuração `v1_7501b808`: cadastro público, senha e Google habilitados, e-mail mutável e paths ainda não configurados. Após autorização, o alvo `docs/clerk-development-config.json` foi aplicado e relido como `v1_ec69bf3a`: convite restrito, código por e-mail, e-mail imutável, senha e Google desligados e paths configurados.
- No Dashboard, **Configure → User & authentication → User model → User permissions**, “Allow users to delete their account” continuava ligado e “Allow users to change their email address” estava desligado após a aplicação. A alteração da exclusão afeta apenas usuários novos; há operação separada para existentes. O conector informou zero usuários e o Dashboard mostrou zero usuários e zero convites pendentes; repetir as leituras antes de operar.
- Em **Configure → Customization → Emails → Authentication**, Invitation e Verification code estavam ativos como templates Clerk. Os assuntos estavam em inglês: `Invitation to join {{app.name}}` e `{{otp_code}} is your verification code`. O corpo e a entrega real em pt-BR não foram homologados. O Account Portal aparecia ativo; sua aceitação não foi testada.
- O schema do conector não expôs a autoexclusão (feedback `fbk_3M3lsUbmAWnUU5t3aOXEFPbQinZ`). A sessão Dashboard fornecida pelo conector é somente leitura, e não havia ferramentas de escrita para essa permissão, templates ou convites (feedback `fbk_3M3rA9wSkSQReTHJl221147qr9b`). Essas tarefas continuam pendentes; não se deve inferir bloqueio de autoexclusão pela configuração parcial.

## Matriz HTTP existente

Em Node 24.13.0, `npx vitest run test/clerk-browser.test.ts test/admin-invitations.test.ts test/clerk-migration.test.ts test/identity-authorization.test.ts test/oauth-consent.test.ts` passou: **5 arquivos, 53 testes**. As suítes usam fixtures; `oauth-consent.test.ts` usa também a identidade local sintética, enquanto as suítes Clerk simulam a sessão e o provedor.

| Cobertura simulada | Evidência |
| --- | --- |
| Convite por administrador, origem/CSRF, reserva pendente, resposta redigida, repetição e reconciliação de falha/expiração/revogação | `test/admin-invitations.test.ts` |
| Ativação deliberada e validação do read-back do usuário | `test/admin-invitations.test.ts` |
| Sessão, vínculo e desativação; credenciais trocadas entre superfícies; origem, CSRF, retorno, cache e cookies de handshake | `test/clerk-browser.test.ts` |
| Consentimento explícito, PKCE, troca e leitura MCP com sessão simulada | `test/clerk-browser.test.ts` |
| Grant legado, isolamento e inventário de conexões | `test/clerk-migration.test.ts`, `test/identity-authorization.test.ts` |
| Bloqueio de token, código e refresh após desativação; migração de vínculo | `test/identity-authorization.test.ts` |

Esses testes não validam a rejeição do cadastro não convidado ou de tickets inválidos no provedor real, tampouco recebimento/aceitação incorporada, renovação após 60 segundos, reabertura de aba, saída, acessibilidade ou aparência em desktop e viewport móvel. A suite de convites testa reconciliação local de estados expirado/revogado, não o fluxo de aceitação no Clerk.

## Validação integrada

Em `9d35bc7`, `npm run check` passou: assets gerados, tipos, **53 arquivos e 776 testes aprovados**, com 1 arquivo e 12 testes conectados pulados; duração de 105,85 segundos. O primeiro check encontrou somente o limite padrão de 5 segundos no teste que executa duas preparações/migrations reais. O commit `71c0091` definiu 30 segundos apenas nesse teste, preservando as asserções; a suíte focada e o check completo seguinte passaram.

`npx wrangler deploy --dry-run --env '' --containers-rollout none` passou em `228e490`, sem publicação. As alterações posteriores foram documentais ou no prazo do teste; o código/configuração do Worker empacotado não mudou. A validação do artefato Access separado está em [access-return-2026-11-13.md](qa/access-return-2026-11-13.md).

## Standards

Revisão por GPT Sol com esforço xhigh, comparando a integração com `9135510`: nenhuma violação documentada ou heurística acionável. Foram conferidos chamadores, helpers, teste novo, configuração, documentação e isolamento; a árvore do runtime publicado permaneceu inalterada.

## Spec

Revisão independente por GPT Sol com esforço xhigh: nenhum defeito local acionável nem escopo extra. A #60 atende à preparação local. A #61 permanece aberta pelos gates de publicação, políticas e automação; a #62 permanece aberta pela configuração e homologação com Clerk real. A ancestralidade do retorno alternativo não substituiu o runtime Clerk.

Resultado das revisões: 0 achados acionáveis em Standards e 0 em Spec; as pendências operacionais de #61 e #62 impedem declarar a spec homologada.

## Pendente para concluir

1. Há autorização para a configuração development e um primeiro destinatário de teste; ainda faltam um segundo destinatário aprovado e o caminho do arquivo privado de credenciais de desenvolvimento. Não usar credenciais de produção.
2. Por acesso de escrita apropriado, reler a contagem de usuários, bloquear e verificar a autoexclusão, tratando explicitamente eventuais usuários existentes. Configurar e conferir os templates em pt-BR, preservando variáveis e entrega pelo fornecedor; repetir o read-back.
3. Preparar certificado HTTPS de loopback confiável pelo navegador e cliente OAuth, com a operação de confiança realizada pelo dono da máquina; sem desativar validação TLS. Usar D1/KV locais isolados e somente fixtures. A prova de loopback não comprova um conector remoto.
4. Resolver o primeiro administrador por identidade existente ou convite administrativo direto e Account Portal, verificar ID, e-mail primário e estado, e vincular somente a fixture local. Com outro destinatário aprovado, executar convite, aceitação incorporada, pendência e ativação pelo WaPilot.
5. Executar a matriz real da #59: negativas de convite e acesso, consentimento/PKCE/MCP, renovação após 60 segundos, nova aba e saída sem revogar grant, desktop/móvel e teclado. Registrar resultados sem tickets, OTP, cookies, bearer ou conteúdo sensível. Rodar checks e dry-run da candidata final.

## Continuação com acesso de escrita

Abra o [Dashboard Clerk](https://dashboard.clerk.com) com sua conta habitual e confirme **WaPilot / Development / Invite-only**. A sessão disponibilizada ao agente é somente leitura; a autorização para development não amplia a capacidade dessa sessão.

1. Em **Configure → User & authentication → User model → User permissions**, desligue **Allow users to delete their account**, salve e confira após recarregar. A alteração cobre usuários novos. Reconte os usuários antes; se houver existentes, avalie separadamente **Apply to existing users**. A alteração de e-mail já foi desligada pelo alvo aplicado.
2. Em **Configure → Customization → Emails → Authentication**, edite **Invitation** e **Verification code**. Preserve os elementos, variáveis obrigatórias, destino dinâmico do botão e entrega pelo Clerk. Para o convite, use o assunto `Convite para participar do {{app.name}}` e texto como “Você recebeu um convite para acessar o WaPilot. Use o botão abaixo para aceitar o convite e concluir seu cadastro.” Para o código, use `{{otp_code}} é seu código de verificação` e “Use o código abaixo para verificar seu acesso ao WaPilot.” Confira corpo e prévias Desktop/Mobile antes de salvar. A inspeção somente leitura não revelou o corpo completo nem uma opção de idioma padrão; não substitua o template inteiro sem conferir as variáveis. O [guia oficial dos templates](https://clerk.com/docs/guides/customizing-clerk/email-sms-templates) descreve prévia, edição e entrega.
3. Após confirmar restrições, textos e Account Portal, confira novamente a ausência da identidade e de convite pendente. Crie somente um convite administrativo para o destinatário aprovado, sem redirect customizado, e confira seu estado. O destinatário aceita/verifica no Account Portal. Não compartilhe códigos, tickets ou links portadores; resultado desconhecido exige leitura antes de qualquer repetição.

Para o perfil HTTPS, forneça o arquivo privado de desenvolvimento descrito em [DEVELOPMENT.md](../DEVELOPMENT.md#clerk-development-em-https-de-loopback), com permissão `0600`. A chave não deve ser enviada pelo chat. A confiança do certificado no navegador continua uma operação do dono da máquina.
