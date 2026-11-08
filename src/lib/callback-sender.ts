import type { Env } from '../types';

export interface CallbackRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

export interface CallbackResponse {
  status: number;
  body: string;
  bodyTruncated?: boolean;
}

export class CallbackSenderError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(readonly reason: 'unavailable' | 'timeout' | 'destination_blocked' | 'invalid_request' = 'unavailable') {
    super('WaPilot could not reach the callback sender.');
    this.status = reason === 'timeout' ? 504 : reason === 'unavailable' ? 503 : 400;
    this.code = `sender_${reason}`;
  }
}

export async function sendCallback(env: Pick<Env, 'CALLBACK_SENDER'>, input: CallbackRequest, deadlineAt=Date.now()+45_000): Promise<CallbackResponse> {
  if (!env.CALLBACK_SENDER) throw new CallbackSenderError();
  const until=Math.min(deadlineAt,Date.now()+45_000),remaining=until-Date.now();
  if (!Number.isSafeInteger(until)) throw new CallbackSenderError('invalid_request');
  if (remaining<=0) throw new CallbackSenderError('timeout');
  const deadline = AbortSignal.timeout(remaining);
  try {
    const response = await env.CALLBACK_SENDER.getByName('shared').fetch('http://sender/send', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-wapilot-deadline':String(until) }, body: JSON.stringify(input),signal:deadline,
    });
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = '', bytes = 0;
    if (reader) {
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 128 * 1024) throw new CallbackSenderError();
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { await reader.cancel(); }
    }
    const data = JSON.parse(text);
    if (response.status !== 200) {
      const reason = data?.error === 'callback_timeout' ? 'timeout'
        : data?.error === 'destination_blocked' ? 'destination_blocked'
        : data?.error === 'invalid_request' ? 'invalid_request' : 'unavailable';
      throw new CallbackSenderError(reason);
    }
    if (!Number.isInteger(data?.status) || data.status < 100 || data.status > 599 || typeof data.body !== 'string'
      || data.body.length > 16 * 1024 || (data.bodyTruncated !== undefined && typeof data.bodyTruncated !== 'boolean')) throw new CallbackSenderError();
    return { status: data.status, body: data.body, ...(data.bodyTruncated ? { bodyTruncated: true } : {}) };
  } catch (error) {
    if (error instanceof CallbackSenderError) throw error;
    throw new CallbackSenderError(deadline.aborted ? 'timeout' : 'unavailable');
  }
}
