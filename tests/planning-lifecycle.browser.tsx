import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { OutlineTitle } from '@/engines/outline/components/OutlineEngine';
import type { Outline } from '@/engines/outline/types';
import { flushPendingWrites } from '@/services/pendingWrites';
import { t } from '@/i18n/useTranslation';
import TimelineView from '@/engines/timeline/components/TimelineView';
import SwimLaneView from '@/engines/timeline/components/SwimLaneView';
import SegmentCard from '@/engines/video-planner/components/SegmentCard';
import MapView from '@/components/maps/MapView';
import PanelEditor from '@/engines/storyboard/components/PanelEditor';

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function typeInto(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = control instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

export async function testPlanningSaveRecovery(): Promise<string[]> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const timeline = { id: 'recovery-timeline', projectId: 'recovery-project', title: 'Timeline', color: '#c4973b', createdAt: 1, updatedAt: 1 };
  const passed: string[] = [];
  try {
    for (const mode of ['list', 'lanes']) {
      let fail = true;
      let saved = 0;
      const persist = async () => { if (fail) throw new Error('storage failed'); saved++; };
      await act(async () => {
        root.render(mode === 'list'
          ? <TimelineView projectId={timeline.projectId} timelineId={timeline.id} events={[]} onAddEvent={persist} onEditEvent={persist} onDeleteEvent={() => {}} />
          : <SwimLaneView projectId={timeline.projectId} timelines={[timeline]} events={[]} connections={[]} onAddEvent={persist} onEditEvent={persist} onDeleteEvent={() => {}} onAddConnection={() => {}} onEditConnection={() => {}} onDeleteConnection={() => {}} onEditTimeline={() => {}} />);
      });
      await act(async () => {
        if (mode === 'list') button(t('timeline.addFirstEvent')).click();
        else {
          const plus = [...host.querySelectorAll('svg text')].find((element) => element.textContent === '+')!;
          plus.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      });
      await act(async () => {
        typeInto(document.querySelector<HTMLInputElement>(`input[placeholder="${t('timeline.placeholderEventName')}"]`)!, 'Keep this event');
      });
      await act(async () => { button(t('timeline.create')).click(); });
      if (!document.querySelector('[role="alert"]') || !document.querySelector<HTMLInputElement>(`input[placeholder="${t('timeline.placeholderEventName')}"]`)?.value.includes('Keep')) {
        throw new Error(`Timeline ${mode} lost the form after failed save`);
      }
      fail = false;
      await act(async () => { button(t('timeline.create')).click(); });
      if (saved !== 1) throw new Error(`Timeline ${mode} retry failed`);
      passed.push(`Timeline ${mode}: a failed save preserves the event draft and can be retried`);
      await act(async () => { root.render(null); });
    }

    let fail = true;
    let deleted = 0;
    const segment = { id: 'segment-recovery', projectId: timeline.projectId, videoPlanId: 'plan', order: 0, title: 'Segment draft', script: '', visualType: 'camera' as const, tags: [], createdAt: 1, updatedAt: 1 };
    await act(async () => { root.render(<SegmentCard segment={segment} index={0} onUpdate={async () => { if (fail) throw new Error('disk failed'); }} onDelete={() => { deleted++; }} />); });
    const card = host.querySelector('[draggable]')!;
    await act(async () => { card.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await act(async () => { typeInto(document.querySelector<HTMLTextAreaElement>('textarea')!, 'My script survives'); });
    await act(async () => { button(t('videoPlanner.segment.saveChanges')).click(); });
    if (document.querySelector<HTMLTextAreaElement>('textarea')?.value !== 'My script survives' || !document.querySelector('[role="alert"]')) throw new Error('Segment save failure lost the script');
    fail = false;
    await act(async () => { button(t('videoPlanner.segment.saveChanges')).click(); });
    await act(async () => { card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    await act(async () => { host.querySelector<HTMLButtonElement>(`button[title="${t('common.delete')}"]`)!.click(); });
    if (deleted !== 0) throw new Error('Segment deleted without confirmation');
    await act(async () => { button(t('common.cancel')).click(); });
    if (deleted !== 0) throw new Error('Cancelling deleted the segment');
    passed.push('Video planner: failed save retains the script and deletion requires confirmation');
    await act(async () => { root.render(null); });

    fail = true;
    let pinsSaved = 0;
    await act(async () => {
      root.render(<MapView projectId={timeline.projectId} mapId="recovery-map" pins={[]} backgroundImage="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onUploadBackground={() => {}} onAddPin={async () => { if (fail) throw new Error('pin failed'); pinsSaved++; }} onEditPin={() => {}} onDeletePin={() => {}} />);
    });
    await act(async () => { button(t('maps.addPin')).click(); });
    await act(async () => { host.querySelector('.relative.inline-block')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 20, clientY: 20 })); });
    await act(async () => { typeInto(document.querySelector<HTMLInputElement>(`input[placeholder="${t('maps.locationName')}"]`)!, 'Unfinished harbour'); });
    await act(async () => { button(t('maps.placePin')).click(); });
    if (!document.querySelector('[role="alert"]') || document.querySelector<HTMLInputElement>(`input[placeholder="${t('maps.locationName')}"]`)?.value !== 'Unfinished harbour') throw new Error('A failed pin creation lost the location draft');
    fail = false;
    await act(async () => { button(t('maps.placePin')).click(); });
    if (pinsSaved !== 1) throw new Error('Pin retry did not save');
    passed.push('Maps: creating a pin retains the location draft on failure and retries successfully');
    await act(async () => { root.render(null); });

    fail = true;
    let editorClosed = false;
    const panel = { id: 'recovery-panel', storyboardId: 'recovery-storyboard', projectId: timeline.projectId, order: 0, subtitle: 'First frame', tags: [], createdAt: 1, updatedAt: 1 };
    await act(async () => { root.render(<PanelEditor panel={panel} isOpen onClose={() => { editorClosed = true; }} onSave={async () => { if (fail) throw new Error('panel failed'); }} />); });
    await act(async () => { typeInto(document.querySelector<HTMLTextAreaElement>('textarea')!, 'A crucial visual idea'); });
    await act(async () => { button(t('storyboard.form.savePanel')).click(); });
    if (editorClosed || document.querySelector<HTMLTextAreaElement>('textarea')?.value !== 'A crucial visual idea' || !document.querySelector('[role="alert"]')) throw new Error('Storyboard closed or lost the draft after failed save');
    fail = false;
    await act(async () => { button(t('storyboard.form.savePanel')).click(); });
    if (!editorClosed) throw new Error('Storyboard did not close after confirmed successful save');
    passed.push('Storyboard: failed save preserves panel content and closes only after successful persistence');
    return passed;
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
}

export async function testPlanningTitleOwnership(): Promise<string> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const first: Outline = { id: 'first-outline', projectId: 'planning-test', title: 'First', createdAt: 1, updatedAt: 1 };
  const second: Outline = { ...first, id: 'second-outline', title: 'Second' };
  const saves: { id: string; title: string | undefined }[] = [];
  const save = async (id: string, changes: Partial<Outline>) => { saves.push({ id, title: changes.title }); };
  try {
    await act(async () => { root.render(<OutlineTitle key={first.id} outline={first} onSave={save} />); });
    const input = host.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'First, revised');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Switch before the debounce, without relying on pointer blur ordering.
    await act(async () => { root.render(<OutlineTitle key={second.id} outline={second} onSave={save} />); });
    await act(async () => { await flushPendingWrites(); });
    if (saves.length !== 1 || saves[0].id !== first.id || saves[0].title !== 'First, revised') {
      throw new Error(`Changing outlines saved the buffered title to the wrong owner: ${JSON.stringify(saves)}`);
    }
    if (host.querySelector('input')!.value !== 'Second') throw new Error('The next outline must show its own title');
    return 'Outline: switching before autosave flushes the title to its original outline';
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
  }
}
