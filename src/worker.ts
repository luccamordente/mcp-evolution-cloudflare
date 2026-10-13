import { createOAuthProvider } from './lib/oauth';
import app from './index';
import type { Env } from './types';

/** OAuthProvider owns `/mcp`, discovery, PKCE, token, registration and
 * revocation. Hono is the fallback for health/UI/webhook routes. */
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const base = env.MCP_PUBLIC_URL ?? new URL(request.url).origin;
    return createOAuthProvider(base, app.fetch.bind(app)).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
