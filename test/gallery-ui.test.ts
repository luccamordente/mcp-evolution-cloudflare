import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { mountGallery, type GalleryBridge } from '../ui/gallery';

function setup() {
  const dom = new JSDOM('<main id="gallery"></main>');
  const root = dom.window.document.querySelector('main')!;
  Object.defineProperty(dom.window, 'createImageBitmap', { value: vi.fn().mockResolvedValue({ width: 1, height: 1, close: vi.fn() }), configurable: true });
  const callServerTool = vi.fn();
  const updateModelContext = vi.fn().mockResolvedValue({});
  const getHostCapabilities = vi.fn().mockReturnValue({ updateModelContext: { text: {}, image: {}, structuredContent: {} } });
  const bridge: GalleryBridge = { callServerTool, updateModelContext, getHostCapabilities, ontoolinput: undefined, ontoolresult: undefined, ontoolcancelled: undefined };
  const gallery = mountGallery(root, bridge);
  return { dom, root, bridge, callServerTool, updateModelContext, getHostCapabilities, gallery };
}

function result(items: unknown[] = [{ state: 'ready', url: 'https://images.example.test/a.png?signature=private', mimeType: 'image/png', caption: '<img src=x onerror=alert(1)>' }]) {
  return { content: [], _meta: { gallery: { connectionId: 'resolved-connection', conversationId: 'chat', text: 'photo', limit: 12, approvedOrigins: ['https://images.example.test'], items } } };
}


const pixels = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function selectable(messageId = 'message-a') {
  return { state: 'ready', id: messageId, conversationId: 'chat', mimeType: 'image/png', url: 'https://images.example.test/a.png?signature=private' };
}
function selection(messageId = 'message-a') {
  return { content: [], _meta: { selection: {
    content: [{ type: 'image', data: pixels, mimeType: 'image/png' }],
    message: { connectionId: 'resolved-connection', messageId, conversationId: 'chat', to: 'chat', direction: 'inbound', sender: 'sender@s.whatsapp.net', mimeType: 'image/png' },
  } } };
}

