import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import type { Project } from '@/types';
import { deleteProject } from '@/db/operations';
import { createSheet } from '@/engines/character-sheets/types';
import { saveSheet } from '@/engines/character-sheets/operations';
import { cocSummary } from '@/engines/character-sheets/cocSummary';
import CompactSheetView from '@/components/editor/toolBlocks/CompactSheetView';
import { registerPendingFlusher, flushPendingWrites } from '@/services/pendingWrites';

const P = 'review-compact-action-lifetime';
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
export async function reviewCompactActionLifetime(): Promise<string[]> {
  const root = createRoot(document.getElementById('root')!);
  let stop: (() => void) | undefined, release: (() => void) | undefined;
  try {
    await db.projects.put({ id: P, title: 'Review fixture', description: '', mode: 'custom', type: 'standalone', status: 'draft', color: '#888888', enabledEngines: ['character-sheets'], createdAt: 1, updatedAt: 1 } as Project);
    const sheet = await saveSheet(P, createSheet('coc7', 'Lifetime fixture'), null);
    const summary = cocSummary(sheet)!;
    const read = async () => (await db.projects.get(P))!.characterSheets![0];
    const gate = () => { let entered = false; const wait = new Promise<void>(resolve => { release = resolve; }); stop = registerPendingFlusher('review-compact-gate', async () => { entered = true; await wait; return true; }); return () => entered; };
    const render = async (canWrite: () => boolean) => { await act(async () => { root.render(<CompactSheetView key={Math.random()} summary={summary} projectId={P} locale="en" canWrite={canWrite} />); await pause(); }); };
    const click = async () => { await act(async () => { const button = document.querySelector<HTMLButtonElement>('[data-coc-summary] button'); assert(button, 'roll control missing'); button.click(); button.click(); await pause(); }); };
    let writable = true;
    let entered = gate();
    await render(() => writable); await click(); assert(entered(), 'initial pending flush not reached');
    writable = false;
    await act(async () => { release!(); await pause(); }); stop!(); stop = undefined;
    assert((await read()).revision === sheet.revision && (await read()).rolls.length === 0, 'readonly transition during flush wrote a roll');
    writable = true; entered = gate();
    await render(() => writable); await click(); assert(entered(), 'unmount flush not reached');
    await act(async () => { root.render(<div />); await pause(); });
    await act(async () => { release!(); await pause(); }); stop!(); stop = undefined;
    assert((await read()).revision === sheet.revision && (await read()).rolls.length === 0, 'unmounted compact wrote after flush');
    await render(() => true); await click();
    await act(async () => { assert((await flushPendingWrites()).ok, 'native action remained pending'); await pause(); });
    assert((await read()).rolls.length === 1 && (await read()).revision === sheet.revision + 1, 'same-tick double click must persist exactly one native action');
    return ['Readonly transition during initial flush prevents native roll', 'Unmount during initial flush prevents native roll', 'Same-tick double click dispatches exactly one real native roll and drains pending writes'];
  } finally {
    release?.(); stop?.(); await act(async () => { root.unmount(); await pause(); }); if (await db.projects.get(P)) await deleteProject(P);
  }
}
