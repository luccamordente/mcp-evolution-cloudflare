import type { App } from '@modelcontextprotocol/ext-apps';
import { SEND_RECEIPT_LABELS, type SendReceipt } from '../src/lib/send-receipt';

export type SendReceiptBridge = Pick<App, 'ontoolinput' | 'ontoolresult' | 'ontoolcancelled'>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** One attempt per mount; displaying a result never invokes a server tool. */
export function mountSendReceipt(root: HTMLElement, bridge: SendReceiptBridge) {
  const doc = root.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', content = '') => {
    const node = doc.createElement(tag);
    node.className = className;
    node.textContent = content;
    return node;
  };
  const header = el('header', 'receipt-header');
  header.appendChild(el('p', 'receipt-brand', 'WaPilot'));
  header.appendChild(el('h1', '', 'Comprovante de envio'));
  const status = el('p', 'receipt-status', 'Aguardando resultado do envio…');
  status.setAttribute('role', 'status');
  const context = el('dl', 'receipt-context');
  const bubble = el('article', 'message-bubble');
  const reply = el('p', 'message-reply', 'Em resposta a uma mensagem');
  reply.hidden = true;
  const message = el('div', 'message-text');
  message.dir = 'auto';
  bubble.appendChild(reply);
  bubble.appendChild(message);
  bubble.hidden = true;
  const note = el('p', 'receipt-note');
  root.replaceChildren(header, status, context, bubble, note);
  root.dataset.state = 'waiting';
  let input: Pick<SendReceipt, 'text' | 'to' | 'isReply'> = { text: '', to: '' };
  let confirmed = false;

  function render(receipt: SendReceipt) {
    confirmed = receipt.state === 'accepted' || receipt.state === 'failed';
    root.dataset.state = receipt.state;
    status.textContent = SEND_RECEIPT_LABELS[receipt.state];
    context.replaceChildren(el('dt', '', 'Destinatário'), el('dd', '', receipt.to || 'Não informado'), el('dt', '', 'Conexão'), el('dd', '', receipt.connectionName || 'Não resolvida'));
    reply.hidden = receipt.isReply !== true;
    message.textContent = receipt.text;
    bubble.hidden = false;
    note.textContent = receipt.state === 'accepted'
      ? 'O aceite não comprova entrega nem leitura pelo destinatário.'
      : receipt.state === 'failed' ? 'A tentativa foi interrompida antes de chamar o envio.'
      : 'A mensagem pode ter sido enviada. Não repita automaticamente. O histórico parcial não comprova ausência de envio.';
  }
  function unknown() {
    if (!confirmed) render({ ...input, state: 'unknown' });
  }
  bridge.ontoolinput = ({ arguments: args }) => {
    input = { text: typeof args?.text === 'string' ? args.text : '', to: typeof args?.to === 'string' ? args.to : '', isReply: typeof args?.messageId === 'string' && args.messageId.length > 0 };
  };
  bridge.ontoolresult = result => {
    const receipt = record(result._meta?.sendReceipt);
    if (!receipt || typeof receipt.text !== 'string' || typeof receipt.to !== 'string' || !['accepted', 'failed', 'unknown'].includes(String(receipt.state))) {
      unknown();
      return;
    }
    render({ text: receipt.text, to: receipt.to, connectionName: typeof receipt.connectionName === 'string' ? receipt.connectionName : undefined, state: receipt.state as SendReceipt['state'], isReply: receipt.isReply === true });
  };
  bridge.ontoolcancelled = unknown;
  return { showError: unknown };
}
