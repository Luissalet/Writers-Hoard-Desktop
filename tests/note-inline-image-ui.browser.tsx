import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import NotesEngine from '@/engines/notes/components/NotesEngine';
import { useLocaleStore } from '@/stores/localeStore';
import { t } from '@/i18n/useTranslation';
import type { Editor } from '@tiptap/core';

const TEXT = 'Pistas del puerto\nRevisar el faro\nHablar con la capitana';
const HTML = '<h2>Pistas del puerto</h2><ul><li><p>Revisar el faro</p></li><li><p>Hablar con la capitana</p></li></ul>';
const pause = () => new Promise(resolve => setTimeout(resolve, 35));
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
async function until(check: () => boolean, message: string) {
  for (let i = 0; i < 100; i++) { if (check()) return; await act(async () => { await pause(); }); }
  throw Error('NOTES_INLINE_IMAGE_SETUP: ' + message);
}
const name = (button: HTMLElement) => (button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '').trim();
const buttons = (within: ParentNode) => [...within.querySelectorAll<HTMLElement>('button,[role="menuitem"]')]
  .filter(button => !button.closest('[hidden],[aria-hidden="true"]'));

/** The fixture has prose only; acquisition is never simulated with setContent or a seeded image. */
async function withEditor(surface: 'card' | 'composer', check: (editor: HTMLElement, context: { host: HTMLElement; projectId: string; noteId: string }) => Promise<void>, writes = false) {
  const projectId = 'note-inline-image-ui-' + surface, noteId = projectId + '-note';
  const host = document.getElementById('root'); assert(host, 'NOTES_INLINE_IMAGE_SETUP: missing root');
  const root = createRoot(host), previousLocale = useLocaleStore.getState().locale;
  try {
    await db.projects.put({ id: projectId, title: 'Inline image RED QA', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#888888', enabledEngines: ['notes'], createdAt: 1, updatedAt: 1 });
    await db.notes.put({ id: noteId, projectId, kind: 'note', text: TEXT, richHtml: HTML, tags: [], pinned: false, createdAt: 1, updatedAt: 1 });
    useLocaleStore.setState({ locale: 'en', loaded: true });
    await act(async () => { root.render(<StrictMode><MemoryRouter><NotesEngine projectId={projectId}/></MemoryRouter></StrictMode>); await pause(); });
    await until(() => Boolean(host.querySelector('fieldset textarea') && host.querySelector('[data-note-rich-read] h2')), 'real NotesEngine plain composer and saved rich note');
    const before = JSON.stringify(await db.notes.get(noteId));
    let owner: HTMLElement;
    if (surface === 'card') {
      const card = host.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`); assert(card, 'NOTES_INLINE_IMAGE_SETUP: missing note card');
      const edit = card.querySelector<HTMLButtonElement>(`button[title="${t('common.edit')}"]`); assert(edit, 'NOTES_INLINE_IMAGE_SETUP: missing Edit');
      await act(async () => { edit.click(); await pause(); }); owner = card;
    } else {
      const composer = host.querySelector<HTMLFieldSetElement>('fieldset'); assert(composer, 'NOTES_INLINE_IMAGE_SETUP: missing composer');
      const toggle = composer.querySelector<HTMLInputElement>('[data-testid="note-rich-toggle"]'); assert(toggle, 'NOTES_INLINE_IMAGE_SETUP: missing rich toggle');
      await act(async () => { toggle.click(); await pause(); }); owner = composer;
    }
    await until(() => Boolean(owner.querySelector('[data-note-rich-editor] .ProseMirror[contenteditable="true"]')), surface + ' native editable Tiptap');
    const editor = owner.querySelector<HTMLElement>('[data-note-rich-editor]')!;
    assert(!editor.querySelector('img'), 'NOTES_INLINE_IMAGE_SETUP: image unexpectedly seeded');
    if (surface === 'card') assert(editor.querySelector('h2')?.textContent === 'Pistas del puerto' && editor.querySelectorAll('li').length === 2, 'NOTES_INLINE_IMAGE_SETUP: heading/list did not mount');
    console.log('CONTROL NotesEngine ' + surface + ': editable native editor mounted, no image seeded, saved row untouched');
    await check(editor, { host, projectId, noteId });
    if (!writes) assert(JSON.stringify(await db.notes.get(noteId)) === before, 'Opening image acquisition wrote the saved note');
  } finally {
    await act(async () => { root.unmount(); await pause(); });
    useLocaleStore.setState({ locale: previousLocale });
    if (await db.projects.get(projectId)) await deleteProject(projectId);
  }
}

async function requireAcquisition(surface: 'card' | 'composer') {
  await withEditor(surface, async editor => {
    const image = buttons(editor).find(button => /^(?:image|imagen)(?:\s|$)/i.test(name(button)));
    assert(image, `NOTES_INLINE_IMAGE_ENTRY_MISSING [${surface}]: normal native toolbar has no Image entry for File/Gallery; mounted controls=${JSON.stringify(buttons(editor).map(name))}`);
    await act(async () => { image.click(); await pause(); });
    await until(() => buttons(document.body).some(button => /\b(?:file|archivo)\b/i.test(name(button))) && buttons(document.body).some(button => /\b(?:gallery|galer[ií]a)\b/i.test(name(button))), surface + ' Image menu exposes File and Gallery');
  });
}

export async function testNoteInlineImageUi(): Promise<string[]> {
  const failures: string[] = [];
  for (const surface of ['card', 'composer'] as const) {
    try { await requireAcquisition(surface); } catch (error) { failures.push(String(error)); }
  }
  assert(!failures.length, failures.join('\n'));
  return ['Real NotesEngine card and rich composer expose Image > File/Gallery through their own native toolbar, without seeded images or editor commands'];
}

/** Positive infrastructure control, separate from the missing-feature RED. */
export async function testNoteInlineImageUiMountControls(): Promise<string[]> {
  for (const surface of ['card', 'composer'] as const) await withEditor(surface, async () => {});
  return ['Real NotesEngine card/composer mount editable native editors, preserve H2/two bullets and keep persisted prose unchanged'];
}

export function rasterFile(color: string, filename: string) {
  const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 16;
  const context = canvas.getContext('2d')!; context.fillStyle = color; context.fillRect(0, 0, 16, 16);
  const src = canvas.toDataURL('image/png');
  return { src, file: new File([Uint8Array.from(atob(src.split(',')[1]), char => char.charCodeAt(0))], filename, { type: 'image/png' }) };
}
export async function clickNamed(within: ParentNode, label: string) {
  const button = buttons(within).find(item => name(item) === label); assert(button, 'Missing normal control ' + label);
  await act(async () => { button.click(); await pause(); });
}
export async function chooseFile(rich: HTMLElement, file: File) {
  let chooser: HTMLInputElement | null = null;
  const nativeClick = HTMLInputElement.prototype.click;
  // Keep the normal File button/handler. Intercept only the OS dialog in headless QA.
  HTMLInputElement.prototype.click = function () { if (this.type === 'file') chooser = this; else nativeClick.call(this); };
  try { await clickNamed(rich, 'File'); } finally { HTMLInputElement.prototype.click = nativeClick; }
  assert(chooser, 'Normal File control did not open its native input');
  const transfer = new DataTransfer(); transfer.items.add(file);
  await act(async () => { (chooser as HTMLInputElement).files = transfer.files; (chooser as HTMLInputElement).dispatchEvent(new Event('change', { bubbles: true })); await pause(); });
}

export async function testNoteInlineImageAcquisition(): Promise<string[]> {
  const original = rasterFile('#cc4422', 'original-alpha.png'), replacement = rasterFile('#2266cc', 'replacement-alpha.png');
  await withEditor('card', async (rich, { host, projectId, noteId }) => {
    const prose = rich.querySelector<HTMLElement>('.ProseMirror') as HTMLElement & { editor: Editor };
    await clickNamed(rich, 'Image'); await chooseFile(rich, original.file);
    await until(() => rich.querySelector<HTMLImageElement>('.ProseMirror img')?.src === original.src, 'normal File acquisition');
    const native = prose.editor; let imagePosition = -1;
    native.state.doc.descendants((node, position) => { if (node.type.name === 'image') imagePosition = position; });
    // Selection only; acquisition above went through the normal File UI and real decoder.
    await act(async () => { native.commands.setNodeSelection(imagePosition); await pause(); });
    await act(async () => { rich.querySelector<HTMLButtonElement>('[data-testid="image-width-50"]')!.click(); rich.querySelector<HTMLButtonElement>('[data-testid="image-frame-polaroid"]')!.click(); await pause(); });
    await clickNamed(rich, 'Image center');
    let image = rich.querySelector<HTMLImageElement>('.ProseMirror img')!;
    const attrs = () => Object.fromEntries([...rich.querySelector('.ProseMirror img')!.attributes].map(attr => [attr.name, attr.value]));
    const beforeReplace = attrs();
    assert(image.naturalWidth === 32 && image.naturalHeight === 16 && image.dataset.whWidth === '50' && image.dataset.whFrame === 'polaroid' && image.dataset.whAlign === 'center', 'File decode/layout controls lost original bytes or dimensions');
    await clickNamed(rich, 'Replace image'); await chooseFile(rich, replacement.file);
    await until(() => rich.querySelector<HTMLImageElement>('.ProseMirror img')?.src === replacement.src, 'normal replacement');
    const afterReplace = attrs(); delete beforeReplace.src; delete afterReplace.src;
    assert(JSON.stringify(beforeReplace) === JSON.stringify(afterReplace), 'Replace changed alt/title/width/frame/alignment');
    await clickNamed(rich, 'Undo'); assert(rich.querySelector<HTMLImageElement>('.ProseMirror img')?.src === original.src, 'Replace Undo lost original raster');
    await clickNamed(rich, 'Redo'); assert(rich.querySelector<HTMLImageElement>('.ProseMirror img')?.src === replacement.src, 'Replace Redo lost replacement raster');
    imagePosition = -1; native.state.doc.descendants((node, position) => { if (node.type.name === 'image') imagePosition = position; });
    await act(async () => { native.commands.setNodeSelection(imagePosition); await pause(); });
    const beforeRemove = native.getHTML(); await clickNamed(rich, 'Remove image'); assert(!rich.querySelector('.ProseMirror img'), 'Remove kept image');
    await clickNamed(rich, 'Undo'); assert(native.getHTML() === beforeRemove, 'Remove Undo did not restore exact HTML');
    await clickNamed(rich, 'Redo'); assert(!rich.querySelector('.ProseMirror img'), 'Remove Redo kept image');
    await clickNamed(rich, 'Undo'); assert(native.getHTML() === beforeRemove, 'Second Undo differs');
    assert(prose.querySelector('h2')?.textContent === 'Pistas del puerto' && prose.querySelectorAll('li').length === 2, 'Acquisition/Undo changed heading or bullets');
    const card = host.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`)!;
    await clickNamed(card, t('common.save')); await until(() => Boolean(card.querySelector('[data-note-rich-read] img')), 'saved read image');
    const row = await db.notes.get(noteId); assert(row?.richHtml?.includes(replacement.src) && row.richHtml.includes('data-wh-align="center"') && row.text === TEXT, 'Normal Save lost image/attrs/plain projection');
    await clickNamed(card, 'Edit'); await until(() => Boolean(card.querySelector('.ProseMirror img')), 'reopen image');
    assert(card.querySelector<HTMLImageElement>('.ProseMirror img')?.src === replacement.src && card.querySelector('img[data-wh-frame="polaroid"][data-wh-align="center"][data-wh-width="50"]'), 'Reopen lost raster/layout');
    assert((await db.notes.where('projectId').equals(projectId).toArray()).length === 1, 'File acquisition wrote extra rows');
  }, true);
  await withEditor('composer', async (rich, { host, projectId }) => {
    const galleryId = projectId + '-gallery';
    await db.inspirationImages.put({ id: galleryId, projectId, imageData: replacement.src, imageDataOriginal: original.src, tags: [], notes: 'Own gallery original', createdAt: 1 });
    await clickNamed(rich, 'Image'); await clickNamed(rich, 'Gallery');
    await until(() => buttons(document.body).some(button => name(button) === 'Own gallery original'), 'normal Gallery picker');
    await clickNamed(document.body, 'Own gallery original');
    await until(() => rich.querySelector<HTMLImageElement>('.ProseMirror img')?.src === original.src, 'Gallery original-byte acquisition');
    const composer = host.querySelector('fieldset')!; await clickNamed(composer, 'Save');
    await until(() => Boolean(composer.querySelector('textarea')), 'rich image composer reset');
    const created = (await db.notes.where('projectId').equals(projectId).toArray()).find(note => note.richHtml?.includes(original.src));
    assert(created?.text === '' && created.richHtml?.includes('data-wh-align="left"'), 'Gallery image-only composer invented text or lost bytes');
  }, true);
  return ['Normal File acquisition decodes original alpha raster, native width/frame/alignment, Replace src-only, Remove/Undo/Redo exact HTML and Save/reopen preserve H2/bullets/plain projection', 'Normal composer Gallery selects original bytes over display image and saves image-only note with empty plain projection'];
}
