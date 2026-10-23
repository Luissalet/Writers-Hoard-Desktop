// The native script beside glossed words in the manuscript: drawn after each
// word of a language that asks for it, never written into the prose; set in
// the language settings and through wh_dictionary_settings.
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { db } from '@/db';
import { createDictionaryGlossPlugin, createGlossMatcher } from '@/engines/dictionary/glosses';
import { emptyWord, type WorldDictionary } from '@/engines/dictionary/types';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testDictionaryNativeProse(): Promise<string[]> {
  const passed: string[] = [];
  const word = { ...emptyWord(), word: 'shara', nativeForm: 'ᛋᚨᚱᚨ', meaning: 'mar' };
  const plain = { ...emptyWord(), word: 'kel', meaning: 'sal' };
  const dictionary: WorldDictionary = { id: 'dn', name: 'Élfico', description: '', scriptMapping: '', detectInManuscript: true, showNativeInProse: true, words: [word, plain] };
  const matcher = createGlossMatcher([dictionary]);
  const found = matcher('La shara y la kel, ᛋᚨᚱᚨ.');
  assert(found[0].native === 'ᛋᚨᚱᚨ' && found[1].native === undefined && found[2].native === undefined, `Native only beside the written word that has one: ${JSON.stringify(found)}`);
  assert(createGlossMatcher([{ ...dictionary, showNativeInProse: false }])('shara')[0].native === undefined, 'Off: no native');
  const host = document.getElementById('root'); assert(host, 'root');
  const editor = new Editor({ element: host, extensions: [StarterKit], content: '<p>La shara brilla.</p>' });
  try {
    editor.registerPlugin(createDictionaryGlossPlugin([dictionary], () => {}));
    await pause(100);
    const native = host.querySelector('[data-dictionary-native]');
    assert(native?.textContent === ' ᛋᚨᚱᚨ' && host.querySelector('.dictionary-gloss')?.nextSibling === native, `Drawn after the word: ${host.innerHTML}`);
    assert(editor.getHTML() === '<p>La shara brilla.</p>' && editor.getText() === 'La shara brilla.', `Prose unchanged: ${editor.getHTML()}`);
    passed.push('Manuscript: with "Mostrar la escritura nativa" on, "shara" is followed by ᛋᚨᚱᚨ drawn beside it (not beside the native form itself, not for a word with none); the prose stays "La shara brilla."');
  } finally {
    editor.destroy();
  }

  const P = 'dn-project';
  try {
    await db.projects.put({ id: P, title: 'Élfico', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['dictionary'], createdAt: 1, updatedAt: 1 } as Project);
    const created = await runBridgeTool('wh_dictionary_create', { projectId: P, name: 'Élfico' });
    assert(created.ok, JSON.stringify(created));
    const { dictionary: made, version } = created.result as { dictionary: WorldDictionary; version: string };
    const set = await runBridgeTool('wh_dictionary_settings', { projectId: P, dictionaryId: made.id, expectedVersion: version, detectInManuscript: true, showNativeInProse: true });
    assert(set.ok && (set.result as { dictionary: { showNativeInProse: boolean; detectInManuscript: boolean } }).dictionary.showNativeInProse && (set.result as { dictionary: { detectInManuscript: boolean } }).dictionary.detectInManuscript, JSON.stringify(set));
    const stale = await runBridgeTool('wh_dictionary_settings', { projectId: P, dictionaryId: made.id, expectedVersion: version, showNativeInProse: false });
    assert(!stale.ok, 'Stale version refused');
    passed.push('Bridge: wh_dictionary_settings turns on glosses and the native script beside them (a stale version is refused)');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
