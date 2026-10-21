import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Editor } from '@tiptap/react';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { db } from '@/db';
import { deleteProject, exportProjectData, importProjectData } from '@/db/operations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { saveWorldEra } from '@/services/worldEras/store';
import { saveDictionary } from '@/engines/dictionary/operations';
import type { WorldDictionary } from '@/engines/dictionary/types';
import { useLocaleStore } from '@/stores/localeStore';
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const channel = window as unknown as { __want: unknown; __sizeAck?: number; __shot: unknown; __shotDone?: string; __native: unknown; __nativeAck?: number };
const pause = () => new Promise(resolve => setTimeout(resolve, 40)); let sequence = 0;
async function wait(check: () => boolean) { for (let i = 0; i < 200; i++) { if (check()) return; await pause(); } throw Error('Dictionary UI handshake timed out'); }
async function settle(check: () => boolean | Promise<boolean>) { for (let i = 0; i < 200; i++) { if (await check()) return; await act(async () => { await pause(); }); } throw Error('Dictionary UI did not settle'); }
async function native(events: unknown[]) { const n = ++sequence; await act(async () => { channel.__native = { n, events }; await wait(() => channel.__nativeAck === n); await pause(); }); }
async function click(node: HTMLElement) { node.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = node.getBoundingClientRect(), p = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), button: 'left', clickCount: 1 }; await native([{ type: 'mouseMove', x: p.x, y: p.y }, { type: 'mouseDown', ...p }, { type: 'mouseUp', ...p }]); }
const keys = (keyCode: string, modifiers?: string[]) => [{ type: 'keyDown', keyCode, modifiers }, { type: 'keyUp', keyCode, modifiers }];
export async function testDictionarySelectionUi() {
  const P = `dictionary-selection-${Date.now()}`, eraId = 'later', host = document.getElementById('root')!, root = createRoot(host), results: string[] = [];
  let editor: Editor | null = null, mounted = false, cloneId: string | undefined;
  const scope = { projectId: P, eraId }, content = '<p>shara acompaña al barco. La prosa sigue intacta.</p>';
  const tool = async <T,>(name: string, args: Record<string, unknown>) => { const result = await runBridgeTool(name, { ...scope, ...args }); assert(result.ok, JSON.stringify(result)); return result.result as T; };
  try {
    useLocaleStore.setState({ locale: 'es' });
    await db.projects.put({ id: P, title: 'Synthetic dictionary selection', mode: 'custom', type: 'standalone', enabledEngines: ['dictionary', 'writings', 'codex'], createdAt: 1, updatedAt: 1 });
    const created = await runBridgeTool('wh_dictionary_create', { projectId: P, name: 'Lúmico', description: 'Lengua del litoral' }); assert(created.ok, JSON.stringify(created));
    const base = created.result as { dictionary: WorldDictionary; version: string }, id = base.dictionary.id;
    const first = await runBridgeTool('wh_dictionary_save_word', { projectId: P, dictionaryId: id, expectedVersion: base.version, word: { word: 'shara', meaning: 'Luz de Base' } }); assert(first.ok, JSON.stringify(first));
    await saveWorldEra(P, { id: eraId, name: 'Later', description: '', revision: 0, createdAt: 1, updatedAt: 1 }, null);
    const currentBase = (await db.projects.get(P))!.dictionaries![0];
    await saveDictionary(P, { ...currentBase, detectInManuscript: true }, currentBase, eraId);
    const initial = await tool<{ dictionary: WorldDictionary; version: string }>('wh_dictionary_get', { dictionaryId: id });
    await tool('wh_dictionary_save_word', { dictionaryId: id, expectedVersion: initial.version, word: { ...initial.dictionary.words[0], meaning: 'Bruma de la era tardía' } });
    const get = () => tool<{ dictionary: WorldDictionary; version: string }>('wh_dictionary_get', { dictionaryId: id });
    for (const width of [1440, 640]) {
      const n = ++sequence;
      await act(async () => { channel.__want = { w: width, h: 1100, n }; await wait(() => channel.__sizeAck === n); root.render(<MemoryRouter><EnginePaneContext.Provider value={{ instanceId: `dictionary-${width}`, projectId: P, eraId, primary: true, visible: true }}><main className="min-h-screen bg-deep p-5 text-text-primary"><TiptapEditor key={width} content={content} onChange={() => {}} referenceContext={{ projectId: P, scopeId: 'prose' }} onEditorReady={value => { editor = value; }} /></main></EnginePaneContext.Provider></MemoryRouter>); mounted = true; await pause(); });
      await settle(() => !!editor && !!host.querySelector('[data-dictionary-word]'));
      const original = editor!.getHTML(); assert(host.querySelector('[data-dictionary-word]')?.getAttribute('title')?.includes('Bruma de la era tardía'), 'Hover definition did not use this era');
      host.querySelector<HTMLElement>('.ProseMirror')!.focus(); await native([...keys('HOME', ['control']), ...Array.from({ length: 5 }, () => keys('RIGHT', ['shift'])).flat()]);
      await settle(() => editor!.state.doc.textBetween(editor!.state.selection.from, editor!.state.selection.to) === 'shara');
      const dictionaryButton = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Diccionario'); assert(dictionaryButton, 'Selection dictionary action missing');
      dictionaryButton.focus(); await native([{type:'keyDown',keyCode:'ENTER'},{type:'char',keyCode:'ENTER'},{type:'keyUp',keyCode:'ENTER'}]);
      await settle(() => !!document.querySelector('[data-testid="selection-dictionary"]'));
      const dialog = () => document.querySelector<HTMLElement>('[data-testid="selection-dictionary"]')!;
      await settle(() => !!dialog().textContent?.includes('Bruma de la era tardía'));
      await click(dialog().querySelector<HTMLInputElement>('input[aria-label="Buscar la selección"]')!);
      const newWord = `vela${width}`; await native([...keys('A', ['control']), { type: 'text', text: newWord }]);
      await click([...dialog().querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Nueva palabra')!);
      await settle(() => !!dialog().querySelector('form textarea[required]'));
      assert(dialog().querySelector<HTMLInputElement>('form input[required]')?.value === newWord, 'New word did not inherit the chosen text');
      await click(dialog().querySelector<HTMLTextAreaElement>('form textarea[required]')!); await native([{ type: 'text', text: 'Vela del barco conservada en el diccionario local.' }]);
      await click([...dialog().querySelectorAll<HTMLButtonElement>('form button')].find(button => button.textContent === 'Guardar')!);
      await settle(() => !dialog().querySelector('form') && !!dialog().textContent?.includes('Vela del barco conservada'));
      assert((await get()).dictionary.words.some(word => word.word === newWord), 'MCP did not read the word created from prose');
      assert(editor!.getHTML() === original && !editor!.can().undo(), 'Dictionary actions changed prose or its Undo history');
      assert(document.documentElement.scrollWidth <= innerWidth + 1, 'Selection dictionary overflows horizontally');
      const shot = `dictionary-selection-${width}`; await act(async () => { channel.__shot = { name: shot }; await wait(() => channel.__shotDone === shot); });
      await native(keys('ESCAPE')); await settle(() => !document.querySelector('[data-testid="selection-dictionary"]'));
      results.push(`Native ${width}px: select prose by keyboard, open dictionary by Enter, read scoped hover/search, add through normal WordForm, preserve prose and Undo`);
    }
    await act(async () => root.unmount()); mounted = false;
    const current = await get();
    assert(!(await runBridgeTool('wh_dictionary_save_word', { ...scope, dictionaryId: id, expectedVersion: initial.version, word: { word: 'stale', meaning: 'Do not write' } })).ok, 'Stale dictionary write accepted');
    const search = await tool<{ dictionaries: { words: unknown[] }[] }>('wh_dictionary_search', { query: 'vela del barco' }); assert(search.dictionaries[0].words.length === 2, 'MCP search did not search meanings');
    assert((await db.projects.get(P))!.dictionaries![0].words.length === 1 && current.dictionary.words.length === 3, 'Era word editing changed Base');
    cloneId = await importProjectData(await exportProjectData(P));
    const clone = (await db.projects.get(cloneId))!, era = clone.worldEras!.find(item => item.name === 'Later')!;
    const cloned = await runBridgeTool('wh_dictionary_search', { projectId: cloneId, eraId: era.id, query: 'vela del barco' }); assert(cloned.ok && (cloned.result as { dictionaries: { words: unknown[] }[] }).dictionaries[0].words.length === 2, 'Cloned scoped dictionary lost new words');
    results.push('Four registered dictionary tools share storage/CAS; named-era new words and meanings survive JSON clone while Base remains intact');
    return results;
  } catch (error) { console.error(JSON.stringify({ stage: "dictionary selection", active: document.activeElement?.outerHTML, selection: editor?.state.selection.toJSON(), html: document.body.innerHTML.slice(-14000) })); throw error; } finally { if (mounted) await act(async () => root.unmount()); if (cloneId) await deleteProject(cloneId); await deleteProject(P); }
}
