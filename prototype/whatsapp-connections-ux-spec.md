# Especificação da experiência do usuário: conexões do WhatsApp

## Objetivo

Descrever a experiência para cadastrar, conectar, acompanhar e trocar entre números de WhatsApp dentro do WaPilot. A experiência mantém um único número em foco por vez e usa esse contexto para orientar o estado exibido e a próxima ação.

Esta especificação descreve comportamento e conteúdo funcional. Ela não define layout, tipografia, cores, componentes visuais ou outras decisões de design.

## Escopo e natureza do protótipo

O protótipo explora duas decisões de produto:

- o usuário trabalha com um número ativo por vez;
- a troca de número acontece pelo seletor de contexto, sem exigir uma central separada de números.

Os controles de variação e cenário descritos mais adiante existem para testar a hipótese. Eles não fazem parte da experiência final do usuário.

## Separação entre as duas páginas

O protótipo possui duas páginas funcionais distintas. Elas compartilham a identificação da aplicação, o seletor de contexto e a identificação do usuário, mas têm objetivos e estados diferentes.

### Página 1 — Dashboard da conexão

**Objetivo:** acompanhar uma conexão já cadastrada e conectada, entender seu estado e escolher o contexto de trabalho.

**Quando aparece:**

- quando existe uma conexão ativa com estado `connected`;
- depois que o usuário conclui o onboarding;
- quando o usuário volta ao dashboard pelo comando “Ir para o dashboard”.

**O que contém:**

- identidade da conexão ativa;
- indicação de conexão padrão, quando aplicável;
- resumo do estado e da saúde da conexão;
- atividade recente;
- ações para adicionar outro número, revisar o estado e tornar a conexão padrão;
- seletor para trocar o contexto.

**O que não faz:** o dashboard não cria o QR diretamente, não conduz a leitura do QR e não representa uma lista operacional independente de todas as conexões. A lista existe dentro do seletor de contexto.

**Como o usuário sai:**

- inicia a adição de outro número e vai para o onboarding;
- seleciona uma conexão pendente ou expirada e vai para o onboarding correspondente;
- continua no dashboard ao trocar para outra conexão `connected`.

### Página 2 — Onboarding e conexão do WhatsApp

**Objetivo:** criar ou continuar a configuração de uma conexão até que ela esteja confirmada como conectada.

**Quando aparece:**

- no primeiro acesso, quando ainda não há conexão;
- ao adicionar outro número;
- ao selecionar uma conexão com estado `provisioning`, `qr` ou `expired`;
- ao revisar uma conexão que ainda não está conectada.

**O que contém:**

- progresso da conexão em três etapas;
- estado de provisionamento da instância;
- QR code e instruções de leitura;
- contagem regressiva e recarga do QR;
- mensagens de expiração e ajuda;
- confirmação de conexão concluída.

**Estados internos da página:**

1. `provisioning`: a instância e o webhook estão sendo preparados;
2. `qr`: o usuário deve ler o QR;
3. `expired`: o QR precisa ser renovado;
4. sucesso: a conexão foi confirmada e pode ir para o dashboard.

**Como o usuário sai:**

- conclui a conexão e aciona “Ir para o dashboard”;
- permanece na página enquanto aguarda ou renova o QR;
- usa o seletor de contexto para mudar para outra conexão, quando essa ação estiver disponível.

### Relação entre as páginas

O dashboard é a página de acompanhamento e operação do contexto ativo. O onboarding é a página de preparação e confirmação de uma conexão específica. Adicionar um número sempre sai do dashboard e abre o onboarding; concluir o onboarding sempre retorna ao dashboard. A troca de contexto pode permanecer no dashboard para conexões conectadas ou levar ao onboarding para conexões pendentes.

## Conceitos e dados da experiência

### Conexão

Uma conexão representa um número de WhatsApp cadastrado no workspace. Ela possui, no mínimo:

- identificador interno;
- nome amigável;
- telefone, quando identificado;
- estado atual da conexão;
- versão do QR exibido, quando houver QR;
- indicação de que é a conexão padrão.

### Contexto ativo

