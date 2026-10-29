import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvolutionGoClient } from '../src/lib/evolution';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ZkAAAAASUVORK5CYII=', 'base64');
const origins = ['https://storage.example.test'];
const signedUrl = `${origins[0]}/image.png?signature=private-link`;
const stored = (url = signedUrl, mimeType = 'image/png') => ({ type: 'message', id: 'image-1', attributes: { encodingFormat: mimeType, body: { media: { url } } } });
function imageClient(data: unknown = stored()) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data }));
  fetcher.mockImplementation(async () => new Response(png));
  const client = new EvolutionGoClient({ baseUrl: 'https://provider.invalid', instanceId: 'instance-1', instanceToken: 'instance-secret', globalApiKey: 'global-secret', fetcher });
  return { client, fetcher, read: (max = 1024) => client.getMessageImage('image-1', origins, max) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('retained image HTTP boundary', () => {
  it('uses the real message lookup contract and downloads image bytes without forwarding credentials', async () => {
    const { read, fetcher } = imageClient();
    expect(await read()).toEqual({ mimeType: 'image/png', data: png.toString('base64') });
    expect(fetcher.mock.calls[0][0]).toBe('https://provider.invalid/message/status');
    expect(fetcher.mock.calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ data: { type: 'message', id: 'image-1' } });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('apikey')).toBe('instance-secret');
    expect(fetcher.mock.calls[1][0]).toBe(signedUrl);
    expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: 'error', credentials: 'omit' });
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('apikey')).toBeNull();
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('authorization')).toBeNull();
  });

  it.each([
    ['image/jpeg', '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AD//Z'],
    ['image/webp', 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vz0AAA='],
  ])('returns supported %s image bytes', async (mime, data) => {
    const { read, fetcher } = imageClient(stored(signedUrl, mime));
    fetcher.mockResolvedValue(new Response(Buffer.from(data, 'base64')));
    expect(await read()).toEqual({ mimeType: mime, data });
  });

  it.each([
    ['https://attacker.example/a.png', 'image/png'],
    ['https://storage.example.test.attacker.example/a.png', 'image/png'],
    ['http://storage.example.test/a.png', 'image/png'],
    ['https://user:password@storage.example.test/a.png', 'image/png'],
    ['https://storage.example.test/a.svg', 'image/png'],
    ['https://storage.example.test/a.html', 'image/png'],
    ['data:image/png;base64,AAAA', 'image/png'],
    [signedUrl, 'image/svg+xml'],
    [signedUrl, 'image/gif'],
    [signedUrl, 'image/avif'],
  ])('rejects unsafe URL or unsupported format before downloading: %s (%s)', async (url, mime) => {
    const { read, fetcher } = imageClient(stored(url, mime));
    await expect(read()).rejects.toThrow(/WaPilot/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects missing or mismatched messages and fails closed without approved storage', async () => {
    for (const data of [null, { ...stored(), id: 'different-message' }, { type: 'message', id: 'image-1' }]) {
      const { read, fetcher } = imageClient(data);
      await expect(read()).rejects.toThrow(/WaPilot/);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const { client, fetcher } = imageClient();
    await expect(client.getMessageImage('image-1', [], 1024)).rejects.toThrow(/WaPilot cannot access/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('enforces the byte limit with content-length present=%s', async (withLength) => {
    const { read, fetcher } = imageClient();
    fetcher.mockResolvedValue(new Response(png, withLength ? { headers: { 'content-length': '4096' } } : {}));
    await expect(read(png.length - 1)).rejects.toMatchObject({ status: 413 });
    expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true);
  });

  it('rejects non-image bytes despite a claimed image MIME type', async () => {
    const { read, fetcher } = imageClient();
    fetcher.mockResolvedValue(new Response('<html>login page</html>', { headers: { 'content-type': 'image/png' } }));
    await expect(read()).rejects.toMatchObject({ status: 415 });
  });

  it('does not follow a redirect to an unapproved host', async () => {
    const { read, fetcher } = imageClient();
    fetcher.mockResolvedValue(new Response(null, { status: 302, headers: { location: 'https://attacker.example' } }));
    await expect(read()).rejects.toMatchObject({ status: 502 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]?.redirect).toBe('error');
  });

  it('replaces private network and message-lookup errors with fixed product messages', async () => {
    const network = imageClient();
    network.fetcher.mockRejectedValue(new Error(`Media exceeds configured limit ${signedUrl} token=instance-secret`));
    await expect(network.read()).rejects.toThrow('WaPilot could not load the image from storage.');
    const metadata = imageClient();
    metadata.fetcher.mockReset().mockResolvedValue(Response.json({ jsonapi: { version: '1.1' }, errors: [{ detail: signedUrl }] }, { status: 503 }));
    await expect(metadata.read()).rejects.toThrow('WaPilot could not retrieve the requested message (HTTP 503).');
  });

  it.each([408, 504])('distinguishes a storage HTTP %s timeout from the local deadline', async (status) => {
    const { read, fetcher } = imageClient();
    fetcher.mockResolvedValue(new Response('private body', { status }));
    await expect(read()).rejects.toMatchObject({ status, timeoutSource: 'upstream' });
  });

  it('keeps the local deadline active while reading image bytes', async () => {
    vi.useFakeTimers();
    const { read, fetcher } = imageClient();
    fetcher.mockImplementation(async (_url, init) => new Response(new ReadableStream({ start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new Error('private storage error')));
    } })));
    const failure = expect(read()).rejects.toMatchObject({ status: 504, timeoutSource: 'wapilot' });
    await vi.advanceTimersByTimeAsync(8_000);
    await failure;
  });
});
