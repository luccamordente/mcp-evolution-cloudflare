# Homologação Clerk development — andamento da #62

**Estado em 13/11/2026: não homologado.** Esta é uma evidência parcial da candidata `9135510`, anterior à integração da #60. Os testes abaixo usam dados locais e Clerk simulado; não comprovam entrega de e-mail, configuração do provedor ou sessão real. Nenhuma configuração externa foi alterada e nenhum convite foi enviado nesta etapa.

## Leitura do ambiente

- O read-back do conector às 16:30 UTC identificou a aplicação WaPilot `app_3M1uSBQzCMOfMfnraVHBpldbNhx`, instância development `ins_3M1uS6zuL7NHmAvpeezFR2uvBjV`, configuração `v1_7501b808`: cadastro público, senha e Google habilitados, e-mail mutável e paths ainda não configurados. O dry-run de `docs/clerk-development-config.json` foi aceito, mas não aplicado.
- No Dashboard dessa instância, **Configure → User & authentication → User model → User permissions**, “Allow users to delete their account” e “Allow users to change their email address” estavam ligados. O painel informa que a alteração da exclusão afeta apenas usuários novos e oferece aplicação separada aos existentes. O conector informou zero usuários development; repetir a contagem antes de alterar qualquer configuração. Não se deve presumir que a alteração cubra usuários existentes.
- Em **Configure → Customization → Emails → Authentication**, Invitation e Verification code estavam ativos e identificados como templates Clerk. No editor Invitation, o assunto estava em inglês: `Invitation to join {{app.name}}`. O corpo e a entrega real em pt-BR ainda não foram homologados.
- O schema do conector não expôs a permissão de autoexclusão; feedback `fbk_3M3lsUbmAWU5t3aOXEFPbQinZ` foi enviado. A observação no Dashboard identifica a configuração, mas não comprova seu bloqueio.

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

## Pendente para concluir

1. Integrar a #60 e repetir as verificações na candidata final. Confirmar as autorizações para alterar a instância development, os dois destinatários de teste, envio de e-mails e o arquivo privado de credenciais de desenvolvimento. Não usar credenciais de produção.
2. Após autorização, reler configuração e contagem de usuários, aplicar o alvo e verificar no provedor as permissões de e-mail e exclusão, inclusive tratamento explícito de usuários existentes se houver. Configurar e conferir paths e templates em pt-BR, inclusive o assunto do convite; repetir o read-back.
3. Preparar certificado HTTPS de loopback confiável pelo navegador e cliente OAuth, com a operação de confiança realizada pelo dono da máquina; sem desativar validação TLS. Usar D1/KV locais isolados e somente fixtures. A prova de loopback não comprova um conector remoto.
4. Resolver o primeiro administrador por identidade existente ou convite administrativo direto e Account Portal, verificar ID, e-mail primário e estado, e vincular somente a fixture local. Com outro destinatário aprovado, executar convite, aceitação incorporada, pendência e ativação pelo WaPilot.
5. Executar a matriz real da #59: negativas de convite e acesso, consentimento/PKCE/MCP, renovação após 60 segundos, nova aba e saída sem revogar grant, desktop/móvel e teclado. Registrar resultados sem tickets, OTP, cookies, bearer ou conteúdo sensível. Rodar checks e dry-run da candidata final.
