import type { Env } from '../types';
import type { EvolutionGoClient } from './evolution';
import { approvedMediaOrigins } from './media-origins';

export const AUDIO_TRANSCRIPTION_TIMEOUT_MS = 300_000;
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

export class AudioTranscriptionError extends Error {
  constructor(
    public readonly code: 'audio_unavailable' | 'transcription_unavailable' | 'transcription_failed' | 'no_speech' | 'media_too_large' | 'request_deadline_exceeded' | 'dependency_timeout' | 'request_cancelled',
    public readonly status: number,
    message: string,
  ) { super(message); }
}

export async function transcribeMessageAudio(client: EvolutionGoClient, env: Pick<Env, 'AI' | 'AUDIO_STORAGE_ORIGINS' | 'EVOLUTION_BASE_URL' | 'MAX_MEDIA_BYTES'>, messageId: string, parentSignal: AbortSignal, expiresAt = Date.now() + AUDIO_TRANSCRIPTION_TIMEOUT_MS): Promise<string> {
  if (!env.AI) throw new AudioTranscriptionError('transcription_unavailable', 503, 'WaPilot audio transcription is unavailable.');
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), Math.max(0, expiresAt - Date.now()));
  const signal = AbortSignal.any([parentSignal, deadline.signal]);
  const checkDeadline = () => {
    if (Date.now() >= expiresAt) deadline.abort();
    signal.throwIfAborted();
  };
  try {
    checkDeadline();
    const audio = await client.getMessageAudio(messageId, approvedMediaOrigins(env.AUDIO_STORAGE_ORIGINS, env.EVOLUTION_BASE_URL), Math.min(Number(env.MAX_MEDIA_BYTES ?? MAX_AUDIO_BYTES), MAX_AUDIO_BYTES), signal);
    checkDeadline();
    const result: unknown = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio, task: 'transcribe' }, { signal });
    checkDeadline();
    if (!result || typeof result !== 'object' || !('text' in result) || typeof result.text !== 'string') {
      throw new AudioTranscriptionError('transcription_failed', 502, 'WaPilot received an invalid transcription response.');
    }
    const text = result.text.trim();
    if (!text) throw new AudioTranscriptionError('no_speech', 422, 'WaPilot could not transcribe speech from this audio.');
    return text;
  } catch (error) {
    if (parentSignal.aborted) throw new AudioTranscriptionError('request_cancelled', 499, 'WaPilot audio transcription was cancelled.');
    if (deadline.signal.aborted) throw new AudioTranscriptionError('request_deadline_exceeded', 504, `WaPilot stopped waiting for audio transcription after ${AUDIO_TRANSCRIPTION_TIMEOUT_MS} ms (WaPilot timeout).`);
    if (error instanceof AudioTranscriptionError) throw error;
    throw new AudioTranscriptionError('transcription_failed', 502, 'WaPilot could not complete audio transcription.');
  } finally {
    clearTimeout(timeout);
  }
}
