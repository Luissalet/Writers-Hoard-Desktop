import { base64FromBytes } from '@/services/documents/client';
import { sha256Hex } from '@/services/judge/text';
import { MAX_SOURCE_BYTES, MAX_TOTAL_BYTES } from '@/engines/writings/manuscriptImport';
import { folderPath } from './paths';
import type { WorldFolderFile, WorldFolderPasted } from './types';

/** Most pasted pieces one import may carry. */
export const MAX_PASTED_FILES = 200;

/** A line holding only this text ends one pasted document and starts the next. */
export const PASTE_SEPARATOR = '---8<---';

/** The pieces of one pasted text, without empty ones. */
export function splitPasted(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n').reduce<string[][]>((groups, line) => {
    if (line.trim() === PASTE_SEPARATOR) groups.push([]); else groups.at(-1)!.push(line);
    return groups;
  }, [[]]).map(lines => lines.join('\n')).filter(piece => piece.trim());
}
const safeName = (name: string | undefined): string => (name ?? '').replace(/[\\/:*?"<>|]/g, '-').split('').filter(char => char.charCodeAt(0) >= 32).join('').replace(/\.(?:md|markdown|txt)$/i, '').replace(/^\.+/, '').trim().slice(0, 80);

/**
 * Pasted text as ordinary files (`pasted.md`, `pasted-2.md`, or the chosen
 * name). The same bytes go through the same reader, so the plan digest and the
 * stale-review checks bind them exactly like a file from disk. A name that an
 * earlier import used for DIFFERENT text moves to the next free number, so a
 * second paste never reads as a changed source.
 */
export async function pastedFolderFiles(pasted: readonly WorldFolderPasted[] | undefined, taken: ReadonlySet<string>, imported: readonly { path: string; sha256: string }[]): Promise<WorldFolderFile[]> {
  if (pasted === undefined) return [];
  if (!Array.isArray(pasted) || pasted.some(item => !item || typeof item.text !== 'string' || item.name !== undefined && typeof item.name !== 'string')) throw Error('world_folder_pasted_invalid');
  const used = new Set(taken), files: WorldFolderFile[] = [];
  let totalBytes = 0;
  for (const item of pasted) {
    const pieces = splitPasted(item.text), base = safeName(item.name) || 'pasted';
    for (const piece of pieces) {
      const bytes = new TextEncoder().encode(piece.replace(/^\ufeff/, ''));
      totalBytes += bytes.length;
      if (bytes.length > MAX_SOURCE_BYTES || totalBytes > MAX_TOTAL_BYTES) throw Error('world_folder_pasted_too_large');
      if (files.length >= MAX_PASTED_FILES) throw Error('world_folder_pasted_too_many');
      const sha = await sha256Hex(bytes);
      let ordinal = 1, path = '';
      for (;; ordinal += 1) {
        path = folderPath(`${base}${ordinal > 1 ? `-${ordinal}` : ''}.md`);
        if (!used.has(path) && !imported.some(file => file.path === path && file.sha256 !== sha)) break;
      }
      used.add(path);
      files.push({ path, dataBase64: base64FromBytes(bytes) });
    }
  }
  return files;
}
