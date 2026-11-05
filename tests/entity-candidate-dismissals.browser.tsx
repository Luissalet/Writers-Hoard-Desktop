import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Editor } from '@tiptap/core';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { db } from '@/db';
import { useLocaleStore } from '@/stores/localeStore';
import type { CodexEntry, Project, Writing } from '@/types';
import type { EntitySpan } from '@/services/entityDetection/types';

// This is a controlled inference port, not a Browser NER runtime or a model test.
// The same real editor fixture first proves incumbent creation/aliases/prose.
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
async function until(read: () => boolean, message: string) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (read()) return;
    await act(async () => { await pause(50); });
  }
  throw Error(message);
}
const names = ['Nora', 'Rowan', 'Castle Blackthorn'];
const candidates = (scope: ParentNode) => [...scope.querySelectorAll('.wh-entity-panel li > span')].map(node => node.textContent);
const buttonNamed = (scope: ParentNode, name: string) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim() === name);

interface Fixture {
  host: HTMLElement;
  first: HTMLElement;
  second: HTMLElement;
  firstEditor: Editor;
  secondEditor: Editor;
  firstHtml: string;
  secondHtml: string;
  authoredBefore: string;
  authored(): Promise<string>;
  edits(): number;
  rerenderFirst(): Promise<void>;
}

async function withFixture(assertions: (fixture: Fixture) => Promise<string[]>): Promise<string[]> {
  const host = document.getElementById('root')!, root = createRoot(host);
  const projectId = 'qa-entity-dismissal-owned-context', firstId = `${projectId}-A`, secondId = `${projectId}-B`, knownId = `${projectId}-known`, now = 200;
  const previousApi = window.electronAPI, previousLocale = useLocaleStore.getState().locale;
  const editors = new Map<string, Editor>();
  let edits = 0, inferenceCalls = 0, firstMount = 0;
  const project: Project = { id: projectId, title: 'Synthetic dismissal contract', type: 'standalone', mode: 'custom', description: '', status: 'draft', color: '#777777', enabledEngines: ['codex', 'writings'], engineOrder: ['writings', 'codex'], createdAt: now, updatedAt: now, entityDetectionPreferences: { revision: 0, detectNewEntities: true, autoLinkMentions: true, animateNewLinks: false } };
  const content = `<p>Nora travelled with Rowan to Castle Blackthorn. La Guía kept the <a href="/project/${projectId}/codex?entry=${knownId}">authored link</a>.</p>`;
  const writing = (id: string): Writing => ({ id, projectId, title: id, status: 'draft', content, wordCount: 15, tags: ['kept'], createdAt: now, updatedAt: now });
  const known: CodexEntry = { id: knownId, projectId, title: 'Aster Pilot', type: 'character', fields: { aliases: '["La Guía"]', keepsake: 'unchanged' }, content: '<p>Known authored facts</p>', tags: [], relations: [], createdAt: now, updatedAt: now };
  const authored = async () => JSON.stringify({ project: await db.projects.get(projectId), writings: await db.writings.where('projectId').equals(projectId).sortBy('id'), cards: await db.codexEntries.where('projectId').equals(projectId).sortBy('id'), snapshots: await db.writingSnapshots.where('projectId').equals(projectId).sortBy('id') });
  const render = async () => {
    const chapter = (id: string, slot: string, mount: number) => <section key={slot} data-dismissal-fixture={slot}><TiptapEditor key={`${id}:${mount}`} content={content} onChange={() => { edits++; }} onEditorReady={editor => { if (editor) editors.set(id, editor); else editors.delete(id); }} copilotIdentity={{ projectId, objectId: id, kind: 'writings' }} documentOwner={{ kind: 'writings', documentId: id }} referenceContext={{ projectId, scopeId: `fixture:${id}` }} {...{ entityCandidateContext: { kind: 'writings' as const, documentId: id } }} /></section>;
    await act(async () => { root.render(<MemoryRouter><main>{chapter(firstId, 'first', firstMount)}{chapter(secondId, 'second', 0)}</main></MemoryRouter>); await pause(); });
    for (const details of host.querySelectorAll<HTMLDetailsElement>('[data-editor-document-tools],.wh-entity-controls')) details.open = true;
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { entityDetection: {
    status: async () => ({ state: 'ready' as const, model: 'controlled-positive-editor-fixture-no-model' }),
    prepare: async () => { throw Error('This fixture must not prepare a classifier'); },
    detect: async (text: string): Promise<EntitySpan[]> => {
      inferenceCalls++;
      return [...names, 'La Guía'].map(name => { const from = text.indexOf(name); check(from >= 0, `Controlled fixture source lost ${name}`); return { from, to: from + name.length, text: name, label: name === 'Castle Blackthorn' ? 'LOC' : 'PER', score: .99 }; });
    },
  } } });
  useLocaleStore.setState({ locale: 'es' });
  try {
    await db.projects.put(project); await db.writings.bulkPut([writing(firstId), writing(secondId)]); await db.codexEntries.put(known);
    const before = await authored();
    await render();
    const first = host.querySelector<HTMLElement>('[data-dismissal-fixture="first"]')!, second = host.querySelector<HTMLElement>('[data-dismissal-fixture="second"]')!;
    check(first && second, 'Both owned editor contexts must mount before the feature assertion');
    await until(() => JSON.stringify(candidates(first)) === JSON.stringify(names) && JSON.stringify(candidates(second)) === JSON.stringify(names), 'Positive baseline: both real editors must show exactly the three candidates before testing dismissal');
    const firstEditor = editors.get(firstId)!, secondEditor = editors.get(secondId)!;
    check(firstEditor && secondEditor && inferenceCalls >= 2, 'Positive baseline: real Tiptap instances must receive the explicitly controlled port');
    check(first.querySelector('[data-wh-entity-candidate]') && second.querySelector('[data-wh-entity-candidate]'), 'Positive baseline: candidates must decorate both actual editor documents');
    check(!candidates(first).includes('La Guía'), 'Positive baseline: known alias must be excluded from new-card candidates');
    const firstHtml = firstEditor.getHTML(), secondHtml = secondEditor.getHTML();
    check(firstHtml.includes('authored link') && firstHtml.includes(knownId) && firstHtml.includes('La Guía'), 'Positive baseline: authored link and literal alias must remain in HTML');
    check(edits === 0 && before === await authored(), 'Positive baseline: inference and decorations must not write authored data, aliases, drafts or prose');
    check(buttonNamed(first, 'Crear ficha') && buttonNamed(second, 'Crear ficha'), 'Positive baseline: normal creation controls must remain available');
    return await assertions({ host, first, second, firstEditor, secondEditor, firstHtml, secondHtml, authoredBefore: before, authored, edits: () => edits, rerenderFirst: async () => { firstMount++; await render(); } });
  } finally {
    await act(async () => { root.unmount(); });
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: previousApi });
    useLocaleStore.setState({ locale: previousLocale });
    await db.writingSnapshots.where('projectId').equals(projectId).delete();
    await db.writings.where('projectId').equals(projectId).delete();
    await db.codexEntries.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  }
}

