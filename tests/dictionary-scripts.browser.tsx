import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { exportProjectData, importProjectData } from '@/db/operations';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import '@/engines/dictionary';
import DictionaryEngine from '@/engines/dictionary/DictionaryEngine';
import { emptyWord, exportDictionary, nativeWord, parseDictionaryImport, parseScriptMapping, type WorldDictionary } from '@/engines/dictionary/types';
import { MAX_DICTIONARY_FONT_BYTES, decodeDictionaryFont, parseDictionaryFont, readDictionaryFont, type DictionaryFont } from '@/engines/dictionary/fonts';
import { presetMapping, scriptPresets } from '@/engines/dictionary/scripts';
import { saveDictionary } from '@/engines/dictionary/operations';
import { useDictionaryFont } from '@/engines/dictionary/useDictionaryFont';
import { dictionaryDrafts } from '@/engines/dictionary/drafts';
import { flushPendingWrites } from '@/services/pendingWrites';
import { useLocaleStore } from '@/stores/localeStore';
import { testFontBase64 } from './dictionary-test-font';

const pause = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function reject(work: () => unknown, message: string) { let rejected = false; try { work(); } catch { rejected = true; } assert(rejected, message); }
export async function testDictionaryScripts(): Promise<string[]> {
  const P = `script-font-${Date.now()}`, root = createRoot(document.getElementById('root')!), passed: string[] = [];
  const font: DictionaryFont = { name: 'Shapes.ttf', format: 'ttf', dataUrl: `data:font/ttf;base64,${testFontBase64}` };
  const dictionary: WorldDictionary = { id: `${P}-language`, name: 'Silver Tongue', description: '', scriptMapping: 'a=ⴰ', detectInManuscript: false, words: [{ ...emptyWord(), word: 'ara', meaning: 'silver' }] };
  const baseline = document.fonts.size;
  let cloned = '';
  const node = <T extends Element = HTMLElement>(id: string): T => { const found = document.querySelector<T>(`[data-testid="${id}"]`); assert(found, `Missing ${id}`); return found; };
  const waitFor = async (test: () => boolean, message: string) => { for (let i = 0; i < 100; i++) { if (test()) return; await act(async () => { await pause(); }); } throw new Error(message); };
  const click = async (text: string) => { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text || item.getAttribute('aria-label') === text); assert(button, `Missing button ${text}`); await act(async () => { button.click(); await pause(100); }); };
  const change = async (control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) => {
    const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value); control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(); });
  };
  const render = async () => act(async () => { root.render(<StrictMode><MemoryRouter><DictionaryEngine projectId={P} /></MemoryRouter></StrictMode>); await pause(180); });
  const upload = async (file: File) => { const transfer = new DataTransfer(); transfer.items.add(file); await act(async () => { const control = node<HTMLInputElement>('dictionary-font-upload'); control.files = transfer.files; control.dispatchEvent(new Event('change', { bubbles: true })); await pause(180); }); };
  try {
    for (const preset of scriptPresets) {
      const mapping = presetMapping(preset.id)!;
      assert(parseScriptMapping(mapping).size === 26 && !mapping.includes('undefined'), `${preset.name} has an editable mapping for all Latin letters`);
      const result = nativeWord({ word: 'Abc XYZ! 42', nativeForm: '' }, mapping);
      assert(result.endsWith('! 42') && !/[a-z]/i.test(result), `${preset.name} substitutes case-insensitive letters while preserving punctuation and numbers`);
      assert(nativeWord({ word: 'ara', nativeForm: 'chosen' }, mapping) === 'chosen', 'Saved native overrides remain authoritative');
    }
    assert(presetMapping('unknown') === undefined, 'Unknown presets cannot clear existing mappings');
    passed.push('Four Unicode presets cover Latin letters, preserve punctuation/native overrides and remain ordinary editable mappings');

    const { bytes } = decodeDictionaryFont(font);
    assert((await readDictionaryFont(new File([bytes], 'Shapes.ttf'))).dataUrl === font.dataUrl, 'Actual browser font parser accepts the procedural local test font');
    for (const bad of [{ ...font, dataUrl: 'https://example.com/font.ttf' }, { ...font, dataUrl: 'data:text/html;base64,SGVsbG8=' }, { ...font, format: 'woff2' }, { ...font, dataUrl: 'data:font/ttf;base64,====' }, { ...font, dataUrl: `data:font/ttf;base64,${'A'.repeat(Math.ceil(MAX_DICTIONARY_FONT_BYTES / 3) * 4 + 8)}` }]) {
      reject(() => parseDictionaryFont(bad), 'Unsafe, malformed, mismatched and oversized fonts must be rejected');
      const payload = JSON.parse(exportDictionary(dictionary)); payload.dictionary.font = bad;
      reject(() => parseDictionaryImport(JSON.stringify(payload)), 'Dictionary import rejects invalid font metadata before writes');
    }
    let invalidUpload = false; try { await readDictionaryFont(new File([new Uint8Array(20)], 'Invalid.ttf')); } catch { invalidUpload = true; }
    assert(invalidUpload, 'A renamed non-font upload is rejected');
    for (const file of [new File([bytes], 'Shapes.exe'), new File([new Uint8Array(MAX_DICTIONARY_FONT_BYTES + 1)], 'Too-big.ttf')]) {
      let rejected = false; try { await readDictionaryFont(file); } catch { rejected = true; } assert(rejected, 'Unsupported extension and oversized upload reject before decoding');
    }
    passed.push('Local font validation: valid font decoding succeeds; URL, MIME, signature, base64, extension and size checks reject invalid imports/uploads');

    function FontHarness({ value }: { value?: DictionaryFont }) { const loaded = useDictionaryFont(value); return <output data-testid="font-harness" style={{ fontFamily: loaded.fontFamily }}>{loaded.error ? 'error' : 'ready'}</output>; }
    await act(async () => { root.render(<StrictMode><FontHarness value={font} /></StrictMode>); await pause(120); });
    await waitFor(() => document.fonts.size === baseline + 1 && !!node<HTMLOutputElement>('font-harness').style.fontFamily, 'Font was not registered for native forms');
    const oldFamily = node<HTMLOutputElement>('font-harness').style.fontFamily;
    await act(async () => { root.render(<StrictMode><FontHarness value={{ ...font, name: 'Replacement.ttf' }} /></StrictMode>); await pause(120); });
    assert(document.fonts.size === baseline + 1 && node<HTMLOutputElement>('font-harness').style.fontFamily !== oldFamily, 'Replacing a font removes its previous registered face');
    await act(async () => { root.render(null); await pause(); }); assert(document.fonts.size === baseline, 'Unmount and StrictMode cleanup remove every owned font face');
    passed.push('Font lifecycle: actual FontFace loading, replacement and StrictMode/unmount cleanup leave no registered-font leaks');

    await db.projects.put({ id: P, title: 'Script fonts', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['dictionary'], engineOrder: ['dictionary'], createdAt: 1, updatedAt: 1 });
    await saveDictionary(P, { ...dictionary, font });
    const base = structuredClone((await db.projects.get(P))!.dictionaries![0]);
    await saveDictionary(P, { ...base, font: { ...font, name: 'Remote.ttf' } }, base);
    await saveDictionary(P, { ...base, description: 'Independent edit' }, base);
    let current = (await db.projects.get(P))!.dictionaries![0];
    assert(current.font?.name === 'Remote.ttf' && current.description === 'Independent edit', 'Unchanged font metadata merges a concurrent font edit');
    let conflict = false; try { await saveDictionary(P, { ...base, font: undefined }, base); } catch { conflict = true; }
    assert(conflict && (await db.projects.get(P))!.dictionaries![0].font?.name === 'Remote.ttf', 'Stale font removal cannot overwrite a concurrent font replacement');
    const imported = parseDictionaryImport(exportDictionary(current));
    assert(imported.font?.dataUrl === font.dataUrl && imported.font.name === 'Remote.ttf', 'Standalone dictionary JSON roundtrips embedded font bytes');
    cloned = await importProjectData(await exportProjectData(P));
    assert((await db.projects.get(cloned))!.dictionaries![0].font?.dataUrl === font.dataUrl, 'Project JSON cloning retains local font bytes');
    const archive = await createProjectZipArchive(P);
    await db.projects.delete(P); await importProjectZip(new File([archive.blob], archive.fileName));
    assert((await db.projects.get(P))!.dictionaries![0].font?.dataUrl === font.dataUrl, 'Actual ZIP archive restore retains embedded font bytes');
    passed.push('Dictionary/project portability retains embedded fonts; independent metadata merges and conflicting font removal rejects');

    useLocaleStore.setState({ locale: 'en' }); await render();
    await waitFor(() => !!document.querySelector('[data-testid="dictionary-native-word"]')?.getAttribute('style'), 'Saved font not applied to dictionary words');
    await click('Language settings');
    await change(node<HTMLSelectElement>('dictionary-script-preset'), 'ogham');
    await act(async () => { node<HTMLButtonElement>('dictionary-script-apply').click(); });
    await change(node<HTMLInputElement>('dictionary-script-sample'), 'ara');
    assert(node('dictionary-script-preview').textContent === nativeWord({ word: 'ara', nativeForm: '' }, presetMapping('ogham')!), 'Preset updates the real script preview');
    await upload(new File([bytes], 'Uploaded.ttf'));
    assert(node('dictionary-font-name').textContent === 'Uploaded.ttf' && node<HTMLOutputElement>('dictionary-script-preview').style.fontFamily, 'Font upload updates the draft and native preview');
    await upload(new File([new Uint8Array(15)], 'Broken.ttf'));
    assert(node('dictionary-font-name').textContent === 'Uploaded.ttf' && document.querySelector('[role="alert"]')?.textContent?.includes('previous font'), 'Rejected upload keeps the previous working draft font and shows an error');
    await click('Cancel'); await act(async () => { root.render(null); await pause(); }); await render();
    const recovery = document.querySelector('summary'); assert(recovery, 'Recovery journal is discoverable'); await act(async () => { recovery.click(); });
    // The language name appears once in navigation and once in the recovery list.
    const recoverButton = [...document.querySelectorAll<HTMLButtonElement>('details button')].find(item => item.textContent === 'Silver Tongue'); assert(recoverButton, 'Language recovery action'); await act(async () => { recoverButton.click(); await pause(150); });
    assert(node('dictionary-font-name').textContent === 'Uploaded.ttf' && [...document.querySelectorAll<HTMLTextAreaElement>('form textarea')].some(item => item.value === presetMapping('ogham')), 'Cancelled preset/font draft recovers after the engine remount');
    const fail = () => { throw new Error('Expected dictionary write failure'); }; db.projects.hook('updating', fail);
    await click('Save'); db.projects.hook('updating').unsubscribe(fail);
    assert(node('dictionary-font-name').textContent === 'Uploaded.ttf' && dictionaryDrafts(P).size > 0, 'Failed save retains live font, mapping and recovery draft');
    await click('Save'); current = (await db.projects.get(P))!.dictionaries![0];
    assert(current.font?.name === 'Uploaded.ttf' && current.scriptMapping === presetMapping('ogham'), 'Recovered font/mapping save together without losing words');
    await click('Language settings'); await act(async () => { node<HTMLButtonElement>('dictionary-font-remove').click(); }); await click('Save');
    assert(!(await db.projects.get(P))!.dictionaries![0].font, 'Removing a local font persists while preserving the script mapping');
    await act(async () => { root.render(null); await pause(); }); assert(document.fonts.size === baseline, 'Closing dictionary releases saved and draft font registrations');
    passed.push('Dictionary UI: preset preview, real font upload, rejection preservation, durable cancelled drafts, failed-save retry and saved removal work end to end');
    return passed;
  } finally {
    await act(async () => { root.unmount(); }); dictionaryDrafts(P).clear(); await flushPendingWrites();
    await db.projects.bulkDelete([P, cloned].filter(Boolean));
  }
}
