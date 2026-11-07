import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { mountSendReceipt, type SendReceiptBridge } from '../ui/send-receipt';

function setup() {
  const dom = new JSDOM('<main id="receipt"></main>');
  const root = dom.window.document.querySelector('main')!;
  const callServerTool = vi.fn();
  const bridge: SendReceiptBridge & { callServerTool: typeof callServerTool } = { ontoolinput: undefined, ontoolresult: undefined, ontoolcancelled: undefined, callServerTool };
  const view = mountSendReceipt(root, bridge);
  return { root, bridge, callServerTool, view };
}

const result = (state = 'accepted', text = '  Olá 👋\n<img src=x onerror=alert(1)>  ') => ({ content: [], _meta: { sendReceipt: { state, text, to: '5511999999999', connectionName: 'Pessoal' } } });

describe('send receipt host bridge and presentation', () => {
  it('shows the attempt content and account as safe, exact text without offering actions or replaying on restoration', () => {
    const { root, bridge, callServerTool } = setup();
    const payload = result();
    bridge.ontoolresult!(payload);
    expect(root.textContent).toContain('WaPilot');
    expect(root.textContent).toContain('Comprovante de envio');
    expect(root.textContent).toContain('Envio aceito');
    expect(root.textContent).toContain('5511999999999');
    expect(root.textContent).toContain('Pessoal');
    expect(root.querySelector('.message-text')!.textContent).toBe(payload._meta.sendReceipt.text);
    expect(root.querySelector('img, script, iframe, button, a, [onerror]')).toBeNull();
    expect(root.textContent).toContain('não comprova entrega nem leitura');
    const restored = setup();
    restored.bridge.ontoolresult!(payload);
    bridge.ontoolresult!(payload);
    expect(restored.root.textContent).toBe(root.textContent);
    expect(callServerTool).not.toHaveBeenCalled();
    expect(restored.callServerTool).not.toHaveBeenCalled();
  });
  it('marks a reply separately from its new text and keeps new-message receipts independent', () => {
    const reply = setup();
    const fresh = setup();
    const text = '> Uma citação dentro da resposta\nTexto novo 👋';
    const payload = { ...result('accepted', text), _meta: { sendReceipt: { ...result('accepted', text)._meta.sendReceipt, isReply: true } } };
    reply.bridge.ontoolresult!(payload);
    fresh.bridge.ontoolresult!(result('accepted', 'Mensagem nova'));
    expect(reply.root.querySelector('.message-reply')!.textContent).toBe('Em resposta a uma mensagem');
    expect(reply.root.querySelector('.message-text')!.textContent).toBe(text);
    expect(reply.root.querySelector('.message-reply')!.hasAttribute('hidden')).toBe(false);
    expect(fresh.root.querySelector('.message-reply')!.hasAttribute('hidden')).toBe(true);
    const restored = setup();
    restored.bridge.ontoolresult!(payload);
    expect(restored.root.textContent).toBe(reply.root.textContent);
    expect(reply.callServerTool).not.toHaveBeenCalled();
    expect(restored.callServerTool).not.toHaveBeenCalled();
    expect(fresh.callServerTool).not.toHaveBeenCalled();
    const interrupted = setup();
    interrupted.bridge.ontoolinput!({ arguments: { to: 'destino', text: 'Resposta interrompida', messageId: 'original-id' } });
    interrupted.bridge.ontoolcancelled!({ reason: 'private-cancellation' });
    expect(interrupted.root.dataset.state).toBe('unknown');
    expect(interrupted.root.querySelector('.message-reply')!.hasAttribute('hidden')).toBe(false);
    expect(interrupted.root.querySelector('.message-text')!.textContent).toBe('Resposta interrompida');
    expect(interrupted.callServerTool).not.toHaveBeenCalled();
  });
  it.each([['failed', 'Falha confirmada'], ['unknown', 'Não foi possível confirmar o envio']])('distinguishes %s by text without suggesting delivery, retry or editing', (state, label) => {
    const { root, bridge, callServerTool } = setup();
    bridge.ontoolresult!(result(state));
    expect(root.dataset.state).toBe(state);
    expect(root.querySelector('[role="status"]')!.textContent).toBe(label);
    expect(root.querySelector('button, input, textarea')).toBeNull();
    expect(callServerTool).not.toHaveBeenCalled();
  });

  it('keeps an interrupted attempt unknown, but never overwrites a confirmed acceptance on cancellation or bridge failure', () => {
    const { root, bridge, view } = setup();
    bridge.ontoolinput!({ arguments: { to: 'destino', text: 'Meu texto' } });
    expect(root.querySelector('.message-bubble')!.hasAttribute('hidden')).toBe(true);
    bridge.ontoolcancelled!({ reason: 'private-host-error' });
    expect(root.dataset.state).toBe('unknown');
    expect(root.querySelector('.message-text')!.textContent).toBe('Meu texto');
    expect(root.textContent).not.toContain('private-host-error');
    bridge.ontoolresult!(result());
    bridge.ontoolcancelled!({ reason: 'private-host-error' });
    view.showError();
    expect(root.dataset.state).toBe('accepted');
    expect(root.textContent).toContain('Envio aceito');
  });

  it('does not infer confirmed failure from isError and does not mix independent receipt mounts', () => {
    const first = setup();
    const second = setup();
    first.bridge.ontoolresult!(result('accepted', 'Primeira'));
    second.bridge.ontoolinput!({ arguments: { to: 'outro', text: 'Segunda' } });
    second.bridge.ontoolresult!({ isError: true, content: [{ type: 'text', text: 'private-result' }] });
    expect(second.root.dataset.state).toBe('unknown');
    expect(second.root.textContent).not.toMatch(/Primeira|private-result/);
    expect(first.root.textContent).not.toContain('Segunda');
  });

  it('shows all 10,000 characters, whitespace, emoji and long URLs without a collapsed region', () => {
    const { root, bridge } = setup();
    const text = '  👋\nhttps://example.test/'.padEnd(10000, 'a');
    bridge.ontoolresult!(result('accepted', text));
    expect(root.querySelector('.message-text')!.textContent).toBe(text);
    expect(root.querySelector('details, button, [aria-expanded]')).toBeNull();
  });
});
