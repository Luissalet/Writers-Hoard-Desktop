// Pausing a writing sprint: the clock stands still, a paused sprint never runs
// out (even across a restart), resuming pushes its end on; the toolbar's
// pause/resume button and the bridge's sprint log.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import SprintControl from '@/engines/writings/components/SprintControl';
import { beginSprint, pauseSprint, readActiveSprint, reconcileSprint, resumeSprint, sprintRemaining } from '@/engines/writing-stats/sprints';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import type { Project } from '@/types';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));

export async function testSprintPause(): Promise<string[]> {
  useLocaleStore.setState({ locale: 'es' });
  const passed: string[] = [];
  assert(sprintRemaining({ endsAt: 10_000, pausedAt: 4_000 }, 9_000) === 6_000 && sprintRemaining({ endsAt: 10_000 }, 9_000) === 1_000, 'Remaining');
  const P = 'synthetic-sprint-pause';
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  try {
    await db.projects.put({ id: P, title: 'Pausa', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['writings'], createdAt: 1, updatedAt: 1 } as Project);
    const sprint = await beginSprint({ projectId: P, durationMinutes: 1, targetWords: 0, baselineWords: 0 });
    const paused = await pauseSprint(P);
    assert(paused?.pausedAt !== undefined && (await readActiveSprint(P))?.pausedAt === paused.pausedAt, 'Paused and stored');
    // A paused sprint is not over even when its end has gone by.
    const stored = (await readActiveSprint(P))!;
    const left = sprintRemaining(stored, stored.endsAt + 3_600_000);
    assert(left > 50_000 && left <= 60_000, `Stands still: ${left}`);
    const reconciled = await reconcileSprint(P, 0);
    assert(reconciled.active && !reconciled.finished, 'Not filed while paused');
    await pause(1200);
    const resumed = await resumeSprint(P);
    assert(resumed && resumed.pausedAt === undefined && resumed.endsAt >= sprint.endsAt + 1000, `End pushed on: ${resumed?.endsAt} vs ${sprint.endsAt}`);
    passed.push('Model: pausing keeps the time left (a paused sprint stays unfiled even an hour after its end, as after a restart); resuming 1.2 s later ends it at least 1.2 s later');

    await act(async () => { root = createRoot(host); root.render(createElement(SprintControl, { projectId: P, getProjectWords: () => 0 })); await pause(300); });
    const button = () => document.querySelector('[data-testid="sprint-pause"]') as HTMLButtonElement | null;
    for (let i = 0; i < 30 && !button(); i++) await act(async () => { await pause(100); });
    assert(button()?.getAttribute('aria-label') === 'Pausar el sprint', 'Pause button');
    await act(async () => { button()!.click(); await pause(300); });
    assert(button()?.getAttribute('aria-pressed') === 'true' && button()?.getAttribute('aria-label') === 'Reanudar el sprint' && (await readActiveSprint(P))?.pausedAt !== undefined, 'Paused from the toolbar');
    const shown = document.querySelector('.font-mono')?.textContent;
    await act(async () => { await pause(1500); });
    assert(document.querySelector('.font-mono')?.textContent === shown, `Clock stands still: ${shown} → ${document.querySelector('.font-mono')?.textContent}`);
    const log = await runBridgeTool('wh_sprint_log', { projectId: P });
    assert((log.result as { running: { paused: boolean } }).running.paused === true, 'Bridge sees it paused');
    await act(async () => { button()!.click(); await pause(300); });
    assert(button()?.getAttribute('aria-pressed') === 'false' && (await readActiveSprint(P))?.pausedAt === undefined, 'Resumed from the toolbar');
    passed.push(`Toolbar: "Pausar el sprint" stops the clock at ${shown} (it does not move for 1.5 s) and "Reanudar el sprint" starts it again; wh_sprint_log reports the running sprint as paused`);
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
    try { await reconcileSprint(P, 0); } catch { /* nothing running */ }
    await db.projects.delete(P);
  }
  return passed;
}
