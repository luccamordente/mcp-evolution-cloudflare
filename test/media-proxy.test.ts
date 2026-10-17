import { describe, expect, it } from 'vitest';
import {
  MEDIA_PROXY_HOST,
  RAW_MEDIA_HOST,
  filterSignedMediaQuery,
  handleMediaProxyRequest,
  rewriteMediaUrl,
  rewriteMediaUrls,
} from '../src/lib/media-proxy';

const signedQuery = 'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=GOOG1ESNAAIQFC2YGK2MV7HDUAD2SCJEU765I2DUZFYEJFKJIINFIE3FQLIQX%2F20261016%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261016T175902Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=d4a65594f205e8a83041b5da89917f68146e70f218dca05dfb1eedce66605b44';
const rawUrl = `https://${RAW_MEDIA_HOST}/attachment-storage-production/evolution-go-medias/3AABE8E5CA8FA9088D98.jpg?${signedQuery}`;

describe('media proxy', () => {
  it('rewrites provider URLs to the public /r path without changing signed query bytes', () => {
    expect(rewriteMediaUrl(rawUrl)).toBe(`https://${MEDIA_PROXY_HOST}/r/3AABE8E5CA8FA9088D98.jpg?${signedQuery}`);
    expect(rewriteMediaUrl(`${rawUrl}&utm_source=some_source`)).toBe(`https://${MEDIA_PROXY_HOST}/r/3AABE8E5CA8FA9088D98.jpg?${signedQuery}&utm_source=some_source`);
  });

  it('rewrites nested media fields while leaving unrelated strings untouched', () => {
    const payload = rewriteMediaUrls({
      items: [{ media: { url: rawUrl } }, 'a normal message containing no media URL'],
      other: 'https://example.com/file.jpg',
    });
    const items = (payload as { items: Array<{ media?: { url?: string }} | string> }).items;
    expect(items[0]).toEqual({ media: { url: `https://${MEDIA_PROXY_HOST}/r/3AABE8E5CA8FA9088D98.jpg?${signedQuery}` } });
    expect(items[1]).toBe('a normal message containing no media URL');
    expect((payload as { other: string }).other).toBe('https://example.com/file.jpg');
  });

  it('keeps only the six signed query parameters and preserves their raw segments', () => {
    const query = `utm_source=some_source&${signedQuery}&utm_campaign=media&X-Amz-Extra=discard`;
    expect(filterSignedMediaQuery(query)).toBe(signedQuery);
  });

  it('redirects /r media paths to the provider without fetching object bytes', () => {
    const request = new Request(`https://${MEDIA_PROXY_HOST}/r/3AABE8E5CA8FA9088D98.jpg?${signedQuery}&utm_source=some_source&tracking_id=discard`);
    const response = handleMediaProxyRequest(request);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`https://${RAW_MEDIA_HOST}/attachment-storage-production/evolution-go-medias/3AABE8E5CA8FA9088D98.jpg?${signedQuery}`);
  });

  it('rejects methods other than GET and HEAD and invalid public paths', () => {
    expect(handleMediaProxyRequest(new Request(`https://${MEDIA_PROXY_HOST}/r/file.jpg`, { method: 'POST' })).status).toBe(405);
    expect(handleMediaProxyRequest(new Request(`https://${MEDIA_PROXY_HOST}/other/file.jpg`)).status).toBe(404);
  });
});
