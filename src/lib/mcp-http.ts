import { createMcpHandler, isLegacyRequest, WebStandardStreamableHTTPServerTransport, type McpServer } from '@modelcontextprotocol/server';

/** Both protocol eras share OAuth, tools and per-request lifetime. */
export async function serveMcpHttp(request: Request, server: McpServer, maxRequestBodySize: number, options?: Parameters<ReturnType<typeof createMcpHandler>['fetch']>[1]): Promise<Response> {
  if (request.method !== 'POST') return new Response('Method not allowed', {status:405,headers:{Allow:'POST'}});
  const started = Date.now();
  const legacy = await isLegacyRequest(request, undefined, { maxRequestBodySize });
  const version = request.headers.get('MCP-Protocol-Version');
  const protocolVersion = ['2024-11-05','2025-03-26','2025-06-18','2025-11-25','2026-07-28'].includes(version ?? '') ? version : version ? 'unsupported' : 'unspecified';
  const missingHeaders = ['MCP-Protocol-Version','Mcp-Method','Mcp-Name'].filter(header=>!request.headers.has(header));
  let response: Response;
  if (legacy) {
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize });
    try {
      await server.connect(transport);
      response = await transport.handleRequest(request, options);
    } finally {
      await transport.close();
      await server.close();
    }
  } else {
    const handler = createMcpHandler(() => server, { legacy: 'reject', responseMode: 'json', maxRequestBodySize });
    response = await handler.fetch(request, options);
  }
  console.info(JSON.stringify({event:'mcp_http',protocolVersion,transport:legacy?'streamable-http-legacy-json':'streamable-http-stateless-json',missingHeaders,status:response.status,latencyMs:Date.now()-started}));
  return response;
}
