import type { App } from '@modelcontextprotocol/ext-apps';
import { SEND_RECEIPT_LABELS, type SendReceipt } from '../src/lib/send-receipt';

export type SendReceiptBridge = Pick<App, 'ontoolinput' | 'ontoolresult' | 'ontoolcancelled'>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

type TextPart = { text: string; code: boolean };

function codeParts(text: string): TextPart[] {
  const runs = [...text.matchAll(/`+/g)];
  const parts: TextPart[] = [];
  let position = 0;
  for (let i = 0; i < runs.length; i++) {
    const opener = runs[i];
    if (opener[0].length !== 1 && opener[0].length !== 3) continue;
    const closerIndex = runs.findIndex((run, index) => index > i && run[0] === opener[0]);
    if (closerIndex < 0) continue;
    const closer = runs[closerIndex];
    const content = text.slice(opener.index + opener[0].length, closer.index);
    if (opener[0].length === 1 && content.includes('\n')) continue;
    parts.push({ text: text.slice(position, opener.index), code: false }, { text: content, code: true });
    position = closer.index + closer[0].length;
    i = closerIndex;
  }
  parts.push({ text: text.slice(position), code: false });
  return parts;
}

function appendInline(parent: HTMLElement, text: string, active = '') {
  const doc = parent.ownerDocument;
  const tags = { '*': 'strong', '_': 'em', '~': 's' } as const;
  let plain = '';
  const flush = () => { parent.appendChild(doc.createTextNode(plain)); plain = ''; };
  for (let i = 0; i < text.length;) {
    const marker = text[i];
    const run = text.slice(i).match(/^([*_~])\1*/)?.[0];
    if (run && run.length > 1) { plain += run; i += run.length; continue; }
    if (marker in tags && !active.includes(marker) && !/[\p{L}\p{N}_]/u.test(text[i - 1] ?? '') && /\S/.test(text[i + 1] ?? '')) {
      let end = text.indexOf(marker, i + 1);
      while (end >= 0 && (text[end - 1] === marker || /\s/.test(text[end - 1]) || /[\p{L}\p{N}_]/u.test(text[end + 1] ?? '') || text[end + 1] === marker)) end = text.indexOf(marker, end + 1);
      if (end >= 0) {
        flush();
        const element = doc.createElement(tags[marker as keyof typeof tags]);
        appendInline(element, text.slice(i + 1, end), active + marker);
        parent.appendChild(element);
        i = end + 1;
        continue;
      }
    }
    plain += marker; i++;
  }
  flush();
}

function appendFormatted(parent: HTMLElement, text: string) {
  const doc = parent.ownerDocument;
  const lines: TextPart[][] = [[]];
  for (const part of codeParts(text)) {
    part.text.split('\n').forEach((line, index) => {
      if (index) lines.push([]);
      lines[lines.length - 1].push({ text: line, code: part.code });
    });
  }
  let list: HTMLUListElement | HTMLOListElement | undefined;
  lines.forEach((parts, index) => {
    if (index) (list ?? parent).appendChild(doc.createTextNode('\n'));
    const first = parts[0];
    const prefix = first && !first.code ? first.text.match(/^([-*] |(\d+)\. |> )/) : null;
    const listTag = prefix && prefix[0] !== '> ' ? prefix[2] ? 'ol' : 'ul' : undefined;
    let line: HTMLElement;
    if (listTag) {
      if (!list || list.localName !== listTag) {
        list = doc.createElement(listTag);
        if (listTag === 'ol') list.setAttribute('start', prefix![2]);
        parent.appendChild(list);
      }
      line = doc.createElement('li');
      if (listTag === 'ol') line.setAttribute('value', prefix![2]);
      list.appendChild(line);
    } else {
      list = undefined;
      line = doc.createElement(prefix ? 'blockquote' : 'div');
      parent.appendChild(line);
    }
    line.className = 'message-line';
    parts.forEach((part, partIndex) => {
      const content = prefix && partIndex === 0 ? part.text.slice(prefix[0].length) : part.text;
      if (part.code) {
        const code = doc.createElement('code');
        code.textContent = content;
        line.appendChild(code);
      } else appendInline(line, content);
    });
  });
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
    message.replaceChildren();
    appendFormatted(message, receipt.text);
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
