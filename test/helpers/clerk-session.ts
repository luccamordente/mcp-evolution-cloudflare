import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { eventRuntime } from './mcp-events-runtime';

export async function clerkRuntime(outbound: (request: Request) => Promise<Response> = async () => { throw new Error('Unexpected external action'); }, bindings: Record<string, string> = {}) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'clerk-fixture' };
  const fixture = await eventRuntime(async request => {
    if (new URL(request.url).hostname === 'api.clerk.com' && new URL(request.url).pathname === '/v1/jwks') return Response.json({ keys: [jwk] });
    return outbound(request);
  }, '9999', {
    ENVIRONMENT: 'test',
    CLERK_PUBLISHABLE_KEY: 'pk_live_' + Buffer.from('clerk.fixture.invalid$').toString('base64'),
    CLERK_SECRET_KEY: 'sk_live_synthetic',
    ...bindings,
  });
  const session = async (sub = 'user_lucca', claims: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ sid: 'sess_fixture', azp: 'https://mcp.invalid', iat: now, nbf: now - 1, exp: now + 60, iss: 'https://clerk.fixture.invalid', sub, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'clerk-fixture', typ: 'JWT', cat: 'cl_B7d4PD111AAA' }).sign(privateKey);
    return { token, cookie: '__session=' + token + '; __client_uat=' + (now - 2) };
  };
  return { ...fixture, session };
}
