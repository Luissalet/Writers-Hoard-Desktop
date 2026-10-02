// ============================================================================
// Pictures for another app: a stored data URL as a PNG, small enough to send
// ============================================================================
//
// Prospero takes image files. The codex keeps portraits as base64 data URLs of
// any web format, so each one is decoded and re-encoded as a PNG here, in the
// renderer, shrunk so its longest edge is at most 1280 px — a portrait or a
// storyboard frame loses nothing a cast sheet or a shot list can use, and a
// forty-panel storyboard stays well under the size limit main enforces.

export const SEND_MAX_EDGE = 1280;

/** Base64 of a PNG (no `data:` prefix) for a stored image data URL, or null when it cannot be read as an image. */
export async function dataUrlToPngBase64(dataUrl: string | undefined, maxEdge = SEND_MAX_EDGE): Promise<string | null> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
  try {
    // Decoded by hand, not fetch()ed: a data: URL is not always allowed by the page's connect-src.
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
    if (!match) return null;
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: match[1] });
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL('image/png');
      return png.startsWith('data:image/png;base64,') ? png.slice('data:image/png;base64,'.length) : null;
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
