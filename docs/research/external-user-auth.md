# Pesquisa: autenticação de usuários externos

**Consulta em 12/11/2026.** Pergunta: como permitir usuários externos aprovados pelo WaPilot sem cadastrar cada e-mail no Cloudflare? Fontes externas abaixo são documentação oficial dos fornecedores; as implicações para o WaPilot são inferências a partir do código local, não garantias dos fornecedores.

## Distinção decisiva

Hoje, o Cloudflare Access autentica o navegador em `/authorize` e `/connections`; o Worker verifica o JWT de Access e uma lista `ALLOWED_EMAILS`. O OAuth Provider, no mesmo Worker, emite outro token para `/mcp`; a assertion de Access não serve como bearer MCP. `ensureUser` cria automaticamente uma linha `active` no D1 para qualquer identidade que passou pela lista e não rejeita uma linha `disabled`. Veja [autenticação](../../src/lib/auth.ts), [OAuth](../../src/lib/oauth.ts), [registro de usuário](../../src/lib/db.ts) e [configuração](../../wrangler.jsonc). Portanto, **tirar o cadastro individual do Access** pode ser uma mudança menor; **tirar a dependência do Access para login** é uma migração de identidade.

| Opção | Cadastro controlado por | Quem autentica o navegador | Mudança no WaPilot |
| --- | --- | --- | --- |
| Access OTP amplo + aprovação no D1 | WaPilot/D1 | Cloudflare Access | Menor; mantém OAuth Provider e tela de login existentes |
| Clerk em modo convite | Convites Clerk + estado WaPilot/D1 | Clerk | Média; troca login da UI e de `/authorize` |
| Supabase Auth por convite | Convites Supabase + estado WaPilot/D1 | Supabase Auth | Média; troca login da UI e de `/authorize` |
| Login próprio no Worker | WaPilot/D1 | WaPilot | Maior; exige operar entrega de e-mail, sessão e recuperação |

### 1. Access com OTP amplo e autorização no D1

A [documentação do Access](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/) mostra que uma política `Allow` com `Include: Login Methods = One-time PIN` aceita qualquer e-mail válido. A [documentação de OTP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) confirma que o código só é enviado quando a política permite o e-mail. Isso remove a edição da política para cada usuário externo: a pessoa prova posse do e-mail, mas o Worker decide se o e-mail tem cadastro `active`. A própria Cloudflare classifica a política ampla como possível configuração equivocada para apps que esperam que Access seja a única barreira. Para o WaPilot, ela só seria segura **após** negar acesso no Worker a identidades ausentes ou desativadas, em todas as rotas protegidas.

Implementação necessária: pré-cadastrar/aprovar no D1; substituir `ALLOWED_EMAILS` como controle de usuários gerais por uma consulta ao D1; parar a criação automática de usuários em requests comuns; validar `active` antes de emitir OAuth em `/authorize`, em cada request MCP (inclusive tokens e grants antigos) e nas rotas de UI/API. Preservar uma regra administrativa própria para `/admin` e provisionamento. Revisar a revogação dos grants e refresh tokens existentes ao desativar conta; [Access tem revogação de sessões](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/), mas isso não substitui a verificação do estado no WaPilot. Fazer essas mudanças **antes** de ampliar a política do Access evita que qualquer e-mail autenticado acione o `ensureUser` atual e ganhe uma conta ativa. A Cloudflare continua responsável pelo login e pelas sessões; usuários externos não precisam ser membros da conta Cloudflare se usarem OTP, conforme [o exemplo de acesso de contratados](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/).

