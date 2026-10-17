/**
 * Public media URL boundary.
 *
 * The Evolution provider signs URLs for its storage origin. Those URLs must
 * never be exposed by MCP, and their signed query bytes must not be rebuilt by
 * a URL parser. This module therefore rewrites only the origin/path and
 * filters proxy queries by raw parameter name.
 */
export const RAW_MEDIA_HOST = 'storage.neurau.com.br';
export const MEDIA_PROXY_HOST = 'media.wapilot.com.br';
export const RAW_MEDIA_PATH_PREFIX = '/attachment-storage-production/evolution-go-medias/';
export const MEDIA_PROXY_PATH_PREFIX = '/r/';

export const SIGNED_MEDIA_QUERY_PARAMETERS = [
  'X-Amz-Algorithm',
  'X-Amz-Credential',
  'X-Amz-Date',
  'X-Amz-Expires',
  'X-Amz-SignedHeaders',
  'X-Amz-Signature',
] as const;

const SIGNED_MEDIA_QUERY_PARAMETER_SET = new Set<string>(SIGNED_MEDIA_QUERY_PARAMETERS);
const RAW_MEDIA_URL = new RegExp(`^https://${RAW_MEDIA_HOST.replace(/\./g, '\\.')}(\/[^?#]*)?(?:\\?([^#]*))?(?:#.*)?$`, 'i');

function queryParameterName(segment: string): string {
  const equals = segment.indexOf('=');
  const encodedName = equals === -1 ? segment : segment.slice(0, equals);
  try {
    return decodeURIComponent(encodedName.replace(/\+/g, ' '));
  } catch {
    return encodedName;
  }
}

function splitQuery(query: string): string[] {
  return query ? query.split('&').filter(Boolean) : [];
}

/**
 * Rewrite one provider URL without reparsing or reserializing its query.
 * Only the storage path used by Evolution Go is accepted. The filename is
 * moved under `/r/`, while every original query segment remains byte-for-byte
 * unchanged so the signed fields continue to verify.
 */
export function rewriteMediaUrl(value: string): string {
  const match = value.match(RAW_MEDIA_URL);
  if (!match) return value;

  const path = match[1] ?? '/';
  if (!path.startsWith(RAW_MEDIA_PATH_PREFIX)) return value;
  const filename = path.slice(RAW_MEDIA_PATH_PREFIX.length);
  if (!filename || filename.includes('/')) return value;

  const query = match[2];
  return `https://${MEDIA_PROXY_HOST}${MEDIA_PROXY_PATH_PREFIX}${filename}${query === undefined ? '' : `?${query}`}`;
}

/** Rewrite media URLs recursively in any JSON-shaped MCP value. */
export function rewriteMediaUrls<T>(value: T): T {
  if (typeof value === 'string') return rewriteMediaUrl(value) as T;
  if (Array.isArray(value)) return value.map((item) => rewriteMediaUrls(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteMediaUrls(item)])) as T;
  }
  return value;
}

/**
 * Keep only the exact signed query fields accepted by the storage provider.
 * Segments are selected from the original query instead of going through
 * URLSearchParams, preserving encoding, ordering, and repeated values.
 */
export function filterSignedMediaQuery(query: string): string {
  return splitQuery(query)
    .filter((segment) => SIGNED_MEDIA_QUERY_PARAMETER_SET.has(queryParameterName(segment)))
    .join('&');
}

function mediaFilename(pathname: string): string | undefined {
  if (!pathname.startsWith(MEDIA_PROXY_PATH_PREFIX)) return undefined;
  const filename = pathname.slice(MEDIA_PROXY_PATH_PREFIX.length);
  if (!filename || filename.includes('/')) return undefined;
  return filename;
}

export function isMediaProxyRequest(request: Request): boolean {
  return new URL(request.url).hostname.toLowerCase() === MEDIA_PROXY_HOST;
}

/**
 * Redirect a public media URL to the signed provider object. The Worker never
 * fetches or streams the object, and unrecognized query parameters are
 * removed before the redirect so they cannot invalidate or alter the signed
 * request.
 */
export function handleMediaProxyRequest(request: Request): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  const url = new URL(request.url);
  const filename = mediaFilename(url.pathname);
  if (!filename) return new Response('Not Found', { status: 404 });

  const query = url.search.startsWith('?') ? url.search.slice(1) : '';
  const filteredQuery = filterSignedMediaQuery(query);
  const target = `https://${RAW_MEDIA_HOST}${RAW_MEDIA_PATH_PREFIX}${filename}${filteredQuery ? `?${filteredQuery}` : ''}`;
  return Response.redirect(target, 302);
}
