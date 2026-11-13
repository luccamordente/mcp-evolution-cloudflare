# Homologação Clerk development — andamento da #62

**Estado em 13/11/2026: perfil local integrado, Clerk real não homologado.** A #60 foi integrada em `228e490`; seus testes focados passaram (19 testes e typecheck), incluindo HTTPS com CA temporária e validação TLS, sem instalar confiança no sistema ou usar navegador real. Os testes abaixo usam dados locais e Clerk simulado; não comprovam entrega de e-mail ou sessão real. A configuração development descrita abaixo foi aplicada; nenhum convite foi enviado.

## Leitura do ambiente

- O read-back inicial identificou a aplicação WaPilot `app_3M1uSBQzCMOfMfnraVHBpldbNhx`, instância development `ins_3M1uS6zuL7NHmAvpeezFR2uvBjV`, configuração `v1_7501b808`: cadastro público, senha e Google habilitados, e-mail mutável e paths ainda não configurados. Após autorização, o alvo `docs/clerk-development-config.json` foi aplicado e relido como `v1_ec69bf3a`: convite restrito, código por e-mail, e-mail imutável, senha e Google desligados e paths configurados.
- No Dashboard, **Configure → User & authentication → User model → User permissions**, “Allow users to delete their account” continuava ligado e “Allow users to change their email address” estava desligado após a aplicação. A alteração da exclusão afeta apenas usuários novos; há operação separada para existentes. O conector informou zero usuários e o Dashboard mostrou zero usuários e zero convites pendentes; repetir as leituras antes de operar.
- Em **Configure → Customization → Emails → Authentication**, Invitation e Verification code estavam inicialmente em inglês. Após o operador fornecer a chave development, `GET /instance` confirmou a instância exata antes de qualquer escrita. Os dois templates foram traduzidos, validados pelo endpoint de prévia e salvos pela Backend API, com read-back às 19:05 UTC. Assuntos atuais: `Convite para acessar o {{app.name}}` e `{{otp_code}} é seu código de verificação`. Entrega pelo Clerk, links, variáveis obrigatórias e estilos originais foram preservados. O Account Portal aparecia ativo; aceitação e entrega real continuam sem teste.
- O schema do conector não expôs a autoexclusão (feedback `fbk_3M3lsUbmAWnUU5t3aOXEFPbQinZ`). A sessão Dashboard fornecida pelo conector é somente leitura, e suas ferramentas não cobrem essa permissão, templates ou convites (feedback `fbk_3M3rA9wSkSQReTHJl221147qr9b`). A chave fornecida permitiu atualizar os templates pela API oficial; a autoexclusão global continua pendente no Dashboard, sem substituí-la por alterações individuais após o cadastro.

## Preparação com a chave development fornecida

O operador autorizou os dois destinatários de teste e preencheu `.env.clerk`. A chave foi validada sem impressão de valores contra a instância development esperada. O arquivo foi copiado para a worktree principal com `0600`, sem sobrescrever uma configuração existente, para servir de referência ao setup de novas worktrees. O `.env.stdio` indicado anteriormente não continha chaves Clerk. `npm run dev:clerk -- --prepare` concluiu as migrations exclusivamente locais e preparou as fixtures desativadas e sem vínculo; nenhuma identidade Clerk foi criada ou ativada.

`orca.yaml` agora lista `.env.stdio`, `.env.clerk` e o par TLS de localhost. A cópia real dos dois arquivos de ambiente para uma worktree auxiliar foi conferida por igualdade e permissões, sem registrar conteúdo. O par TLS ainda não existia; sua cópia será feita quando estiver disponível. D1/KV, grants, cifra/consentimento, arquivos de runtime e chave privada da CA não são copiados. Branches anteriores à mudança mantêm seu setup anterior até receberem os commits; não houve merge no `main`.

As prévias sanitizadas foram conferidas por GPT Terra em 1280×800 e 390×844: ambos os templates ficaram legíveis, sem cortes. O convite recebeu foco nos dois links por Tab na ordem esperada; o código não tem controles interativos. O exemplo do fornecedor ainda formata a data dinâmica em inglês e usa um local sintético. Isso não comprova os valores/localização do e-mail real nem acessibilidade completa. Nenhum convite foi enviado.

### Modern Web Guidance

- **`accessibility`**: apliquei `lang="pt-BR"` ao HTML e ao markup do editor, preservando a estrutura e os estilos do fornecedor, conforme “Do declare the page's human language”. A prévia e o read-back confirmaram o idioma declarado; não houve modernização do layout de e-mail.

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

