# WhatsApp MCP

Termos canônicos para seleção de conexões nas ferramentas MCP.

## Conexões

**Conexão padrão**:
A conexão do usuário escolhida como contexto implícito quando uma ferramenta MCP é chamada sem identificador de conexão.
_Avoid_: conexão ativa, primeira conexão, conexão principal

**Identificador de conexão**:
O UUID interno que identifica uma conexão pertencente ao usuário e permite selecioná-la explicitamente em uma chamada MCP.
_Avoid_: token da instância, nome da instância, ID da instância
