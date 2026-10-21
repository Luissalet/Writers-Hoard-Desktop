import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { db } from '@/db';
import { createEntityCandidate, entityPreferences, newEntityCandidates, updateEntityDetectionPreferences } from '@/services/entityDetection/service';
import { DEFAULT_ENTITY_PREFERENCES, type EntitySpan } from '@/services/entityDetection/types';
import { readEraRow } from '@/services/worldEras/store';
import type { CodexEntry, Project } from '@/types';
import { createInlineMentionsPlugin, inlineMentionsKey } from '@/services/codexReference/inlineMentions';
import { alignEntityTokens, entityChunks } from '@/services/entityDetection/alignment';
import EntityDetectionControls from '@/components/editor/entityDetection/EntityDetectionControls';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
export async function testEntityDetection(): Promise<string[]> {
  const projectId = 'synthetic-entity-detection', now = Date.now();
  const project: Project = { id: projectId, title: 'Synthetic entity QA', mode: 'custom', type: 'standalone', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['codex'], engineOrder: ['codex'], createdAt: now, updatedAt: now, worldEras: [{ id: 'future', name: 'Future QA', description: '', revision: 1, createdAt: now, updatedAt: now }] };
  const entry: CodexEntry = { id: 'qa-existing', projectId, title: 'María García', type: 'character', fields: { aliases: '["La Cartógrafa"]' }, content: '<p>Keep</p>', tags: [], relations: [], createdAt: now, updatedAt: now };
  const source = 'María García visitó San Sebastián.', candidate: EntitySpan = { from: 20, to: 33, text: 'San Sebastián', label: 'LOC', score: .99 };
  const passed: string[] = [];
  await db.projects.put(project); await db.codexEntries.put(entry);
  try {
    assert(entityPreferences(project).animateNewLinks === false && entityPreferences(project).autoLinkMentions, 'Legacy defaults preserve matcher and no animation');
    await updateEntityDetectionPreferences(projectId, { detectNewEntities: true }, 0);
    let conflicted = false; try { await updateEntityDetectionPreferences(projectId, { autoLinkMentions: false }, 0); } catch { conflicted = true; }
    assert(conflicted && (await db.projects.get(projectId))?.worldEras?.[0].revision === 1, 'Preference CAS preserves eras');
    assert(newEntityCandidates('La Cartógrafa', [{ from: 0, to: 13, text: 'La Cartógrafa', label: 'PER', score: .95 }], [entry, { ...entry, id: 'second' }]).length === 0, 'Ambiguous known alias is not a new candidate');
    const created = await createEntityCandidate({ projectId, eraId: 'future', text: source, candidate, type: 'location' });
    assert(!await db.codexEntries.get(created.id) && (await readEraRow<CodexEntry>({ projectId, eraId: 'future' }, 'codexEntries', created.id))?.title === 'San Sebastián', 'Explicit creation targets current era only');
    assert((await db.codexEntries.get(entry.id))?.content === entry.content && created.content === '' && Object.keys(created.fields).length === 0, 'Base and facts remain untouched');
    let duplicate = false; try { await createEntityCandidate({ projectId, eraId: 'future', text: source, candidate, type: 'location' }); } catch { duplicate = true; }
    let stale = false; try { await createEntityCandidate({ projectId, text: source + 'edited', candidate: { ...candidate, text: 'Paris' }, type: 'location' }); } catch { stale = true; }
    assert(duplicate && stale, 'Duplicate and changed-source candidates rejected');
    let late = false; try { await createEntityCandidate({ projectId, text: source, candidate, type: 'location' }, () => { throw Error('source changed while reading'); }); } catch { late = true; }
    assert(late && await db.codexEntries.where('projectId').equals(projectId).count() === 1, 'Late source check rolls back before any Base card is written');
    passed.push('Entity preferences: independent switches, project-wide CAS; explicit era creation, Base preservation, duplicate and source checks');
    const host = document.createElement('div'); document.body.append(host);
    const editor = new Editor({ element: host, extensions: [StarterKit.configure({ trailingNode: false })], content: `<p>María García <a href="/project/${projectId}/codex?entry=${entry.id}">authored prose</a></p>` });
    try {
      const original = editor.getHTML();
      editor.registerPlugin(createInlineMentionsPlugin([entry], () => {}, undefined, { autoLinkMentions: false, animateNewLinks: true }));
      assert(host.querySelectorAll('[data-wh-codex-mention]').length === 1 && editor.getHTML() === original, 'Auto-link off preserves authored links and prose');
      editor.unregisterPlugin(inlineMentionsKey);
      editor.registerPlugin(createInlineMentionsPlugin([entry], () => {}, undefined, { autoLinkMentions: true, animateNewLinks: true }));
      assert(host.querySelectorAll('[data-wh-codex-mention]').length === 2 && !host.querySelector('.wh-codex-mention-animated'), 'Animation does not flash existing links');
      editor.commands.insertContentAt(editor.state.doc.content.size, '<p>María García</p>');
      assert(host.querySelectorAll('.wh-codex-mention-animated').length === 1, 'Only newly linked mention animates');
      editor.commands.undo(); assert(editor.getHTML() === original, 'Detection and decorations add no undo edits');
      passed.push('Mentions: independent animation, authored links survive auto-link off, exact prose and native undo');
    } finally { editor.destroy(); host.remove(); }
    const chunks = entityChunks('a '.repeat(1700) + 'tail', text => text.split(' ').length);
    assert(chunks.at(-1)?.text.endsWith('tail') && chunks.every(chunk => chunk.text.split(' ').length <= 448), 'All text is chunked within token budget');
    const tokenize = (text: string) => text === 'Élodie Durand' ? ['Él', '##odie', 'Durand'] : text === 'Élodie' ? ['Él', '##odie'] : [text];
    const spans = alignEntityTokens('Élodie Durand', tokenize, [{ index: 1, entity: 'B-PER', score: .99 }, { index: 2, entity: 'I-PER', score: .99 }, { index: 3, entity: 'I-PER', score: .99 }]);
    assert(spans[0]?.text === 'Élodie Durand' && spans[0].to === 13, 'Subword spans use source offsets');
    passed.push('NER alignment: verified WordPiece stream, UTF-16 source spans, complete long-text token budgeting');
    return passed;
  } finally { await db.worldEraVariants.where('projectId').equals(projectId).delete(); await db.codexEntries.where('projectId').equals(projectId).delete(); await db.projects.delete(projectId); }
}

