import type { Message } from '../types';

/** Only operator-approved HTTPS origins can enter either CSP or image data. */
export function approvedImageOrigins(config?: string, evolutionBaseUrl?: string): string[] {
  const origins = new Set<string>();
  let excludedOrigin: string | undefined;
  try { excludedOrigin = new URL(evolutionBaseUrl ?? '').origin; } catch { /* No valid API origin configured. */ }
  for (const entry of (config ?? '').split(',')) {
    try {
      const url = new URL(entry.trim());
      if (url.origin !== excludedOrigin && url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash && !url.origin.includes('*')) origins.add(url.origin);
    } catch { /* Invalid configuration fails closed. */ }
  }
  return [...origins];
}

const RASTER_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif']);

/** A component-only projection: never expose this object in structuredContent. */
export function galleryImage(message: Message, approvedOrigins: string[]) {
  const mimeType = (message.media?.mimeType ?? message.type ?? '').toLowerCase().trim();
  const context = {
    id: message.id?.slice(0, 200), conversationId: message.conversationId?.slice(0, 200),
    sender: message.sender?.slice(0, 200), timestamp: message.timestamp, direction: message.direction,
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
