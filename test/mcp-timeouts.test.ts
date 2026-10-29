import { describe, expect, it, vi } from 'vitest';
import { EvolutionGoClient } from '../src/lib/evolution';
import { classifyMcpError } from '../src/lib/mcp';

describe('MCP timeout attribution', () => {
  it.each(['read', 'write'])('attributes the local %s deadline to WaPilot without replaying the request', async (kind) => {
    const fetcher = vi.fn<typeof fetch>(async (_request, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'instance-1', instanceToken: 'private-token', timeoutMs: 10, fetcher });
    const operation = kind === 'read' ? 'connection_status' : 'send_text';
    const error = await (kind === 'read' ? client.status() : client.sendText('5511999999999', 'Private text')).catch(error => error);
    const classified = classifyMcpError(error, operation);

    expect(classified).toMatchObject({ code: 'wapilot_timeout', status: 504, retryable: true, operation });
    expect(classified.message).toContain('WaPilot');
    expect(classified.message).toContain('10 ms');
    expect(classified.message).toContain('outcome is unknown');
    expect(classified.hint).toContain('writes must not be replayed automatically');
    expect(JSON.stringify(classified)).not.toMatch(/Evolution|private-token|Private text|evolution.invalid/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([408, 504])('identifies a timeout response (HTTP %s) separately from the local deadline', async (status) => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('sensitive upstream timeout body', { status }));
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'instance-1', instanceToken: 'private-token', fetcher });
    const error = await client.sendText('5511999999999', 'Private text').catch(error => error);
    const classified = classifyMcpError(error, 'send_text');

    expect(classified).toMatchObject({ code: 'upstream_timeout', status, retryable: true, operation: 'send_text' });
    expect(classified.message).toContain(`HTTP ${status}`);
    expect(classified.message).toContain('returned a timeout response');
    expect(classified.message).toContain('WaPilot');
    expect(classified.hint).toContain('writes must not be replayed automatically');
    expect(JSON.stringify(classified)).not.toMatch(/Evolution|sensitive|private-token|Private text/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports the local deadline even when a previous attempt received an upstream timeout', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 504 }))
      .mockImplementation(async (_request, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }));
    const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'instance-1', instanceToken: 'private-token', timeoutMs: 10, fetcher });
    const error = await client.status().catch(error => error);
    expect(classifyMcpError(error, 'connection_status')).toMatchObject({ code: 'wapilot_timeout', status: 504 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
