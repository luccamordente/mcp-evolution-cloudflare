import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

export async function eventRuntime(sender: (request: Request) => Promise<Response>, migrationThrough = '9999') {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { OAuthProvider, getOAuthApi } from '@cloudflare/workers-oauth-provider';
    import { oauthOptions } from './src/lib/oauth';
    import productionWorker from './src/worker';
    import { ensureUser, createConnection } from './src/lib/db';
    import { Buffer } from 'node:buffer';
    const base = 'https://mcp.invalid';
    let providerFailure = false, providerDelay = 0, queueFailure = false, fixtureNow;
    const realNow = Date.now;
    Date.now = () => fixtureNow ?? realNow();
    function fixtureEnv(env) {
      env = {...env};
      env.CALLBACK_SENDER = { getByName() { return { fetch(url, init) { return fetch('https://sender.invalid/send', init); } }; } };
      env.EVENT_DELIVERIES = {async send(id) {if (queueFailure) throw new Error('Synthetic publication failure'); const response = await fetch('https://queue.invalid/',{method:'POST',body:JSON.stringify(id)}); if (!response.ok) throw new Error('Synthetic publication failure');}};
      if (providerFailure || providerDelay) {
        const kv = env.OAUTH_KV;
        env.OAUTH_KV = {get:kv.get.bind(kv),put:kv.put.bind(kv),delete:kv.delete.bind(kv),list:async(...args)=>{if (providerDelay) await new Promise(resolve=>setTimeout(resolve,providerDelay)); if (providerFailure) throw new Error('private fixture payload token=do-not-return');return kv.list(...args);}};
      }
      return env;
    }
    export default { async fetch(request, env, ctx) {
      env = fixtureEnv(env);
      const url = new URL(request.url);
      if (request.headers.has('x-fixture-provider-failure')) {
        const kv = env.OAUTH_KV;
        env.OAUTH_KV = {get:kv.get.bind(kv),put:kv.put.bind(kv),delete:kv.delete.bind(kv),list:async()=>{throw new Error('private fixture payload token=do-not-return');}};
      }
      if (url.pathname === '/fixture/provider-failure') {providerFailure = url.searchParams.has('enabled'); return Response.json({ok:true});}
      if (url.pathname === '/fixture/provider-delay') {providerDelay = Number(url.searchParams.get('ms')); return Response.json({ok:true});}
      if (url.pathname === '/fixture/queue-failure') {queueFailure = url.searchParams.has('enabled'); return Response.json({ok:true});}
      if (url.pathname === '/fixture/clock') {fixtureNow = url.searchParams.has('now') ? Number(url.searchParams.get('now')) : undefined; return Response.json({ok:true});}
      if (url.pathname === '/fixture/webhook') {
        const id = url.searchParams.get('connectionId'), secret = 'synthetic-webhook-'+id;
        const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret));
        const hash = Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,'0')).join('');
        await env.DB.prepare('UPDATE whatsapp_connections SET webhook_secret_hash = ? WHERE id = ?').bind(hash,id).run();
        const row = await env.DB.prepare('SELECT instance_id FROM whatsapp_connections WHERE id = ?').bind(id).first();
        return Response.json({path:'/webhooks/evolution/'+secret,instanceId:row.instance_id});
      }
      const api = getOAuthApi(oauthOptions(base), env);
      if (url.pathname === '/fixture/issue') {
        const email = url.searchParams.get('email') || 'fixture-a@example.test';
        const user = { id:'untrusted-claim',email,claims:{} };
        const owner = await ensureUser(env.DB, user);
        let connections = (await env.DB.prepare('SELECT id FROM whatsapp_connections WHERE user_id = ? ORDER BY friendly_name').bind(owner.id).all()).results;
        if (!connections.length) {
          for (const name of ['A', 'B']) await createConnection(env.DB, env.TOKEN_ENCRYPTION_KEY, {userId:owner.id,friendlyName:name,instanceId:email+name,token:'synthetic-instance'});
          connections = (await env.DB.prepare('SELECT id FROM whatsapp_connections WHERE user_id = ? ORDER BY friendly_name').bind(owner.id).all()).results;
        }
        const client = url.searchParams.has('clientId') ? await api.lookupClient(url.searchParams.get('clientId')) : await api.createClient({clientName:'Fixture',redirectUris:['https://client.invalid/callback'],tokenEndpointAuthMethod:'none',grantTypes:['authorization_code','refresh_token'],responseTypes:['code']});
        const verifier = 'a'.repeat(43), challenge = Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))).toString('base64url');
        const scope = url.searchParams.get('scope') || 'mcp:read';
        const query = new URLSearchParams({client_id:client.clientId,redirect_uri:client.redirectUris[0],response_type:'code',resource:base+'/mcp',scope,code_challenge:challenge,code_challenge_method:'S256'});
        const authRequest = await api.parseAuthRequest(new Request(base+'/authorize?'+query));
        const completed = await api.completeAuthorization({request:authRequest,userId:encodeURIComponent(email),scope:authRequest.scope,props:{user},revokeExistingGrants:false});
        const tokenResponse = await new OAuthProvider(oauthOptions(base)).fetch(new Request(base+'/oauth/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:client.clientId,redirect_uri:client.redirectUris[0],code:new URL(completed.redirectTo).searchParams.get('code'),code_verifier:verifier,resource:base+'/mcp'})}),env,ctx);
        const token = await tokenResponse.json(), summary = await api.unwrapToken(token.access_token);
        return Response.json({accessToken:token.access_token,refreshToken:token.refresh_token,grantId:summary.grantId,clientId:client.clientId,userId:owner.id,connections:connections.map(c=>c.id)});
      }
      if (url.pathname === '/fixture/grants') return Response.json(await api.listUserGrants(url.searchParams.get('user'),{limit:100,...(url.searchParams.get('cursor') ? {cursor:url.searchParams.get('cursor')} : {})}));
      if (url.pathname === '/fixture/revoke') { await api.revokeGrant(url.searchParams.get('grantId'), url.searchParams.get('providerUserId')); return Response.json({ok:true}); }
      return productionWorker.fetch(request,env,ctx);
    }, queue(batch, env, ctx) { return productionWorker.queue(batch,fixtureEnv(env),ctx); }, scheduled(controller, env, ctx) { return productionWorker.scheduled(controller,fixtureEnv(env),ctx); } };
  ` }, bundle:true,write:false,format:'esm',platform:'browser',conditions:['workerd'],external:['cloudflare:*','node:*'],logLevel:'silent',
    plugins: [{ name: 'pdfium-module', setup(builder) {
      builder.onResolve({ filter: /pdfium\.wasm$/ }, () => ({ path: './pdfium.wasm', external: true }));
    } }],
  });
  const wasm = await readFile(resolve('node_modules/@hyzyla/pdfium/dist/pdfium.wasm'));
  const published: unknown[] = [];
  const logs:string[]=[];
  let restarts=0;
  const options = (script=bundle.outputFiles[0].text) => convertV4MiniflareOptions({
    modulesRoot:process.cwd(), modules:[
      {type:'ESModule',path:resolve('events-worker.js'),contents:script},
      {type:'CompiledWasm',path:resolve('pdfium.wasm'),contents:wasm},
    ],compatibilityDate:'2026-10-13',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],handleStructuredLogs:entry=>{logs.push(entry.message);},
    kvNamespaces:['OAUTH_KV'],d1Databases:{DB:'events-test'},
    bindings:{ TOKEN_ENCRYPTION_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',EVOLUTION_BASE_URL:'https://provider.invalid',MCP_PUBLIC_URL:'https://mcp.invalid',ENVIRONMENT:'local',LOCAL_DEV_USER_EMAIL:'fixture-a@example.test' },
    outboundService: async request => { if (new URL(request.url).hostname === 'queue.invalid') {published.push(await request.json()); return new Response(null,{status:204});} return sender(new Request(request.url,{method:request.method,headers:Object.fromEntries(request.headers),...(request.method === 'GET' || request.method === 'HEAD' ? {} : {body:await request.text()}),signal:request.signal})); },
  });
  const runtime = new Miniflare(options());
  let db = await runtime.getD1Database('DB');
  for (const file of (await readdir('migrations')).filter(f=>f.endsWith('.sql') && f <= migrationThrough).sort()) {
    await db.batch(unstable_splitSqlQuery(await readFile(`migrations/${file}`,'utf8')).map(sql=>db.prepare(sql)));
  }
  const fetch = (path:string, init?:Parameters<Miniflare['dispatchFetch']>[1]) => runtime.dispatchFetch('https://mcp.invalid'+path,init);
  return { runtime, get db() {return db;}, fetch, published, logs,
    async webhook(connectionId:string) { return await (await fetch('/fixture/webhook?'+new URLSearchParams({connectionId}))).json() as {path:string;instanceId:string}; },
    async queue(ids:unknown[], name='wapilot-events') { return (await runtime.getWorker()).queue(name,ids.map((body,index)=>({id:'fixture-'+index,timestamp:new Date(),attempts:1,body}))); },
    async clock(now?:number) { await fetch('/fixture/clock'+(now === undefined ? '' : '?now='+now)); },
    async restart() { await runtime.setOptions(options(bundle.outputFiles[0].text+'\n// Restarted fixture '+(++restarts))); db=await runtime.getD1Database('DB'); },
    async scheduled(time:number) { return (await runtime.getWorker()).scheduled({scheduledTime:new Date(time),cron:'* * * * *'}); },
    async issue(query: Record<string,string> = {}) { return await (await fetch('/fixture/issue?'+new URLSearchParams(query))).json() as {accessToken:string;refreshToken:string;grantId:string;clientId:string;userId:string;connections:string[]}; },
    async rpc(accessToken:string, method:string, params:Record<string,unknown> = {}, extraHeaders:Record<string,string> = {}) {
      const response = await fetch('/mcp',{method:'POST',headers:{authorization:'Bearer '+accessToken,'content-type':'application/json',accept:'application/json','Mcp-Method':method,'MCP-Protocol-Version':'2026-07-28',...extraHeaders},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:{...params,_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{}}}})});
      return {response, body:await response.json() as any};
    },
  };
}