É a conexão que determina o conteúdo do dashboard e a ação principal disponível na sessão. Apenas uma conexão pode estar ativa por vez.

Trocar o contexto atualiza o nome, o telefone, o estado e as ações mostradas ao usuário. A troca não altera automaticamente a conexão padrão.

### Conexão padrão

É a conexão escolhida como referência principal do workspace.

- A primeira conexão criada torna-se padrão automaticamente.
- Conexões posteriores não substituem a padrão sem uma ação explícita do usuário.
- Tornar uma conexão padrão também a torna ativa no protótipo.

### Estados

| Estado | Significado para o usuário | Próxima ação esperada |
| --- | --- | --- |
| `provisioning` | A instância está sendo criada e preparada. | Aguardar; nenhuma ação é necessária. |
| `qr` | A instância existe e aguarda a leitura do QR. | Ler o QR pelo WhatsApp ou recarregá-lo. |
| `connected` | O número foi conectado e está pronto para uso. | Usar o workspace ou trocar de contexto. |
| `expired` | O QR deixou de ser válido. | Aguardar a renovação automática ou recarregar o QR. |
| `offline` | A conexão está desconectada. | Conectar novamente pelo QR. |
| `error` | Não foi possível verificar o estado. | Tentar atualizar o estado ou seguir a orientação de erro. |

`offline` e `error` já estão previstos no vocabulário de estados do protótipo, mas não possuem um fluxo visual completo implementado.

## Elementos compartilhados

### Aviso de protótipo

Informa que a experiência é descartável, usa dados locais e não executa alterações reais. Serve para evitar que o usuário interprete o estado demonstrado como uma conexão real.

### Identidade da aplicação

Identifica o WaPilot e permite retornar à tela principal da variação atual. Não representa uma ação de conexão nem altera o estado do número.

### Navegação principal

Apresenta as áreas “Dashboard” e “Atividade”. O dashboard é a superfície funcional desta exploração; “Atividade” é uma intenção de navegação ainda sem consulta implementada.

### Conta do usuário

Identifica o usuário autenticado no protótipo. Não há, nessa experiência, fluxo de edição de perfil, logout ou troca de conta.

### Feedback breve de ações

Após trocar o contexto, alterar a conexão padrão ou carregar um cenário, o protótipo apresenta uma confirmação breve. Esse feedback comunica a mudança sem criar uma etapa adicional no fluxo.

### Seletor de contexto

Exibe a conexão ativa, seu telefone ou a informação de que o número ainda não foi identificado, além do estado resumido. Ao ser acionado, oferece:

- lista de todas as conexões cadastradas;
- indicação de qual está ativa;
- indicação de qual é a padrão;
- estado de cada conexão;
- ação para tornar outra conexão padrão;
- ação para adicionar outro número;
- ação para rever o onboarding.

Ao selecionar uma conexão:

- se ela estiver conectada, o dashboard passa a exibi-la;
- se estiver aguardando QR, o usuário retorna ao passo de leitura;
- se estiver expirada, o protótipo renova o QR antes de exibir o passo de leitura;
- o menu é fechado e o contexto passa a ser o selecionado.

## Elementos da página Dashboard

### Identidade da conexão

Apresenta o nome amigável, o telefone conhecido e, quando aplicável, a marca de conexão padrão. Serve para confirmar ao usuário qual número está em foco.

### Resumo do estado atual

Informa se o número está conectado e pronto para uso. Quando conectado, comunica a saúde atual, a estabilidade, o momento da última verificação e o identificador da conexão. Esse resumo evita que o usuário precise inferir o estado a partir de outras telas.

### Ações rápidas do dashboard

Dependendo da variação explorada, o dashboard oferece as seguintes intenções:

- adicionar outro número;
- abrir ou revisar o estado da conexão;
- tornar a conexão ativa a conexão padrão;
- rever como funciona o onboarding.

As ações de abrir/revisar uma conexão conectada confirmam que ela está pronta. Para uma conexão pendente, levam ao passo de QR.

### Atividade recente

Registra eventos de referência para explicar como a conexão chegou ao estado atual:

- conexão verificada;
- webhook ativo e pronto para capturar eventos;
- instância criada.