export async function testEntityCandidateDismissalPositiveBaseline(): Promise<string[]> {
  return withFixture(async fixture => {
    const firstCreate = buttonNamed(fixture.first, 'Crear ficha'); check(firstCreate, 'Incumbent Create action missing');
    await act(async () => { firstCreate.click(); await pause(); });
    await until(() => !candidates(fixture.first).includes('Nora'), 'Positive baseline: explicit normal Create must update its candidate list');
    const created = await db.codexEntries.where('projectId').equals('qa-entity-dismissal-owned-context').toArray();
    check(created.length === 2 && created.some(entry => entry.title === 'Nora' && entry.content === '' && !Object.keys(entry.fields).length), 'Positive baseline: Create must produce exactly one title-only card through the real product service');
    check(fixture.firstEditor.getHTML() === fixture.firstHtml && fixture.secondEditor.getHTML() === fixture.secondHtml && fixture.edits() === 0, 'Positive baseline: normal explicit creation must preserve both rich documents and avoid onChange');
    return ['Controlled-port baseline only: two real Tiptap editors, exact three candidates, known alias excluded, authored link/drafts unchanged, normal Create service still functional; no model or Browser NER claim'];
  });
}

export async function testEntityCandidateDismissalOriginal(): Promise<string[]> {
  return withFixture(async fixture => {
    const dismiss = buttonNamed(fixture.first, 'Descartar Nora');
    check(dismiss, 'NER_DISMISS_ONE_MISSING: positive real-editor baseline passed; no accessible "Descartar Nora" action exists');
    await act(async () => { dismiss.click(); await pause(); });
    check(JSON.stringify(candidates(fixture.first)) === JSON.stringify(['Rowan', 'Castle Blackthorn']), 'Dismiss must remove only Nora from its owned document context');
    check(JSON.stringify(candidates(fixture.second)) === JSON.stringify(names), 'Dismiss must preserve the other owned document context');
    check(fixture.edits() === 0 && fixture.firstEditor.getHTML() === fixture.firstHtml && fixture.secondEditor.getHTML() === fixture.secondHtml && fixture.authoredBefore === await fixture.authored(), 'Dismiss must not alter saved data, aliases, prose, draft history or normal text Undo');
    await fixture.rerenderFirst();
    await until(() => JSON.stringify(candidates(fixture.first)) === JSON.stringify(['Rowan', 'Castle Blackthorn']), 'Same-document remount must retain Nora dismissal during this renderer session');
    const restore = buttonNamed(fixture.first, 'Recuperar Nora'); check(restore, 'Dismissed candidate must have an explicit individual recovery action');
    await act(async () => { restore.click(); await pause(); });
    await until(() => JSON.stringify(candidates(fixture.first)) === JSON.stringify(names), 'Recover must restore Nora without discarding Rowan or Castle Blackthorn');
    check(fixture.edits() === 0 && fixture.authoredBefore === await fixture.authored(), 'Recovery must preserve authored documents, preferences, aliases and history');
    return ['Dismiss/recover one candidate in a real owned editor context, session remount continuity, sibling-document isolation and exact authored-data preservation; explicitly controlled inference only'];
  });
}
