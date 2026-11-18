import { describe, expect, it, vi } from 'vitest';
import worker from '../src/worker';
import type { Env } from '../src/types';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {}, WorkerEntrypoint: class {} }));

const env = { MCP_PUBLIC_URL: 'https://app.wapilot.com.br' } as Env;
const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;

describe('Worker request origin', () => {
  it.each(['GET', 'POST'])('upgrades public HTTP %s before constructing the OAuth provider', async (method) => {
    const request = new Request('http://app.wapilot.com.br/mcp?fixture=1', { method, ...(method === 'POST' ? { body: 'synthetic-body' } : {}) });
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe('https://app.wapilot.com.br/mcp?fixture=1');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    if (method === 'POST') expect(await request.text()).toBe('synthetic-body');
  });

  it.each(['127.example.test', 'localhost.example.test'])('upgrades public lookalike host %s', async (host) => {
    const response = await worker.fetch(new Request(`http://${host}/`), env, ctx);
    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe(`https://${host}/`);
  });

  it.each(['https://app.wapilot.com.br', 'https://alternate.workers.dev', 'http://localhost:8787', 'http://127.0.0.1:8787', 'http://127.0.0.2:8787', 'http://[::1]:8787'])('preserves discovery on %s', async (origin) => {
    const response = await worker.fetch(new Request(`${origin}/.well-known/oauth-protected-resource/mcp`), { ...env, MCP_PUBLIC_URL: origin }, ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resource: `${origin}/mcp` });
  });
});
