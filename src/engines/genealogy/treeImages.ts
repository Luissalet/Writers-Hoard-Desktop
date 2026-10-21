export const MAX_TREE_IMAGE_BYTES = 8 * 1024 * 1024;
export function validTreeImage(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length > Math.ceil(MAX_TREE_IMAGE_BYTES / 3) * 4) return false;
  try {
    const bytes = atob(match[2]); if (bytes.length > MAX_TREE_IMAGE_BYTES) return false;
    return match[1] === 'png' ? bytes.startsWith('\x89PNG\r\n\x1a\n') : match[1] === 'jpeg' ? bytes.startsWith('\xff\xd8\xff') : bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  } catch { return false; }
}
export async function decodeTreeImage(value: string): Promise<void> {
  if (!validTreeImage(value)) throw Error('invalid_tree_image');
  await new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => image.naturalWidth && image.naturalHeight ? resolve() : reject(Error('invalid_tree_image')); image.onerror = () => reject(Error('invalid_tree_image')); image.src = value; });
}
