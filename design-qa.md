# QA visual — galeria WaPilot v2

Data: 19 de outubro de 2026. Escopo: alinhar a linguagem visual da galeria ao
WaPilot aberto, preservando o fluxo de leitura e a adaptação ao host.

O relatório anterior do fluxo de conexões foi preservado em
[`docs/qa/wapilot-connections.md`](docs/qa/wapilot-connections.md).

## Evidências

Pasta local de capturas, fora do Git:
`/Users/luccamordente/.codex/visualizations/2026/10/19/01a153d0-438b-7501-9318-c33c1f9b09b1/wapilot-style-review/`.

- Fonte visual: dashboard autenticado `https://app.wapilot.com.br/connections`;
  captura `05-reference-panel.png`.
- Implementação: prévia local do mesmo componente e CSS de produção;
  captura `08-gallery-wide-ready.png`.
- Comparação conjunta: `12-comparison-wide.png`; detalhes de controles e
  superfícies: `13-comparison-controls.png`.
- Viewport das duas capturas da comparação completa: 1496 × 1036 CSS px;
  arquivos de 1496 × 1036 pixels, escala 1:1. A conversão de JPEG para PNG
  preservou dimensões e conteúdo, sem redimensionar as fontes de evidência.
- Estados adicionais: painel 530 × 800 (`06-gallery-binary-fonts-light.jpg`),
  modal (`09-modal-after.png`), escuro 360 × 800 (`10-gallery-dark-mobile.png`)
  e mídia indisponível/formato não suportado (`11-gallery-dark-states.png`).

O dashboard e a galeria cumprem tarefas diferentes. A comparação avalia tokens,
tipografia, superfícies e controles; não exige copiar a navegação, o hero ou os
dados de conexão do dashboard para um componente MCP Apps. Imagens já exibidas
na galeria aberta foram usadas apenas na prévia privada, com legendas/contexto
de demonstração. Nenhuma imagem, conversa ou URL assinada entra neste commit.

## Histórico da comparação e correções

1. **[P1] Cores e controles destoavam do WaPilot.** O componente usava botão
   neutro e raios pequenos. Foram aplicados os tokens verificados no dashboard:
   carvão `#0f1b25`, canvas `#f7faf9`, mint `#e9f8f0`, verde `#25d366`, borda
   `#dfe9e6` e botões em pill. A comparação conjunta posterior confirma o
   alinhamento de cor, bordas e sombras.
2. **[P1] Tipografia diferente e risco de fallback no host.** Foram incluídas
   DM Sans e Manrope, com licenças. A CSP observada no ChatGPT bloqueava fontes
   por `data:`; a implementação final registra bytes pelo construtor binário de
   `FontFace`, sem URLs nem expansão de permissões. A prévia confirmou ambas
   carregadas sob `font-src 'none'`; o console ficou sem erros.
3. **[P2] Ritmo e largura das imagens.** Foram alinhados o container de conteúdo
   de 1180 px, paddings, raios de 14/24 px e espaço entre componentes. A grade
   usa `auto-fit` para ocupar a área disponível quando há poucas imagens.
   As novas capturas não mostram overflow nas larguras verificadas.

Não restam achados P0/P1/P2 acionáveis nesta comparação de estilos.

## Superfícies verificadas

- **Fontes/tipografia:** DM Sans no corpo, Manrope 700 nos títulos, tracking
  negativo e eyebrow verde; título compacto adequado ao widget, em vez do hero
  de 66 px do dashboard. Fallback continua legível se a API de fontes falhar.
- **Layout/espaçamento:** bordas, sombras, container, padding e botões coerentes
  com a referência; painel estreito faz wrap dos controles sem esconder ações.
- **Cores/tokens:** valores claros conferidos no DOM da referência. O tema
  escuro é uma adaptação do componente; o dashboard de referência é claro.
- **Imagens:** `object-fit: contain`, proporção preservada em miniaturas e modal;
  nenhuma ilustração ou marca foi aproximada com CSS. Estados indisponíveis
  foram inspecionados separadamente.
- **Texto:** conteúdo do componente preservado; somente a identificação visual
  “WaPilot · Galeria” foi acrescentada. Legendas continuam sendo texto.

## Interações e limites

- Na prévia: Tab até a primeira miniatura, Enter para ampliar, foco em Fechar,
  Escape e retorno de foco; estados claro/escuro e mídia ausente/não suportada.
- Na galeria v1 aberta no ChatGPT: imagens visíveis, ampliação, foco, Escape e
  atualização por ponte do host concluídos. Não é prova de publicação da v2.
- Console da prévia: nenhum erro ou warning observado.
- `npm run check`: 134 testes, typechecks e sincronização do bundle passaram.
  O dry-run do Wrangler passou sem publicar.
- A prévia usa uma ponte de dados simulada. A nova v2 ainda requer publicação
  autorizada e atualização do catálogo do host; o Codex desktop não foi validado
  nesta rodada. O critério geral de dois hosts continua aberto.

Referência técnica da carga binária: [FontFace, CSS Font Loading](https://www.w3.org/TR/css-font-loading-3/#font-face-constructor).

## Checklist

- [x] Comparar a referência aberta e a implementação em uma mesma imagem.
- [x] Conferir controles em detalhe, tipografia e tokens.
- [x] Exercitar largura reduzida, tema escuro, modal e foco.
- [x] Manter fontes e imagens dentro da política de rede declarada.
- [x] Gerar o novo recurso versionado, atualizar documentação e validar build.

final result: passed
