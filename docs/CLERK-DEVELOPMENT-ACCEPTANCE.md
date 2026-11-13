# Homologação Clerk development — andamento da #62

**Estado em 13/11/2026: perfil privado Tailscale integrado e conferido na máquina real; Clerk real ainda não homologado.** A #60 foi integrada em `228e490`; a adaptação privada foi integrada em `54026be`. A configuração development foi aplicada; o primeiro convite administrativo teve envio confirmado pelo Clerk e está pendente de aceitação. Testes simulados e verificações sem sessão não comprovam entrega, aceitação ou sessão real.

## Leitura do ambiente

- O read-back inicial identificou a aplicação WaPilot `app_3M1uSBQzCMOfMfnraVHBpldbNhx`, instância development `ins_3M1uS6zuL7NHmAvpeezFR2uvBjV`, configuração `v1_7501b808`: cadastro público, senha e Google habilitados, e-mail mutável e paths ainda não configurados. Após autorização, o alvo `docs/clerk-development-config.json` foi aplicado e relido como `v1_ec69bf3a`: convite restrito, código por e-mail, e-mail imutável, senha e Google desligados e paths configurados.
- No Dashboard, **Configure → User & authentication → User model → User permissions**, a autoexclusão continuou ligada após o primeiro alvo. O operador a desligou e salvou; GPT Terra confirmou ambos os switches desligados antes e depois de recarregar, por volta de 19:16 UTC. A alteração cobre usuários novos; a tela ainda mostrava zero usuários. A restrição foi concluída antes do primeiro convite.
- Em **Configure → Customization → Emails → Authentication**, Invitation e Verification code estavam inicialmente em inglês. Após o operador fornecer a chave development, `GET /instance` confirmou a instância exata antes de qualquer escrita. Os dois templates foram traduzidos, validados pelo endpoint de prévia e salvos pela Backend API, com read-back às 19:05 UTC. Assuntos atuais: `Convite para acessar o {{app.name}}` e `{{otp_code}} é seu código de verificação`. Entrega pelo Clerk, links, variáveis obrigatórias e estilos originais foram preservados. O Account Portal aparecia ativo; aceitação e entrega real continuam sem teste.
- O schema do conector não expôs a autoexclusão (feedback `fbk_3M3lsUbmAWnUU5t3aOXEFPbQinZ`). A sessão Dashboard fornecida pelo conector é somente leitura, e suas ferramentas não cobrem essa permissão, templates ou convites (feedback `fbk_3M3rA9wSkSQReTHJl221147qr9b`). A chave fornecida permitiu atualizar os templates pela API oficial; o operador concluiu a restrição global pelo Dashboard, sem substituí-la por alterações individuais após o cadastro.

## Preparação com a chave development fornecida

O operador autorizou os dois destinatários de teste e preencheu `.env.clerk`. A chave foi validada sem impressão de valores contra a instância development esperada. O arquivo foi copiado para a worktree principal com `0600`, sem sobrescrever uma configuração existente, para servir de referência ao setup de novas worktrees. O `.env.stdio` indicado anteriormente não continha chaves Clerk. `npm run dev:clerk -- --prepare` concluiu as migrations exclusivamente locais e preparou as fixtures desativadas e sem vínculo; nenhuma identidade Clerk foi criada ou ativada.

`orca.yaml` lista `.env.stdio` e `.env.clerk`. A cópia real dos dois arquivos de ambiente para uma worktree auxiliar foi conferida por igualdade e permissões, sem registrar conteúdo. Certificado e chave TLS são obtidos localmente para o hostname da própria máquina, sem cópia entre worktrees. D1/KV, grants, cifra/consentimento, arquivos de runtime e índices também não são copiados. Branches anteriores à mudança mantêm seu setup anterior até receberem os commits; não houve merge no `main`.

