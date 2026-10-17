import { createOAuthProvider } from './lib/oauth';
import { handleMediaProxyRequest, isMediaProxyRequest } from './lib/media-proxy';
import app from './index';
import type { Env } from './types';

/** OAuthProvider owns `/mcp`, discovery, PKCE, token, registration and
 * revocation. Hono is the fallback for health/UI/webhook routes. */
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (isMediaProxyRequest(request)) return Promise.resolve(handleMediaProxyRequest(request));
    const origin = new URL(request.url).origin;
    const base = origin.includes('localhost') ? (env.MCP_PUBLIC_URL ?? origin) : origin;
    return createOAuthProvider(base, app.fetch.bind(app)).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
