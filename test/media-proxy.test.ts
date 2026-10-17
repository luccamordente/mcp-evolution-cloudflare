import { describe, expect, it, vi } from 'vitest';
import {
  MEDIA_PROXY_HOST,
  handleMediaProxyRequest,
  rewriteMediaUrl,
  rewriteMediaUrls,
  stripTrackingParameters,
} from '../src/lib/media-proxy';

const signedQuery = 'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=GOOG1ESNAAIQFC2YGK2MV7HDUAD2SCJEU765I2DUZFYEJFKJIINFIE3FQLIQX%2F20261016%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261016T175902Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=d4a65594f205e8a83041b5da89917f68146e70f218dca05dfb1eedce66605b44';
const rawUrl = `https://neurau.com.br/attachment-storage-production/evolution-go-medias/3AABE8E5CA8FA9088D98.jpg?${signedQuery}`;

describe('media tracking proxy', () => {
  it('rewrites raw storage URLs while appending tracking after the signed query', () => {
    const rewritten = rewriteMediaUrl(rawUrl);
    expect(rewritten).toBe(`https://${MEDIA_PROXY_HOST}/attachment-storage-production/evolution-go-medias/3AABE8E5CA8FA9088D98.jpg?${signedQuery}&utm_source=chatgpt`);
    expect(rewritten.split('?')[1].split('&').slice(0, -1).join('&')).toBe(signedQuery);
  });

  it('rewrites nested JSON arrays and leaves unrelated strings untouched', () => {
    const payload = rewriteMediaUrls({
      items: [{ media: { url: rawUrl } }, 'a normal message containing no media URL'],
      other: 'https://example.com/file.jpg',
    });
    const items = (payload as { items: Array<{ media?: { url?: string }} | string> }).items;
    expect(items[0]).toMatchObject({ media: { url: expect.stringContaining(`https://${MEDIA_PROXY_HOST}/`) } });
    expect(items[1]).toBe('a normal message containing no media URL');
    expect((payload as { other: string }).other).toBe('https://example.com/file.jpg');
  });

  it('strips only tracking parameters before issuing the redirect', async () => {
    const pending: Promise<unknown>[] = [];
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetcher);
    const request = new Request(`https://${MEDIA_PROXY_HOST}/attachment.jpg?${signedQuery}&utm_source=chatgpt&utm_campaign=media`);
    const response = handleMediaProxyRequest(request, { MEDIA_TRACKING_ENDPOINT: 'https://wapilot.com.br/metrics/log' }, {
      waitUntil(promise: Promise<unknown>) { pending.push(promise); },
    } as ExecutionContext);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`https://neurau.com.br/attachment.jpg?${signedQuery}`);
    await Promise.all(pending);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [telemetryRequest] = fetcher.mock.calls[0] as unknown as [unknown];
    expect(String(telemetryRequest)).toBe('https://wapilot.com.br/metrics/log?source=chatgpt&path=%2Fattachment.jpg');
    vi.unstubAllGlobals();
  });

  it('keeps signed fields byte-for-byte when removing tracking', () => {
    expect(stripTrackingParameters(`${signedQuery}&utm_source=chatgpt&utm_medium=chat`)).toBe(signedQuery);
  });

  it('rejects methods that could mutate or upload through the redirect host', () => {
    const response = handleMediaProxyRequest(new Request(`https://${MEDIA_PROXY_HOST}/attachment.jpg`, { method: 'POST' }), {}, {} as ExecutionContext);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});
