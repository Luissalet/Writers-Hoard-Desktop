import { act } from 'react';
import { createRoot } from 'react-dom/client';
import MapView, { type PinDraft } from '@/components/maps/MapView';
import DivergenceEditor from '@/engines/real-atlas/components/DivergenceEditor';
import { isRowDraftSnapshot } from '@/engines/real-atlas/components/useRowDraft';
import type { AtlasDivergence } from '@/engines/real-atlas/types';
import TimelineView from '@/engines/timeline/components/TimelineView';
import SwimLaneView from '@/engines/timeline/components/SwimLaneView';
import { createLocalDraftStore, deleteWithDraftCleanup } from '@/hooks/localDraftStore';
import { flushPendingWrites, getPendingWritesSnapshot, retryFailedWrites } from '@/services/pendingWrites';
import { t } from '@/i18n/useTranslation';
import type { MapPin, TimelineEvent, TimelineConnection } from '@/types';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function typeInto(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = control instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
}
function clickText(host: HTMLElement, text: string) {
  const node = [...host.querySelectorAll('svg text')].find((element) => element.textContent === text);
  if (!node) throw new Error(`Missing SVG text: ${text}`);
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

export async function testPlanningFollowup(): Promise<string[]> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const prefix = `planning-followup-${Date.now()}`;
  const passed: string[] = [];
  const acceptPin = (value: unknown): value is PinDraft => !!value && typeof value === 'object' && 'name' in value;
  try {
    let drafts = createLocalDraftStore(`${prefix}-maps`, acceptPin);
    let fail = true;
    const savedPins: string[] = [];
    const pins: MapPin[] = ['A', 'B'].map((id) => ({ id, projectId: prefix, mapId: 'map', name: id, description: '', icon: 'city', position: { x: 20, y: 20 } }));
    const renderMap = async (id: string, key = 'map') => act(async () => {
      root.render(<MapView key={key} projectId={prefix} mapId="map" focusPinId={id} pins={pins} drafts={drafts} backgroundImage="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onUploadBackground={() => {}} onAddPin={() => {}} onEditPin={async (pinId) => { if (fail) throw new Error('save failed'); savedPins.push(pinId); }} onDeletePin={() => {}} />);
    });
    await renderMap('A');
    await act(async () => { typeInto(host.querySelector('textarea')!, 'Harbour draft'); });
    await renderMap('B');
    if (host.querySelector('textarea')?.value === 'Harbour draft') throw new Error('Map draft leaked between pins');
    await renderMap('A');
    if (host.querySelector('textarea')?.value !== 'Harbour draft') throw new Error('Map switching discarded draft');
    await act(async () => { button(t('common.save')).click(); });
    if (!host.querySelector('[role="alert"]') || !drafts.has('A')) throw new Error('Map failed save lost recovery copy');
    await act(async () => { root.render(null); });
    drafts = createLocalDraftStore(`${prefix}-maps`, acceptPin);
    await renderMap('A', 'reopen');
    if (host.querySelector('textarea')?.value !== 'Harbour draft') throw new Error('Map reopening lost persisted draft');
    fail = false;
    await act(async () => { button(t('common.save')).click(); });
    if (savedPins.join() !== 'A' || drafts.has('A')) throw new Error('Map retry did not save correct owner and retire recovery');
    passed.push('Maps: selection isolation, durable reopening, failed save and retry preserve the correct pin');

    let atlasDrafts = createLocalDraftStore(`${prefix}-atlas`, isRowDraftSnapshot);
    const row: AtlasDivergence = { id: 'divergence-A', projectId: prefix, title: 'A', category: 'history', reality: '', fiction: '', reason: '', tags: [], createdAt: 1, updatedAt: 1 };
    fail = true;
    let savedTitle = '';
    const renderAtlas = async (divergence: AtlasDivergence) => act(async () => {
      root.render(<DivergenceEditor key={divergence.id} projectId={prefix} divergence={divergence} places={[]} draftStore={atlasDrafts} onSave={async (changes) => { if (fail) throw new Error('save failed'); savedTitle = changes.title!; }} onDelete={async () => {}} />);
    });
    await renderAtlas(row);
    await act(async () => { typeInto(host.querySelector('input')!, 'Alternate history'); });
    await renderAtlas({ ...row, id: 'divergence-B', title: 'B' });
    if (host.querySelector('input')?.value !== 'B') throw new Error('Atlas draft leaked between rows');
    await act(async () => { root.render(null); });
    atlasDrafts = createLocalDraftStore(`${prefix}-atlas`, isRowDraftSnapshot);
    await renderAtlas({ ...row, updatedAt: 2, reality: 'External research' });
    if (host.querySelector('input')?.value !== 'Alternate history' || host.querySelector('textarea')?.value !== 'External research') throw new Error('Atlas reopening failed to merge saved changes with draft');
    await act(async () => { button(t('realAtlas.divergence.save')).click(); });
    if (!host.querySelector('[role="alert"]') || !atlasDrafts.has(row.id)) throw new Error('Atlas failure lost recoverable draft');
    fail = false;
    await act(async () => { button(t('realAtlas.divergence.save')).click(); });
    if (savedTitle !== 'Alternate history' || atlasDrafts.has(row.id)) throw new Error('Atlas retry did not retire recovered draft');
    passed.push('Real Atlas: durable drafts merge external updates and survive failed explicit saves');
    await act(async () => { root.render(null); });

    const journalKey = `${prefix}-failure`;
    const originalSetItem = Storage.prototype.setItem;
    const recovery = createLocalDraftStore(journalKey, acceptPin);
    try {
      Storage.prototype.setItem = function (key, value) { if (key === journalKey) throw new Error('quota'); originalSetItem.call(this, key, value); };
      recovery.set('draft', { name: 'Recover me', description: '', icon: 'city' });
      await flushPendingWrites();
      if (getPendingWritesSnapshot().failed === 0) throw new Error('Journal failure was hidden from close protection');
      if (createLocalDraftStore(journalKey, acceptPin) !== recovery) throw new Error('Reopening during storage failure lost the live recovery owner');
    } finally { Storage.prototype.setItem = originalSetItem; }
    await retryFailedWrites();
    if (!(await flushPendingWrites()).ok || !localStorage.getItem(journalKey)?.includes('Recover me')) throw new Error('Journal retry did not persist recovery');
    localStorage.setItem(`${prefix}-cold`, localStorage.getItem(journalKey)!);
    if (createLocalDraftStore(`${prefix}-cold`, acceptPin).get('draft')?.name !== 'Recover me') throw new Error('A fresh journal owner did not hydrate saved recovery');
    recovery.set('other-entity', { name: 'Keep me', description: '', icon: 'city' });
    try { await deleteWithDraftCleanup(recovery, ['draft'], async () => { throw new Error('delete failed'); }); } catch { /* Expected failure. */ }
    if (!recovery.has('draft')) throw new Error('Failed deletion purged recovery');
    await deleteWithDraftCleanup(recovery, ['draft'], async () => {});
    await flushPendingWrites();
    if (recovery.has('draft') || !recovery.has('other-entity') || localStorage.getItem(journalKey)?.includes('Recover me')) throw new Error('Committed deletion failed to purge only its recovery');
    recovery.set('child-A', { name: 'Child A', description: '', icon: 'city' });
    recovery.set('child-B', { name: 'Child B', description: '', icon: 'city' });
    await deleteWithDraftCleanup(recovery, ['child-A', 'child-B'], async () => {});
    await flushPendingWrites();
    if (recovery.has('child-A') || recovery.has('child-B') || !recovery.has('other-entity')) throw new Error('Parent deletion did not retire child drafts in isolation');
    passed.push('Recovery journal: storage failure enters close protection and global retry persists the draft');

    const projectKeys = [`wh.maps-drafts.v1.${prefix}`, `wh.real-atlas-drafts.v1.${prefix}`];
    const neighbouringKey = `wh.maps-drafts.v1.${prefix}-neighbour`;
    const projectDrafts = createLocalDraftStore(projectKeys[0], acceptPin);
    projectDrafts.set('pin', { name: 'Deleted project draft', description: '', icon: 'city' });
    localStorage.setItem(projectKeys[1], JSON.stringify([['place', { name: 'Cold atlas draft' }]]));
    localStorage.setItem(neighbouringKey, 'Keep neighbouring project');
    await db.projects.put({ id: prefix, title: 'Deletion boundary', type: 'standalone', mode: 'custom', color: '#c4973b', description: '', status: 'draft', enabledEngines: [], engineOrder: [], createdAt: 1, updatedAt: 1 });
    await flushPendingWrites();
    const rejectDelete = (key: string) => { if (key === prefix) throw new Error('transaction failed'); };
    db.projects.hook('deleting', rejectDelete);
    try { await deleteProject(prefix); } catch { /* Expected transaction rollback. */ }
    finally { db.projects.hook('deleting').unsubscribe(rejectDelete); }
    if (!projectDrafts.has('pin') || !localStorage.getItem(projectKeys[1]) || !(await db.projects.get(prefix))) throw new Error('Failed project transaction purged its recovery');
    const originalRemoveItem = Storage.prototype.removeItem;
    try {
      Storage.prototype.removeItem = function (key) { if (key === projectKeys[0]) throw new Error('storage failed'); originalRemoveItem.call(this, key); };
      await deleteProject(prefix);
      await flushPendingWrites();
      if (projectDrafts.size !== 0 || getPendingWritesSnapshot().failed === 0 || await db.projects.get(prefix)) throw new Error('Project deletion did not clear live drafts and expose storage cleanup failure');
    } finally { Storage.prototype.removeItem = originalRemoveItem; }
    await retryFailedWrites();
    await flushPendingWrites();
    if (projectKeys.some((key) => localStorage.getItem(key) !== null) || localStorage.getItem(neighbouringKey) !== 'Keep neighbouring project' || createLocalDraftStore(projectKeys[0], acceptPin).size !== 0) throw new Error('Project recovery cleanup revived drafts or affected a neighbour');
    localStorage.removeItem(neighbouringKey);
    passed.push('Project deletion: failed transactions retain recovery; committed deletion clears exact journals and retries storage failures');

    const timeline = { id: 'timeline', projectId: prefix, title: 'Lane', color: '#c4973b', createdAt: 1, updatedAt: 1 };
    for (const mode of ['list', 'lanes']) {
      let saved = 0;
      const persist = async () => { saved++; };
      await act(async () => { root.render(mode === 'list'
        ? <TimelineView projectId={prefix} timelineId={timeline.id} events={[]} onAddEvent={persist} onEditEvent={persist} onDeleteEvent={() => {}} />
        : <SwimLaneView projectId={prefix} timelines={[timeline]} events={[]} connections={[]} onAddEvent={persist} onEditEvent={persist} onDeleteEvent={() => {}} onAddConnection={() => {}} onEditConnection={() => {}} onDeleteConnection={() => {}} onEditTimeline={() => {}} />); });
      await act(async () => { if (mode === 'list') button(t('timeline.addFirstEvent')).click(); else clickText(host, '+'); });
      await act(async () => { typeInto(document.querySelector<HTMLInputElement>(`input[placeholder="${t('timeline.placeholderEventName')}"]`)!, 'Range'); button(t('timeline.calendar')).click(); });
      await act(async () => { typeInto(document.querySelectorAll<HTMLInputElement>('input[type="date"]')[0], '2026-09-09'); });
      await act(async () => { typeInto(document.querySelectorAll<HTMLInputElement>('input[type="date"]')[1], '2026-09-08'); });
      if (!button(t('timeline.create')).disabled || !document.querySelector('[role="alert"]')) throw new Error(`${mode} accepts reversed range`);
      await act(async () => { typeInto(document.querySelectorAll<HTMLInputElement>('input[type="date"]')[1], '2026-09-09'); });
      await act(async () => { button(t('timeline.create')).click(); });
      if (saved !== 1) throw new Error(`${mode} rejects valid same-day range`);
      await act(async () => { root.render(null); });
    }
    passed.push('Timeline list and lanes: reversed date ranges are blocked and same-day ranges can save');

    const events: TimelineEvent[] = ['Event A', 'Event B'].map((title, order) => ({ id: title, projectId: prefix, timelineId: timeline.id, title, description: '', date: '', dateMode: 'text', eventType: 'point', order, lane: '', color: '#c4973b', createdAt: 1, updatedAt: 1 }));
    let renameFails = true;
    let connectionFails = true;
    let renamed = '';
    const attempts: TimelineConnection[] = [];
    await act(async () => { root.render(<SwimLaneView projectId={prefix} timelines={[timeline]} events={events} connections={[]} onAddEvent={() => {}} onEditEvent={() => {}} onDeleteEvent={() => {}} onAddConnection={async (connection) => { attempts.push(connection); if (connectionFails) throw new Error('connection failed'); }} onEditConnection={() => {}} onDeleteConnection={() => {}} onEditTimeline={async (_id, changes) => { if (renameFails) throw new Error('rename failed'); renamed = changes.title!; }} />); });
    await act(async () => { clickText(host, 'Lane'); });
    await act(async () => { typeInto(document.querySelector<HTMLInputElement>('[role="dialog"] input')!, 'Parallel history'); });
    await act(async () => { button(t('common.save')).click(); });
    if (!document.querySelector('[role="alert"]') || document.querySelector<HTMLInputElement>('[role="dialog"] input')?.value !== 'Parallel history') throw new Error('Lane rename failure lost draft');
    renameFails = false;
    await act(async () => { button(t('common.save')).click(); });
    if (renamed !== 'Parallel history') throw new Error('Lane rename retry failed');
    await act(async () => { clickText(host, 'Event A'); });
    await act(async () => { clickText(host, '⤳'); });
    await act(async () => { clickText(host, 'Event B'); });
    if (!host.querySelector('[role="alert"]')) throw new Error('Failed connection was silent');
    connectionFails = false;
    await act(async () => { button(t('projectCockpit.retry')).click(); });
    if (attempts.length !== 2 || attempts[0].id !== attempts[1].id || attempts[1].sourceEventId !== 'Event A' || attempts[1].targetEventId !== 'Event B') throw new Error('Connection retry lost intent or duplicated identity');
    passed.push('Timeline lanes: rename and connection failures retain intent and retry the original write');
    return passed;
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    for (const suffix of ['maps', 'atlas', 'failure', 'cold']) localStorage.removeItem(`${prefix}-${suffix}`);
    await db.projects.delete(prefix);
    for (const key of [`wh.maps-drafts.v1.${prefix}`, `wh.real-atlas-drafts.v1.${prefix}`, `wh.maps-drafts.v1.${prefix}-neighbour`]) localStorage.removeItem(key);
  }
}
