import type { Message } from '../types';

const RASTER_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);

/** A component-only projection: never expose this object in structuredContent. */
export function galleryImage(message: Message, approvedOrigins: string[]) {
  const mimeType = (message.media?.mimeType ?? message.type ?? '').toLowerCase().trim();
  const context = {
    id: message.id?.slice(0, 200), conversationId: message.conversationId?.slice(0, 200),
    source: message.source?.slice(0, 200), timestamp: message.timestamp, direction: message.direction,
    caption: message.text?.slice(0, 2000), mimeType,
  };
  if (!RASTER_MIME_TYPES.has(mimeType)) return { ...context, state: 'unsupported' as const };
  const source = message.media?.url;
  if (!source) return { ...context, state: 'missing' as const };
  try {
    const url = new URL(source);
    if (source.length <= 8192 && url.protocol === 'https:' && !url.username && !url.password && !url.hash && approvedOrigins.includes(url.origin)
      && !/\.(?:svg|html?|xhtml)(?:$|[/?])/i.test(decodeURIComponent(url.pathname))) {
      return { ...context, state: 'ready' as const, url: url.href };
    }
  } catch { /* Malformed and disallowed links are unavailable, never reflected. */ }
  return { ...context, state: 'blocked' as const };
}
