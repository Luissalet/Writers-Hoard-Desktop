import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { makeEntityHook } from '@/engines/_shared/makeEntityHook';
import { makeReadOnlyHook } from '@/engines/_shared/makeReadOnlyHook';
import AnnotationsEngine from '@/engines/annotations/components/AnnotationsEngine';
import InspirationGallery from '@/components/gallery/InspirationGallery';
import { t } from '@/i18n/useTranslation';
import type { Annotation } from '@/engines/annotations/types';
import NoteCard from '@/engines/notes/components/NoteCard';
import { makeNote } from '@/engines/notes/operations';
import { CreativeLab } from '@/components/project/creative-lab/CreativeLab';
import { buildCreativeSources, creativeSourceKey } from '@/components/project/creative-lab/sourceAdapters';
import { useProject, useProjects } from '@/hooks/useProjects';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
function input(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function testCreativeRetrieval(): Promise<string[]> {
  const host = document.createElement('div');
  document.body.append(host);
  let root: Root | null = null;
  const mount = async (view: ReactNode) => {
    await act(async () => { root?.unmount(); root = createRoot(host); root.render(<MemoryRouter>{view}</MemoryRouter>); await pause(); });
    await act(pause);
  };
  const until = async (predicate: () => boolean, message: string) => {
    for (let i = 0; i < 60 && !predicate(); i++) await act(pause);
    assert(predicate(), message);
  };
  const results: string[] = [];
  const projectId = 'creative-retrieval-fixture';
  try {
    for (const kind of ['entity', 'read-only'] as const) {
      let failing = true;
      let resolveLate!: (rows: string[]) => void;
      const fetchFn = async (scope: string) => {
        if (scope === 'slow') return new Promise<string[]>(resolve => { resolveLate = resolve; });
        if (failing) throw new Error(`Cannot read ${scope}`);
        return [`content-${scope}`];
      };
      const useRows = kind === 'entity'
        ? makeEntityHook<string>({ fetchFn, createFn: async () => 'id', updateFn: async () => {}, deleteFn: async () => {} })
        : makeReadOnlyHook<string>({ fetchFn });
      let current!: ReturnType<typeof useRows>;
      function Probe({ scope }: { scope: string }) { current = useRows(scope); return <p>{current.items.join(',')}</p>; }
      await mount(<Probe scope="first" />);
      await until(() => Boolean(current.error), `${kind}: initial failure hidden`);
      assert(!current.loading && current.items.length === 0, `${kind}: initial failure left permanent loading`);
      failing = false;
      await act(async () => { await current.refresh(); });
      assert(!current.error && current.items[0] === 'content-first', `${kind}: retry did not recover`);
      await act(async () => { root!.render(<MemoryRouter><Probe scope="slow" /></MemoryRouter>); await pause(); });
      assert(current.loading && current.items.length === 0 && !current.error, `${kind}: stale data leaked into new scope`);
      await act(async () => { root!.render(<MemoryRouter><Probe scope="next" /></MemoryRouter>); await pause(); });
      await until(() => current.items[0] === 'content-next', `${kind}: next scope did not load`);
      await act(async () => { resolveLate(['wrong-owner']); await pause(); });
      assert(current.items[0] === 'content-next', `${kind}: slow prior scope replaced current content`);
      failing = true;
      await act(async () => { await current.refresh(); });
      assert(!current.loading && current.error && current.items[0] === 'content-next', `${kind}: refresh error unmounted or erased existing content`);
      results.push(`${kind} reads: initial failure stops loading, retry recovers, refresh keeps content and stale scopes cannot overwrite`);
    }

    let finishMutation!: () => void;
    const useMutatingRows = makeEntityHook<string>({
      fetchFn: async scope => [`owner-${scope}`], createFn: async () => 'new', deleteFn: async () => {},
      updateFn: async () => new Promise<void>(resolve => { finishMutation = resolve; }),
    });
    let mutating!: ReturnType<typeof useMutatingRows>;
    function MutationProbe({ scope }: { scope: string }) { mutating = useMutatingRows(scope); return null; }
    await mount(<MutationProbe scope="A" />);
    let writing!: Promise<void>;
    await act(async () => { writing = mutating.editItem('record-A', 'changed'); });
    await act(async () => { root!.render(<MemoryRouter><MutationProbe scope="B" /></MemoryRouter>); await pause(); });
    await act(async () => { finishMutation(); await writing; });
    assert(mutating.items[0] === 'owner-B' && !mutating.loading, 'Late mutation in A invalidated the active B read');
    results.push('Entity mutations finishing after navigation keep the current owner and do not restart an obsolete read');

    await db.projects.put({ id: projectId, title: 'Read recovery', description: '', type: 'idea', status: 'draft', mode: 'custom', color: '#fff', enabledEngines: [], engineOrder: [], createdAt: 1, updatedAt: 1 });
    let projectRead!: ReturnType<typeof useProject>;
    let libraryRead!: ReturnType<typeof useProjects>;
    function ProjectProbe() { projectRead = useProject(projectId); libraryRead = useProjects(); return null; }
    const rejectRead = () => { throw new Error('Storage read temporarily unavailable'); };
    const originalOrderBy = db.projects.orderBy;
    db.projects.orderBy = (() => ({ reverse: () => ({ toArray: async () => { throw new Error('Library query failed'); } }) })) as unknown as typeof db.projects.orderBy;
    db.projects.hook('reading', rejectRead);
    try {
      await mount(<ProjectProbe />);
      for (let i = 0; i < 60 && !(projectRead.error && libraryRead.error); i++) await act(pause);
      assert(projectRead.error && libraryRead.error, `Project/library read failure hidden: ${JSON.stringify({ projectError: projectRead.error?.message, libraryError: libraryRead.error?.message, projectLoading: projectRead.loading, libraryLoading: libraryRead.loading, project: projectRead.project?.id, count: libraryRead.projects.length })}`);
      assert(!projectRead.loading && !libraryRead.loading && !projectRead.project, 'Project read error kept spinning or showed stale project');
    } finally { db.projects.hook('reading').unsubscribe(rejectRead); db.projects.orderBy = originalOrderBy; }
    await act(async () => { await Promise.all([projectRead.refresh(), libraryRead.refresh()]); });
    assert(projectRead.project?.id === projectId && !projectRead.error && libraryRead.projects.some(project => project.id === projectId) && !libraryRead.error, 'Library/project retry did not recover actual stored records');
    results.push('Project and library read failures are explicit and retry reloads existing records');

    const annotation = (id: string, noteBody: string, orphan: boolean): Annotation => ({
      id, projectId, sourceEngineId: 'writings', sourceEntityId: 'excerpt', anchor: { type: 'entity', selectedText: 'Original excerpt' }, noteType: 'text', noteBody, isOrphaned: orphan, position: 0, createdAt: 1, updatedAt: 1,
    });
    await db.annotations.bulkPut([annotation('retrieve-a', 'Brújula de recuerdos', true), annotation('retrieve-b', 'Otra intuición', false)]);
    await mount(<AnnotationsEngine projectId={projectId} />);
    await until(() => host.querySelectorAll('li').length === 2, 'Annotation list did not load');
    await act(async () => { input(host.querySelector('input[type="search"]')!, 'brujula'); });
    assert(host.querySelectorAll('li').length === 1 && host.textContent?.includes('Brújula'), 'Annotation body search failed to fold accents');
    await act(async () => { input(host.querySelector('input[type="search"]')!, ''); host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
    assert(host.querySelectorAll('li').length === 1, 'Orphan filter did not narrow list');
    await act(async () => { await db.annotations.update('retrieve-a', { isOrphaned: false }); });
    await until(() => host.querySelectorAll('li').length === 0, 'Repaired annotation stayed in orphan filter');
    assert(host.textContent?.includes(t('common.filteredEmpty')), 'Filtered empty annotation state missing');
    results.push('Annotations: body/excerpt search, accent folding and live orphan repairs update the filtered list');

    await mount(<InspirationGallery projectId={projectId} collections={[]} images={[
      { id: 'ref-a', projectId, imageData: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', tags: ['mapas'], notes: 'Brújula de recuerdos', createdAt: 1 },
      { id: 'ref-b', projectId, imageData: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', tags: ['arquitectura'], notes: 'Ciudad costera', createdAt: 2 },
    ]} onAdd={async () => {}} onEditImage={() => {}} onDelete={() => {}} onAddCollection={async () => {}} onDeleteCollection={() => {}} />);
    await act(async () => { input(host.querySelector('input[type="search"]')!, 'brujula mapas'); });
    assert(host.querySelectorAll('img').length === 1, 'Gallery combined notes/tags search failed');
    await act(async () => { input(host.querySelector('input[type="search"]')!, 'missing'); });
    assert(!host.querySelector('img') && host.textContent?.includes(t('common.filteredEmpty')), 'Gallery search empty state claimed the library was empty');
    const clear = [...host.querySelectorAll('button')].find(button => button.textContent === t('common.resetFilters'));
    assert(clear, 'Gallery clear filters action missing');
    await act(async () => clear.click());
    assert(host.querySelectorAll('img').length === 2, 'Gallery clear filters did not recover existing references');
    results.push('Gallery: combined notes/tags search folds accents and clearing no-result filters restores references');

    const note = makeNote(projectId, { text: 'Una ciudad que recuerda', kind: 'idea', tags: ['memoria'] });
    let rejectEdit = true;
    let storedText = note.text;
    await mount(<NoteCard note={note} onUpdate={async (_id, changes) => { if (rejectEdit) throw new Error('Disk busy'); storedText = changes.text ?? storedText; }} onDelete={() => {}} />);
    const edit = host.querySelector<HTMLButtonElement>(`button[title="${t('common.edit')}"]`)!;
    await act(async () => edit.click());
    await act(async () => {
      const textarea = host.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Una ciudad que comparte recuerdos');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const saveNote = () => [...host.querySelectorAll('button')].find(button => button.textContent === t('common.save'))!;
    await act(async () => { saveNote().click(); await pause(); });
    assert(host.querySelector('textarea')?.value === 'Una ciudad que comparte recuerdos' && host.querySelector('[role="alert"]'), 'Editing a note discarded a rejected save');
    rejectEdit = false;
    await act(async () => { saveNote().click(); await pause(); });
    assert(!host.querySelector('textarea') && storedText === 'Una ciudad que comparte recuerdos', 'Note edit retry did not persist');
    const sources = buildCreativeSources({ projectId, notes: [note] });
    await mount(<CreativeLab projectId={projectId} sources={sources} focusedSourceKey={creativeSourceKey('note', note.id)} onPromote={async () => { throw new Error('Not invoked'); }} />);
    assert(host.querySelector('[data-testid="creative-source-list"] button[aria-pressed="true"]')?.textContent?.includes(note.text), 'Develop note did not preselect the original source');
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="creative-source-list"] button[aria-pressed="true"]')!.click(); });
    assert(!host.querySelector('[data-testid="creative-source-list"] button[aria-pressed="true"]'), 'Deep link kept forcing source selection after manual change');
    results.push('Notes: failed edits retain drafts and retry; development links preselect the source without overriding later choices');
    return results;
  } finally {
    await act(async () => { root?.unmount(); });
    host.remove();
    await db.annotations.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  }
}