O comando “Ver tudo” está presente como intenção de produto, mas não abre uma consulta de atividade no protótipo.

## Elementos da página Onboarding

### Indicador de progresso do onboarding

Representa três etapas da conexão:

1. criação da instância;
2. leitura do QR code;
3. conexão concluída.

No estado de provisionamento, a primeira etapa aparece como criação da instância, seguida pela configuração do webhook e pela geração do QR. Depois que a instância existe, a primeira etapa passa a ser “Instância criada”.

### Estado de provisionamento

Explica que a instância está sendo criada automaticamente, informa que o processo leva alguns segundos e diz que o usuário não precisa fazer nada. O estado avança automaticamente para a leitura do QR depois da preparação.

### QR code e instruções de conexão

O passo de leitura contém:

- QR code da conexão;
- orientação para abrir `Configurações → Aparelhos conectados` no WhatsApp;
- orientação para tocar em “Conectar aparelho”;
- orientação para manter a tela aberta até a confirmação;
- contagem regressiva de 30 segundos;
- ação “Recarregar QR code”;
- mensagem de ajuda para o caso de o evento de conexão não chegar.

O QR exibido é apenas demonstrativo. Em uma implementação real, a instrução deve acompanhar a validade informada pelo provedor.

### Estado de QR expirado

Quando a contagem chega a zero, o estado passa a ser `expired`, a mensagem informa que um novo QR está sendo gerado e o protótipo agenda uma renovação automática. O usuário também pode recarregar manualmente o QR. Cada recarga reinicia a contagem e produz uma nova versão do código.

### Confirmação de conexão

Depois de conectado, a experiência confirma “WhatsApp conectado”, identifica a conexão e explica a regra de padrão: a primeira conexão criada é padrão automaticamente; números posteriores só assumem esse papel após escolha explícita.

O comando “Ir para o dashboard” encerra o onboarding, mantém a conexão como contexto ativo e retorna ao dashboard.

## Workflows

### 1. Primeiro acesso e criação da primeira conexão

1. O usuário inicia sem uma conexão cadastrada.
2. O sistema cria uma conexão provisória e a torna ativa.
3. O sistema cria a instância, configura o webhook e prepara o QR sem pedir nome ou telefone ao usuário.
4. A conexão avança para o passo de leitura do QR.
5. O usuário abre os aparelhos conectados no WhatsApp e lê o QR.
6. Ao receber a confirmação, a conexão passa para `connected`.
7. A primeira conexão é marcada como padrão automaticamente.
8. O usuário confirma a conclusão e vai para o dashboard daquela conexão.

Se o telefone ainda não estiver disponível, a experiência deve comunicar que ele será identificado após a leitura, sem bloquear a conexão por esse dado.

### 2. Adicionar outro número

1. O usuário aciona “Adicionar outro número” no dashboard ou no seletor de contexto.
2. O sistema cria uma nova conexão provisória sem substituir a conexão padrão existente.
3. O sistema mostra o provisionamento e depois o QR da nova conexão.
4. O usuário lê o QR e aguarda a confirmação.
5. A nova conexão passa a `connected` e permanece ativa.
6. A conexão padrão anterior permanece padrão até que o usuário escolha “Tornar padrão”.

### 3. Trocar o número em foco

1. O usuário abre o seletor de contexto.
2. O sistema lista as conexões e seus estados.
3. O usuário escolhe uma conexão.
4. O sistema atualiza o contexto ativo e fecha o seletor.
5. O dashboard passa a refletir a conexão escolhida.

Uma conexão pendente reabre o onboarding no passo correspondente. Uma conexão expirada inicia a renovação do QR automaticamente antes de continuar.

### 4. Tornar uma conexão padrão

1. O usuário abre o seletor ou usa a ação de padrão disponível no dashboard.
2. O usuário escolhe “Tornar padrão”.
3. O sistema atualiza a conexão padrão.
4. O sistema também torna essa conexão ativa e confirma a alteração.

Essa ação não deve criar, excluir ou reconectar instâncias.

### 5. Continuar uma conexão que aguarda QR