As prévias sanitizadas foram conferidas por GPT Terra em 1280×800 e 390×844: ambos os templates ficaram legíveis, sem cortes. O convite recebeu foco nos dois links por Tab na ordem esperada; o código não tem controles interativos. O exemplo do fornecedor ainda formata a data dinâmica em inglês e usa um local sintético. Isso não comprova os valores/localização do e-mail real nem acessibilidade completa.

## Bootstrap real e decisão de HTTPS privado

Antes do envio, a Backend API foi novamente validada para a instância development. A busca exata e paginada encontrou zero usuários e zero convites para o administrador aprovado nos estados pending, accepted, revoked e expired. Foi emitido um único convite com notificação habilitada, sem redirect customizado e sem ignorar convites existentes. O Clerk confirmou o envio e uma nova leitura confirmou pending e destino no Account Portal. O objeto portador não foi registrado; o resumo operacional permanece apenas no estado local privado. Aceitação, e-mail primário verificado e vínculo D1 ainda estão pendentes.

O operador substituiu a etapa de CA local por **Tailscale Serve privado**, com hostname da própria máquina de cada desenvolvedor. Funnel público não foi autorizado. O comando descobre a origem no daemon local, obtém e valida o certificado desse hostname, mantém Worker/mock em loopback e encaminha TCP privado na porta 8443 com TLS até o Wrangler. Não confia em headers encaminhados pelo cliente. [Serve](https://tailscale.com/docs/features/tailscale-serve) atende somente a tailnet; um cliente externo permanece fora desta prova.

### Prova conectada do perfil privado

Em `54026be`, `npm run dev:clerk` iniciou com o daemon Tailscale real, sem instalar CA ou desativar a validação TLS. Às 20:03 UTC, foram conferidos:

| Cenário real sem sessão | Resultado |
| --- | --- |
| Certificado da origem externa | Cadeia pública e hostname aceitos pela validação TLS padrão |
| `/healthz` e `/sign-in` | `200`; página de login HTML disponível |
| `/connections/data`, inclusive com `Accept: text/html` | `401` JSON, sem headers de diagnóstico Clerk |
| `/mcp` sem bearer | `401`, com `resource_metadata` na origem HTTPS privada |
| Metadata OAuth | Recurso canônico igual à origem privada mais `/mcp` |
| Navegação para `/connections` | Handshake Clerk `307`, destino HTTPS |
| Headers `X-Forwarded-Host`/`X-Forwarded-Proto` maliciosos | API continuou recusando com `401` |
| Configuração Serve durante a execução | Um encaminhamento TCP privado 8443; sem Funnel nessa porta; configuração persistente anterior preservada |
| Ctrl+C | Worker/mock encerrados; nenhuma porta de trabalho restante; configuração Serve idêntica à leitura anterior, incluindo os seis serviços existentes em 443 |

O perfil foi reiniciado após a prova de encerramento. A comparação de configuração e os resultados sanitizados permanecem no estado privado local; URLs de outros serviços e chaves não foram registrados no relatório. A prova ocorreu na própria máquina conectada; acesso de um segundo dispositivo e o fluxo autenticado ainda precisam de homologação.

GPT Terra conferiu a superfície deslogada no navegador Orca pela origem privada, sem exceção de certificado, em 1280×800 e 390×844. O componente Clerk real montou em `/sign-in`, com “Seu e-mail”, “Continuar” e instruções em português; não havia Google, senha ou cadastro aberto visíveis. Foco visível, Tab e Enter com campo vazio produziram a validação nativa em português. A página `/accept-invitation` sem ticket mostrou o erro esperado, sem formulário, nas duas dimensões. Não houve cortes horizontais aparentes. Os rodapés “Development mode” e “Secured by Clerk” continuam em inglês; não foram ocultados. Nenhum endereço foi preenchido ou código solicitado. Essa conferência não cobre a aceitação, sessão autenticada ou OAuth MCP.

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

Em `54026be`, assets e typecheck passaram. Os 14 testes focados do launcher/cópia passaram; a suíte completa `npm test -- --maxWorkers=1` passou com **784 testes aprovados e 12 pulados**, em 240,58 segundos. O `npm run check` com paralelismo padrão excedeu o limite de 5 segundos em três testes; os três passaram na repetição focada. Com dois workers, apenas a asserção preexistente de encerramento stdio em menos de 2 segundos falhou (2,333 segundos); isolada, passou em 1,841 segundo. A execução serial preservou todas as asserções e passou, sem mudar timeouts nem a configuração global. O check com paralelismo padrão continua sujeito à contenção observada nesta máquina.

A revisão independente Standards/Spec por GPT Sol xhigh do diff `a0096fc...54026be` não encontrou achados acionáveis. Os testes novos cobrem hostname próprio, TLS válido/inválido, origem de URLs, conflitos/offline/HTTPS ausente, preservação de serviços, ausência de Funnel 8443 e limpeza da sessão própria.

`npx wrangler deploy --dry-run --env '' --containers-rollout none` passou em `228e490`, sem publicação. As alterações posteriores alcançaram documentação, testes, setup de worktrees e o launcher/configuração local Clerk; o código/configuração do Worker empacotado não mudou. A validação do artefato Access separado está em [access-return-2026-11-13.md](qa/access-return-2026-11-13.md).

## Standards

Revisão por GPT Sol com esforço xhigh, comparando a integração com `9135510`: nenhuma violação documentada ou heurística acionável. Foram conferidos chamadores, helpers, teste novo, configuração, documentação e isolamento; a árvore do runtime publicado permaneceu inalterada.

## Spec

Revisão independente por GPT Sol com esforço xhigh: nenhum defeito local acionável nem escopo extra. A #60 atende à preparação local. A #61 permanece aberta pelos gates de publicação, políticas e automação; a #62 permanece aberta pela aceitação, vínculo e homologação com Clerk real. A ancestralidade do retorno alternativo não substituiu o runtime Clerk.

Resultado das revisões: 0 achados acionáveis em Standards e 0 em Spec; as pendências operacionais de #61 e #62 impedem declarar a spec homologada.

## Pendente para concluir

1. Concluir a aceitação do primeiro convite no Account Portal, verificar ID, e-mail primário e estado no Clerk e vincular somente a fixture D1 local. Os templates traduzidos já foram salvos, mas entrega e valores dinâmicos reais precisam de conferência.
2. Com o outro destinatário aprovado, executar convite, aceitação incorporada, pendência e ativação pelos endpoints WaPilot.
3. Executar a matriz real da #59 pela origem privada: negativas de convite e acesso, cookies, Origin/CSRF, consentimento/PKCE/MCP, renovação após 60 segundos, nova aba e saída sem revogar grant, desktop/móvel e teclado. Registrar resultados sem tickets, OTP, cookies, bearer ou conteúdo sensível. Não usar Funnel nem desativar TLS. Repetir checks/dry-run somente se novas correções mudarem o código ou o bundle publicado.

## Continuação da homologação

A configuração permanece **WaPilot / Development / Invite-only**, com alteração de e-mail e autoexclusão desligadas. A sessão Dashboard fornecida ao agente continua somente leitura; os ajustes manuais já concluídos não precisam ser repetidos.

O primeiro destinatário deve aceitar/verificar o convite já enviado no Account Portal. Não emitir outro convite nem compartilhar códigos, tickets ou links portadores. Depois da aceitação, a operação autorizada confere a identidade antes do vínculo local. O [guia oficial dos templates](https://clerk.com/docs/guides/customizing-clerk/email-sms-templates) descreve prévia, edição e entrega.

O arquivo privado de desenvolvimento já foi fornecido com permissão `0600`. A decisão atual usa o HTTPS do Tailscale, em substituição à instalação da CA local; cada desenvolvedor precisa ter seu próprio cliente conectado e sua origem descoberta localmente. A implantação e as identidades de produção continuam fora desta operação.