Após a extensão da cópia no setup, `npm run check` passou novamente em `a5339a3`: **53 arquivos e 777 testes aprovados**, com 1 arquivo e 12 testes conectados pulados; duração de 105,82 segundos. A revisão independente Standards/Spec por GPT Sol xhigh do diff desde `04b7a57` não encontrou achados acionáveis. O teste novo executa o comando de `orca.yaml` em uma fixture Git e confere origem, permissões, repetição, arquivos ausentes e exclusão de estados/CA privada.

`npx wrangler deploy --dry-run --env '' --containers-rollout none` passou em `228e490`, sem publicação. As alterações posteriores alcançaram documentação, testes e setup de worktrees; o código/configuração do Worker empacotado não mudou. A validação do artefato Access separado está em [access-return-2026-11-13.md](qa/access-return-2026-11-13.md).

## Standards

Revisão por GPT Sol com esforço xhigh, comparando a integração com `9135510`: nenhuma violação documentada ou heurística acionável. Foram conferidos chamadores, helpers, teste novo, configuração, documentação e isolamento; a árvore do runtime publicado permaneceu inalterada.

## Spec

Revisão independente por GPT Sol com esforço xhigh: nenhum defeito local acionável nem escopo extra. A #60 atende à preparação local. A #61 permanece aberta pelos gates de publicação, políticas e automação; a #62 permanece aberta pela configuração e homologação com Clerk real. A ancestralidade do retorno alternativo não substituiu o runtime Clerk.

Resultado das revisões: 0 achados acionáveis em Standards e 0 em Spec; as pendências operacionais de #61 e #62 impedem declarar a spec homologada.

## Pendente para concluir

1. Por acesso de escrita apropriado, reler a contagem de usuários, bloquear e verificar a autoexclusão, tratando explicitamente eventuais usuários existentes. Os templates traduzidos já foram salvos, mas entrega e valores dinâmicos reais precisam de conferência.
2. Preparar certificado HTTPS de loopback confiável pelo navegador e cliente OAuth, com a operação de confiança realizada pelo dono da máquina; sem desativar validação TLS. Usar D1/KV locais isolados e somente fixtures. A prova de loopback não comprova um conector remoto.
3. Resolver o primeiro administrador por identidade existente ou convite administrativo direto e Account Portal, verificar ID, e-mail primário e estado, e vincular somente a fixture local. Com outro destinatário aprovado, executar convite, aceitação incorporada, pendência e ativação pelo WaPilot.
4. Executar a matriz real da #59: negativas de convite e acesso, consentimento/PKCE/MCP, renovação após 60 segundos, nova aba e saída sem revogar grant, desktop/móvel e teclado. Registrar resultados sem tickets, OTP, cookies, bearer ou conteúdo sensível. Repetir checks/dry-run somente se novas correções mudarem o código ou o bundle publicado.

## Continuação com acesso de escrita

Abra o [Dashboard Clerk](https://dashboard.clerk.com) com sua conta habitual e confirme **WaPilot / Development / Invite-only**. A sessão disponibilizada ao agente é somente leitura; a autorização para development não amplia a capacidade dessa sessão.

1. Em **Configure → User & authentication → User model → User permissions**, desligue **Allow users to delete their account**, salve e confira após recarregar. A alteração cobre usuários novos. Reconte os usuários antes; se houver existentes, avalie separadamente **Apply to existing users**. A alteração de e-mail já foi desligada pelo alvo aplicado.
2. Depois da restrição, a operação autorizada deve conferir novamente ausência da identidade/convite pendente e emitir um único convite administrativo, sem redirect customizado. Os templates já foram traduzidos pela API; não precisam ser editados novamente. O destinatário aceita/verifica no Account Portal. Não compartilhe códigos, tickets ou links portadores; resultado desconhecido exige leitura antes de qualquer repetição. O [guia oficial dos templates](https://clerk.com/docs/guides/customizing-clerk/email-sms-templates) descreve prévia, edição e entrega.

O arquivo privado de desenvolvimento já foi fornecido com permissão `0600`. Para o HTTPS, falta a confiança da CA pelo dono da máquina, seguindo [DEVELOPMENT.md](../DEVELOPMENT.md#clerk-development-em-https-de-loopback). Depois disso, o par de localhost pode ser gerado e guardado como referência na worktree principal; a chave da CA fica fora do projeto.
