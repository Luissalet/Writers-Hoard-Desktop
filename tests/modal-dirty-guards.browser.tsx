// Engine editors pass `dismissible={!dirty}` to Modal, so a stray Escape or
// backdrop click cannot throw away unsaved input; Story State deletes wait for
// a ConfirmDialog instead of hard-deleting on one click.
//
//   xvfb-run -a npx electron scripts/run-focused-browser-tests.cjs \
//     tests/modal-dirty-guards.browser.tsx testModalDirtyGuards 120000 --no-sandbox

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import '@/engines';
import { db } from '@/db';
import { t } from '@/i18n/useTranslation';
import BeatEditor from '@/engines/outline/components/BeatEditor';
import SegmentEditor from '@/engines/video-planner/components/SegmentEditor';
import PanelEditor from '@/engines/storyboard/components/PanelEditor';
import TimelineView from '@/engines/timeline/components/TimelineView';
import StoryStateLab from '@/components/project/creative-lab/StoryStateLab';
import type { OutlineBeat } from '@/engines/outline/types';
import type { VideoSegment } from '@/engines/video-planner/types';
import type { StoryboardPanel } from '@/engines/storyboard/types';
import type { Outline } from '@/engines/outline/types';
import type { CodexEntry } from '@/types';
import { createNarrativeMoment, createStoryClaim, type StoryFactClaim } from '@/services/storyState';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const wait = (ms = 80) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const escape = (target: EventTarget) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
async function waitFor<T>(find: () => T | null | undefined, message: string): Promise<T> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const found = find();
    if (found) return found;
    await act(async () => { await wait(50); });
  }
  throw new Error(message);
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
/** Sets a controlled field's value the way typing does, so React's onChange fires. */
function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')!.set!.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Shared script for an editor that calls `onClose` itself: Escape with no
 * edits closes, Escape and a backdrop click after an edit do not, the header
 * X still does, and reverting the edit makes Escape close again.
 */
async function checkEditor(
  root: Root,
  render: (onClose: () => void) => ReactElement,
  field: () => HTMLInputElement | HTMLTextAreaElement,
  label: string,
): Promise<void> {
  let closes = 0;
  const onClose = () => { closes += 1; };
  await act(async () => { root.render(render(onClose)); await wait(); });
  assert(dialog(), `${label}: editor did not open`);
  await act(async () => { escape(field()); await wait(); });
  assert(closes === 1, `${label}: Escape with no edits did not close`);

  await act(async () => { root.render(<></>); await wait(); });
  await act(async () => { root.render(render(onClose)); await wait(); });
  const original = field().value;
  await act(async () => { typeInto(field(), `${original} edited`); await wait(); });
  await act(async () => { escape(field()); await wait(); });
  await act(async () => { dialog()!.parentElement!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await wait(); });
  assert(closes === 1, `${label}: Escape/backdrop discarded unsaved input`);
  await act(async () => { typeInto(field(), original); await wait(); });
  await act(async () => { escape(field()); await wait(); });
  assert(closes === 2, `${label}: reverting the edit did not make Escape close again`);

  await act(async () => { root.render(<></>); await wait(); });
  await act(async () => { root.render(render(onClose)); await wait(); });
  await act(async () => { typeInto(field(), 'dirty'); await wait(); });
  await act(async () => { dialog()!.querySelector<HTMLButtonElement>(`button[aria-label="${t('common.close')}"]`)!.click(); await wait(); });
  assert(closes === 3, `${label}: header X did not close a dirty editor`);
  await act(async () => { root.render(<></>); await wait(); });
}