**Trade-off:** menor custo de implementação e nenhuma nova dependência de autenticação, mas a página de OTP do Access fica aberta a qualquer e-mail válido. A aprovação no D1 passa a ser a barreira principal para dados e ações. O número de usuários autenticados e as condições comerciais do Access devem ser conferidos no plano contratado; [a página de preços atual](https://www.cloudflare.com/plans/zero-trust-services/) não basta para estimar um custo por usuário deste cenário.

### 2. Clerk em modo convite

O [modo Invite-only da Clerk](https://clerk.com/docs/guides/secure/restricting-access) permite cadastro apenas por convite ou criação administrativa. A Clerk fornece [convites](https://clerk.com/docs/guides/users/inviting), sessão e [verificação de seus tokens no backend](https://clerk.com/docs/guides/sessions/manual-jwt-verification). O Worker poderia converter uma sessão Clerk validada para a identidade interna do WaPilot; o OAuth Provider atual continuaria emitindo os tokens MCP, sem aceitar tokens de sessão Clerk em `/mcp`. O estado `active` do D1 ainda deve ser verificado por request, pois bloquear inscrições futuras não revoga tokens MCP já emitidos. A própria [documentação da Clerk sobre restrições](https://clerk.com/docs/guides/secure/restricting-access) distingue restrições de cadastro de bloqueio de usuários existentes.

**Trade-off:** experiência de login e convite pronta, independente do Access, mas outra conta, configuração, SDK/integração e migração da UI. O [plano Hobby atual](https://clerk.com/pricing) é gratuito até seu limite de usuários retidos; recursos como MFA e duração personalizada de sessão pertencem ao plano pago. Preços e limites precisam ser reconfirmados ao contratar.

### 3. Supabase Auth por convite

O Supabase oferece [convite administrativo por e-mail](https://supabase.com/docs/guides/auth/users) e login por [OTP ou link](https://supabase.com/docs/guides/auth/auth-email-passwordless). `signInWithOtp` cria usuário por padrão; `shouldCreateUser: false` evita isso, segundo a documentação. Em produção, o [servidor SMTP padrão não entrega para endereços externos não autorizados](https://supabase.com/docs/guides/auth/auth-smtp); será preciso configurar SMTP próprio. O Worker pode [verificar JWTs por JWKS](https://supabase.com/docs/guides/auth/jwts) quando o projeto usa chaves assimétricas, mapear o `sub` ao usuário interno e manter o OAuth Provider atual. A checagem de `active` no D1 continua necessária. [Logout global revoga refresh tokens, mas JWTs de acesso seguem válidos até expirar](https://supabase.com/docs/guides/auth/signout).

O Supabase também tem [servidor OAuth 2.1 e orientação específica para MCP](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication), ainda [em beta segundo a documentação atual](https://supabase.com/docs/guides/auth/oauth-server/getting-started). Substituir o OAuth Provider atual por ele seria um projeto separado: exigiria revisar descoberta, client registration, escopos, audience do recurso, consentimento e revogação para o contrato MCP fixado neste repositório. O [plano Free atual](https://supabase.com/pricing) inclui Auth para 50 mil MAU, mas o projeto gratuito pode ser pausado após uma semana sem atividade; isso importa para uso de produção intermitente.

**Trade-off:** remove Access da autenticação e oferece convite/OTP, mas acrescenta serviço de Auth e entrega SMTP. Manter o OAuth Provider reduz o escopo da migração.

### 4. Login próprio no Worker

O Worker e o D1 podem implementar convite e sessão próprios, mas isso desloca para o WaPilot a geração e entrega de códigos, limites de tentativa, prevenção de enumeração, cookies, CSRF, revogação, expiração, recuperação de conta e auditoria. O [NIST SP 800-63B](https://pages.nist.gov/800-63-4/sp800-63b.html) é referência primária para controles de autenticação, e a [orientação OWASP sobre sessões](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) cobre o ciclo de vida de cookies/sessões. O OAuth Provider MCP ainda pode ser mantido. É a opção de maior código e responsabilidade operacional para o problema apresentado.

## Recomendação para decidir

Se o requisito literal é **não editar Cloudflare para cada novo usuário**, começar por **Access OTP amplo + D1 como cadastro autorizado**. Isso preserva a arquitetura OAuth atual, mas só é seguro depois de trocar a autorização geral por `users.status = 'active'` em todas as entradas e de testar conta ausente, desativada e token MCP emitido antes da desativação. Não basta apagar `ALLOWED_EMAILS`.

Se o requisito é **o login continuar funcionando sem Cloudflare Access**, escolher um provedor de identidade. Clerk é a opção de convite mais pronta; Supabase Auth é viável se a equipe aceitar a configuração SMTP e o serviço adicional. Em ambos, manter inicialmente o OAuth Provider atual para `/mcp` reduz risco de incompatibilidade. Esta recomendação é uma inferência de escopo sobre o código atual e as capacidades documentadas, não uma avaliação operacional em produção.

**Não verificado:** política Access, plano contratado e configuração de e-mail efetivos em produção. Nenhuma configuração externa foi alterada.
