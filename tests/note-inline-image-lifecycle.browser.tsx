import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { BRIDGE_TOOLS, getBridgeTool } from '@/services/aiBridge/manifest';
import { validateToolArgs } from '@/services/aiRuntime/toolPolicy';
import NoteRichEditor from '@/engines/notes/components/NoteRichEditor';
import NoteComposer from '@/engines/notes/components/NoteComposer';
import { useLocaleStore } from '@/stores/localeStore';
import { rasterFile, clickNamed, chooseFile } from './note-inline-image-ui.browser';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const pause = () => new Promise(resolve => setTimeout(resolve, 35));
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Constructor parser fixture, deliberately distinct from the UI acquisition oracle. */
async function roundtrip(align?: string) {
  const host = document.getElementById('root'); assert(host, 'NOTES_INLINE_IMAGE_SETUP: missing root');
  const root = createRoot(host); let editor: Editor | null = null;
  try {
    await act(async () => { root.render(<TiptapEditor content={`<h2>Parser control</h2><p><img src="${PNG}" alt="Own parser fixture" data-wh-width="50" data-wh-frame="polaroid"${align ? ` data-wh-align="${align}"` : ''}></p>`} onChange={() => {}} onEditorReady={value => { editor = value; }}/>); await pause(); });
    for (let i = 0; !editor && i < 100; i++) await act(async () => { await pause(); });
    assert(editor, 'NOTES_INLINE_IMAGE_SETUP: full native editor did not become ready');
    const html = (editor as Editor).getHTML(), doc = new DOMParser().parseFromString(html, 'text/html'), image = doc.querySelector('img');
    assert(image?.getAttribute('src') === PNG && image.getAttribute('data-wh-width') === '50' && image.getAttribute('data-wh-frame') === 'polaroid', 'NOTES_INLINE_IMAGE_SETUP: legacy image parser/control failed');
    return { html, align: image.getAttribute('data-wh-align') };
  } finally { await act(async () => { root.unmount(); await pause(); }); }
}

