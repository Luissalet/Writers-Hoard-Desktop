import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import TimelineEngine from '@/engines/timeline/TimelineEngine';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { useLocaleStore } from '@/stores/localeStore';
import { useAppStore } from '@/stores/appStore';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
async function settle() { await act(async () => { await pause(); }); }
async function click(node: HTMLElement | null) {
  assert(node, 'Missing action');
  await act(async () => { node.focus(); node.click(); await pause(); });
  await settle();
}
async function key(key: string, shiftKey = false) {
  await act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
    await pause();
  });
  await settle();
}

/** Independent focus/keyboard regression at the real Engine -> existing Modal boundary. */
export async function reviewCalendarEditorFocus(): Promise<string[]> {
  const projectId = 'qa-calendar-peer-focus';
  const root = createRoot(document.getElementById('root')!);
  const locale = useLocaleStore.getState().locale;
  const motion = useAppStore.getState().motion;
  useLocaleStore.setState({ locale: 'en' });
  useAppStore.setState({ motion: 'reduce' });
  try {
    await db.projects.put({ id: projectId, title: 'Calendar keyboard QA', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['timeline'], createdAt: 1, updatedAt: 1 });
    await db.timelines.bulkPut([
      { id: 'qa-peer-other-timeline', projectId, title: 'Other owner', color: '#888888', createdAt: 1, updatedAt: 1 },
      { id: 'qa-peer-target-timeline', projectId, title: 'Target owner', color: '#c4973b', createdAt: 2, updatedAt: 2 },
    ]);
    const created = await runBridgeTool('wh_create_event', { projectId, timelineId: 'qa-peer-target-timeline', title: 'Peer keyboard event', dateMode: 'calendar', realDate: '1500-01-10', realDateEnd: '1500-01-12', eventType: 'range', repeat: { every: 'week' } });
    assert(created.ok, JSON.stringify(created));
    const saved = (await db.timelineEvents.where('projectId').equals(projectId).toArray())[0];
    const before = JSON.stringify(saved);
    await act(async () => {
      root.render(<MemoryRouter initialEntries={[`/project/${projectId}/timeline?view=calendar`]}><EnginePaneContext.Provider value={{ instanceId: 'peer-calendar', projectId, visible: true }}><TimelineEngine projectId={projectId} /></EnginePaneContext.Provider></MemoryRouter>);
      await pause();
    });
    for (let i = 0; i < 35 && !document.querySelector('[data-testid="calendar-next"]'); i++) await settle();
    await click(document.querySelector('[data-testid="calendar-next"]'));
    await click(document.querySelector('[data-testid="calendar-day-8"]'));
    const calendar = document.querySelector('[data-testid="timeline-calendar"]');
    const trigger = document.querySelector<HTMLButtonElement>(`[data-testid="calendar-open-event-${saved.id}"]`);
    assert(trigger, 'Owner event missing from selected recurring day');
    await click(trigger);
    for (let i = 0; i < 35 && !document.querySelector('input[aria-label="End date"]'); i++) await settle();
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    assert(dialogs.length === 1, `Expected one existing editor, got ${dialogs.length}`);
    const dialog = dialogs[0];
    assert(dialog.contains(document.activeElement), 'Open editor did not receive focus');
    assert(document.getElementById('root')?.inert, 'Background is not inert');
    const start = dialog.querySelector<HTMLInputElement>('input[aria-label="Start date"]');
    const end = dialog.querySelector<HTMLInputElement>('input[aria-label="End date"]');
    assert(start?.type === 'date' && end?.type === 'date' && start.value === '1500-01-10' && end.value === '1500-01-12' && end.min === start.value, 'Labelled date inputs do not preserve the saved range/constraint');
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')];
    const first = focusable[0], last = focusable.at(-1)!;
    last.focus(); await key('Tab');
    assert(document.activeElement === first, 'Tab escaped last-to-first dialog boundary');
    first.focus(); await key('Tab', true);
    assert(document.activeElement === last, 'Shift+Tab escaped first-to-last dialog boundary');
    await key('Escape');
    assert(!document.querySelector('[role="dialog"]') && !document.getElementById('root')?.inert, 'Clean Escape left a modal/inert background');
    assert(document.querySelector('[data-testid="timeline-calendar"]') === calendar && !calendar?.parentElement?.hidden && document.querySelector('[data-testid="calendar-title"]')?.textContent?.includes('February'), 'Keyboard close lost mounted Calendar or month');
    assert(JSON.stringify(await db.timelineEvents.get(saved.id)) === before, 'Keyboard open/close mutated the saved event');
    assert(document.activeElement === trigger, `Calendar event trigger did not regain keyboard focus; active=${document.activeElement?.outerHTML.slice(0, 180)}`);
    return ['Actual Calendar owner event opens one labelled modal, traps focus, Escape preserves month/day and source, and returns focus to its event button'];
  } finally {
    await act(async () => { root.unmount(); await pause(); });
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
    useLocaleStore.setState({ locale });
    useAppStore.setState({ motion });
  }
}