1. O usuário seleciona uma conexão com estado `qr`.
2. O sistema abre o passo de leitura e reinicia a contagem da sessão exibida.
3. O usuário lê o QR ou aciona “Recarregar QR code”.
4. Se houver confirmação, segue para o estado conectado; caso contrário, permanece no passo de leitura até expirar ou ser recarregado.

### 6. Recuperar um QR expirado

1. A contagem chega a zero ou o usuário seleciona uma conexão já expirada.
2. O sistema informa que o QR expirou.
3. O sistema inicia uma renovação automática; o usuário também pode solicitar a renovação manual.
4. Um novo QR é exibido com nova validade.
5. O usuário repete a leitura.

A renovação deve reutilizar a conexão existente. Ela não deve criar uma segunda conexão local apenas para obter outro QR.

### 7. Revisar o estado de uma conexão

1. O usuário aciona “Abrir detalhes”, “Abrir estado”, “Ver estado completo” ou “Revisar detalhes da conexão”, conforme a variação.
2. Se a conexão estiver `connected`, o sistema confirma que ela está pronta.
3. Se estiver `qr`, o sistema abre o onboarding no QR.
4. Se estiver `expired`, o sistema renova o QR e abre o onboarding.

### 8. Explorar o protótipo

Os controles de exploração permitem:

- alternar entre as variações A a I por setas na interface ou pelas teclas de seta esquerda/direita;
- carregar um cenário com uma conexão conectada;
- carregar o cenário de primeiro acesso;
- carregar um cenário com três conexões: uma conectada, uma aguardando QR e uma com QR expirado.

Esses controles alteram apenas o estado local da demonstração. Eles não são requisitos da experiência final.

## Regras de comportamento

- O dashboard sempre representa uma conexão ativa por vez.
- A conexão ativa e a conexão padrão são conceitos distintos.
- A primeira conexão criada é padrão automaticamente.
- Uma conexão adicional só se torna padrão por escolha explícita.
- O usuário não precisa informar nome ou telefone para iniciar o onboarding.
- O estado de provisionamento não pede interação enquanto a instância é preparada.
- O QR tem validade temporária e pode ser recarregado.
- Selecionar uma conexão expirada deve renovar o QR da conexão existente.
- A tela de sucesso mantém a conexão recém-concluída como contexto ativo.
- Mensagens de confirmação devem explicar a mudança realizada, sem sugerir que uma ação real foi enviada quando o ambiente for apenas o protótipo.

## Limitações e pontos a validar antes da implementação

- O protótipo contém a função interna `simulate-connected`, mas não expõe um controle de usuário para transformar o QR em conectado. O estado de sucesso precisa ser acionado por integração real ou por uma ação explícita de simulação durante a validação.
- O cenário de primeiro acesso cria uma conexão provisória mesmo quando o objetivo é apenas visualizar a tela; a implementação final deve distinguir rascunho de conexão persistida.
- Os estados `offline` e `error` têm rótulos e mensagens definidos, mas não têm recuperação completa demonstrada.
- “Ver tudo” na atividade e a aba “Atividade” não possuem comportamento implementado.
- A troca de variação, o carregamento de cenários, o QR falso, os identificadores de exemplo e os dados de usuário são exclusivos da demonstração.
- A implementação real precisa substituir o estado local por leituras do backend e confirmar a conexão no Evolution Go antes de declarar o número conectado.

## Critérios de aceitação da experiência

- O usuário consegue entender qual número está em foco e qual é o padrão.
- O usuário consegue iniciar a primeira conexão sem preencher dados desnecessários.
- O usuário recebe instruções suficientes para ler o QR e sabe quando deve aguardar, recarregar ou repetir.
- O usuário consegue adicionar outros números sem perder a conexão padrão atual.
- O usuário consegue trocar o contexto sem abrir uma central separada.
- O sistema distingue conexão ativa, padrão, aguardando QR, expirada, desconectada e erro.
- A renovação do QR reutiliza a conexão existente.
- A confirmação final informa claramente que a conexão está pronta e permite voltar ao dashboard.
- Em produção, cada transição de conexão é sustentada por confirmação do backend; o protótipo local não deve ser tratado como essa confirmação.