export async function testEntityDetectionUi(): Promise<string[]> {
  const host = document.getElementById('root')!; const root = createRoot(host);
  const projectId = 'synthetic-entity-ui', now = Date.now();
  await db.projects.put({ id: projectId, title: 'Synthetic QA', mode: 'custom', type: 'standalone', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['codex'], engineOrder: ['codex'], createdAt: now, updatedAt: now });
  const editorHost = document.createElement('div'); document.body.append(editorHost);
  const editor = new Editor({ element: editorHost, extensions: [StarterKit.configure({ trailingNode: false })], content: '<p>María García visitó San Sebastián.</p>' });
  let deliver: ((value: EntitySpan[]) => void) | undefined;
  const previous = window.electronAPI;
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { entityDetection: { status: async () => ({ state: 'ready', model: 'synthetic UI only' }), prepare: async () => ({ state: 'ready', model: 'synthetic UI only' }), detect: () => new Promise<EntitySpan[]>(resolve => { deliver = resolve; }) } } });
  const prefs = { ...DEFAULT_ENTITY_PREFERENCES, detectNewEntities: true };
  try {
    await act(async () => { root.render(<EntityDetectionControls editor={editor} projectId={projectId} entries={[]} preferences={prefs} />); await pause(); });
    await act(async () => { await pause(300); }); assert(deliver, 'Auto detection starts with prepared classifier');
    await act(async () => { editor.commands.insertContentAt(1, 'edited '); deliver!([{ from: 0, to: 12, text: 'María García', label: 'PER', score: .99 }]); await pause(); });
    assert(!host.querySelector('[data-create-entity]') && !editorHost.querySelector('[data-wh-entity-candidate]'), 'Editing discards late model result');
    await act(async () => { await pause(1200); });
    await act(async () => { deliver!([{ from: 7, to: 19, text: 'María García', label: 'PER', score: .99 }]); await pause(); });
    assert(host.querySelector('[data-create-entity]') && editorHost.querySelector('[data-wh-entity-candidate]'), 'Fresh candidate visible in normal controls and prose');
    const highlight = editorHost.querySelector<HTMLElement>('[data-wh-entity-candidate]')!;
    await act(async () => { highlight.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await pause(100); });
    assert(document.activeElement?.hasAttribute('data-create-entity') && host.querySelector('details')?.open, `Keyboard highlight opens candidates and focuses create: ${document.activeElement?.tagName}, open=${host.querySelector('details')?.open}, button=${host.querySelector('[data-create-entity]')?.outerHTML}`);
    await act(async () => { root.render(<EntityDetectionControls key="other" editor={editor} projectId="other-project" entries={[]} preferences={prefs} />); await pause(); });
    assert(!host.querySelector('[data-create-entity]'), 'Navigating project discards candidates');
    return ['Entity UI: prepared auto scan, discard stale result after edits/navigation, readonly highlight and keyboard creation control'];
  } finally { await act(async () => root.unmount()); editor.destroy(); editorHost.remove(); Object.defineProperty(window, 'electronAPI', { configurable: true, value: previous }); await db.projects.delete(projectId); }
}