async function withProject<T>(suffix: string, run: (projectId: string) => Promise<T>) {
  const projectId = 'note-inline-image-contract-' + suffix;
  try {
    await db.projects.put({ id: projectId, title: 'Inline note contracts QA', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#888888', enabledEngines: ['notes'], createdAt: 1, updatedAt: 1 });
    return await run(projectId);
  } finally { if (await db.projects.get(projectId)) await deleteProject(projectId); }
}

export async function testNoteInlineImageExistingControls(): Promise<string[]> {
  const legacy = await roundtrip(); assert(legacy.align === null, 'Legacy image acquired inferred alignment');
  await withProject('controls', async projectId => {
    const plain = await runBridgeTool('wh_create_note', { projectId, text: 'Native dispatcher control' });
    assert(plain.ok, 'NOTES_INLINE_IMAGE_SETUP: registered note tool failed: ' + JSON.stringify(plain));
    for (const richHtml of ['<img>', '<img src="javascript:bad()">', '<img src="data:image/svg+xml;base64,PHN2Zy8+">']) {
      const invalid = await runBridgeTool('wh_create_note', { projectId, text: '', richHtml });
      assert(!invalid.ok, 'Empty text was justified by an image without admitted raster src: ' + richHtml);
    }
    assert((await db.notes.where('projectId').equals(projectId).toArray()).length === 1, 'Rejected empty image created a row');
  });
  return ['Current full-editor width50/polaroid parser preserves original raster and absent align; registered note creation works; empty/missing/active image src does not create an empty note'];
}

export async function testNoteInlineImageParserAlignment(): Promise<string[]> {
  const actual = await roundtrip('right');
  assert(actual.align === 'right', 'NOTES_INLINE_IMAGE_ALIGN_LOST: current full native parser drops explicit data-wh-align="right" while preserving width50/polaroid; html=' + actual.html);
  return ['Full native image parser preserves additive explicit alignment alongside legacy width/frame'];
}

export async function testNoteInlineImageMcpImageOnly(): Promise<string[]> {
  await withProject('image-only', async projectId => {
    const tool = getBridgeTool('wh_create_note')!, spec = tool.schema.properties.text as Record<string, unknown>;
    assert(tool.schema.required?.includes('text') && spec.type === 'string' && spec.minLength === 0, 'Published note schema must explicitly admit empty required string');
    const optIns = BRIDGE_TOOLS.flatMap(tool => Object.entries(tool.schema.properties).filter(([, value]) => value !== null && typeof value === 'object' && (value as Record<string, unknown>).type === 'string' && (value as Record<string, unknown>).minLength === 0).map(([field]) => tool.name + '.' + field));
    assert(JSON.stringify(optIns) === JSON.stringify(['wh_create_note.text']), 'Empty required string opt-in spread to another tool');
    const richHtml = `<p><img src="${PNG}" data-wh-width="50" data-wh-frame="polaroid" data-wh-align="right"></p>`;
    for (const invalid of [{}, { text: undefined }, { text: null }, { text: false }, { text: {} }, { text: [] }]) {
      assert(!validateToolArgs(tool.schema, { projectId, richHtml, ...invalid }).ok, 'Required text missing/null/wrong type admitted by policy: ' + JSON.stringify(invalid));
    }
    for (const minLength of [undefined, '0', false, 1]) {
      const schema = { ...tool.schema, properties: { ...tool.schema.properties, text: { ...spec, minLength } } };
      assert(!validateToolArgs(schema, { projectId, text: '', richHtml }).ok, 'Non-numeric-zero or absent schema opt-in relaxed required text');
    }
    const legacy = getBridgeTool('wh_create_codex_entry')!;
    for (const title of ['', '   ']) assert(!validateToolArgs(legacy.schema, { title, type: 'character' }).ok, 'Legacy nonempty required string was relaxed');
    const coerced = validateToolArgs(tool.schema, { projectId, text: 37, pinned: 'false' });
    assert(coerced.ok && coerced.args.text === '37' && coerced.args.pinned === false, 'Existing numeric/string and boolean coercion changed');
    const call = async (args: Record<string, unknown>) => {
      const verdict = validateToolArgs(tool.schema, { projectId, ...args });
      assert(verdict.ok, 'Native argument policy rejected admitted note args: ' + JSON.stringify(verdict));
      return runBridgeTool(tool.name, verdict.args);
    };
    for (const invalidRich of [undefined, '', '<img>', '<img src="">', '<img src="javascript:bad()">', '<img src="data:image/svg+xml;base64,PHN2Zy8+">']) {
      const rejected = await call({ text: '', ...(invalidRich !== undefined ? { richHtml: invalidRich } : {}) });
      assert(!rejected.ok, 'Schema opt-in bypassed Notes content validation: ' + String(invalidRich));
    }
    assert((await db.notes.where('projectId').equals(projectId).toArray()).length === 0, 'Rejected empty note wrote a row');
    const result = await call({ text: '', richHtml });
    assert(result.ok, 'NOTES_INLINE_IMAGE_MCP_IMAGE_ONLY_REJECTED: registered native tool rejects empty plain projection despite admitted original raster; reply=' + JSON.stringify(result));
    const notes = await db.notes.where('projectId').equals(projectId).toArray();
    assert(notes.length === 1 && notes[0].text === '' && notes[0].richHtml?.includes(PNG) && notes[0].richHtml?.includes('data-wh-align="right"'), 'Image-only MCP creation lost raster/layout or invented plain text');
    const prose = await call({ text: '', richHtml: '<h2>Normalized native prose</h2><p>Coherent projection</p>' });
    assert(prose.ok && (await db.notes.where('projectId').equals(projectId).toArray()).some(note => note.text === 'Normalized native prose\nCoherent projection'), 'Required empty string with real normalized text did not reach Notes handler');
  });
  return ['Published Notes schema opts into empty required text through native argument policy and registered handler; original raster/layout and normalized prose persist, missing/type/legacy/content negatives and existing coercions stay intact'];
}

export async function testNoteInlineImageAsyncLifecycle(): Promise<string[]> {
  const host = document.getElementById('root')!, root = createRoot(host), originalDecode = Image.prototype.decode, pending: (() => void)[] = [];
  const previousLocale = useLocaleStore.getState().locale, activity = { current: { epoch: 0, blocked: false } };
  const fileA = rasterFile('#bb4400', 'old-owner.png'), fileB = rasterFile('#0044bb', 'latest-attempt.png');
  let output = '', writes = 0;
  Image.prototype.decode = function () { return originalDecode.call(this).then(() => new Promise<void>(resolve => pending.push(resolve))); };
  const until = async (check: () => boolean, message: string) => { for (let i = 0; i < 100; i++) { if (check()) return; await act(async () => { await pause(); }); } throw Error(message); };
  const render = async (noteId: string) => { await act(async () => { root.render(<NoteRichEditor html="<p>Owner prose</p>" projectId="owned-project" eraId={noteId === 'B' ? 'past' : undefined} noteId={noteId} activity={activity} onChange={(_text, html) => { output = html; }}/>); await pause(); }); await until(() => Boolean(host.querySelector('[data-note-image-controls] button')), 'Native image controls did not mount'); };
  const start = async (file: File) => { const rich = host.querySelector<HTMLElement>('[data-note-rich-editor]')!; await clickNamed(rich, 'Image'); await chooseFile(rich, file); };
  try {
    useLocaleStore.setState({ locale: 'en', loaded: true });
    await render('A'); await start(fileA.file); await until(() => pending.length === 1, 'Real first decoder not held');
    await render('B'); await act(async () => { pending.shift()!(); await pause(); });
    assert(!host.querySelector('.ProseMirror img') && !output, 'Late decoder retargeted the next note/era');
    await start(fileA.file); await until(() => pending.length === 1, 'First retry decoder not held');
    await start(fileB.file); await until(() => pending.length === 2, 'Second retry decoder not held');
    await act(async () => { pending.pop()!(); await pause(); });
    assert(host.querySelector<HTMLImageElement>('.ProseMirror img')?.src === fileB.src, 'Latest acquisition did not win');
    await act(async () => { pending.shift()!(); await pause(); });
    assert(host.querySelectorAll('.ProseMirror img').length === 1 && host.querySelector<HTMLImageElement>('.ProseMirror img')?.src === fileB.src, 'Earlier decoder overwrote/reinserted after newer attempt');
    // Switch to the actual composer host to exercise Save's synchronous seam.
    await act(async () => { root.render(<NoteComposer projectId="owned-project" onSubmit={async () => { writes++; throw Error('own injected storage error'); }}/>); await pause(); });
    const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Keep this draft'); textarea.dispatchEvent(new Event('input', { bubbles: true })); host.querySelector<HTMLInputElement>('[data-testid="note-rich-toggle"]')!.click(); await pause(); });
    await start(fileA.file); await until(() => pending.length === 1, 'Save decoder not held');
    const save = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Save')!;
    await act(async () => { save.click(); pending.shift()!(); await pause(); });
    assert(writes === 1 && !host.querySelector('.ProseMirror img') && host.querySelector('.ProseMirror')?.textContent === 'Keep this draft' && host.querySelector('[role="alert"]'), 'Save rejection lost draft or allowed a decoder past synchronous invalidation');
    await start(fileA.file); await until(() => pending.length === 1, 'Toggle decoder not held');
    await act(async () => { host.querySelector<HTMLInputElement>('[data-testid="note-rich-toggle"]')!.click(); pending.shift()!(); await pause(); });
    assert(host.querySelector<HTMLTextAreaElement>('textarea')?.value === 'Keep this draft' && !host.querySelector('.ProseMirror'), 'Late decoder reopened rich mode after rich/plain toggle');
    return ['Real decoder completed then held: note/era replacement drops stale result; newer acquisition wins regardless of completion order', 'Actual composer Save invalidates before IO/microtask and preserves draft/error on storage rejection; rich/plain toggle synchronously invalidates pending decode'];
  } finally {
    Image.prototype.decode = originalDecode;
    await act(async () => { root.unmount(); pending.splice(0).forEach(resolve => resolve()); await pause(); });
    useLocaleStore.setState({ locale: previousLocale });
  }
}
