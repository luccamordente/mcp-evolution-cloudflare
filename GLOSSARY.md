# WhatsApp MCP

Termos canônicos do WaPilot.

## Mensagens

**Transcrição de áudio**:
Representação textual da fala contida em uma mensagem de áudio, preservando o idioma original para permitir a compreensão sem ouvir a mensagem.
_Avoid_: transcript, resumo do áudio

**Mensagem de áudio**:
Mensagem recebida ou enviada cujo conteúdo é uma nota de voz ou um arquivo de áudio anexado.
_Avoid_: nota de voz como sinônimo de toda mensagem de áudio

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
