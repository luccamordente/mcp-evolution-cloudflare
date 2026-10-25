import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { mountGallery, type GalleryBridge } from '../ui/gallery';

function setup() {
  const dom = new JSDOM('<main id="gallery"></main>');
  const root = dom.window.document.querySelector('main')!;
  const callServerTool = vi.fn();
  const bridge: GalleryBridge = { callServerTool, ontoolinput: undefined, ontoolresult: undefined, ontoolcancelled: undefined };
  mountGallery(root, bridge);
  return { dom, root, bridge, callServerTool };
}

function result(items: unknown[] = [{ state: 'ready', url: 'https://images.example.test/a.png?signature=private', mimeType: 'image/png', caption: '<img src=x onerror=alert(1)>' }]) {
  return { content: [], _meta: { gallery: { connectionId: 'resolved-connection', conversationId: 'chat', text: 'photo', limit: 12, approvedOrigins: ['https://images.example.test'], items } } };
}

describe('image gallery host bridge and DOM', () => {
  it('renders approved images and treats message captions as text', () => {
    const { root, bridge } = setup();
    bridge.ontoolresult!(result());
    expect(root.querySelectorAll('img')).toHaveLength(1);
    expect(root.querySelector('img')!.getAttribute('src')).toBe('https://images.example.test/a.png?signature=private');
    expect(root.querySelector('img')!.getAttribute('loading')).toBe('lazy');
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(root.querySelector('[onerror]')).toBeNull();
  });

  it('isolates missing, unsupported and unapproved media without loading their URLs', () => {
    const { root, bridge } = setup();
    bridge.ontoolresult!(result([
      { state: 'missing' },
      { state: 'unsupported', mimeType: 'image/svg+xml' },
      { state: 'ready', mimeType: 'image/png', url: 'https://unapproved.example.test/a.png' },
      { state: 'ready', mimeType: 'text/html', url: 'https://images.example.test/a.html' },
      { state: 'ready', mimeType: 'image/png', url: 'https://user:secret@images.example.test/a.png' },
      { state: 'ready', mimeType: 'image/png', url: 'http://images.example.test/a.png' },
      { state: 'ready', mimeType: 'image/png', url: 'https://images.example.test/active.svg' },
      { state: 'ready', mimeType: 'image/png', url: 'https://images.example.test/active.html' },
      { state: 'ready', mimeType: 'image/png', url: 'https://images.example.test/safe.png' },
    ]));
    expect(root.querySelectorAll('img')).toHaveLength(1);
    expect(root.textContent).toContain('Arquivo não disponível');
    expect(root.textContent).toContain('Formato não suportado');
    expect(root.textContent).toContain('Imagem bloqueada');
    expect(root.querySelectorAll('li')).toHaveLength(9);
  });

  it('refreshes through the host using the resolved connection and query, then renders renewed links', async () => {
    const { root, bridge, callServerTool } = setup();
    bridge.ontoolinput!({ arguments: { connectionId: 'different-default', limit: 20 } });
    bridge.ontoolresult!(result());
    callServerTool.mockResolvedValue(result([{ state: 'ready', mimeType: 'image/png', url: 'https://images.example.test/new.png?renewed=1' }]));
    (root.querySelector('.refresh') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelector('img')?.getAttribute('src')).toBe('https://images.example.test/new.png?renewed=1'));
    expect(callServerTool).toHaveBeenCalledExactlyOnceWith({ name: 'show_image_gallery', arguments: { connectionId: 'resolved-connection', conversationId: 'chat', text: 'photo', limit: 12 } });
  });

  it('isolates an expired URL without retrying or exposing its signed URL in errors', () => {
    const { root, bridge, dom, callServerTool } = setup();
    bridge.ontoolresult!(result());
    root.querySelector('img')!.dispatchEvent(new dom.window.Event('error'));
    expect(root.textContent).toContain('Link expirado ou arquivo indisponível');
    expect(root.querySelector('img[src]')).toBeNull();
    expect(root.textContent).not.toContain('signature');
    expect(callServerTool).not.toHaveBeenCalled();
  });

  it('opens an accessible modal and restores focus on Escape dismissal', () => {
    const { root, bridge, dom } = setup();
    // jsdom has no top layer; exercise the browser dialog methods at their boundary.
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
    bridge.ontoolresult!(result());
    const thumbnail = root.querySelector('.thumbnail') as HTMLButtonElement;
    thumbnail.focus();
    thumbnail.click();
    const dialog = root.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
    expect(dialog.querySelector('img')!.getAttribute('alt')).toBe('<img src=x onerror=alert(1)>');
    dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true }));
    expect(dialog.open).toBe(false);
    expect(dom.window.document.activeElement).toBe(thumbnail);
  });

  it('shows empty and recoverable errors without printing the host error', async () => {
    const { root, bridge, callServerTool } = setup();
    expect(root.dataset.state).toBe('loading');
    bridge.ontoolresult!(result([]));
    expect(root.dataset.state).toBe('empty');
    expect(root.textContent).toContain('Nenhuma imagem disponível');
    callServerTool.mockRejectedValueOnce(new Error('token=secret signature=private'));
    (root.querySelector('.refresh') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.dataset.state).toBe('error'));
    expect(root.textContent).not.toMatch(/token=|secret|signature=/);
    expect((root.querySelector('.refresh') as HTMLButtonElement).disabled).toBe(false);
    callServerTool.mockResolvedValueOnce(result());
    (root.querySelector('.refresh') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.dataset.state).toBe('ready'));
  });

  it('bounds rendered items to twenty and keeps only one manual refresh in flight', async () => {
    const { root, bridge, callServerTool } = setup();
    const payload = result(Array.from({ length: 30 }, () => ({ state: 'missing' })));
    payload._meta.gallery.limit = 100;
    bridge.ontoolresult!(payload);
    expect(root.querySelectorAll('li')).toHaveLength(20);
    let resolve!: (value: unknown) => void;
    callServerTool.mockImplementation(() => new Promise(done => { resolve = done; }));
    const refresh = root.querySelector('.refresh') as HTMLButtonElement;
    refresh.click();
    refresh.click();
    expect(callServerTool).toHaveBeenCalledTimes(1);
    expect(refresh.disabled).toBe(true);
    resolve(result([]));
    await vi.waitFor(() => expect(root.dataset.state).toBe('empty'));
    expect(callServerTool.mock.calls[0][0].arguments.limit).toBe(20);
  });
  it('can retry an initial authorized storage error using the resolved connection', async () => {
    const { root, bridge, callServerTool } = setup();
    bridge.ontoolinput!({ arguments: {} });
    bridge.ontoolresult!({ ...result([]), isError: true });
    expect(root.dataset.state).toBe('error');
    expect((root.querySelector('.refresh') as HTMLButtonElement).disabled).toBe(false);
    callServerTool.mockResolvedValueOnce(result());
    (root.querySelector('.refresh') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.dataset.state).toBe('ready'));
    expect(callServerTool.mock.calls[0][0].arguments.connectionId).toBe('resolved-connection');
  });

});
