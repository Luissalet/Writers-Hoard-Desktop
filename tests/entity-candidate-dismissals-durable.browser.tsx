import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import type { Editor } from '@tiptap/core';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { db } from '@/db';
import { useLocaleStore } from '@/stores/localeStore';
import type { CodexEntry, Project, Writing } from '@/types';
import type { WritingSnapshot } from '@/engines/writings/snapshotTypes';
import type { EntitySpan } from '@/services/entityDetection/types';

// New durable oracle. The historical 1686f471 session oracle is not imported,
// rewritten or asserted to pass this different metadata persistence contract.
// Inference here is an explicitly controlled port; no model or Browser NER.
const pause = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
function check(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
function equal(actual: unknown, expected: unknown, message: string) { check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)}`); }
async function until(read: () => boolean, message: string) {
  for (let attempt = 0; attempt < 160; attempt++) { if (read()) return; await act(async () => { await pause(50); }); }
  throw Error(message);
}
const names = ['Nora', 'Rowan', 'Castle Blackthorn'];
const visible = (scope: ParentNode) => [...scope.querySelectorAll('.wh-entity-panel li > span')].map(node => node.textContent);
const buttonNamed = (scope: ParentNode, name: string) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(button => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim() === name);
interface Decision { key: string; name: string; discarded: boolean; version: string }
interface Ledger { version: 1; owners: Array<{ eraId?: string; context: { kind: 'writings' | 'codex'; documentId: string; draftId?: string }; revision: number; decisions: Decision[] }> }
type DurableProject = Project & { entityCandidateDismissals?: Ledger };
interface Fixture {
  projectId: string; firstId: string; secondId: string; first: HTMLElement; second: HTMLElement;
  editor(id: string): Editor; firstHtml: string; secondHtml: string; before: string;
  unchangedAuthored(): Promise<void>; metadata(): Promise<Ledger | undefined>;
  remountFirst(): Promise<void>; edits(): number;
}

async function withDurableFixture(assertions: (fixture: Fixture) => Promise<string[]>): Promise<string[]> {
  const host = document.getElementById('root')!, root = createRoot(host);
  const projectId = 'qa-entity-dismissal-durable-contract', controlId = `${projectId}-foreign`, firstId = `${projectId}-A`, secondId = `${projectId}-B`, draftId = `${projectId}-draft`, knownId = `${projectId}-known`, now = 100;
  const previousApi = window.electronAPI, previousLocale = useLocaleStore.getState().locale;
  const editors = new Map<string, Editor>(); let edits = 0, calls = 0, firstMount = 0;
  const content = `<p>Nora travelled with Rowan to Castle Blackthorn. La Guía kept the <a href="/project/${projectId}/codex?entry=${knownId}">authored link</a>.</p>`;
  const project = (id: string): Project => ({ id, title: id, type: 'standalone', mode: 'custom', description: 'unchanged description', status: 'draft', color: '#777777', enabledEngines: ['codex', 'writings'], engineOrder: ['writings', 'codex'], createdAt: now, updatedAt: now, entityDetectionPreferences: { revision: 7, detectNewEntities: true, autoLinkMentions: true, animateNewLinks: false }, worldEras: [{ id: 'past', name: 'Past control', description: 'unchanged', revision: 3, createdAt: now, updatedAt: now }] });
  const writing = (id: string): Writing => ({ id, projectId, title: id, status: 'draft', content, wordCount: 15, tags: ['unchanged'], createdAt: now, updatedAt: now });
  const known: CodexEntry = { id: knownId, projectId, title: 'Known Pilot', type: 'character', fields: { aliases: '["La Guía"]', extra: 'unchanged' }, content: '<p>Exact authored facts</p>', tags: ['kept'], relations: [], createdAt: now, updatedAt: now };
  const draft: WritingSnapshot = { id: draftId, writingId: firstId, projectId, title: firstId, content: '<p>Nora in a separate alternative.</p>', wordCount: 6, reason: 'manual', kind: 'parallel-draft', draftName: 'Kept alternative', basedOnVersion: now, createdAt: now, updatedAt: now };
  // Snapshot every IDB table, not just prose. The only permitted omission is
  // the NEW metadata field on the one fixture Project; dates remain compared.
  const authored = async () => {
    const result: Record<string, unknown[]> = {};
    for (const table of db.tables) result[table.name] = (await table.toArray()).map(row => {
      if (table.name !== 'projects' || row.id !== projectId) return row;
      const copy = { ...row }; delete copy.entityCandidateDismissals; return copy;
    });
    return JSON.stringify(result);
  };
  const render = async () => {
    const chapter = (id: string, slot: string, mount: number) => <section key={slot} data-durable-dismissal={slot}><TiptapEditor key={`${id}:${mount}`} content={content} onChange={() => { edits++; }} onEditorReady={editor => { if (editor) editors.set(id, editor); else editors.delete(id); }} copilotIdentity={{ projectId, objectId: id, kind: 'writings' }} documentOwner={{ kind: 'writings', documentId: id }} referenceContext={{ projectId, scopeId: `fixture:${id}` }} {...{ entityCandidateContext: { kind: 'writings' as const, documentId: id } }} /></section>;
    await act(async () => { root.render(<MemoryRouter><main>{chapter(firstId, 'first', firstMount)}{chapter(secondId, 'second', 0)}</main></MemoryRouter>); await pause(); });
    for (const details of host.querySelectorAll<HTMLDetailsElement>('[data-editor-document-tools],.wh-entity-controls')) details.open = true;
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { entityDetection: {
    status: async () => ({ state: 'ready' as const, model: 'controlled-durable-ui-fixture-no-model' }),
    prepare: async () => { throw Error('Durable dismissal fixture must never prepare a classifier'); },
    detect: async (text: string): Promise<EntitySpan[]> => { calls++; return [...names, 'La Guía'].map(name => { const from = text.indexOf(name); check(from >= 0, `Fixture source lost ${name}`); return { from, to: from + name.length, text: name, label: name === 'Castle Blackthorn' ? 'LOC' : 'PER', score: .99 }; }); },
  } } });
  useLocaleStore.setState({ locale: 'es' });
  try {
    await db.projects.bulkPut([project(projectId), project(controlId)]); await db.writings.bulkPut([writing(firstId), writing(secondId)]); await db.codexEntries.put(known); await db.writingSnapshots.put(draft);
    // A real existing era override is an untouched control, not a fabricated
    // owner bypass. Future bridge tests separately exercise era-only drafts.
    await db.worldEraVariants.put({ id: `${projectId}-past-B`, projectId, eraId: 'past', kind: 'writings', entityId: secondId, revision: 2, updatedAt: now, document: { root: { ...writing(secondId), content: '<p>Nora in an unchanged era.</p>' }, children: {} } });
    const before = await authored();
    await render();
    const first = host.querySelector<HTMLElement>('[data-durable-dismissal="first"]')!, second = host.querySelector<HTMLElement>('[data-durable-dismissal="second"]')!;
    check(first && second, 'Durable positive baseline: both owned contexts mounted');
    await until(() => JSON.stringify(visible(first)) === JSON.stringify(names) && JSON.stringify(visible(second)) === JSON.stringify(names), 'Durable positive baseline: both real editors must show exactly three new candidates before feature assertions');
    const getEditor = (id: string) => { const editor = editors.get(id); check(editor, `Real editor unavailable: ${id}`); return editor; };
    const firstHtml = getEditor(firstId).getHTML(), secondHtml = getEditor(secondId).getHTML();
    check(calls >= 2 && first.querySelector('[data-wh-entity-candidate]') && second.querySelector('[data-wh-entity-candidate]'), 'Durable positive baseline: controlled candidates decorate both real Tiptap documents');
    check(firstHtml.includes('authored link') && firstHtml.includes(knownId) && firstHtml.includes('La Guía') && !visible(first).includes('La Guía'), 'Durable positive baseline: literal authored link/alias retained while known alias is excluded');
    check(buttonNamed(first, 'Crear ficha') && buttonNamed(second, 'Crear ficha'), 'Durable positive baseline: incumbent Create controls available');
    check(edits === 0 && before === await authored(), 'Durable positive baseline: scanning must not write any authored table, field or date');
    const metadata = async () => (await db.projects.get(projectId) as DurableProject | undefined)?.entityCandidateDismissals;
    check(!Object.hasOwn((await db.projects.get(projectId))!, 'entityCandidateDismissals'), 'Durable positive baseline: opening/scanning legacy metadata absence must not materialize a default');
    return await assertions({ projectId, firstId, secondId, first, second, editor: getEditor, firstHtml, secondHtml, before, metadata, edits: () => edits, remountFirst: async () => { firstMount++; await render(); }, unchangedAuthored: async () => {
      equal(await authored(), before, 'Only Project.entityCandidateDismissals may change: all other rows/fields/dates must remain exact');
      check(edits === 0 && getEditor(firstId).getHTML() === firstHtml && getEditor(secondId).getHTML() === secondHtml, 'Dismissal metadata must not alter rich HTML, aliases, authored links or report prose onChange');
    } });
  } finally {
    await act(async () => { root.unmount(); });
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: previousApi }); useLocaleStore.setState({ locale: previousLocale });
    await db.worldEraVariants.where('projectId').equals(projectId).delete(); await db.writingSnapshots.where('projectId').equals(projectId).delete(); await db.writings.where('projectId').equals(projectId).delete(); await db.codexEntries.where('projectId').equals(projectId).delete(); await db.projects.bulkDelete([projectId, controlId]);
  }
}

function onlyNoraOwner(metadata: Ledger | undefined, fixture: Fixture, discarded: boolean): Decision {
  check(metadata?.version === 1 && metadata.owners.length === 1, 'Durable metadata must persist one exact owner record in Project');
  const owner = metadata.owners[0];
  equal(owner.context, { kind: 'writings', documentId: fixture.firstId }, 'Metadata owner must be the intended canonical writing, not pane/title/other document');
  check(owner.eraId === undefined && owner.revision > 0 && Number.isSafeInteger(owner.revision), 'Canonical Base owner must not create an era/draft decision or invalid revision');
  check(owner.decisions.length === 1, 'Only the chosen candidate may gain metadata');
  const decision = owner.decisions[0];
  check(decision.key === 'nora' && decision.name === 'Nora' && decision.discarded === discarded && typeof decision.version === 'string' && decision.version.length > 0, 'Persist exactly the canonical name/key, requested membership and nonempty CAS token');
  return decision;
}

export async function testEntityCandidateDismissalDurablePositiveBaseline(): Promise<string[]> {
  return withDurableFixture(async fixture => {
    const create = buttonNamed(fixture.first, 'Crear ficha'); check(create, 'Incumbent Create action missing');
    await act(async () => { create.click(); await pause(); });
    await until(() => !visible(fixture.first).includes('Nora'), 'Positive baseline: ordinary Create must update candidates');
    const cards = await db.codexEntries.where('projectId').equals(fixture.projectId).toArray();
    check(cards.length === 2 && cards.some(card => card.title === 'Nora' && card.content === '' && Object.keys(card.fields).length === 0), 'Positive baseline: normal service must create exactly one title-only card');
    check(fixture.editor(fixture.firstId).getHTML() === fixture.firstHtml && fixture.editor(fixture.secondId).getHTML() === fixture.secondHtml && fixture.edits() === 0, 'Incumbent explicit creation preserves both rich documents');
    check(await fixture.metadata() === undefined, 'Ordinary creation does not manufacture dismissal metadata');
    return ['New durable baseline: two actual owned Tiptap editors, three candidates/known alias/authored link, all-table pre-feature invariance, legacy absence and ordinary Create; controlled inference explicitly, no Browser NER runtime'];
  });
}

export async function testEntityCandidateDismissalDurableOriginal(): Promise<string[]> {
  return withDurableFixture(async fixture => {
    const dismiss = buttonNamed(fixture.first, 'Descartar Nora');
    check(dismiss, 'NER_DURABLE_DISMISS_ONE_MISSING: positive real-editor/all-table baseline passed; no accessible "Descartar Nora" action exists');
    await act(async () => { dismiss.click(); await pause(); });
    equal(visible(fixture.first), ['Rowan', 'Castle Blackthorn'], 'Dismiss must preserve the other two candidates');
    equal(visible(fixture.second), names, 'Another document must preserve Nora');
    const firstToken = onlyNoraOwner(await fixture.metadata(), fixture, true).version;
    await fixture.unchangedAuthored();
    const undo = buttonNamed(fixture.first, 'Deshacer descarte'); check(undo, 'Effective durable dismissal must have an explicit Undo action');
    await act(async () => { undo.click(); await pause(); });
    await until(() => JSON.stringify(visible(fixture.first)) === JSON.stringify(names), 'Undo must return Nora without losing other names');
    check(!Object.hasOwn((await db.projects.get(fixture.projectId))!, 'entityCandidateDismissals'), 'First Undo must restore real legacy absence, not an empty materialized ledger');
    await fixture.unchangedAuthored();
    const dismissAgain = buttonNamed(fixture.first, 'Descartar Nora'); check(dismissAgain, 'Nora must be dismissible after Undo');
    await act(async () => { dismissAgain.click(); await pause(); });
    const secondToken = onlyNoraOwner(await fixture.metadata(), fixture, true).version;
    check(secondToken !== firstToken, 'A new transition must not revive a previous CAS token');
    await fixture.remountFirst();
    await until(() => JSON.stringify(visible(fixture.first)) === JSON.stringify(['Rowan', 'Castle Blackthorn']), 'Remount must read the persisted owner decision');
    onlyNoraOwner(await fixture.metadata(), fixture, true); await fixture.unchangedAuthored();
    const recover = buttonNamed(fixture.first, 'Recuperar Nora'); check(recover, 'Durable discarded name must have an explicit recovery action');
    await act(async () => { recover.click(); await pause(); });
    await until(() => JSON.stringify(visible(fixture.first)) === JSON.stringify(names), 'Individual recovery must restore only Nora');
    check(onlyNoraOwner(await fixture.metadata(), fixture, false).version !== secondToken, 'Recovery persists a new token instead of reviving a stale receipt');
    equal(visible(fixture.second), names, 'Recovery must preserve the other document scope'); await fixture.unchangedAuthored();
    return ['Durable Project metadata is the sole allowed data delta; one-name dismissal, individual recovery, Undo to true absence, fresh CAS tokens and remount/other-document isolation with controlled inference; DB metadata/remount is not a cold-renderer proof'];
  });
}
