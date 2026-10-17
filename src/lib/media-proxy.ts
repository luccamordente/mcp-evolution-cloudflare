export const RAW_MEDIA_HOST = 'neurau.com.br';
export const MEDIA_PROXY_HOST = 'storage.wapilot.com.br';
export const MEDIA_TRACKING_SOURCE = 'chatgpt';

const RAW_MEDIA_PREFIX = `https://${RAW_MEDIA_HOST}`;
const TRACKING_PARAMETER = /^utm_[a-z0-9_]+$/i;

function queryParameterName(segment: string): string {
  const equals = segment.indexOf('=');
  const encodedName = equals === -1 ? segment : segment.slice(0, equals);
  try {
    return decodeURIComponent(encodedName.replace(/\+/g, ' '));
  } catch {
    return encodedName;
  }
}

function hasQueryParameter(query: string, name: string): boolean {
  return query.split('&').some((segment) => queryParameterName(segment) === name);
}

/**
 * Rewrites one raw Evolution media URL without reparsing its signed query.
 * Keeping the original query segments byte-for-byte preserves the order and
 * encoding of every X-Amz field. The tracking parameter is appended last.
 */
export function rewriteMediaUrl(value: string, source = MEDIA_TRACKING_SOURCE): string {
  if (!value.toLowerCase().startsWith(RAW_MEDIA_PREFIX)) return value;

  const remainder = value.slice(RAW_MEDIA_PREFIX.length);
  if (remainder && !remainder.startsWith('/') && !remainder.startsWith('?') && !remainder.startsWith('#')) return value;

  const hashIndex = remainder.indexOf('#');
  const beforeHash = hashIndex === -1 ? remainder : remainder.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : remainder.slice(hashIndex);
  const queryIndex = beforeHash.indexOf('?');
  const path = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1);
  const trackedQuery = hasQueryParameter(query, 'utm_source')
    ? query
    : `${query ? `${query}&` : ''}utm_source=${encodeURIComponent(source)}`;

  return `https://${MEDIA_PROXY_HOST}${path}?${trackedQuery}${hash}`;
}

/** Rewrite URLs recursively in any JSON-shaped MCP value. */
export function rewriteMediaUrls<T>(value: T, source = MEDIA_TRACKING_SOURCE): T {
  if (typeof value === 'string') return rewriteMediaUrl(value, source) as T;
  if (Array.isArray(value)) return value.map((item) => rewriteMediaUrls(item, source)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteMediaUrls(item, source)])) as T;
  }
  return value;
}

/** Remove only UTM parameters, preserving all signed query segments verbatim. */
export function stripTrackingParameters(query: string): string {
  return query.split('&').filter((segment) => segment && !TRACKING_PARAMETER.test(queryParameterName(segment))).join('&');
}

function trackingSource(query: string): string {
  const source = query.split('&').find((segment) => queryParameterName(segment) === 'utm_source');
  if (!source) return 'direct';
  const equals = source.indexOf('=');
  if (equals === -1) return 'direct';
  try {
    return decodeURIComponent(source.slice(equals + 1).replace(/\+/g, ' ')).slice(0, 100) || 'direct';
  } catch {
    return 'direct';
  }
}

async function logMediaHit(endpoint: string, source: string, path: string): Promise<void> {
  try {
    const url = new URL(endpoint);
    url.searchParams.set('source', source);
    url.searchParams.set('path', path);
    await fetch(url, { method: 'POST', headers: { Accept: 'application/json' } });
  } catch {
    // Tracking is best effort and must never delay or fail a media redirect.
  }
}

export function isMediaProxyRequest(request: Request): boolean {
  return new URL(request.url).hostname.toLowerCase() === MEDIA_PROXY_HOST;
}

/**
 * Redirects media clients to the original storage origin. Workers never read
 * or stream the object bytes, so the redirect does not add a second transfer.
 */
export function handleMediaProxyRequest(request: Request, env: { MEDIA_TRACKING_ENDPOINT?: string }, ctx: ExecutionContext): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const url = new URL(request.url);
  const query = url.search.startsWith('?') ? url.search.slice(1) : '';
  const source = trackingSource(query);
  if (env.MEDIA_TRACKING_ENDPOINT) ctx.waitUntil(logMediaHit(env.MEDIA_TRACKING_ENDPOINT, source, url.pathname));

  const cleanQuery = stripTrackingParameters(query);
  const target = `https://${RAW_MEDIA_HOST}${url.pathname}${cleanQuery ? `?${cleanQuery}` : ''}`;
  return Response.redirect(target, 302);
}
