import { beforeAll, afterAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const audio = Buffer.from('OggS-test-audio');
const image = Buffer.from('89504e470d0a1a0a', 'hex');
let runtime: Miniflare;
let requests: { url: string; apiKey: string | null; authorization: string | null }[];

beforeAll(async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import { EvolutionGoClient } from './src/lib/evolution';
      import { transcribeMessageAudio } from './src/lib/audio-transcription';
      export default { async fetch(request) {
        const id = new URL(request.url).pathname.slice(1);
        const client = new EvolutionGoClient({ baseUrl: 'https://provider.invalid', instanceId: 'test-instance', instanceToken: 'instance-secret' });
        try {
          const result = id.startsWith('audio')
            ? await transcribeMessageAudio(client, {
                EVOLUTION_BASE_URL: 'https://provider.invalid', AUDIO_STORAGE_ORIGINS: 'https://storage.example.test',
                AI: { run: async (_model, input) => ({ text: input.audio === '${audio.toString('base64')}' ? 'Transcrição de teste.' : '' }) },
              }, id, request.signal)
            : await client.getMessageImage(id, ['https://storage.example.test'], 1024);
          return Response.json(result);
        } catch (error) { return Response.json({ code: error.code, message: error.message }, { status: error.status ?? 500 }); }
      } };
    ` },
    bundle: true, write: false, format: 'esm', platform: 'browser', external: ['node:*'],
  });
  runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-10-13', compatibilityFlags: ['nodejs_compat'],
    script: bundle.outputFiles[0].text,
    outboundService: async request => {
      requests.push({ url: request.url, apiKey: request.headers.get('apikey'), authorization: request.headers.get('authorization') });
      if (new URL(request.url).origin === 'https://provider.invalid') {
        const { data: { id } } = await request.json() as { data: { id: string } };
        return Response.json({ jsonapi: { version: '1.1' }, data: {
          type: 'message', id, attributes: { encodingFormat: id.startsWith('audio') ? 'audio/ogg' : 'image/png', body: { media: { url: 'https://storage.example.test/' + id } } },
        } });
      }
      if (request.url.endsWith('-redirect')) return new Response(null, { status: 302, headers: { location: 'https://attacker.example/private' } });
      return new Response(request.url.includes('/audio') ? audio : image);
    },
  }));
});

afterAll(async () => { await runtime?.dispose(); });

it.each(['audio', 'image'])('loads retained %s in Workers without exposing credentials or following redirects', async kind => {
  requests = [];
  const response = await runtime.dispatchFetch('https://local/' + kind);
  const result = await response.json();
  expect({ status: response.status, result }).toEqual({ status: 200, result: kind === 'audio' ? 'Transcrição de teste.' : { mimeType: 'image/png', data: image.toString('base64') } });
  expect(requests).toHaveLength(2);
  expect(requests[0].apiKey).toBe('instance-secret');
  expect(requests[1]).toEqual({ url: 'https://storage.example.test/' + kind, apiKey: null, authorization: null });

  requests = [];
  const redirected = await runtime.dispatchFetch('https://local/' + kind + '-redirect');
  expect(redirected.status).toBe(502);
  expect(requests).toHaveLength(2);
  expect(requests.some(request => request.url.startsWith('https://attacker.example'))).toBe(false);
});
