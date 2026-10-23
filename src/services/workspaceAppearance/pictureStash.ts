// Side store for background pictures that an undo receipt needs but must not carry.
// Receipts (the bridge audit file, the in-window undo journal) record WHAT changed and a content
// hash for any picture; the bytes wait here. The store is bounded (newest few pictures) and an undo
// whose bytes were evicted is refused, never faked.
import { db } from '@/db';
import { getSetting } from '@/db/operations';

export const PICTURE_PREFIX = 'workspaceThemes.picture.';
export const PICTURE_INDEX_KEY = 'workspaceThemes.pictureIndex';
export const MAX_STASHED_PICTURES = 6;
export const MAX_STASH_CHARS = 24 * 1024 * 1024;

interface IndexEntry { hash: string; chars: number }

export async function pictureHash(dataUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const parseIndex = (raw: string | undefined): IndexEntry[] => {
  try { const data = JSON.parse(raw ?? '[]') as unknown; return Array.isArray(data) ? data.filter((item): item is IndexEntry => !!item && typeof (item as IndexEntry).hash === 'string' && typeof (item as IndexEntry).chars === 'number') : []; } catch { return []; }
};

/** Keeps the picture (deduplicated by content) and returns its hash. Oldest pictures are evicted past the bounds. */
export async function stashPicture(dataUrl: string): Promise<string> {
  const hash = await pictureHash(dataUrl), key = `${PICTURE_PREFIX}${hash}`;
  await db.transaction('rw', db.settings, async () => {
    const indexRow = await db.settings.where('key').equals(PICTURE_INDEX_KEY).first();
    const index = parseIndex(indexRow?.value).filter(item => item.hash !== hash);
    index.push({ hash, chars: dataUrl.length });
    const dropped: IndexEntry[] = [];
    // The newest picture always stays, even when it alone is over the character bound.
    while (index.length > 1 && (index.length > MAX_STASHED_PICTURES || index.reduce((sum, item) => sum + item.chars, 0) > MAX_STASH_CHARS)) dropped.push(index.shift()!);
    const row = await db.settings.where('key').equals(key).first();
    await db.settings.put({ id: row?.id ?? `set_${key}`, key, value: dataUrl });
    for (const item of dropped) await db.settings.where('key').equals(`${PICTURE_PREFIX}${item.hash}`).delete();
    await db.settings.put({ id: indexRow?.id ?? `set_${PICTURE_INDEX_KEY}`, key: PICTURE_INDEX_KEY, value: JSON.stringify(index) });
  });
  return hash;
}
/** The picture for a hash, or undefined when it was evicted (or no longer matches its hash). */
export async function loadStashedPicture(hash: string): Promise<string | undefined> {
  const value = await getSetting(`${PICTURE_PREFIX}${hash}`);
  return value && await pictureHash(value) === hash ? value : undefined;
}

/** The same values without picture bytes: `backgroundImageRef` is the hash of the stashed picture. */
export interface SlimValues { values: Record<string, unknown>; backgroundImageRef?: string }
export async function slimValues(values: Record<string, unknown>): Promise<SlimValues> {
  const { backgroundImage, ...rest } = values;
  if (typeof backgroundImage === 'string' && backgroundImage) return { values: rest, backgroundImageRef: await stashPicture(backgroundImage) };
  return { values: backgroundImage === null ? { ...rest, backgroundImage: null } : rest };
}
/** Inverse of `slimValues`; throws when the stashed picture is gone. */
export async function fatValues(slim: SlimValues): Promise<Record<string, unknown>> {
  if (!slim.backgroundImageRef) return slim.values;
  const picture = await loadStashedPicture(slim.backgroundImageRef);
  if (!picture) throw new Error('picture_gone');
  return { ...slim.values, backgroundImage: picture };
}
