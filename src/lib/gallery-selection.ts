import type { Message } from '../types';
import { galleryImage } from './image-gallery';

export const SELECTED_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const SELECTED_IMAGE_TIMEOUT_MS = 10_000;

/** This error carries only a fixed, public message, never an upstream URL. */
export class GallerySelectionError extends Error {
  constructor(public readonly code: 'selected_image_unavailable' | 'selected_image_too_large' | 'selected_image_timeout' | 'selected_image_invalid', public readonly status: number, public readonly retryable = false) {
    super({
      selected_image_unavailable: 'The selected image is unavailable. Refresh the gallery and try again.',
      selected_image_too_large: 'The selected image exceeds the 5 MiB context limit. Select a smaller image.',
      selected_image_timeout: 'The selected image could not be read within 10 seconds. Try again.',
      selected_image_invalid: 'The selected file is not a supported image. Select another image.',
    }[code]);
  }
}

function matchesImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  const startsWith = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (mimeType === 'image/png') return bytes.length >= 24 && startsWith([137, 80, 78, 71, 13, 10, 26, 10]) && ascii(12, 4) === 'IHDR';
  if (mimeType === 'image/jpeg') return bytes.length >= 4 && startsWith([255, 216, 255]);
  if (mimeType === 'image/gif') return bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  if (mimeType === 'image/webp') return bytes.length >= 16 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
  if (mimeType === 'image/avif') {
    if (bytes.length < 16 || ascii(4, 4) !== 'ftyp') return false;
    const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (boxSize < 16 || boxSize > bytes.length) return false;
    if (['avif', 'avis'].includes(ascii(8, 4))) return true;
    for (let offset = 16; offset + 4 <= boxSize; offset += 4) if (['avif', 'avis'].includes(ascii(offset, 4))) return true;
  }
  return false;
}

/** Fetch only a source derived from an account-scoped, retained message. */
export async function readSelectedGalleryImage(message: Message, approvedOrigins: string[]) {
  const image = galleryImage(message, approvedOrigins);
  if (image.state !== 'ready') throw new GallerySelectionError('selected_image_unavailable', 404);
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new GallerySelectionError('selected_image_timeout', 504, true));
    }, SELECTED_IMAGE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetch(image.url, { signal: controller.signal, redirect: 'error', credentials: 'omit', headers: { Accept: image.mimeType } });
      if (!response.ok || !response.body) throw new GallerySelectionError('selected_image_unavailable', 404, true);
      if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== image.mimeType) throw new GallerySelectionError('selected_image_invalid', 415);
      const length = Number(response.headers.get('content-length'));
      if (length > SELECTED_IMAGE_MAX_BYTES) throw new GallerySelectionError('selected_image_too_large', 413);
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > SELECTED_IMAGE_MAX_BYTES) throw new GallerySelectionError('selected_image_too_large', 413);
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (!matchesImageSignature(bytes, image.mimeType)) throw new GallerySelectionError('selected_image_invalid', 415);
      let binary = '';
      for (let start = 0; start < bytes.byteLength; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
      return { type: 'image' as const, data: btoa(binary), mimeType: image.mimeType };
    })()]);
  } catch (error) {
    if (error instanceof GallerySelectionError) throw error;
    throw new GallerySelectionError('selected_image_unavailable', 502, true);
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => { /* A canceled stream must not mask the safe result. */ });
  }
}
