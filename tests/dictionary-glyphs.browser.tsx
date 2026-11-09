import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import '@/engines/dictionary';
import DictionaryEngine from '@/engines/dictionary/DictionaryEngine';
import { dictionaryDrafts } from '@/engines/dictionary/drafts';
import { emptyWord, type WorldDictionary } from '@/engines/dictionary/types';
import { useLocaleStore } from '@/stores/localeStore';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const rawMapping = ['// Retain this authored line', 'a=ⵓ', 'sh=ᛋ', 'a=ⴰ', 'b=ⴱ', 'l=ⵍ', 'm=ⵎ', 'blank=', 'not a mapping line', '𐌰=𐌱', '  extra=Ω  ', ''].join('\r\n');

async function mountDictionary() {
  const projectId = 'glyph-ui-' + crypto.randomUUID();
  const dictionary: WorldDictionary = { id: projectId + '-language', name: 'Own glyph fixture', description: '', scriptMapping: rawMapping, detectInManuscript: false,
    words: [{ ...emptyWord(), id: projectId + '-ala', word: 'ala', meaning: 'Own door' }, { ...emptyWord(), id: projectId + '-ama', word: 'ama', meaning: 'Own light', nativeForm: 'Ω' }] };
  await db.projects.put({ id: projectId, title: 'Own glyph UI', description: '', mode: 'custom', type: 'standalone', color: '#777777', status: 'draft', enabledEngines: ['dictionary'], engineOrder: ['dictionary'], dictionaries: [dictionary], createdAt: 1, updatedAt: 1 });
  const previousLocale = useLocaleStore.getState().locale;
  useLocaleStore.setState({ locale: 'en' });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const wait = async (test: () => unknown | Promise<unknown>, message: string) => {
    for (let i = 0; i < 100; i++) { if (await test()) return; await act(async () => { await pause(); }); }
    throw Error(message);
  };
  const render = async () => { await act(async () => { root.render(<StrictMode><MemoryRouter><DictionaryEngine projectId={projectId} /></MemoryRouter></StrictMode>); }); await wait(() => host.querySelector('[data-word-id]'), 'Normal Dictionary did not load own words'); };
  const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => (item.getAttribute('aria-label') ?? item.textContent)?.trim() === name);
  const click = async (name: string) => { const target = button(name); assert(target, 'Missing visible Dictionary control: ' + name); await act(async () => { target.click(); await pause(); }); };
  const control = (name: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | undefined => {
    const named = [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')].find(item => item.getAttribute('aria-label') === name);
    return named ?? [...host.querySelectorAll('label')].find(item => item.textContent?.trim() === name)?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select') ?? undefined;
  };
  const change = async (target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
    const prototype = target instanceof HTMLSelectElement ? HTMLSelectElement.prototype : target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(target, value); target.dispatchEvent(new Event(target instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await pause(); });
  };
  const saved = async () => (await db.projects.get(projectId))!.dictionaries!.find(item => item.id === dictionary.id)!;
  const remount = async () => { await act(async () => { root.render(null); await pause(); }); await render(); };
  const cleanup = async () => { await act(async () => { root.unmount(); await pause(); }); host.remove(); dictionaryDrafts(projectId).clear(); await db.projects.delete(projectId); useLocaleStore.setState({ locale: previousLocale }); };
  try { await render(); } catch (error) { await cleanup(); throw error; }
  return { projectId, dictionary, host, wait, click, button, control, change, saved, remount, cleanup };
}

/** Real form, selection and persistence: no proposed glyph helper is imported. */
export async function testDictionaryGlyphCaretUI(): Promise<string[]> {
  const ui = await mountDictionary();
  try {
    await ui.click('ama');
    const input = ui.control('Native form override') as HTMLInputElement | undefined;
    assert(input?.value === 'Ω', 'Normal word form lost its existing Unicode override');
    input.focus(); input.setSelectionRange(1, 1); input.dispatchEvent(new Event('select', { bubbles: true }));
    assert(ui.button('Insert glyph'), 'Missing visible native-form glyph palette in normal WordForm');
    await ui.click('Insert glyph');
    await ui.click('ⴱ');
    assert(input.value === 'Ωⴱ' && input.selectionStart === 2 && input.selectionEnd === 2 && document.activeElement === input, 'A visual glyph must insert at the native input caret and return focus');
    assert((await ui.saved()).words.find(item => item.id.endsWith('-ama'))!.nativeForm === 'Ω', 'Choosing a glyph must remain an unsaved draft');
    await ui.change(input, 'Ωxy'); input.focus(); input.setSelectionRange(1, 3); input.dispatchEvent(new Event('select', { bubbles: true }));
    if (!ui.button('ⴱ')) await ui.click('Insert glyph');
    await ui.click('ⴱ');
    assert(input.value === 'Ωⴱ' && input.selectionStart === 2 && input.selectionEnd === 2, 'Glyph insertion must replace only the selected range');
    await ui.click('Save'); await ui.wait(async () => (await ui.saved()).words.find(item => item.id.endsWith('-ama'))?.nativeForm === 'Ωⴱ', 'Normal Save did not retain the inserted glyph');
    await ui.remount(); assert(ui.host.querySelector('[data-word-id="' + ui.dictionary.words[1].id + '"]')?.textContent?.includes('Ωⴱ'), 'Reopened normal Dictionary lost the glyph');
    const read = await runBridgeTool('wh_dictionary_search', { projectId: ui.projectId, query: 'ama' });
    assert(read.ok && JSON.stringify(read.result).includes('Ωⴱ'), 'Existing public Dictionary search must read the same saved native form');
    return ['Normal WordForm inserts a visually selected glyph at the caret, replaces the selection, keeps draft semantics, saves and reopens through existing UI/MCP'];
  } finally { await ui.cleanup(); }
}

/** Observable per-association editing; authored raw lines and duplicate precedence are the oracle. */
export async function testDictionaryLetterMapUI(): Promise<string[]> {
  const ui = await mountDictionary();
  try {
    await ui.click('Language settings');
    const glyph = ui.control('Glyph for a') as HTMLInputElement | undefined;
    assert(glyph, 'Missing visible single-association glyph editor for a in normal Language settings');
    assert(glyph.value === 'ⴰ', 'Association editor must show the last effective duplicate key');
    await ui.change(glyph, 'ᚨ'); await ui.click('Save');
    const changed = rawMapping.replace('a=ⴰ', 'a=ᚨ');
    await ui.wait(async () => (await ui.saved()).scriptMapping === changed, 'One association edit must preserve all other raw lines, CRLF, duplicates, multichar and blank entries');
    assert(ui.host.querySelector('[data-word-id="' + ui.dictionary.words[0].id + '"]')?.textContent?.includes('ᚨⵍᚨ'), 'Normal word list must derive the individually edited glyph');
    assert((await ui.saved()).words[1].nativeForm === 'Ω', 'Editing the map must preserve a native override');
    await ui.remount(); await ui.click('Language settings');
    const preset = ui.host.querySelector<HTMLSelectElement>('[data-testid="dictionary-script-preset"]'); assert(preset, 'Existing explicit preset selector must remain available');
    await ui.change(preset, 'tifinagh');
    assert((await ui.saved()).scriptMapping === changed, 'Exploring/selecting a reference preset must not apply a whole language mapping');
    await ui.click('Reset a to Tifinagh'); await ui.click('Save');
    await ui.wait(async () => (await ui.saved()).scriptMapping === rawMapping, 'Individual preset reset must restore only a, keeping raw authored lines and duplicate order');
    const read = await runBridgeTool('wh_dictionary_search', { projectId: ui.projectId, query: 'ala' });
    assert(read.ok && JSON.stringify(read.result).includes('ⴰⵍⴰ'), 'Existing public search must read the individually reset association');
    return ['Normal Language settings edits the effective duplicate association, preserves all authored raw lines/Unicode/blank/digraphs, and resets one key from an explicitly selected preset without replacing the map'];
  } finally { await ui.cleanup(); }
}
/** Keyboard-reachable native controls and Escape exercise the actual palette handlers. */
export async function testDictionaryGlyphKeyboardUI(): Promise<string[]> {
  const ui = await mountDictionary();
  try {
    await ui.click('ama');
    const input = ui.control('Native form override') as HTMLInputElement; input.focus(); input.setSelectionRange(1, 1);
    const trigger = ui.button('Insert glyph'); assert(trigger && trigger.tabIndex >= 0, 'Glyph action must be keyboard reachable');
    trigger.focus(); await ui.click('Insert glyph');
    const region = ui.host.querySelector<HTMLElement>('[role="region"][aria-label="Glyphs"]'); assert(region, 'Opened glyph region must have an accessible name');
    const select = region.querySelector('select'); assert(select && document.activeElement === select, 'Opening the palette must focus its native set selector');
    await ui.change(select, 'runic');
    assert(region.querySelector('button[aria-label="ᚠ"]') && region.querySelector('button[aria-label="ᛪ"]'), 'Declared Runic subset must contain its observed endpoints');
    assert((await ui.saved()).scriptMapping === rawMapping && input.value === 'Ω', 'Exploring another glyph set must not replace the language mapping or override');
    const glyph = region.querySelector<HTMLButtonElement>('button[aria-label="ᚨ"]'); assert(glyph && glyph.tabIndex >= 0, 'Glyph choices must use keyboard-reachable buttons');
    glyph.focus();
    await act(async () => { glyph.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await pause(); });
    assert(!ui.host.querySelector('[role="region"][aria-label="Glyphs"]') && document.activeElement === input && input.selectionStart === 1 && input.value === 'Ω', 'Escape must close only the palette and restore the native input selection without editing');
    await ui.click('Insert glyph'); const next = ui.host.querySelector('[role="region"][aria-label="Glyphs"]')!;
    const sets = next.querySelector('select')!; await ui.change(sets, 'tifinagh');
    assert(next.querySelector('button[aria-label="ⴰ"]') && next.querySelector('button[aria-label="ⵧ"]'), 'Declared Tifinagh subset must contain its observed endpoints');
    await ui.click('Close glyph palette');
    assert(document.activeElement === input && !ui.host.querySelector('[role="region"][aria-label="Glyphs"]'), 'Explicit close must restore native input focus');
    await ui.click('Cancel');
    assert((await ui.saved()).words[1].nativeForm === 'Ω' && (await ui.saved()).scriptMapping === rawMapping, 'Closing or cancelling glyph exploration must not mutate a document');
    return ['Palette uses keyboard-reachable native controls, focuses its set selector, includes the declared Unicode subsets and returns focus/selection on Escape or close without persisting exploration'];
  } finally { await ui.cleanup(); }
}

/** Selection changes must update the already-open palette, without toggling it. */
export async function testDictionaryGlyphLimitEnablesUI(): Promise<string[]> {
  const ui = await mountDictionary();
  try {
    await ui.click('ama'); const input = ui.control('Native form override') as HTMLInputElement;
    const full = 'x'.repeat(50000); await ui.change(input, full);
    input.focus(); input.setSelectionRange(full.length, full.length); await ui.click('Insert glyph');
    const palette = ui.host.querySelector('[role="region"][aria-label="Glyphs"]');
    const glyph = ui.button('ⴱ'); assert(glyph?.disabled, 'At maxlength with a collapsed caret the glyph must initially be disabled');
    await act(async () => { input.focus(); input.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); input.setSelectionRange(0, full.length); document.dispatchEvent(new Event('selectionchange')); input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true })); await pause(); });
    assert(ui.host.querySelector('[role="region"][aria-label="Glyphs"]') === palette, 'Selecting text must keep the same palette open');
    assert(!glyph.disabled, 'Selecting all in the open palette must immediately enable a glyph that replaces that selection');
    await ui.click('ⴱ');
    assert(input.value === 'ⴱ' && input.selectionStart === 1 && input.selectionEnd === 1, 'Replacement at maxlength must replace the selected text and restore its caret');
    assert((await ui.saved()).words[1].nativeForm === 'Ω', 'A maxlength replacement remains an unsaved draft');
    return ['An open native glyph palette reacts to selection growth at maxlength and enables a valid replacement without reopening'];
  } finally { await ui.cleanup(); }
}

