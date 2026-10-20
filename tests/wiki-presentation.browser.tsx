import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { db } from '@/db';
import { buildWorldWiki, type WorldWikiData } from '@/services/worldWikiExport';
import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import { WikiHidden, WikiSpoiler } from '@/components/editor/wiki/marks';
import WikiExportControl from '@/engines/codex/WikiExportControl';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
export async function testWikiPresentation(): Promise<string[]> {
  const P = `wiki-presentation-${Date.now()}`; const passed: string[] = [];
  const project = { id: P, title: 'Synthetic coastal world', mode: 'custom' as const, type: 'standalone' as const, color: '#aaa', description: '', status: 'draft' as const, enabledEngines: ['codex'], engineOrder: ['codex'], createdAt: 1, updatedAt: 1 };
  const content = '<p>Visible Taro <span data-wh-wiki-hidden="true">NEVER_EXPORT_THIS <img src="data:image/png;base64,AAAA"></span> <span data-wh-wiki-spoiler="true">A_REVEALABLE_SPOILER</span>.</p>';
  const entry = { id: 'visible', projectId: P, type: 'character' as const, title: 'Iria', fields: { privateNotes: 'PRIVATE_FIELD' }, content, tags: [], relations: [], referenceFields: { captain: ['target'] }, createdAt: 1, updatedAt: 1 };
  const target = { ...entry, id: 'target', title: 'Taro', fields: {}, content: '<p>Navigator</p>', referenceFields: {} };
  const excluded = { ...entry, id: 'excluded', title: 'EXCLUDED_CARD_TITLE', fields: {}, content: '<p>EXCLUDED_CARD_BODY</p>', referenceFields: {} };
  const data: WorldWikiData = { project, entries: [entry, target, excluded], maps: [], pins: [], images: [] };
  const options = { excludedEntryIds: [excluded.id], excludedFields: ['privateNotes'], theme: 'night' as const, layout: 'journal' as const, font: 'sans' as const, accent: '#d4b778' };
  const artifact = buildWorldWiki(data, options);
  assert(!artifact.html.includes('NEVER_EXPORT_THIS') && !artifact.html.includes('PRIVATE_FIELD') && !artifact.html.includes('EXCLUDED_CARD_TITLE') && !artifact.html.includes('EXCLUDED_CARD_BODY'), 'Excluded text, fields and documents must never reach snapshot or search');
  const doc = new DOMParser().parseFromString(artifact.html, 'text/html');
  assert(doc.querySelector('[data-wiki-reveal][aria-expanded="false"]') && doc.querySelector('.wiki-spoiler > span[hidden]')?.textContent === 'A_REVEALABLE_SPOILER', 'Spoilers need an initially collapsed accessible reveal control');
  assert(doc.querySelectorAll('dd a').length === 1 && doc.body.textContent?.includes('Enlaces a esta entrada'), 'Typed references and backlinks must be included');
  assert(artifact.html.includes('--paper:#1a1b1c') && artifact.html.includes('--accent:#d4b778') && artifact.html.includes('font-family:system-ui') && artifact.html.includes('.layout{display:block;max-width:900px}'), 'Theme/layout/font/accent choices must reach file');
  assert(!buildWorldWiki(data, { accent: '#fff;}body{display:none}/*' }).html.includes('display:none}/*'), 'Unvalidated CSS must never enter snapshot');
  passed.push('Wiki: physical omission of hidden prose/documents/fields, collapsed spoilers, typed links/backlinks and validated presentation');
  const mapData: WorldWikiData = { ...data, maps: [{ id: 'map', projectId: P, title: 'Coast', backgroundImage: 'data:image/png;base64,AAAA', createdAt: 1, updatedAt: 1, layers: [{ id: 'secret', name: 'Hidden', visible: false }], features: [
    { id: 'region', kind: 'region', name: 'Northern coast', color: '#aabbcc', linkedEntryId: 'target', points: [{ x: 10, y: 10 }, { x: 80, y: 20 }, { x: 30, y: 70 }] },
    { id: 'path', kind: 'path', name: 'Old road', color: 'url(https://evil.invalid)', points: [{ x: 10, y: 10 }, { x: 70, y: 70 }] },
    { id: 'label', kind: 'label', name: 'NEVER_VISIBLE_LAYER', color: '#aabbcc', layerId: 'secret', points: [{ x: 50, y: 50 }] },
  ] }] };
  const mapDoc = new DOMParser().parseFromString(buildWorldWiki(mapData, options).html, 'text/html');
  assert(mapDoc.querySelector('.map-vectors polygon') && mapDoc.querySelector('.map-vectors polyline') && !mapDoc.body.textContent?.includes('NEVER_VISIBLE_LAYER') && !mapDoc.querySelector('[stroke^="url"]'), 'Wiki maps retain visible region/path geometry and safely omit hidden layers/unvalidated colors');
  assert(mapDoc.querySelector('.map-list a[href^="#entry-"]') && doc.querySelectorAll('.prose a').length === 1, 'Vector annotations and automatic body mentions retain local Codex navigation');
  const blockContent = `<aside data-wh-codex-block="true" data-project-id="${P}" data-entry-id="target" data-label="Old name"><p>Codex: Old name</p></aside><aside data-wh-codex-block="true" data-project-id="${P}" data-entry-id="excluded" data-label="EXCLUDED_CARD_TITLE"><p>EXCLUDED_CARD_TITLE</p></aside>`;
  const blockWiki = buildWorldWiki({ ...data, entries: [{ ...entry, content: blockContent }, target, excluded] }, options).html;
  assert(!blockWiki.includes('Old name') && !blockWiki.includes('EXCLUDED_CARD_TITLE') && new DOMParser().parseFromString(blockWiki, 'text/html').querySelector('.prose a')?.textContent === 'Taro', 'Live block export resolves current admitted title and physically removes excluded fallback');
  passed.push('Wiki integration: vector map annotations, hidden layers, indexed body mentions and scoped/excluded live-block exports');
  const root = createRoot(document.getElementById('root')!); let editor: Editor | undefined;
  try {
    const editorElement = document.createElement('div'); document.body.append(editorElement);
    editor = new Editor({ element: editorElement, extensions: [StarterKit, WikiHidden, WikiSpoiler], content: sanitizeRichHtml(content) });
    assert(editor.getHTML().includes('data-wh-wiki-hidden="true"') && editor.getHTML().includes('data-wh-wiki-spoiler="true"'), 'Editor roundtrip must retain author visibility semantics');
    editor.commands.setTextSelection({ from: 1, to: 8 }); editor.commands.toggleMark('wikiHidden');
    assert(editor.isActive('wikiHidden'), 'Selection can be hidden using native editor mark');
    editor.commands.undo();
    assert(!editor.isActive('wikiHidden'), 'Visibility edits must be undoable');
    editor.destroy(); editor = undefined; editorElement.remove();
    passed.push('Wiki authoring: sanitizer/editor roundtrip preserves hidden/spoiler marks and native undo');

    const iframe = document.createElement('iframe'); document.body.append(iframe);
    const loaded = new Promise<void>(resolve => { iframe.onload = () => resolve(); }); iframe.srcdoc = artifact.html; await loaded;
    const reveal = iframe.contentDocument!.querySelector<HTMLButtonElement>('[data-wiki-reveal]')!;
    reveal.click(); assert(reveal.getAttribute('aria-expanded') === 'true' && !(reveal.nextElementSibling as HTMLElement).hidden, 'Real script must reveal spoiler on click');
    reveal.click(); assert(reveal.getAttribute('aria-expanded') === 'false' && (reveal.nextElementSibling as HTMLElement).hidden, 'Real script must collapse spoiler again'); iframe.remove();
    passed.push('Wiki exported behavior: real generated snapshot reveals and collapses spoiler without server calls');

    await db.projects.put(project); await db.codexEntries.bulkPut(data.entries); useLocaleStore.setState({ locale: 'en' });
    await act(async () => { root.render(<WikiExportControl projectId={P} entries={data.entries} />); await pause(100); });
    for (let attempt = 0; attempt < 100 && !document.querySelector('details'); attempt++) await act(async () => { await pause(); });
    const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === label)!;
    await act(async () => { button('Preview').click(); await pause(150); });
    for (let attempt = 0; attempt < 100 && !document.querySelector('iframe'); attempt++) await act(async () => { await pause(); });
    const preview = document.querySelector<HTMLIFrameElement>('iframe')!;
    assert(preview && preview.getAttribute('sandbox') === 'allow-scripts' && !preview.srcdoc.includes('NEVER_EXPORT_THIS'), 'Live preview must use isolated sandbox and omit hidden prose');
    await act(async () => { button('Save preferences').click(); await pause(150); });
    assert((await db.projects.get(P))!.wikiOptions, 'Preferences must persist in project metadata');
    passed.push('Wiki UI: sandboxed real preview and saved project presentation preferences');
    return passed;
  } finally { editor?.destroy(); await act(async () => root.unmount()); await db.codexEntries.where('projectId').equals(P).delete(); await db.projects.delete(P); }
}
