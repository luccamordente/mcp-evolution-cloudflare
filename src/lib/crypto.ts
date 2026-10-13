/** Encrypts instance credentials with AES-GCM. The key is supplied as a Worker secret. */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function importKey(secret: string): Promise<CryptoKey> {
  const raw = fromBase64Url(secret);
  if (![16, 24, 32].includes(raw.length)) throw new Error('TOKEN_ENCRYPTION_KEY must be a base64url AES key (128, 192 or 256 bits)');
  return crypto.subtle.importKey('raw', raw as unknown as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptToken(token: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importKey(secret);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, encoder.encode(token) as unknown as BufferSource));
  return `${toBase64Url(iv)}.${toBase64Url(ciphertext)}`;
}

export async function decryptToken(value: string, secret: string): Promise<string> {
  const [ivPart, ciphertextPart] = value.split('.');
  if (!ivPart || !ciphertextPart) throw new Error('Invalid encrypted token');
  const key = await importKey(secret);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(ivPart) as unknown as BufferSource }, key, fromBase64Url(ciphertextPart) as unknown as BufferSource);
  return decoder.decode(plaintext);
}
