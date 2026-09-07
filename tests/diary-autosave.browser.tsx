import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import EntryEditor from '@/engines/diary/components/EntryEditor';
import DiaryEngine from '@/engines/diary/components/DiaryEngine';
import { db } from '@/db';
import { discardPendingOwner, flushPendingWrites, getPendingWritesSnapshot, trackPendingWrite } from '@/services/pendingWrites';
import type { DiaryEntry } from '@/engines/diary/types';
import { t } from '@/i18n/useTranslation';

export async function testDiaryAutosave(): Promise<string[]> {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const entry: DiaryEntry = { id: 'autosave-diary', projectId: 'autosave-project', title: 'Initial', content: '', entryDate: '2026-09-07T12:00', tags: [], pinned: false, createdAt: 1, updatedAt: 1 };
  const saved: string[] = [];
  let finishFirst!: () => void;
  let closed = false;
  const wait = () => new Promise(resolve => setTimeout(resolve, 25));
  const button = (name: string) => [...host.querySelectorAll('button')].find(row => row.textContent?.trim() === name)!;
  const projectId = 'diary-real-autosave-project';
  const sentinelOwner = 'diary-autosave-unrelated-failure';
  const editTitle = async (value: string) => act(async () => {
    const input = host.querySelector<HTMLInputElement>(`input[placeholder="${t('diary.titlePlaceholder')}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  try {
    await act(async () => { root.render(<EntryEditor entry={entry} onSave={async changes => {
      saved.push(changes.title ?? '');
      if (saved.length === 1) await new Promise<void>(resolve => { finishFirst = resolve; });
    }} onDelete={async () => {}} onClose={() => { closed = true; }} />); });
    await editTitle('First thought');
    for (let i = 0; i < 100 && !finishFirst; i++) await act(wait);
    if (!finishFirst || closed || host.querySelector('[inert]')) throw new Error('Diary autosave did not start in background while keeping editor usable');
    await editTitle('Second thought while saving');
    await act(async () => { finishFirst(); await flushPendingWrites(); await wait(); });
    if (saved.join('|') !== 'First thought|Second thought while saving' || closed) throw new Error('Diary autosave lost a newer edit or closed the editor');
    const back = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === t('common.back'))!;
    await act(async () => { back.click(); await wait(); });
    if (!closed || saved.length !== 2) throw new Error('Diary Back after autosave duplicated a write or failed to close');

    for (const emptyContent of ['', '<p></p>']) {
      let emptyWrites = 0;
      await act(async () => { root.render(<EntryEditor key={`empty-${emptyContent}`} entry={{ ...entry, id: `empty-${emptyContent}`, title: '', content: emptyContent }} isNew onSave={async () => { emptyWrites++; }} onDelete={async () => {}} onClose={() => root.render(null)} />); });
      await act(async () => { button(t('diary.pin')).click(); await wait(); });
      // This field is dirty but there is no authored text: neither the timer
      // nor the unmount cleanup may create a blank entry.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 1650)); });
      if (emptyWrites !== 0) throw new Error('Diary autosaved a new empty entry after a metadata edit');
      await act(async () => { button(t('common.back')).click(); await wait(); });
      await act(async () => { await flushPendingWrites(); });
      if (emptyWrites !== 0 || host.querySelector('input')) throw new Error('Diary Back or unmount saved a discarded empty entry');
    }

    const imageOnly = '<p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="></p>';
    for (const immediateBack of [false, true]) {
      const mediaSaves: string[] = [];
      await act(async () => { root.render(<EntryEditor key={`media-${immediateBack}`} entry={{ ...entry, id: `media-${immediateBack}`, title: '', content: imageOnly }} isNew onSave={async changes => { mediaSaves.push(changes.content ?? ''); }} onDelete={async () => {}} onClose={() => root.render(null)} />); });
      await act(async () => { button(t('diary.pin')).click(); await wait(); });
      if (!immediateBack) {
        for (let i = 0; i < 100 && mediaSaves.length === 0; i++) await act(wait);
        if (mediaSaves.length !== 1) throw new Error('Diary treated image-only content as empty during autosave');
      }
      await act(async () => { button(t('common.back')).click(); await wait(); });
      if (mediaSaves.length !== 1 || mediaSaves[0] !== imageOnly || host.querySelector('input')) throw new Error('Diary Back discarded or duplicated image-only content');
    }

    let deleted = false;
    let failedAttempts = 0;
    await trackPendingWrite(Promise.reject(new Error('Unrelated fixture failure')), undefined, sentinelOwner).catch(() => {});
    const unrelatedFailures = getPendingWritesSnapshot().failed;
    await act(async () => { root.render(<EntryEditor key="failed-delete" entry={{ ...entry, id: 'failed-delete' }} onSave={async () => { failedAttempts++; throw new Error('Injected diary persistence failure'); }} onDelete={async () => { deleted = true; root.render(null); }} onClose={() => root.render(null)} />); });
    await editTitle('Failed draft to intentionally delete');
    await act(async () => { await flushPendingWrites(); await wait(); });
    if (getPendingWritesSnapshot().failed !== unrelatedFailures + 1 || !host.querySelector('[role="alert"]')) throw new Error('Failed diary write was not retained in the ledger');
    const deleteButton = host.querySelector<HTMLButtonElement>(`button[title="${t('diary.deleteEntry')}"]`)!;
    await act(async () => { deleteButton.click(); await wait(); });
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(row => row.textContent?.trim() === t('common.delete'))!;
    await act(async () => { confirm.click(); await wait(); });
    if (!deleted || getPendingWritesSnapshot().failed !== unrelatedFailures || failedAttempts !== 1) throw new Error('Deleting a failed diary draft left its failure, retried it, or cleared another owner');
    discardPendingOwner(sentinelOwner);
    if (!(await flushPendingWrites()).ok) throw new Error('Deleted draft still blocks a clean exit');

    await db.projects.put({ id: projectId, title: 'Diary autosave fixture', mode: 'custom', type: 'idea', color: '#fff', description: '', status: 'draft', enabledEngines: ['diary'], engineOrder: ['diary'], createdAt: 1, updatedAt: 1 });
    await act(async () => { root.render(<MemoryRouter><DiaryEngine projectId={projectId} /></MemoryRouter>); await wait(); });
    for (let i = 0; i < 100 && !button(t('diary.newEntry')); i++) await act(wait);
    await act(async () => { button(t('diary.newEntry')).click(); await wait(); });
    const firstInput = host.querySelector<HTMLInputElement>(`input[placeholder="${t('diary.titlePlaceholder')}"]`)!;
    await editTitle('A new journal idea');
    let created: DiaryEntry[] = [];
    for (let i = 0; i < 120 && created.length === 0; i++) {
      await act(async () => {
        await wait();
        created = await db.diaryEntries.where('projectId').equals(projectId).toArray();
      });
    }
    await act(async () => { await flushPendingWrites(); await wait(); });
    if (created.length !== 1 || !firstInput.isConnected || firstInput.value !== 'A new journal idea') throw new Error('First real diary autosave closed/remounted the editor or failed to insert once');
    const firstId = created[0].id;
    await editTitle('The same idea developed');
    await act(async () => { await flushPendingWrites(); await wait(); });
    const updated = await db.diaryEntries.where('projectId').equals(projectId).toArray();
    if (updated.length !== 1 || updated[0].id !== firstId || updated[0].title !== 'The same idea developed' || !firstInput.isConnected) throw new Error('Second real autosave duplicated the new entry or lost its editor owner');
    await act(async () => { button(t('common.back')).click(); await wait(); });
    if (host.contains(firstInput) || await db.diaryEntries.where('projectId').equals(projectId).count() !== 1) throw new Error('Back after first creation failed to close or duplicated the entry');
    return ['Diary autosave keeps editing available, drains newer text during a write, and Back closes without duplicate saves', 'Diary empty drafts: metadata and empty rich text do not create rows on autosave or Back', 'Diary image-only content survives autosave and immediate Back without a title', 'Diary deletion clears only its failed draft owner and no longer blocks clean exit', 'Diary real first autosave keeps the editor mounted and subsequent edits reuse the same entry ID'];
  } finally {
    await act(async () => root.unmount()); host.remove();
    discardPendingOwner(sentinelOwner);
    discardPendingOwner(`diary-draft:${entry.projectId}:failed-delete`);
    await db.diaryEntries.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  }
}
