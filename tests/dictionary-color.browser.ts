import { db } from '@/db';
import type { Project } from '@/types';
import { saveDictionary } from '@/engines/dictionary/operations';
import type { WorldDictionary } from '@/engines/dictionary/types';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** A language's book colour: chosen in its settings, kept, refused when not a colour, set by the bridge. */
export async function testDictionaryColor(): Promise<string[]> {
  const P = 'synthetic-dictionary-color';
  try {
    await db.projects.put({ id: P, title: 'Lenguas', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['dictionary'], createdAt: 1, updatedAt: 1 } satisfies Project);
    const made = await runBridgeTool('wh_dictionary_create', { projectId: P, name: 'Élfico', color: '#3d85c6' });
    assert(made.ok, JSON.stringify(made));
    const dictionary = (await db.projects.get(P))!.dictionaries![0];
    assert(dictionary.color === '#3d85c6', `Created with its colour: ${JSON.stringify(dictionary)}`);
    let refused = false;
    try { await saveDictionary(P, { ...dictionary, color: 'red' } as WorldDictionary, dictionary); } catch { refused = true; }
    assert(refused, 'A colour that is not #rrggbb is refused');
    await saveDictionary(P, { ...dictionary, color: '#c0504d' }, dictionary);
    assert((await db.projects.get(P))!.dictionaries![0].color === '#c0504d', 'Changed in its settings');
    return ['A language carries the colour of its book: wh_dictionary_create sets it, the language settings change it (only #rrggbb), and the list draws the book in it'];
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