describe('image gallery host bridge and DOM', () => {
  it('transfers the chosen image and its original message to future model context without sending', async () => {
    const { root, bridge, callServerTool, updateModelContext } = setup();
    bridge.ontoolresult!(result([selectable()]));
    callServerTool.mockResolvedValueOnce(selection());
    const select = root.querySelector<HTMLButtonElement>('.select-image')!;
    expect(select).not.toBeNull();
    select.click();
    await vi.waitFor(() => expect(updateModelContext).toHaveBeenCalledOnce());
    expect(callServerTool).toHaveBeenCalledExactlyOnceWith({ name: 'get_gallery_image', arguments: { connectionId: 'resolved-connection', messageId: 'message-a', conversationId: 'chat', text: 'photo' } }, expect.objectContaining({ timeout: 15000 }));
    const context = updateModelContext.mock.calls[0][0];
    expect(context.content).toContainEqual({ type: 'image', data: pixels, mimeType: 'image/png' });
    expect(context.content[0].text).toContain('O usuário selecionou a mensagem message-a');
    expect(context.structuredContent.selectedMessage).toMatchObject({ connectionId: 'resolved-connection', messageId: 'message-a', conversationId: 'chat', to: 'chat' });
    expect(JSON.stringify(context)).not.toMatch(/https:|signature|apikey|token/);
    await vi.waitFor(() => expect(select.getAttribute('aria-pressed')).toBe('true'));
    expect(root.textContent).toContain('Mensagem message-a selecionada');
  });

  it('selects an older image using the original gallery text filter', async () => {
    const { root, bridge, callServerTool, updateModelContext } = setup();
    const galleryResult = result([selectable('old-image')]);
    galleryResult._meta.gallery.text = 'Foto antiga & família + viagem';
    bridge.ontoolresult!(galleryResult);
    callServerTool.mockImplementation(async request => request.arguments.text === 'Foto antiga & família + viagem'
      ? selection('old-image') : { isError: true });
    root.querySelector<HTMLButtonElement>('.select-image')!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Mensagem old-image selecionada'));
    expect(callServerTool).toHaveBeenCalledExactlyOnceWith({ name: 'get_gallery_image', arguments: {
      connectionId: 'resolved-connection', messageId: 'old-image', conversationId: 'chat', text: 'Foto antiga & família + viagem',
    } }, expect.objectContaining({ timeout: 15000 }));
    expect(updateModelContext.mock.calls[0][0].structuredContent.selectedMessage.messageId).toBe('old-image');
  });

  it('explains unavailable image context support without reading or confirming a selection', () => {
    const { root, bridge, callServerTool, updateModelContext, getHostCapabilities } = setup();
    getHostCapabilities.mockReturnValue({ updateModelContext: { text: {}, structuredContent: {} } });
    bridge.ontoolresult!(result([selectable()]));
    root.querySelector<HTMLButtonElement>('.select-image')!.click();
    expect(root.textContent).toContain('Este aplicativo não oferece contexto com imagens');
    expect(callServerTool).not.toHaveBeenCalled();
    expect(updateModelContext).not.toHaveBeenCalled();
    expect(root.querySelector('.select-image')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('replaces one confirmed selection and explicitly clears the current view context', async () => {
    const { root, bridge, callServerTool, updateModelContext } = setup();
    bridge.ontoolresult!(result([selectable('a'), selectable('b')]));
    callServerTool.mockResolvedValueOnce(selection('a')).mockResolvedValueOnce(selection('b'));
    root.querySelectorAll<HTMLButtonElement>('.select-image')[0].click();
    await vi.waitFor(() => expect(root.textContent).toContain('Mensagem a selecionada'));
    root.querySelectorAll<HTMLButtonElement>('.select-image')[1].click();
    await vi.waitFor(() => expect(root.textContent).toContain('Mensagem b selecionada'));
    expect(Array.from(root.querySelectorAll('.select-image')).map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    root.querySelector<HTMLButtonElement>('.clear-selection')!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Seleção removida'));
    expect(updateModelContext.mock.calls[2][0]).toEqual({ content: [], structuredContent: {} });
    expect(root.querySelector('[aria-pressed="true"]')).toBeNull();
    expect(callServerTool.mock.calls.map(call => call[0].name)).toEqual(['get_gallery_image', 'get_gallery_image']);
  });

  it('ignores a late media result after a newer image is selected', async () => {
    const { root, bridge, callServerTool, updateModelContext } = setup();
    bridge.ontoolresult!(result([selectable('slow'), selectable('latest')]));
    let finishSlow!: (value: unknown) => void;
    callServerTool.mockImplementationOnce(() => new Promise(resolve => { finishSlow = resolve; })).mockResolvedValueOnce(selection('latest'));
    root.querySelectorAll<HTMLButtonElement>('.select-image')[0].click();
    root.querySelectorAll<HTMLButtonElement>('.select-image')[1].click();
    await vi.waitFor(() => expect(root.textContent).toContain('Mensagem latest selecionada'));
    finishSlow(selection('slow'));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(updateModelContext).toHaveBeenCalledOnce();
    expect(root.textContent).toContain('Mensagem latest selecionada');
    expect(root.querySelectorAll('.select-image')[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('serializes host context writes and coalesces newer selections while the host is slow', async () => {
    const { root, bridge, callServerTool, updateModelContext } = setup();
    bridge.ontoolresult!(result([selectable('a'), selectable('b'), selectable('c')]));
    let acknowledgeA!: (value: object) => void;
    updateModelContext.mockImplementationOnce(() => new Promise(resolve => { acknowledgeA = resolve; }));
    callServerTool.mockResolvedValueOnce(selection('a')).mockResolvedValueOnce(selection('b')).mockResolvedValueOnce(selection('c'));
    root.querySelectorAll<HTMLButtonElement>('.select-image')[0].click();
    await vi.waitFor(() => expect(updateModelContext).toHaveBeenCalledOnce());
    root.querySelectorAll<HTMLButtonElement>('.select-image')[1].click();
    await vi.waitFor(() => expect(callServerTool).toHaveBeenCalledTimes(2));
    await new Promise(resolve => setTimeout(resolve, 10));
    root.querySelectorAll<HTMLButtonElement>('.select-image')[2].click();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(updateModelContext).toHaveBeenCalledOnce();
    acknowledgeA({});
    await vi.waitFor(() => expect(root.textContent).toContain('Mensagem c selecionada'));
    expect(updateModelContext).toHaveBeenCalledTimes(2);
    expect(updateModelContext.mock.calls[1][0].structuredContent.selectedMessage.messageId).toBe('c');
    expect(root.querySelectorAll('.select-image')[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('allows clearing a pending selection and ignores its delayed image bytes', async () => {
    const { root, bridge, callServerTool, updateModelContext } = setup();
    bridge.ontoolresult!(result([selectable()]));
    let finish!: (value: unknown) => void;
    callServerTool.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    root.querySelector<HTMLButtonElement>('.select-image')!.click();
    const clear = root.querySelector<HTMLButtonElement>('.clear-selection')!;
    expect(clear.disabled).toBe(false);
    clear.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Seleção removida'));
    finish(selection());
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(updateModelContext).toHaveBeenCalledExactlyOnceWith({ content: [], structuredContent: {} }, { timeout: 60000 });
    expect(root.querySelector('[aria-pressed="true"]')).toBeNull();
  });

  it('restores the last confirmed context when a newer replacement fails after an older write began', async () => {
    const { root, bridge, callServerTool, updateModelContext } = setup();
    bridge.ontoolresult!(result([selectable('original'), selectable('stale'), selectable('failed')]));
    callServerTool.mockResolvedValueOnce(selection('original')).mockResolvedValueOnce(selection('stale')).mockRejectedValueOnce(new Error('private URL signature=secret'));
    root.querySelectorAll<HTMLButtonElement>('.select-image')[0].click();
    await vi.waitFor(() => expect(root.textContent).toContain('Mensagem original selecionada'));
    let acknowledge!: (value: object) => void;
    updateModelContext.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
    root.querySelectorAll<HTMLButtonElement>('.select-image')[1].click();
    await vi.waitFor(() => expect(updateModelContext).toHaveBeenCalledTimes(2));
    root.querySelectorAll<HTMLButtonElement>('.select-image')[2].click();
    await vi.waitFor(() => expect(root.textContent).toContain('A mensagem original continua selecionada'));
    acknowledge({});
    await vi.waitFor(() => expect(updateModelContext).toHaveBeenCalledTimes(3));
    expect(updateModelContext.mock.calls[2][0].structuredContent.selectedMessage.messageId).toBe('original');
    expect(root.textContent).not.toContain('secret');
  });

  it.each(['query', 'connection', 'absence'])('invalidates the current context when an updated gallery changes %s', async change => {
    const { root, bridge, callServerTool, updateModelContext } = setup();
    bridge.ontoolresult!(result([selectable()]));
    callServerTool.mockResolvedValueOnce(selection());
    root.querySelector<HTMLButtonElement>('.select-image')!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Mensagem message-a selecionada'));
    const next = result(change === 'absence' ? [] : [selectable()]);
    if (change === 'query') next._meta.gallery.text = 'new query';
    if (change === 'connection') next._meta.gallery.connectionId = 'other-connection';
    bridge.ontoolresult!(next);
    await vi.waitFor(() => expect(updateModelContext).toHaveBeenCalledTimes(2));
    expect(updateModelContext.mock.calls[1][0]).toEqual({ content: [], structuredContent: {} });
    expect(root.querySelector('[aria-pressed="true"]')).toBeNull();
  });

  it('preserves a confirmed selection through the same query refresh and zoom dismissal', async () => {
    const { root, bridge, callServerTool, updateModelContext, dom } = setup();
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
    bridge.ontoolresult!(result([selectable()]));
    callServerTool.mockResolvedValueOnce(selection());
    root.querySelector<HTMLButtonElement>('.select-image')!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Mensagem message-a selecionada'));
    root.querySelector<HTMLButtonElement>('.thumbnail')!.click();
    root.querySelector<HTMLButtonElement>('.close')!.click();
    bridge.ontoolresult!(result([selectable()]));
    expect(root.querySelector('.select-image')!.getAttribute('aria-pressed')).toBe('true');
    expect(updateModelContext).toHaveBeenCalledOnce();
  });

  it('reports a slow host without releasing its write or confirming stale content', async () => {
    vi.useFakeTimers();
    try {
      const { root, bridge, callServerTool, updateModelContext } = setup();
      bridge.ontoolresult!(result([selectable('slow'), selectable('new')]));
      let acknowledge!: (value: object) => void;
      updateModelContext.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
      callServerTool.mockResolvedValueOnce(selection('slow')).mockResolvedValueOnce(selection('new'));
      root.querySelectorAll<HTMLButtonElement>('.select-image')[0].click();
      await vi.advanceTimersByTimeAsync(0);
      expect(updateModelContext).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(15000);
      expect(root.textContent).toContain('O aplicativo demorou a confirmar');
      expect(root.querySelector('[aria-pressed="true"]')).toBeNull();
      root.querySelectorAll<HTMLButtonElement>('.select-image')[1].click();
      await vi.advanceTimersByTimeAsync(0);
      expect(updateModelContext).toHaveBeenCalledOnce();
      acknowledge({});
      await vi.advanceTimersByTimeAsync(0);
      expect(updateModelContext).toHaveBeenCalledTimes(2);
      expect(root.textContent).toContain('Mensagem new selecionada');
    } finally { vi.useRealTimers(); }
  });

  it('discards an already queued replacement when a later selection fails', async () => {
    const { root, bridge, callServerTool, updateModelContext } = setup();
    bridge.ontoolresult!(result([selectable('a'), selectable('b'), selectable('failed')]));
    let acknowledge!: (value: object) => void;
    updateModelContext.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
    callServerTool.mockResolvedValueOnce(selection('a')).mockResolvedValueOnce(selection('b')).mockRejectedValueOnce(new Error('unavailable'));
    root.querySelectorAll<HTMLButtonElement>('.select-image')[0].click();
    await vi.waitFor(() => expect(updateModelContext).toHaveBeenCalledOnce());
    root.querySelectorAll<HTMLButtonElement>('.select-image')[1].click();
    await new Promise(resolve => setTimeout(resolve, 10));
    root.querySelectorAll<HTMLButtonElement>('.select-image')[2].click();
    await vi.waitFor(() => expect(root.textContent).toContain('Não foi possível selecionar esta imagem'));
    acknowledge({});
    await vi.waitFor(() => expect(updateModelContext).toHaveBeenCalledTimes(2));
    expect(updateModelContext.mock.calls[1][0]).toEqual({ content: [], structuredContent: {} });
    expect(root.querySelector('[aria-pressed="true"]')).toBeNull();
  });

  it('stops further writes after an unacknowledged host failure and identifies the last confirmation', async () => {
    const { root, bridge, callServerTool, updateModelContext } = setup();
    bridge.ontoolresult!(result([selectable('original'), selectable('failed'), selectable('queued')]));
    callServerTool.mockResolvedValueOnce(selection('original')).mockResolvedValueOnce(selection('failed')).mockResolvedValueOnce(selection('queued'));
    root.querySelectorAll<HTMLButtonElement>('.select-image')[0].click();
    await vi.waitFor(() => expect(root.textContent).toContain('Mensagem original selecionada'));
    let reject!: (reason: Error) => void;
    updateModelContext.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    root.querySelectorAll<HTMLButtonElement>('.select-image')[1].click();
    await vi.waitFor(() => expect(updateModelContext).toHaveBeenCalledTimes(2));
    root.querySelectorAll<HTMLButtonElement>('.select-image')[2].click();
    await new Promise(resolve => setTimeout(resolve, 10));
    reject(new Error('host timeout token=secret'));
    await vi.waitFor(() => expect(root.textContent).toContain('Última confirmação: mensagem original'));
    expect(root.textContent).toContain('Reabra a galeria');
    expect(root.textContent).not.toContain('secret');
    expect(updateModelContext).toHaveBeenCalledTimes(2);
    expect(Array.from(root.querySelectorAll<HTMLButtonElement>('.select-image, .clear-selection')).every(button => button.disabled)).toBe(true);
  });

  it.each(['to', 'mimeType'])('rejects helper results with inconsistent %s metadata', async field => {
    const { root, bridge, callServerTool, updateModelContext } = setup();
    bridge.ontoolresult!(result([selectable()]));
    const response = selection();
    response._meta.selection.message[field as 'to' | 'mimeType'] = field === 'to' ? 'different-chat' : 'image/jpeg';
    callServerTool.mockResolvedValueOnce(response);
    root.querySelector<HTMLButtonElement>('.select-image')!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Não foi possível selecionar esta imagem'));
    expect(updateModelContext).not.toHaveBeenCalled();
    expect(root.querySelector('[aria-pressed="true"]')).toBeNull();
  });

  it('invalidates immediately on new query input even if the following result fails', async () => {
    const { root, bridge, callServerTool, updateModelContext } = setup();
    bridge.ontoolresult!(result([selectable()]));
    callServerTool.mockResolvedValueOnce(selection());
    root.querySelector<HTMLButtonElement>('.select-image')!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Mensagem message-a selecionada'));
    bridge.ontoolinput!({ arguments: { conversationId: 'other-chat', text: 'photo' } });
    await vi.waitFor(() => expect(updateModelContext).toHaveBeenCalledTimes(2));
    expect(root.querySelectorAll('.select-image')).toHaveLength(0);
    bridge.ontoolresult!({ content: [], isError: true });
    expect(updateModelContext.mock.calls[1][0]).toEqual({ content: [], structuredContent: {} });
    expect(root.querySelector('[aria-pressed="true"]')).toBeNull();
  });

  it('invalidates a changed connection even when its new gallery result is an error', async () => {
    const { root, bridge, callServerTool, updateModelContext } = setup();
    bridge.ontoolresult!(result([selectable()]));
    callServerTool.mockResolvedValueOnce(selection());
    root.querySelector<HTMLButtonElement>('.select-image')!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Mensagem message-a selecionada'));
    const failed = { ...result([]), isError: true };
    failed._meta.gallery.connectionId = 'other-connection';
    bridge.ontoolresult!(failed);
    await vi.waitFor(() => expect(updateModelContext).toHaveBeenCalledTimes(2));
    expect(updateModelContext.mock.calls[1][0]).toEqual({ content: [], structuredContent: {} });
  });

  it('marks only the matching message and conversation as selected when IDs repeat', async () => {
    const { root, bridge, callServerTool } = setup();
    bridge.ontoolresult!(result([selectable('same-id'), { ...selectable('same-id'), conversationId: 'other-chat' }]));
    callServerTool.mockResolvedValueOnce(selection('same-id'));
    root.querySelectorAll<HTMLButtonElement>('.select-image')[0].click();
    await vi.waitFor(() => expect(root.textContent).toContain('Mensagem same-id selecionada'));
    expect(Array.from(root.querySelectorAll('.select-image')).map(button => button.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
  });

  it('times out an unreadable selection safely and permits a later retry', async () => {
    vi.useFakeTimers();
    try {
      const { root, bridge, callServerTool, updateModelContext } = setup();
      bridge.ontoolresult!(result([selectable()]));
      let late!: (value: unknown) => void;
      callServerTool.mockImplementationOnce(() => new Promise(resolve => { late = resolve; })).mockResolvedValueOnce(selection());
      root.querySelector<HTMLButtonElement>('.select-image')!.click();
      await vi.advanceTimersByTimeAsync(15000);
      expect(root.textContent).toContain('Não foi possível selecionar esta imagem');
      expect(updateModelContext).not.toHaveBeenCalled();
      root.querySelector<HTMLButtonElement>('.select-image')!.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(root.textContent).toContain('Mensagem message-a selecionada');
      late(selection());
      await vi.advanceTimersByTimeAsync(0);
      expect(updateModelContext).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('times out image decoding before context transfer and closes a late decoded bitmap', async () => {
    vi.useFakeTimers();
    try {
      const { root, bridge, callServerTool, updateModelContext, dom } = setup();
      let decoded!: (value: ImageBitmap) => void;
      vi.mocked(dom.window.createImageBitmap).mockImplementationOnce(() => new Promise(resolve => { decoded = resolve; }));
      bridge.ontoolresult!(result([selectable()]));
      callServerTool.mockResolvedValueOnce(selection());
      root.querySelector<HTMLButtonElement>('.select-image')!.click();
      await vi.advanceTimersByTimeAsync(5000);
      expect(root.textContent).toContain('Não foi possível selecionar esta imagem');
      expect(updateModelContext).not.toHaveBeenCalled();
      const close = vi.fn();
      decoded({ width: 1, height: 1, close });
      await vi.advanceTimersByTimeAsync(0);
      expect(close).toHaveBeenCalledOnce();
      expect(updateModelContext).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('does not send queued or delayed context after the gallery is torn down', async () => {
    const { root, bridge, callServerTool, updateModelContext, gallery } = setup();
    bridge.ontoolresult!(result([selectable('a'), selectable('b')]));
    let acknowledge!: (value: object) => void;
    updateModelContext.mockImplementationOnce(() => new Promise(resolve => { acknowledge = resolve; }));
    callServerTool.mockResolvedValueOnce(selection('a')).mockResolvedValueOnce(selection('b'));
    root.querySelectorAll<HTMLButtonElement>('.select-image')[0].click();
    await vi.waitFor(() => expect(updateModelContext).toHaveBeenCalledOnce());
    root.querySelectorAll<HTMLButtonElement>('.select-image')[1].click();
    await new Promise(resolve => setTimeout(resolve, 10));
    gallery.destroy();
    acknowledge({});
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(updateModelContext).toHaveBeenCalledOnce();
  });

  it('explains missing browser image decoding without pretending visual context is available', () => {
    const { root, bridge, dom, callServerTool, updateModelContext } = setup();
    Object.defineProperty(dom.window, 'createImageBitmap', { value: undefined, configurable: true });
    bridge.ontoolresult!(result([selectable()]));
    root.querySelector<HTMLButtonElement>('.select-image')!.click();
    expect(root.textContent).toContain('Este aplicativo não consegue validar o conteúdo visual');
    expect(callServerTool).not.toHaveBeenCalled();
    expect(updateModelContext).not.toHaveBeenCalled();
  });

  it.each(['missing', 'mime', 'bytes', 'decode', 'pixels'])('keeps visual context unconfirmed for %s media failures', async failure => {
    const { root, bridge, dom, callServerTool, updateModelContext } = setup();
    bridge.ontoolresult!(result([selectable()]));
    const response = selection();
    if (failure === 'mime') response._meta.selection.content[0].mimeType = 'image/svg+xml';
    if (failure === 'bytes') response._meta.selection.content[0].data = 'a'.repeat(6990512);
    if (failure === 'decode') vi.mocked(dom.window.createImageBitmap).mockRejectedValueOnce(new Error('invalid image'));
    if (failure === 'pixels') vi.mocked(dom.window.createImageBitmap).mockResolvedValueOnce({ width: 4097, height: 4097, close: vi.fn() });
    callServerTool.mockResolvedValueOnce(failure === 'missing' ? { isError: true, content: [{ type: 'text', text: 'signature=private' }] } : response);
    root.querySelector<HTMLButtonElement>('.select-image')!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Não foi possível selecionar esta imagem'));
    expect(updateModelContext).not.toHaveBeenCalled();
    expect(root.querySelector('[aria-pressed="true"]')).toBeNull();
    expect(root.textContent).not.toContain('signature=private');
  });

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
