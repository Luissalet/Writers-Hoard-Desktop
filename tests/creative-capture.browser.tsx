import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import '@/engines/notes';
import NoteComposer, { type NoteDraft } from '@/engines/notes/components/NoteComposer';
import { captureNote, moveNote } from '@/engines/notes/operations';
import { GLOBAL_NOTES_SCOPE } from '@/engines/notes/types';
import PersistentCreativeLab from '@/components/project/creative-lab/PersistentCreativeLab';
import { buildCreativeSources, createCreativePossibility } from '@/components/project/creative-lab';
import { saveCreativePossibilities } from '@/services/creativePossibilities';
import { flushPendingWrites } from '@/services/pendingWrites';
import { createProjectZipArchive, importProjectZip } from '@/services/zipBackup';
import type { Project } from '@/types';
import CodexEntryList from '@/components/codex/CodexEntryList';
import CaptureBar from '@/engines/scrapper/components/CaptureBar';
import EntryEditor from '@/engines/diary/components/EntryEditor';
import InspirationGallery from '@/components/gallery/InspirationGallery';
import { t } from '@/i18n/useTranslation';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const wait = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));

function setText(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function testCreativeCapturePersistence(): Promise<string[]> {
  const host = document.getElementById('root');
  assert(host, 'Missing test host');
  let root: Root | null = null;
  const projectId = 'creative-capture-fixture';
  const foreignId = 'creative-capture-foreign';
  const project = (id: string): Project => ({
    id, title: id, mode: 'custom', type: 'idea', color: '#fff', description: '',
    status: 'draft', enabledEngines: [], engineOrder: [], createdAt: 1, updatedAt: 1,
  });
  const unmount = async () => {
    await act(async () => { root?.unmount(); root = null; await wait(); });
  };
  const mount = async (element: React.ReactNode, route = '/') => {
    await act(async () => { root = createRoot(host); root.render(<MemoryRouter initialEntries={[route]}>{element}</MemoryRouter>); await wait(); });
    await act(async () => { await wait(); });
  };
  let capturedId: string | undefined;
  try {
    await db.projects.bulkPut([project(projectId), project(foreignId)]);
    let reject!: (error: Error) => void;
    let submissions = 0;
    let savedDraft: NoteDraft | undefined;
    let fail = true;
    await mount(<NoteComposer onSubmit={async draft => {
      submissions += 1;
      savedDraft = draft;
      if (fail) await new Promise<void>((_resolve, rejectSave) => { reject = rejectSave; });
    }} />);
    const textarea = host.querySelector('textarea')!;
    await act(async () => { setText(textarea, 'A thought worth keeping'); });
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    assert(submissions === 1, 'Double Enter submitted twice');
    assert(textarea.value === 'A thought worth keeping', 'Pending write cleared the idea');
    await act(async () => { reject(new Error('storage unavailable')); await wait(); });
    assert(textarea.value === 'A thought worth keeping', 'Failed write cleared the idea');
    assert(host.querySelector('[role="alert"]'), 'Failed write has no recovery feedback');
    fail = false;
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await wait();
    });
    assert(savedDraft?.text === 'A thought worth keeping' && textarea.value === '', 'Retry did not save and clear');
    await unmount();

    // Saving a codex entry must retain the actual form when storage rejects it.
    await mount(<CodexEntryList projectId={projectId} entries={[]} onAdd={async () => { throw new Error('storage unavailable'); }} onEdit={async () => {}} onDelete={() => {}} />);
    const create = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === t('codex.newEntry'));
    assert(create, 'Missing codex create entry button');
    await act(async () => { create.click(); await wait(); });
    const codexName = [...document.querySelectorAll('input')].find(input => input.placeholder === t('codex.entryName'));
    assert(codexName, 'Codex form did not open');
    await act(async () => { setText(codexName, 'Mara keeps the truth'); });
    const codexSave = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent?.trim() === t('codex.createEntry'));
    assert(codexSave, 'Missing codex save button');
    await act(async () => { codexSave.click(); await wait(); });
    assert(document.querySelector('[role="dialog"] input') && codexName.value === 'Mara keeps the truth', 'Failed codex save dismissed the draft');
    assert(document.querySelector('[role="alert"]'), 'Codex save error was hidden');
    await unmount();

    await mount(<CaptureBar projectId={projectId} onManualEntry={() => {}} onCapture={async () => { throw new Error('storage unavailable'); }} />);
    const url = host.querySelector('input')!;
    await act(async () => { setText(url, 'https://example.com/irreplaceable-link'); });
    await act(async () => { url.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(); });
    assert(url.value === 'https://example.com/irreplaceable-link' && host.querySelector('[role="alert"]'), 'Failed clipping save lost the URL');
    await unmount();

    let diaryClosed = false;
    let failDiary = true;
    let persistedDiaryTitle: string | undefined;
    await mount(<EntryEditor
      entry={{ id: 'diary-draft', projectId, title: '', content: '', entryDate: '2026-09-07T12:00', tags: [], pinned: false, createdAt: 1, updatedAt: 1 }}
      onSave={async changes => {
        if (failDiary) throw new Error('storage unavailable');
        persistedDiaryTitle = changes.title;
      }}
      onDelete={async () => {}}
      onClose={() => { diaryClosed = true; }}
    />);
    const diaryTitle = [...host.querySelectorAll('input')].find(input => input.placeholder === t('diary.titlePlaceholder'));
    assert(diaryTitle, 'Missing diary title input');
    await act(async () => { setText(diaryTitle, 'An unfinished memory'); });
    await act(async () => { host.querySelector('button')!.click(); await wait(); });
    assert(!diaryClosed && diaryTitle.value === 'An unfinished memory', 'Back discarded diary after failed save');
    failDiary = false;
    await unmount();
    await flushPendingWrites();
    assert(persistedDiaryTitle === 'An unfinished memory', 'Sidebar navigation discarded the diary draft');

    const galleryImage = {
      id: 'gallery-target', projectId, collectionId: 'album-target', notes: 'A reference worth revisiting',
      imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
      thumbnailData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', tags: ['reference'], createdAt: 1,
    };
    const galleryProps = {
      projectId, images: [galleryImage], collections: [{ id: 'album-target', projectId, title: 'References', createdAt: 1 }],
      onAdd: async () => {}, onEditImage: () => {}, onDelete: () => {}, onDeleteCollection: () => {},
      onAddCollection: async () => { throw new Error('storage unavailable'); },
    };
    await mount(<InspirationGallery {...galleryProps} />, `/project/${projectId}/gallery?image=gallery-target`);
    const lightbox = document.querySelector('[role="dialog"]');
    assert(lightbox?.querySelector('img')?.getAttribute('alt') === galleryImage.notes, 'Image deep link did not open its lightbox');
    await unmount();
    await mount(<InspirationGallery {...galleryProps} />);
    const newAlbum = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === t('gallery.newAlbum'));
    assert(newAlbum, 'Missing new album button');
    await act(async () => { newAlbum.click(); });
    const albumName = [...host.querySelectorAll('input')].find(input => input.placeholder === t('gallery.albumName'));
    assert(albumName, 'Missing album name field');
    await act(async () => { setText(albumName, 'Unfinished references'); });
    await act(async () => { albumName.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(); });
    assert(albumName.isConnected && albumName.value === 'Unfinished references' && host.querySelector('[role="alert"]'), 'Failed album save lost name');
    await unmount();

    const note = await captureNote({ projectId: GLOBAL_NOTES_SCOPE, text: 'The bell rings before a lie', tags: ['mystery', 'bell'] });
    assert(note, 'Capture returned no note');
    capturedId = note.id;
    assert((await db.notes.get(note.id))?.tags.join(',') === 'mystery,bell', 'Quick capture lost tags');
    await moveNote(note.id, projectId);
    assert((await db.projects.get(projectId))?.enabledEngines.includes('notes'), 'Moving to a project left notes hidden');
    try { await moveNote(note.id, 'missing-project'); } catch { /* must leave origin intact */ }
    assert((await db.notes.get(note.id))?.projectId === projectId, 'Failed move lost original ownership');

    const sources = buildCreativeSources({ projectId, notes: [{ ...note, projectId }], boardNodes: [], codexEntries: [], images: [], seeds: [] });
    const possibility = createCreativePossibility({ id: 'persisted-idea', createdAt: 1, sources, request: { operation: 'truth' } });
    await saveCreativePossibilities(projectId, [possibility]);
    const sibling = { ...possibility, id: 'second-idea', createdAt: 2 };
    await saveCreativePossibilities(projectId, [sibling]);
    await saveCreativePossibilities(projectId, [{ ...possibility, title: 'Edited idea', updatedAt: 3 }]);
    assert((await db.projects.get(projectId))?.creativePossibilities?.length === 2, 'Partial save erased a sibling idea');
    let rejectedForeign = false;
    try { await saveCreativePossibilities(foreignId, [possibility]); } catch { rejectedForeign = true; }
    assert(rejectedForeign, 'Cross-project possibility write accepted');

    const props = { projectId, sources, onPromote: async () => ({ entityId: 'unused' }) };
    await mount(<PersistentCreativeLab {...props} />);
    const title = host.querySelector('[data-testid="creative-possibility-persisted-idea"] input') as HTMLInputElement | null;
    assert(title, 'Persisted idea did not mount');
    await act(async () => { setText(title, 'The last keystroke survives navigation'); });
    await unmount();
    assert((await flushPendingWrites()).ok, 'Navigation failed to flush the draft');
    await mount(<PersistentCreativeLab {...props} />);
    assert((host.querySelector('[data-testid="creative-possibility-persisted-idea"] input') as HTMLInputElement)?.value === 'The last keystroke survives navigation', 'Reopening lost latest idea edit');
    await unmount();
    assert(!(await db.projects.get(foreignId))?.creativePossibilities?.length, 'Draft leaked into another project');

    const archive = await createProjectZipArchive(projectId);
    await db.projects.update(projectId, { creativePossibilities: [] });
    await importProjectZip(new File([archive.blob], 'creative-project.zip'), { replaceProjectIds: [projectId] });
    const restored = (await db.projects.get(projectId))?.creativePossibilities;
    assert(restored?.length === 2 && restored.some(row => row.title === 'The last keystroke survives navigation'), 'Project archive lost creative possibilities');
    return ['Notes: retry retains text, double-submit blocked, tags and project move preserved', 'Codex, clippings and diary keep drafts after rejected writes; diary flushes on navigation', 'Gallery: image deep links open lightbox; failed album writes retain input', 'Creative lab: navigation flush, project isolation, concurrent ideas and ZIP roundtrip'];
  } finally {
    await unmount();
    await db.notes.where('projectId').anyOf([projectId, foreignId]).delete();
    if (capturedId) await db.notes.delete(capturedId);
    await db.projects.bulkDelete([projectId, foreignId]);
  }
}
