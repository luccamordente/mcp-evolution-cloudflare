# Fixtures PDF sintéticas

Regere `document-matrix.pdf` e `document-limits.pdf` com `python3 test/fixtures/generate-document-matrix.py` (ReportLab/Pillow, somente ferramentas de teste). O documento principal mantém 24 páginas físicas:

- 2: scan sem camada textual, com marcadores coloridos.
- 3–5: página mista, rotação salva e formulário/anotação salvos.
- 6: duas folhas lógicas escaneadas em uma página física paisagem; marcadores em cada folha e separação central.
- 7–8: tabela larga continuada com unidades repetidas nos cabeçalhos, números com sinais e nota/fórmula de 4 pontos.
- 9: scan de apenas 60×80 pixels com desfoque intencional; ampliação não recupera informação perdida.
- Demais páginas: linhas textuais e notas pequenas para navegação seletiva.

`test/pdf-matrix.test.ts` executa o processador real no workerd: verifica dimensões, regiões de cor, separação das folhas, estrutura da tabela, camada textual e pixels escuros de um recorte de detalhe da nota. Os sinais e unidades também são conferidos na extração textual real. Esses asserts comprovam conteúdo entregue e geometria; não comprovam reconhecimento visual exato pelo modelo, OCR, legibilidade de um scan ruim ou ausência de redução pelo host. O teste de recorte girado e de detalhe renderizado a partir do original fica em `test/pdf-detail.test.ts`.

`generate-document-inspection.py` produz `document-inspection.pdf` (texto extenso, rótulos distintos da posição física, cabeçalho misto e ordem textual não espacial) e `document-outline.pdf` (105 bookmarks para paginação). Todas as fixtures usam conteúdo artificial, sem mensagens ou documentos privados.
