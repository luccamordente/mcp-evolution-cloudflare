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
    let prefix = first && !first.code ? first.text.match(/^([-*] |(\d+)\. |> )/) : null;
    // Native list markers use signed 32-bit integers and discard leading zeros.
    if (prefix?.[2] && (Number(prefix[2]) > 2147483647 || String(Number(prefix[2])) !== prefix[2])) prefix = null;
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
  const bubble = el('article', 'message-bubble');
  bubble.setAttribute('aria-label', 'Comprovante de envio');
  const message = el('div', 'message-text');
  message.dir = 'auto';
  bubble.appendChild(message);
  const metadata = el('footer', 'message-meta');
  metadata.setAttribute('role', 'status');
  bubble.appendChild(metadata);
  bubble.hidden = true;
  root.replaceChildren(bubble);
  root.dataset.state = 'waiting';
  let input: Pick<SendReceipt, 'text' | 'to'> = { text: '', to: '' };
  let lastReceipt: SendReceipt | undefined;
  let confirmed = false;

  function render(receipt: SendReceipt) {
    lastReceipt = receipt;
    confirmed = receipt.state === 'accepted' || receipt.state === 'failed';
    root.dataset.state = receipt.state;
    message.replaceChildren();
    appendFormatted(message, receipt.text);
    bubble.hidden = false;
    metadata.replaceChildren();
    if (receipt.state === 'accepted') {
      const date = receipt.sentAt ? new Date(receipt.sentAt) : undefined;
      if (date && Number.isFinite(date.getTime())) {
        const time = el('time', '', new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date));
        time.dateTime = date.toISOString();
        metadata.appendChild(time);
      }
      const check = el('span', 'message-check', '✓');
      check.setAttribute('role', 'img');
      check.setAttribute('aria-label', 'Envio aceito');
      check.title = 'Envio aceito; não confirma entrega nem leitura.';
      metadata.appendChild(check);
    } else metadata.textContent = SEND_RECEIPT_LABELS[receipt.state];
  }
  function unknown() {
    if (!confirmed) render({ ...(lastReceipt ?? input), state: 'unknown' });
  }
  bridge.ontoolinput = ({ arguments: args }) => {
    input = { text: typeof args?.text === 'string' ? args.text : '', to: typeof args?.to === 'string' ? args.to : '' };
  };
  bridge.ontoolresult = result => {
    const receipt = record(result._meta?.sendReceipt);
    if (!receipt || typeof receipt.text !== 'string' || typeof receipt.to !== 'string' || !['accepted', 'failed', 'unknown'].includes(String(receipt.state))) {
      unknown();
      return;
    }
    render({ text: receipt.text, to: receipt.to, state: receipt.state as SendReceipt['state'], sentAt: typeof receipt.sentAt === 'string' ? receipt.sentAt : undefined });
  };
  bridge.ontoolcancelled = unknown;
  return { showError: unknown };
}