/** Collapse disables choices; even a click before the next selection render cannot overflow. */
export async function testDictionaryGlyphLimitRejectsUI(): Promise<string[]> {
  const ui = await mountDictionary();
  try {
    await ui.click('ama'); const input = ui.control('Native form override') as HTMLInputElement;
    const full = 'x'.repeat(50000); await ui.change(input, full);
    input.focus(); input.setSelectionRange(0, full.length); await ui.click('Insert glyph');
    const palette = ui.host.querySelector('[role="region"][aria-label="Glyphs"]');
    const glyph = ui.button('ⴱ'); assert(glyph && !glyph.disabled, 'A replacement that fits must initially be enabled');
    await act(async () => { input.focus(); input.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); input.setSelectionRange(full.length, full.length); document.dispatchEvent(new Event('selectionchange')); input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true })); await pause(); });
    const disabledAfterCollapse = glyph.disabled;
    await act(async () => { glyph.click(); await pause(); });
    assert(input.value === full && input.selectionStart === full.length && input.selectionEnd === full.length,
      `An open-palette click after collapse must preserve maxlength text and caret; length=${input.value.length}, disabled=${disabledAfterCollapse}`);
    assert(disabledAfterCollapse && ui.host.querySelector('[role="region"][aria-label="Glyphs"]') === palette, 'Collapsing the selection must disable the same open palette before choosing');
    await act(async () => { input.focus(); input.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); input.setSelectionRange(0, full.length); document.dispatchEvent(new Event('selectionchange')); input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true })); await pause(); });
    assert(!glyph.disabled, 'Selection growth must re-enable replacement before exercising the pending-selection race');
    await act(async () => { input.setSelectionRange(full.length, full.length); assert(!glyph.disabled, 'The pending-selection race must reach an enabled choice before React updates selection state'); glyph.click(); await pause(); });
    assert(input.value === full && input.selectionStart === full.length && input.selectionEnd === full.length && ui.host.querySelector('[role="region"][aria-label="Glyphs"]') === palette,
      'The choose action must recheck the actual current range before a queued selection event/render, preserving text, caret and open palette when it does not fit');
    assert((await ui.saved()).words[1].nativeForm === 'Ω', 'Rejected glyph choices must not save or alter the stored override');
    return ['An open native glyph palette reacts to selection collapse and the choose action rechecks the actual range before a pending selection render, preventing maxlength overflow without losing text or caret'];
  } finally { await ui.cleanup(); }
}
export async function testDictionaryGlyphsUI(): Promise<string[]> {
  return [...await testDictionaryGlyphCaretUI(), ...await testDictionaryLetterMapUI(), ...await testDictionaryGlyphKeyboardUI(), ...await testDictionaryGlyphLimitEnablesUI(), ...await testDictionaryGlyphLimitRejectsUI()];
}
