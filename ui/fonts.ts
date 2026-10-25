import dmSans from './fonts/dm-sans-latin.woff2';
import manrope from './fonts/manrope-latin.woff2';

/** Register bundled binary fonts without fetching a URL in the host sandbox. */
export async function loadGalleryFonts(): Promise<boolean> {
  if (typeof FontFace === 'undefined' || !document.fonts) return false;
  try {
    const faces = [
      new FontFace('DM Sans', new Uint8Array(dmSans).buffer, { weight: '100 1000' }),
      new FontFace('Manrope', new Uint8Array(manrope).buffer, { weight: '200 800' }),
    ];
    await Promise.all(faces.map(face => face.load()));
    for (const face of faces) document.fonts.add(face);
    return true;
  } catch {
    // Keep the gallery usable with the host/system fallback if font loading fails.
    return false;
  }
}
