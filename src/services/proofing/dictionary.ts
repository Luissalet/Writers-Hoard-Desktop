import { db } from '@/db';
const keyFor = (projectId?: string) => `proofing:es-ES:${projectId || 'global'}`;
export async function loadPersonalWords(projectId?: string): Promise<string[]> {
  const row = await db.settings.where('key').equals(keyFor(projectId)).first();
  try { const words: unknown = JSON.parse(row?.value ?? '[]'); return Array.isArray(words) ? words.filter((word): word is string => typeof word === 'string') : []; }
  catch { return []; }
}
export async function editPersonalWord(word: string, action: 'add' | 'remove', projectId?: string): Promise<string[]> {
  const normalized = word.normalize('NFC').trim();
  if (!normalized) throw new Error('Indica una palabra.');
  return db.transaction('rw', db.settings, async () => {
    const key = keyFor(projectId); const row = await db.settings.where('key').equals(key).first();
    const words = await loadPersonalWords(projectId);
    const next = action === 'add' ? [...new Set([...words, normalized])] : words.filter(value => value !== normalized);
    await db.settings.put({ id: row?.id ?? key, key, value: JSON.stringify(next) });
    return next;
  });
}
