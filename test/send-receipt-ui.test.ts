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
  it('shows WhatsApp inline emphasis and keeps code literal without executing message HTML', () => {
    const { root, bridge } = setup();
    bridge.ontoolresult!(result('accepted', '*Negrito* _Itálico_ ~Tachado~ `*literal*` ```_mono_``` <img src=x>'));
    const message = root.querySelector('.message-text')!;
    expect(message.querySelector('strong')?.textContent).toBe('Negrito');
    expect(message.querySelector('em')?.textContent).toBe('Itálico');
    expect(message.querySelector('s')?.textContent).toBe('Tachado');
    expect([...message.querySelectorAll('code')].map(node => node.textContent)).toEqual(['*literal*', '_mono_']);
    expect(message.textContent).toBe('Negrito Itálico Tachado *literal* _mono_ <img src=x>');
    expect(message.querySelector('img')).toBeNull();
  });

  it('shows lists and block quotes while protecting every line of monospace content', () => {
    const { root, bridge } = setup();
    const text = '- *Primeiro*\n* Segundo\n3. Terceiro\n4. Quarto\n> _Citação_\n```*literal*\n- não é lista\n> não é citação```';
    bridge.ontoolresult!(result('accepted', text));
    const message = root.querySelector('.message-text')!;
    expect([...message.querySelectorAll('ul li')].map(node => node.textContent)).toEqual(['Primeiro', 'Segundo']);
    expect([...message.querySelectorAll('ol li')].map(node => node.textContent)).toEqual(['Terceiro', 'Quarto']);
    expect(message.querySelector('ol')?.getAttribute('start')).toBe('3');
    expect(message.querySelector('blockquote em')?.textContent).toBe('Citação');
    expect([...message.querySelectorAll('code')].map(node => node.textContent).join('\n')).toBe('*literal*\n- não é lista\n> não é citação');
    expect(message.querySelectorAll('blockquote')).toHaveLength(1);
  });

  it('preserves unsupported list numbers literally and keeps the largest supported marker', () => {
    const { root, bridge } = setup();
    bridge.ontoolresult!(result('accepted', '2147483647. Limite\n2147483648. Acima\n999999999999999999999999999999. Enorme\n01. Zero inicial\n1.Sem espaço'));
    const message = root.querySelector('.message-text')!;
    expect(message.textContent).toBe('Limite\n2147483648. Acima\n999999999999999999999999999999. Enorme\n01. Zero inicial\n1.Sem espaço');
    expect(message.querySelectorAll('ol li')).toHaveLength(1);
    expect((message.querySelector('ol') as HTMLOListElement).start).toBe(2147483647);
    expect((message.querySelector('ol li') as HTMLLIElement).value).toBe(2147483647);
  });

  it('preserves whitespace, unknown syntax and incomplete markers and supports nested distinct emphasis', () => {
    const { root, bridge } = setup();
    const literal = '  👋\t# Título\n\n**duplo** foo_bar_baz [link](https://example.test)\n*incompleto _ incompleto ~ `aberto ```aberto';
    bridge.ontoolresult!(result('accepted', literal));
    expect(root.querySelector('.message-text')!.textContent).toBe(literal);
    expect(root.querySelector('.message-text strong, .message-text em, .message-text s, .message-text code, .message-text a, .message-text h1')).toBeNull();
    bridge.ontoolresult!(result('accepted', '*_ênfase combinada_* ~*revisado*~'));
    expect(root.querySelector('strong em')?.textContent).toBe('ênfase combinada');
    expect(root.querySelector('s strong')?.textContent).toBe('revisado');
  });

  it('does not interpret emphasis across literal code or block prefixes inside multiline code', () => {
    const { root, bridge } = setup();
    bridge.ontoolresult!(result('accepted', '*antes `*literal*` depois*\n```- literal\n1. literal\n> literal```'));
    const message = root.querySelector('.message-text')!;
    expect(message.querySelector('strong, li, blockquote')).toBeNull();
    expect(message.textContent).toBe('*antes *literal* depois*\n- literal\n1. literal\n> literal');
  });

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
    expect(reply.root.querySelector('.message-text')!.textContent).toBe('Uma citação dentro da resposta\nTexto novo 👋');
    expect(reply.root.querySelector('blockquote')?.textContent).toBe('Uma citação dentro da resposta');
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

  it('preserves a restored unknown receipt on cancellation and bridge failure without replaying it', () => {
    const { root, bridge, view, callServerTool } = setup();
    const payload = { ...result('unknown', 'Texto restaurado 👋'), _meta: { sendReceipt: { ...result('unknown', 'Texto restaurado 👋')._meta.sendReceipt, isReply: true } } };
    bridge.ontoolresult!(payload);
    const restored = root.textContent;
    bridge.ontoolcancelled!({ reason: 'private-host-error' });
    expect(root.textContent).toBe(restored);
    view.showError();
    expect(root.textContent).toBe(restored);
    expect(root.dataset.state).toBe('unknown');
    expect(root.querySelector('.message-reply')!.hasAttribute('hidden')).toBe(false);
    expect(callServerTool).not.toHaveBeenCalled();
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

  it('keeps the entire formatted message at the 10,000 character limit', () => {
    const { root, bridge } = setup();
    const code = 'https://example.test/'.padEnd(9994, 'a');
    bridge.ontoolresult!(result('accepted', '```' + code + '```'));
    expect(root.querySelector('code')?.textContent).toBe(code);
    expect(root.querySelector('.message-text')!.textContent).toHaveLength(9994);
    expect(root.querySelector('details, button, [aria-expanded]')).toBeNull();
  });

  it('shows all 10,000 characters, whitespace, emoji and long URLs without a collapsed region', () => {
    const { root, bridge } = setup();
    const text = '  👋\nhttps://example.test/'.padEnd(10000, 'a');
    bridge.ontoolresult!(result('accepted', text));
    expect(root.querySelector('.message-text')!.textContent).toBe(text);
    expect(root.querySelector('details, button, [aria-expanded]')).toBeNull();
  });
});
