import type { App } from '@modelcontextprotocol/ext-apps';

/** Public MCP Apps bridge boundary; the production adapter is the official App SDK. */
export type GalleryBridge = Pick<App, 'ontoolinput' | 'ontoolresult' | 'ontoolcancelled' | 'callServerTool'>;

type Item = Record<string, unknown>;

const RASTER_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function approvedUrl(item: Item, origins: unknown[]): string | undefined {
  if (item.state !== 'ready' || !RASTER_MIMES.has(text(item.mimeType).trim().toLowerCase())) return;
  try {
    const url = new URL(text(item.url));
    if (text(item.url).length > 8192 || url.protocol !== 'https:' || url.username || url.password || url.hash) return;
    if (/\.(?:svg|html?|xhtml)(?:$|[/?])/i.test(decodeURIComponent(url.pathname))) return;
    if (!origins.includes(url.origin)) return;
    return url.href;
  } catch {
    return;
  }
}

/** Mount one read-only gallery. Results are supplied only by the authenticated host bridge. */
export function mountGallery(root: HTMLElement, bridge: GalleryBridge) {
  const doc = root.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', content = '') => {
    const node = doc.createElement(tag);
    node.className = className;
    node.textContent = content;
    return node;
  };
  const header = el('header', 'gallery-header');
  const title = el('div', 'gallery-title');
  const eyebrow = el('p', 'gallery-eyebrow', 'WaPilot · Galeria');
  const heading = el('h1', '', 'Imagens da conversa');
  const refresh = el('button', 'refresh', 'Atualizar');
  refresh.type = 'button';
  refresh.disabled = true;
  const status = el('p', 'gallery-status', 'Carregando imagens…');
  status.setAttribute('role', 'status');
  title.appendChild(eyebrow);
  title.appendChild(heading);
  title.appendChild(status);
  header.appendChild(title);
  header.appendChild(refresh);
  const grid = el('ul', 'gallery-grid');
  grid.setAttribute('role', 'list');
  const note = el('p', 'gallery-note', 'Imagens disponíveis no histórico retido. Atualize para renovar links.');
  const dialog = el('dialog', 'image-dialog');
  const dialogTitle = el('h2', '', 'Imagem ampliada');
  dialogTitle.id = 'image-dialog-title';
  dialog.setAttribute('aria-labelledby', dialogTitle.id);
  const close = el('button', 'close', 'Fechar');
  close.type = 'button';
  close.autofocus = true;
  const dialogBody = el('figure', 'dialog-body');
  const dialogHeader = el('header', 'dialog-header');
  dialogHeader.appendChild(dialogTitle);
  dialogHeader.appendChild(close);
  dialog.appendChild(dialogHeader);
  dialog.appendChild(dialogBody);
  let origin: HTMLButtonElement | undefined;
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
  dialog.addEventListener('close', () => {
    dialogBody.replaceChildren();
    if (origin?.isConnected && !origin.disabled) origin.focus();
    else refresh.focus();
    origin = undefined;
  });
  root.replaceChildren(header, grid, note, dialog);
  root.dataset.state = 'loading';
  let query: Record<string, unknown> | undefined;
  let busy = false;
  let generation = 0;

  function fail(message = query ? 'Não foi possível carregar as imagens. Atualize para tentar novamente.' : 'Não foi possível carregar as imagens. Peça ao agente para abrir a galeria novamente.') {
    root.dataset.state = 'error';
    status.textContent = message;
  }

  refresh.addEventListener('click', async () => {
    if (!query || busy) return;
    busy = true;
    refresh.disabled = true;
    root.setAttribute('aria-busy', 'true');
    status.textContent = 'Atualizando imagens…';
    const request = ++generation;
    try {
      const next = await bridge.callServerTool({ name: 'show_image_gallery', arguments: { ...query } });
      if (request === generation) render(next);
    } catch {
      if (request === generation) fail();
    } finally {
      busy = false;
      refresh.disabled = !query;
      root.removeAttribute('aria-busy');
    }
  });

  function render(result: unknown) {
    const gallery = record(record(record(result)?._meta)?.gallery);
    if (!gallery || !Array.isArray(gallery.items) || !text(gallery.connectionId)) {
      fail();
      return;
    }
    query = { connectionId: gallery.connectionId, limit: Number.isInteger(gallery.limit) ? Math.max(1, Math.min(20, gallery.limit as number)) : 12 };
    if (text(gallery.conversationId)) query.conversationId = gallery.conversationId;
    if (text(gallery.text)) query.text = gallery.text;
    refresh.disabled = busy;
    if (record(result)?.isError) { fail(); return; }
    if (dialog.open) dialog.close();
    grid.replaceChildren();
    const origins = Array.isArray(gallery.approvedOrigins) ? gallery.approvedOrigins : [];
    const items = gallery.items.slice(0, query.limit as number);
    for (const value of items) {
      const item = record(value) ?? {};
      const li = el('li', 'gallery-item');
      const figure = el('figure');
      const url = approvedUrl(item, origins);
      if (url) {
        const open = el('button', 'thumbnail');
        open.type = 'button';
        open.setAttribute('aria-label', `Ampliar imagem ${grid.children.length + 1}`);
        open.setAttribute('aria-haspopup', 'dialog');
        const image = el('img');
        image.alt = text(item.caption) || 'Imagem de mensagem do WhatsApp';
        image.setAttribute('loading', 'lazy');
        image.decoding = 'async';
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => {
          image.removeAttribute('src');
          image.hidden = true;
          open.disabled = true;
          open.appendChild(el('span', 'media-placeholder', 'Link expirado ou arquivo indisponível. Atualize para renovar.'));
        }, { once: true });
        image.src = url;
        open.addEventListener('click', () => {
          origin = open;
          const enlarged = el('img');
          enlarged.alt = image.alt;
          enlarged.decoding = 'async';
          enlarged.referrerPolicy = 'no-referrer';
          enlarged.addEventListener('error', () => {
            enlarged.removeAttribute('src');
            enlarged.hidden = true;
            dialogBody.insertBefore(el('p', 'media-placeholder', 'Link expirado ou arquivo indisponível. Atualize para renovar.'), dialogBody.firstChild);
          }, { once: true });
          enlarged.src = url;
          dialogBody.replaceChildren(enlarged, el('figcaption', 'caption', text(item.caption)));
          dialog.showModal();
          close.focus();
        });
        open.appendChild(image);
        figure.appendChild(open);
      } else {
        const unavailable = item.state === 'missing' ? 'Arquivo não disponível' : item.state === 'unsupported' || (item.mimeType && !RASTER_MIMES.has(text(item.mimeType).trim().toLowerCase())) ? 'Formato não suportado' : 'Imagem bloqueada';
        figure.appendChild(el('p', 'media-placeholder', unavailable));
      }
      figure.appendChild(el('figcaption', 'caption', text(item.caption)));
      const context = [item.direction === 'outbound' ? 'Enviada' : item.direction === 'inbound' ? 'Recebida' : '', text(item.sender), text(item.timestamp), text(item.conversationId)].filter(Boolean).join(' · ');
      if (context) figure.appendChild(el('p', 'message-context', context));
      li.appendChild(figure);
      grid.appendChild(li);
    }
    root.dataset.state = items.length ? 'ready' : 'empty';
    status.textContent = items.length ? `${items.length} imagens · recebidas e enviadas` : 'Nenhuma imagem disponível para esta consulta.';
  }
  bridge.ontoolinput = () => { root.dataset.state = 'loading'; status.textContent = 'Carregando imagens…'; };
  bridge.ontoolresult = (result) => { ++generation; render(result); };
  bridge.ontoolcancelled = () => { ++generation; fail('Consulta cancelada. Atualize para tentar novamente.'); };
  return { showError() { fail('Não foi possível conectar a galeria ao aplicativo.'); } };
}