export async function testModalDirtyGuards(): Promise<string[]> {
  const passed: string[] = [];
  const host = document.getElementById('root')!;
  const now = Date.now();

  {
    const beat: OutlineBeat = {
      id: 'guard-beat', outlineId: 'guard-outline', projectId: 'guard-project', order: 0, level: 'beat',
      title: 'Crossing', description: 'She crosses.', status: 'outlined', createdAt: now, updatedAt: now,
    };
    const root = createRoot(host);
    await checkEditor(
      root,
      (onClose) => <BeatEditor beat={beat} onSave={() => {}} onClose={onClose} />,
      () => dialog()!.querySelector<HTMLInputElement>('input[type="text"]')!,
      'BeatEditor',
    );
    root.unmount();
    passed.push('Outline BeatEditor: Escape/backdrop ignored only while dirty');
  }

  {
    const segment: VideoSegment = {
      id: 'guard-segment', videoPlanId: 'guard-plan', projectId: 'guard-project', order: 0,
      title: 'Intro', script: 'Hello.', visualType: 'camera', tags: ['a', 'b'], createdAt: now, updatedAt: now,
    };
    const root = createRoot(host);
    await checkEditor(
      root,
      (onClose) => <SegmentEditor segment={segment} onSave={() => {}} onCancel={onClose} />,
      () => dialog()!.querySelector<HTMLTextAreaElement>('textarea')!,
      'SegmentEditor',
    );
    root.unmount();
    passed.push('Video Planner SegmentEditor: Escape/backdrop ignored only while dirty');
  }

  {
    const panel: StoryboardPanel = {
      id: 'guard-panel', storyboardId: 'guard-board', projectId: 'guard-project', order: 0,
      subtitle: 'Wide shot', tags: ['day'], createdAt: now, updatedAt: now,
    };
    const root = createRoot(host);
    await checkEditor(
      root,
      (onClose) => <PanelEditor panel={panel} isOpen onClose={onClose} onSave={() => {}} />,
      () => dialog()!.querySelector<HTMLInputElement>(`input[placeholder="${t('storyboard.form.subtitlePlaceholder')}"]`)!,
      'PanelEditor',
    );
    root.unmount();
    passed.push('Storyboard PanelEditor: Escape/backdrop ignored only while dirty');
  }

  // A create form (Timeline): blank means clean, any typed input means dirty.
  {
    const root = createRoot(host);
    await act(async () => {
      root.render(<TimelineView projectId="guard-project" timelineId="guard-tl" events={[]} onAddEvent={() => {}} onEditEvent={() => {}} onDeleteEvent={() => {}} />);
      await wait();
    });
    const openForm = async () => {
      const add = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(t('timeline.addFirstEvent')));
      assert(add, 'timeline add button missing');
      await act(async () => { add.click(); await wait(); });
      assert(dialog(), 'timeline event form did not open');
    };
    const title = () => dialog()!.querySelector<HTMLInputElement>(`input[placeholder="${t('timeline.placeholderEventName')}"]`)!;
    await openForm();
    await act(async () => { escape(title()); await wait(); });
    assert(!dialog(), 'Timeline: Escape on a blank create form did not close');
    await openForm();
    await act(async () => { typeInto(title(), 'The fall of the bridge'); await wait(); });
    await act(async () => { escape(title()); await wait(); });
    assert(dialog() && title().value === 'The fall of the bridge', 'Timeline: Escape discarded a typed event');
    await act(async () => { typeInto(title(), ''); await wait(); });
    await act(async () => { escape(title()); await wait(); });
    assert(!dialog(), 'Timeline: clearing the input did not make Escape close again');
    root.unmount();
    passed.push('Timeline create form: Escape ignored once anything is typed');
  }

  // Story State: deleting a claim or a moment needs an explicit confirm.
  {
    const PROJECT_ID = 'guard-story-state';
    if (!db.isOpen()) await db.open();
    const outline: Outline = { id: 'guard-ss-outline', projectId: PROJECT_ID, title: 'Axis', createdAt: now, updatedAt: now };
    const beats: OutlineBeat[] = [0, 1].map((order) => ({
      id: `guard-ss-beat-${order}`, outlineId: outline.id, projectId: PROJECT_ID, order, level: 'beat',
      title: order ? 'After' : 'Before', description: '', status: 'outlined', createdAt: now, updatedAt: now,
    }));
    const character: CodexEntry = {
      id: 'guard-ss-character', projectId: PROJECT_ID, type: 'character', title: 'Mara',
      fields: {}, content: '', tags: [], relations: [], createdAt: now, updatedAt: now,
    };
    await db.outlines.put(outline);
    await db.outlineBeats.bulkPut(beats);
    await db.codexEntries.put(character);
    const first = await createNarrativeMoment({ projectId: PROJECT_ID, anchorKind: 'beat', anchorEntityId: beats[0].id });
    const second = await createNarrativeMoment({ projectId: PROJECT_ID, anchorKind: 'beat', anchorEntityId: beats[1].id });
    const claim = await createStoryClaim<StoryFactClaim>({
      projectId: PROJECT_ID, kind: 'fact', status: 'canonical', factType: 'location', value: 'The harbour',
      subject: { engineId: 'codex', entityType: 'character', entityId: character.id, title: character.title },
      fromMomentId: first.id,
    });

    const root = createRoot(host);
    await act(async () => { root.render(<StoryStateLab projectId={PROJECT_ID} />); await wait(300); });
    const confirmButton = (label: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label);

    const deleteClaim = await waitFor(
      () => document.querySelector<HTMLButtonElement>(`button[aria-label^="${t('creativeLab.story.deleteClaim')}: Mara"]`),
      `claim delete button missing: ${host.textContent?.slice(0, 400)}`,
    );
    await act(async () => { deleteClaim.click(); await wait(); });
    assert(dialog()?.textContent?.includes('The harbour'), 'claim delete did not ask for confirmation');
    assert(await db.storyClaims.get(claim.id), 'claim was deleted before confirming');
    await act(async () => { confirmButton(t('common.cancel'))!.click(); await wait(); });
    assert(!dialog() && await db.storyClaims.get(claim.id), 'cancel did not keep the claim');
    await act(async () => { deleteClaim.click(); await wait(); });
    await act(async () => { confirmButton(t('common.delete'))!.click(); await wait(200); });
    assert(!(await db.storyClaims.get(claim.id)), 'confirming did not delete the claim');
    assert(!dialog(), 'confirm dialog stayed open after deleting the claim');

    const axisTab = [...document.querySelectorAll<HTMLButtonElement>('nav button')].find((b) => b.textContent?.includes(t('creativeLab.story.view.axis')));
    await act(async () => { axisTab!.click(); await wait(); });
    const deleteMoment = document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${t('creativeLab.story.deleteMoment')}"]`)[1];
    assert(deleteMoment, 'moment delete button missing');
    await act(async () => { deleteMoment.click(); await wait(); });
    assert(dialog()?.textContent?.includes(second.label), 'moment delete did not ask for confirmation');
    assert(await db.narrativeMoments.get(second.id), 'moment was deleted before confirming');
    await act(async () => { escape(dialog()!); await wait(); });
    assert(!dialog() && await db.narrativeMoments.get(second.id), 'Escape did not cancel the moment delete');
    await act(async () => { deleteMoment.click(); await wait(); });
    await act(async () => { confirmButton(t('common.delete'))!.click(); await wait(200); });
    assert(!(await db.narrativeMoments.get(second.id)), 'confirming did not delete the moment');

    root.unmount();
    await db.storyClaims.where('projectId').equals(PROJECT_ID).delete();
    await db.narrativeMoments.where('projectId').equals(PROJECT_ID).delete();
    await db.outlineBeats.where('projectId').equals(PROJECT_ID).delete();
    await db.outlines.where('projectId').equals(PROJECT_ID).delete();
    await db.codexEntries.where('projectId').equals(PROJECT_ID).delete();
    passed.push('StoryStateLab: claim and moment deletes wait for ConfirmDialog');
  }

  return passed;
}
