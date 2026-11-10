# WhatsApp MCP

Termos canônicos do WaPilot.

## Mensagens

**Comprovante de envio**:
Representação do conteúdo e do resultado de uma tentativa de envio de mensagem, exibida após a operação. Não comprova entrega nem leitura pelo destinatário.
_Avoid_: prévia de envio, confirmação de entrega, recibo de leitura

**Envio aceito**:
Tentativa de envio cujo aceite foi confirmado pelo serviço de mensagens. Não implica entrega nem leitura pelo destinatário.
_Avoid_: mensagem entregue, mensagem lida

**Resultado de envio desconhecido**:
Tentativa de envio que pode ter produzido a mensagem, mas para a qual não há confirmação suficiente do resultado.
_Avoid_: falha confirmada, mensagem não enviada

**Transcrição de áudio**:
Representação textual da fala contida em uma mensagem de áudio, preservando o idioma original para permitir a compreensão sem ouvir a mensagem.
_Avoid_: transcript, resumo do áudio

**Mensagem de áudio**:
Mensagem recebida ou enviada cujo conteúdo é uma nota de voz ou um arquivo de áudio anexado.
_Avoid_: nota de voz como sinônimo de toda mensagem de áudio

**Mensagem completa**:
Representação de uma mensagem com seu texto integral e os metadados disponíveis, incluindo informações sobre anexos.
_Avoid_: prévia, arquivo de mídia como sinônimo de mensagem completa

## Monitoramento de mensagens

**Assinatura de mensagens**:
Monitoramento solicitado por um cliente em nome de um usuário para mensagens novas recebidas em uma conexão e, opcionalmente, em uma conversa.
_Avoid_: conexão, autorização OAuth como sinônimo de assinatura

**Objetivo de acompanhamento**:
Condição definida pelo usuário que determina o propósito e, quando aplicável, o término do monitoramento de mensagens.

**Notificação de mensagem**:
Aviso destinado a um cliente sobre uma mensagem nova recebida que corresponde à sua assinatura de mensagens.
_Avoid_: webhook bruto, histórico de mensagens

**Prévia de mensagem**:
Trecho inicial do texto de uma mensagem, destinado a permitir uma avaliação inicial sem necessariamente incluir seu conteúdo integral.
_Avoid_: mensagem completa, resumo como sinônimo de prévia

**Entrega de notificação**:
Envio de uma notificação de mensagem a um cliente específico. Uma mesma mensagem pode originar entregas para diferentes assinaturas.

## Conexões

**Conexão padrão**:
A conexão do usuário escolhida como contexto implícito quando uma ferramenta MCP é chamada sem identificador de conexão.
_Avoid_: conexão ativa, primeira conexão, conexão principal

**Identificador de conexão**:
O UUID interno que identifica uma conexão pertencente ao usuário e permite selecioná-la explicitamente em uma chamada MCP.
_Avoid_: token da instância, nome da instância, ID da instância

## Administração

**Administrador operacional**:
Pessoa autorizada a consultar a visão agregada de usuários, conexões e autorizações do serviço. Nesta decisão, Lucca e Heitor exercem esse papel com as mesmas permissões de leitura.

**Painel administrativo**:
Superfície de leitura usada por administradores operacionais para observar o estado agregado do serviço. Não inclui criação de instâncias, revogação de autorizações ou alterações nas conexões.

**Snapshot administrativo**:
Leitura coerente produzida por uma atualização manual do painel, contendo os dados disponíveis naquele momento e indicando individualmente fontes que falharam.

**Estado live**:
Disponibilidade atual informada diretamente pelo Evolution Go para uma conexão.
_Avoid_: estado persistido, status cadastral, cadastro

**Registro de conexão**:
Dados de configuração registrados no D1 sobre uma conexão, incluindo usuário, instância, credencial cifrada, conexão padrão e webhook. O registro não representa a disponibilidade atual no WhatsApp.
_Avoid_: estado live, status cadastral

**Autorização OAuth ativa**:
Grant vigente associado a um usuário e a um cliente OAuth, com seus escopos e datas relevantes; tokens e credenciais não fazem parte da visão administrativa.

**Autorização OAuth expirada**:
Grant cujo prazo terminou. Não aparece na lista de autorizações ativas, mas pode ser contabilizado separadamente quando essa informação estiver disponível.

**Atenção operacional**:
Sinal derivado usado para priorizar uma conta ou conexão quando o Evolution Go informa indisponibilidade, desconexão ou falha de leitura do estado live.


## Leitura de documentos

**Posição física da página**:
Índice da página dentro do PDF, começando em 1. É o identificador usado para leitura e recorte, independentemente do número impresso ou do rótulo.

**Rótulo da página**:
Numeração lógica declarada pelo PDF, quando presente. Pode usar algarismos romanos, prefixos ou outra sequência e não comprova a numeração visível na folha.

**Cobertura textual**:
Trecho de texto extraído de uma página; não comprova que imagens, scans, gráficos ou todo o conteúdo visual tenham sido examinados.
