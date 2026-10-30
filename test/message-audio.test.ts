import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvolutionGoClient } from '../src/lib/evolution';
import { AUDIO_TRANSCRIPTION_TIMEOUT_MS, transcribeMessageAudio } from '../src/lib/audio-transcription';
import type { Env } from '../src/types';

const signedUrl = 'https://storage.example.test/voice.ogg?signature=private-link';
const bytes = Buffer.from('OggS-test-audio');
const stored = (url = signedUrl, mime = 'audio/ogg; codecs=opus') => ({
  type: 'message', id: 'audio-1',
  attributes: { encodingFormat: mime, body: { media: { url } } },
});

function audioTool(data: unknown = stored()) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes))
    .mockResolvedValueOnce(Response.json({ jsonapi: { version: '1.1' }, data }));
  const run = vi.fn().mockResolvedValue({ text: 'Reunião amanhã às dez.', vtt: 'private timing data' });
  const client = new EvolutionGoClient({ baseUrl: 'https://evolution.invalid', instanceId: 'instance-a', instanceToken: 'instance-secret', fetcher });
  const env: Pick<Env, 'AI' | 'EVOLUTION_BASE_URL' | 'AUDIO_STORAGE_ORIGINS' | 'MAX_MEDIA_BYTES'> = { AI: { run, toMarkdown: vi.fn() }, EVOLUTION_BASE_URL: 'https://evolution.invalid', AUDIO_STORAGE_ORIGINS: 'https://storage.example.test', MAX_MEDIA_BYTES: '1024' };
  const parent = new AbortController();
  return { env, fetcher, run, parent, read: () => transcribeMessageAudio(client, env, 'audio-1', parent.signal) };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('retained audio transcription', () => {
  it('downloads scoped audio and passes only its bytes to the transcription model', async () => {
    const { read, run, fetcher } = audioTool();
    expect(await read()).toBe('Reunião amanhã às dez.');
    expect(fetcher.mock.calls[0][0]).toBe('https://evolution.invalid/message/status');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({ data: { type: 'message', id: 'audio-1' } });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('apikey')).toBe('instance-secret');
    expect(fetcher.mock.calls[1][0]).toBe(signedUrl);
    expect(fetcher.mock.calls[1][1]).toMatchObject({ redirect: 'manual', credentials: 'omit' });
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('apikey')).toBeNull();
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('authorization')).toBeNull();
    expect(run).toHaveBeenCalledExactlyOnceWith('@cf/openai/whisper-large-v3-turbo', { audio: bytes.toString('base64'), task: 'transcribe' }, { signal: expect.any(AbortSignal) });
    expect(JSON.stringify(run.mock.calls)).not.toMatch(/private-link|instance-secret|storage\.example/);
  });

  it.each([
    ['https://attacker.example/voice.ogg', 'audio/ogg'],
    ['https://storage.example.test.attacker.example/voice.ogg', 'audio/ogg'],
    ['http://storage.example.test/voice.ogg', 'audio/ogg'],
    ['https://user:password@storage.example.test/voice.ogg', 'audio/ogg'],
    ['https://storage.example.test/voice.ogg#private', 'audio/ogg'],
    ['data:audio/ogg;base64,AAAA', 'audio/ogg'],
    [signedUrl, 'video/mp4'],
    [signedUrl, 'image/png'],
  ])('rejects unsafe URLs and non-audio messages: %s (%s)', async (url, mime) => {
    const { read, fetcher, run } = audioTool(stored(url, mime));
    await expect(read()).rejects.toMatchObject({ code: 'audio_unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed without an audio allowlist and excludes the API origin even if approved', async () => {
    for (const origin of ['', 'https://evolution.invalid']) {
      const { env, read, fetcher, run } = audioTool(stored('https://evolution.invalid/voice.ogg'));
      env.AUDIO_STORAGE_ORIGINS = origin;
      await expect(read()).rejects.toMatchObject({ code: 'audio_unavailable' });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(run).not.toHaveBeenCalled();
    }
  });

  it.each([null, { ...stored(), id: 'another-message' }, { type: 'message', id: 'audio-1' }, stored('')])('rejects missing or mismatched retained audio: %j', async (data) => {
    const { read, fetcher, run } = audioTool(data);
    await expect(read()).rejects.toMatchObject({ code: 'audio_unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([true, false])('enforces the byte limit with content-length present=%s', async (withLength) => {
    const { env, read, fetcher, run } = audioTool();
    env.MAX_MEDIA_BYTES = String(bytes.length - 1);
    fetcher.mockResolvedValue(new Response(bytes, withLength ? { headers: { 'content-length': String(bytes.length) } } : {}));
    await expect(read()).rejects.toMatchObject({ code: 'media_too_large', status: 413 });
    expect(run).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true);
  });

  it('caps audio at 8 MiB even when the general media limit is higher', async () => {
    const { env, read, fetcher, run } = audioTool();
    env.MAX_MEDIA_BYTES = String(16 * 1024 * 1024);
    fetcher.mockResolvedValue(new Response(bytes, { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } }));
    await expect(read()).rejects.toMatchObject({ code: 'media_too_large', status: 413 });
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['', '0', '-1', 'invalid'])('rejects invalid configured media limits: %s', async (limit) => {
    const { env, read, fetcher, run } = audioTool();
    env.MAX_MEDIA_BYTES = limit;
    await expect(read()).rejects.toMatchObject({ code: 'audio_unavailable', status: 500 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects redirects and empty responses without invoking transcription', async () => {
    for (const response of [new Response(null, { status: 302 }), new Response(null), new Response(new Uint8Array())]) {
      const { read, fetcher, run } = audioTool();
      fetcher.mockResolvedValue(response);
      await expect(read()).rejects.toMatchObject({ code: 'audio_unavailable', status: 502 });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(run).not.toHaveBeenCalled();
    }
  });

  it.each([408, 504])('distinguishes storage HTTP %s from a local timeout', async (status) => {
    const { read, fetcher } = audioTool();
    fetcher.mockResolvedValue(new Response('private upstream body', { status }));
    await expect(read()).rejects.toMatchObject({ code: 'upstream_timeout', status });
  });

  it('sanitizes lookup, storage and inference failures without repeating them', async () => {
    for (const stage of ['lookup', 'storage', 'inference']) {
      const { read, fetcher, run } = audioTool();
      const privateError = new Error(`${signedUrl} token=instance-secret private-audio-content`);
      if (stage === 'lookup') fetcher.mockReset().mockRejectedValue(privateError);
      if (stage === 'storage') fetcher.mockRejectedValue(privateError);
      if (stage === 'inference') run.mockRejectedValue(privateError);
      const error = await read().catch(error => error);
      expect(error.code).toBe(stage === 'inference' ? 'transcription_failed' : 'audio_unavailable');
      expect(error.message).not.toMatch(/private|signature|instance-secret/);
      expect(fetcher).toHaveBeenCalledTimes(stage === 'lookup' ? 1 : 2);
      expect(run).toHaveBeenCalledTimes(stage === 'inference' ? 1 : 0);
    }
  });

  it.each([{ text: '' }, { text: '  \n' }, { text: 42 }, null, { vtt: 'not a transcript' }])('rejects absent speech and invalid model output: %j', async (result) => {
    const { read, run } = audioTool();
    run.mockResolvedValue(result);
    await expect(read()).rejects.toMatchObject({ code: result && typeof result.text === 'string' ? 'no_speech' : 'transcription_failed' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports a missing binding before retrieving audio', async () => {
    const { env, read, fetcher } = audioTool();
    delete env.AI;
    await expect(read()).rejects.toMatchObject({ code: 'transcription_unavailable', status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('allows inference to take longer than the usual 60-second client timeout', async () => {
    vi.useFakeTimers();
    const { read, run } = audioTool();
    run.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ text: 'Long audio.' }), 120_000)));
    const pending = read();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await pending).toBe('Long audio.');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses one 5-minute deadline across storage and inference', async () => {
    vi.useFakeTimers();
    const { read, fetcher, run } = audioTool();
    fetcher.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 30_000));
      return new Response(bytes);
    });
    run.mockImplementation((_model, _input, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })));
    const failure = expect(read()).rejects.toMatchObject({ code: 'wapilot_timeout', status: 504 });
    await vi.advanceTimersByTimeAsync(AUDIO_TRANSCRIPTION_TIMEOUT_MS - 1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][2].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await failure;
    expect(run.mock.calls[0][2].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the total deadline active while reading the audio body', async () => {
    vi.useFakeTimers();
    const { read, fetcher, run } = audioTool();
    fetcher.mockImplementation(async (_url, init) => new Response(new ReadableStream({ start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new Error('private storage error')));
    } })));
    const failure = expect(read()).rejects.toMatchObject({ code: 'wapilot_timeout', status: 504 });
    await vi.advanceTimersByTimeAsync(AUDIO_TRANSCRIPTION_TIMEOUT_MS);
    await failure;
    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['lookup', 'storage', 'inference'])('propagates caller cancellation during %s without retry', async (stage) => {
    const { read, fetcher, run, parent } = audioTool();
    const block = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      parent.abort();
    });
    if (stage === 'lookup') fetcher.mockReset().mockImplementation((_url, init) => block(init!.signal!));
    if (stage === 'storage') fetcher.mockImplementation((_url, init) => block(init!.signal!));
    if (stage === 'inference') run.mockImplementation((_model, _input, options) => block(options.signal));
    await expect(read()).rejects.toMatchObject({ code: 'request_cancelled', status: 499 });
    expect(fetcher).toHaveBeenCalledTimes(stage === 'lookup' ? 1 : 2);
    expect(run).toHaveBeenCalledTimes(stage === 'inference' ? 1 : 0);
  });
});
