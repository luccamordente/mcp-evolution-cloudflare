import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types';

const IDLE_MS = 60_000;

export class CallbackSender extends DurableObject<Env> {
  #starting?: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(IDLE_MS));
  }

  async #token(): Promise<string> {
    if (!this.env.TOKEN_ENCRYPTION_KEY) throw new Error('Callback sender is not configured');
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(this.env.TOKEN_ENCRYPTION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const token = await crypto.subtle.sign('HMAC', key, encoder.encode('WaPilot callback sender v1'));
    return Array.from(new Uint8Array(token), b => b.toString(16).padStart(2, '0')).join('');
  }

  async #ready(): Promise<void> {
    const container = this.ctx.container;
    if (!container) throw new Error('Callback sender is not configured');
    if (!this.#starting) {
      this.#starting = (async () => {
        const deadline = new AbortController();
        const timer = setTimeout(() => deadline.abort(new DOMException('Sender readiness timed out', 'TimeoutError')), 30_000);
        const signal = deadline.signal;
        try {
          if (!container.running) {
            container.start({ image: container.images.sender, instance: 'lite', enableInternet: true,
              env: { CALLBACK_SENDER_TOKEN: await this.#token() } });
          }
          await container.setInactivityTimeout(IDLE_MS);
          while (!signal.aborted) {
            try {
              const response = await container.getTcpPort(8080).fetch('http://sender/healthz', { signal });
              if (response.ok && (await response.json<{ ok?: boolean }>()).ok === true) return;
            } catch { signal.throwIfAborted(); }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          signal.throwIfAborted();
        } finally { clearTimeout(timer); }
      })().finally(() => { this.#starting = undefined; });
    }
    return this.#starting;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/send') return new Response('Not found', { status: 404 });
    const header=request.headers.get('x-wapilot-deadline'),deadlineAt=Number(header);
    if (!header || !/^\d+$/.test(header) || !Number.isSafeInteger(deadlineAt) || deadlineAt<=0) return Response.json({error:'invalid_request'},{status:400});
    const until=Math.min(deadlineAt,Date.now()+45_000),remaining=until-Date.now();
    if (remaining<=0) return Response.json({error:'callback_timeout'},{status:504});
    const caller=new AbortController();
    const callerTimer=setTimeout(()=>caller.abort(new DOMException('Sender request timed out','TimeoutError')),remaining);
    const signal=AbortSignal.any([request.signal,caller.signal]);
    let onAbort:(()=>void)|undefined;
    try {
      const aborted=new Promise<never>((_,reject)=>{onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});});
      signal.throwIfAborted();
      // Shared startup may serve other callers; an expired caller must never start a POST.
      await Promise.race([this.#ready(),aborted]);
      const authorization = `Bearer ${await this.#token()}`;
      signal.throwIfAborted();
      if (Date.now()>=until) throw new DOMException('Sender request timed out','TimeoutError');
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(new DOMException('Sender request timed out', 'TimeoutError')), 12_000);
      try { return await this.ctx.container!.getTcpPort(8080).fetch('http://sender/send', {
        method: 'POST', body: request.body, headers: { authorization, 'content-type': 'application/json','x-wapilot-deadline':String(until) },
        signal: AbortSignal.any([signal, deadline.signal]),
      }); } finally { clearTimeout(timer); }
    } catch (error) {
      const timeout = signal.aborted || error instanceof Error && error.name === 'TimeoutError';
      return Response.json({ error: timeout ? 'callback_timeout' : 'sender_unavailable' }, { status: timeout ? 504 : 503 });
    } finally {clearTimeout(callerTimer);if (onAbort) signal.removeEventListener('abort',onAbort);}
  }
}
