import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { db } from '@/db';
import DictionaryEngine from '@/engines/dictionary/DictionaryEngine';
import { emptyWord, exportDictionary, nativeWord, parseDictionaryImport, searchWords, type WorldDictionary } from '@/engines/dictionary/types';
import { removeDictionary, removeWord, saveDictionary, saveWord } from '@/engines/dictionary/operations';
import { createDictionaryGlossPlugin, createGlossMatcher } from '@/engines/dictionary/glosses';
import { useLocaleStore } from '@/stores/localeStore';
import { dictionaryCopy } from '@/engines/dictionary/copy';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
export async function testVvdDictionary(): Promise<string[]> {
  const passed: string[] = [];
  const P = `dictionary-${Date.now()}`, Q = `${P}-other`;
  const word = { ...emptyWord(), word: 'shara', meaning: 'luz del alba', pronunciation: 'ˈʃa.ra', examples: 'La shara cruza el mar.', phrases: 'shara lum', derivatives: 'sharan', origin: 'Antiguo', partOfSpeech: 'nombre' };
  const dictionary: WorldDictionary = { id: `${P}-language`, name: 'Lúmico', description: 'Lengua del litoral', scriptMapping: 's=ⵙ\nsh=ⵛ\na=ⴰ', detectInManuscript: true, words: [word] };
  const root = createRoot(document.getElementById('root')!);
  let editor: Editor | undefined;
  useLocaleStore.setState({ locale: 'es' });
  const click = async (text: string) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text);
    assert(button, `Missing ${text}`); await act(async () => { button.click(); await pause(100); });
  };
  const setInput = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const prototype = input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); await pause(); });
  };
  try {
    const project = { id: P, title: 'Synthetic dictionary test', mode: 'custom' as const, type: 'standalone' as const, color: '#aaa', description: '', status: 'draft' as const, enabledEngines: ['dictionary'], engineOrder: ['dictionary'], createdAt: 1, updatedAt: 1 };
    await db.projects.bulkPut([project, { ...project, id: Q }]);
    assert(nativeWord(word, dictionary.scriptMapping) === 'ⵛⴰrⴰ', 'Longest script digraph should win');
    assert(nativeWord({ ...word, nativeForm: '𐌰' }, dictionary.scriptMapping) === '𐌰', 'Native overrides must win');
    assert(searchWords(dictionary, 'alba').length === 1 && searchWords(dictionary, 'sharan').length === 1 && searchWords(dictionary, 'ⵛ').length === 1, 'Search meanings, derivatives and native script');
    const imported = parseDictionaryImport(exportDictionary(dictionary));
    assert(imported.id !== dictionary.id && imported.words[0].id !== word.id && imported.words[0].meaning === word.meaning && !imported.detectInManuscript, 'Portable import must use fresh IDs and require detection opt-in');
    for (const payload of ['{}', '{"format":"writers-dictionary-v1","dictionary":{"name":"X","words":[{"word":"x"}]}}']) {
      let rejected = false; try { parseDictionaryImport(payload); } catch { rejected = true; } assert(rejected, 'Malformed import must fail before writes');
    }
    passed.push('Dictionary: Unicode scripts, longest digraphs, per-word overrides, comprehensive search and validated portable import/export');

    await saveDictionary(P, dictionary);
    const second = { ...emptyWord(), word: 'lume', meaning: 'llama' };
    await Promise.all([saveWord(P, dictionary.id, second), saveDictionary(P, { ...dictionary, description: 'Actualizado' })]);
    let stored = (await db.projects.get(P))!.dictionaries![0];
    assert(stored.words.length === 2 && stored.description === 'Actualizado', 'Concurrent metadata and word edits must not lose words');
    assert(!(await db.projects.get(Q))!.dictionaries, 'Words must remain in their project');
    await removeWord(P, dictionary.id, second.id);
    await db.close(); await db.open();
    stored = (await db.projects.get(P))!.dictionaries![0];
    assert(stored.words.length === 1 && stored.words[0].phrases === word.phrases, 'Word anatomy must survive DB reopen');
    const backupRow = JSON.parse(JSON.stringify(await db.projects.get(P)));
    assert(backupRow.dictionaries[0].words[0].id === word.id, 'Project metadata serialization must preserve dictionaries');
    passed.push('Dictionary: serialized project persistence, project isolation, reopen, concurrent metadata/word edits and deletion');

    const matcher = createGlossMatcher([dictionary]);
    assert(matcher('SHARA sharan shara. ⵛⴰrⴰ').length === 3, 'Glosses match whole words, native spelling and case, without partial-word false positives');
    assert(createGlossMatcher([{ ...dictionary, detectInManuscript: false }])('shara').length === 0, 'Detection OFF must remove all glosses');
    let opened = '';
    const host = document.createElement('div'); document.body.append(host);
    editor = new Editor({ element: host, extensions: [StarterKit], content: '<p>shara <a href="https://example.com">shara</a> <code>shara</code></p><pre><code>shara</code></pre>' });
    const original = editor.getHTML();
    editor.registerPlugin(createDictionaryGlossPlugin([dictionary], id => { opened = id; }));
    const glosses = host.querySelectorAll<HTMLElement>('[data-dictionary-word]');
    assert(glosses.length === 1 && glosses[0].title.includes('luz del alba'), 'Decorations must skip existing links and code');
    glosses[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert(opened === word.id && editor.getHTML() === original && !editor.getHTML().includes('dictionary-gloss'), `Opening a gloss must leave HTML and undo history untouched: opened=${opened}, expected=${word.id}, unchanged=${editor.getHTML() === original}`);
    editor.destroy(); editor = undefined; host.remove();
    passed.push('Manuscript: live read-only gloss decorations, whole-word matching, native script, OFF state, no code/link interference and direct dictionary navigation');

    const render = async () => { await act(async () => { root.render(<StrictMode><MemoryRouter><DictionaryEngine projectId={P} /></MemoryRouter></StrictMode>); await pause(200); }); await act(async () => { await pause(200); }); };
    await render();
    assert(document.body.textContent?.includes('luz del alba'), 'Persisted dictionary must be visible in real UI');
    await click('Nueva palabra');
    const inputs = document.querySelectorAll<HTMLInputElement>('form input');
    await setInput(inputs[0], 'nora');
    const meaning = [...document.querySelectorAll<HTMLTextAreaElement>('form textarea')][0];
    await setInput(meaning, 'estrella lejana');
    await click('Guardar');
    await act(async () => { await pause(300); });
    assert((await db.projects.get(P))!.dictionaries![0].words.some(word => word.word === 'nora'), 'UI must persist new word');
    const search = document.querySelector<HTMLInputElement>(`input[aria-label="${dictionaryCopy.es.search}"]`)!;
    await setInput(search, 'estrella');
    assert(document.body.textContent?.includes('nora') && !document.querySelector(`[data-word-id="${word.id}"]`), 'UI must filter by meaning');
    await act(async () => { useLocaleStore.setState({ locale: 'en' }); await pause(); });
    assert(document.body.textContent?.includes('New word'), 'English UI must render translated controls');
    passed.push('Dictionary UI: StrictMode mounting, create/save word, live persistence, meaning filter and ES/EN controls');

    await click('New word'); await setInput(document.querySelector<HTMLInputElement>('form input')!, 'lume'); await click('Cancel');
    await act(async () => { root.render(<div />); await pause(); }); await render();
    const recovery = [...document.querySelectorAll('summary')].find(item => item.textContent?.includes('Recover drafts'));
    assert(recovery, 'Cancelled word must have a discoverable recovery journal');
    await act(async () => { recovery.click(); await pause(); }); await click('lume');
    assert(document.querySelector<HTMLInputElement>('form input')?.value === 'lume' && document.body.textContent?.includes('Recovered local draft'), 'Engine remount must reopen the exact unsaved spelling');
    await setInput(document.querySelector<HTMLTextAreaElement>('form textarea')!, 'flame'); await click('Save');
    assert((await db.projects.get(P))!.dictionaries![0].words.some(word => word.word === 'lume'), 'Recovered draft can be completed and saved');
    passed.push('Dictionary recovery: cancelled input survives engine remount, can be resumed and clears on successful save');

    const base = structuredClone((await db.projects.get(P))!.dictionaries![0].words.find(item => item.id === word.id)!);
    await saveWord(P, dictionary.id, { ...base, origin: 'Remote etymology' }, base);
    await saveWord(P, dictionary.id, { ...base, meaning: 'Local meaning' }, base);
    const merged = (await db.projects.get(P))!.dictionaries![0].words.find(item => item.id === word.id)!;
    assert(merged.origin === 'Remote etymology' && merged.meaning === 'Local meaning', 'Independent word fields must merge');
    let conflict = false; try { await saveWord(P, dictionary.id, { ...base, origin: 'Competing etymology' }, base); } catch { conflict = true; }
    assert(conflict && (await db.projects.get(P))!.dictionaries![0].words.find(item => item.id === word.id)!.origin === 'Remote etymology', 'Conflicting field must reject without overwriting the latest word');
    passed.push('Dictionary editing: independent fields merge and concurrent same-field edits preserve the latest saved value');

    await removeDictionary(P, dictionary.id);
    assert((await db.projects.get(P))!.dictionaries!.length === 0 && await db.projects.get(Q), 'Dictionary deletion must preserve other project data');
    return passed;
  } finally {
    editor?.destroy();
    await act(async () => { root.unmount(); });
    await db.projects.bulkDelete([P, Q]);
  }
}
