// Engine leftovers: POV audit counts scenes a character speaks in, the timeline
// stats refresh after deleting a timeline, and dialog blocks ask before deleting.
//
//   xvfb-run -a npx electron scripts/run-focused-browser-tests.cjs \
//     tests/engine-leftovers.browser.tsx testEngineLeftovers 120000 --no-sandbox
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import { computeUsage } from '@/engines/pov-audit/operations';
import TimelineEngine from '@/engines/timeline/TimelineEngine';
import SceneEditor from '@/engines/dialog-scene/components/SceneEditor';
import { useLocaleStore } from '@/stores/localeStore';
import type { DialogBlock, Scene, SceneCast } from '@/engines/dialog-scene/types';
import type { Timeline, TimelineConnection, TimelineEvent } from '@/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const pause = (ms = 25) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
async function waitFor(condition: () => boolean, message: string | (() => string)): Promise<void> {
  const deadline = Date.now() + 8000;
  while (!condition() && Date.now() < deadline) await act(async () => { await pause(); });
  assert(condition(), typeof message === 'function' ? message() : message);
}

async function withEnglish<T>(run: () => Promise<T>): Promise<T> {
  if (!db.isOpen()) await db.open();
  const prior = useLocaleStore.getState().locale;
  useLocaleStore.setState({ locale: 'en' });
  try {
    return await run();
  } finally {
    useLocaleStore.setState({ locale: prior });
  }
}

async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<MemoryRouter>{node}</MemoryRouter>); });
  return {
    host,
    async unmount() {
      await act(async () => { root.unmount(); });
      host.remove();
    },
  };
}

const now = Date.now();
function scene(projectId: string, id: string, order: number): Scene {
  return { id: `${projectId}-${id}`, projectId, title: id, order, tags: [], createdAt: now, updatedAt: now };
}
function block(sceneRow: Scene, id: string, order: number, fields: Partial<DialogBlock>): DialogBlock {
  return {
    id: `${sceneRow.id}-${id}`,
    sceneId: sceneRow.id,
    projectId: sceneRow.projectId,
    type: 'dialog',
    characterName: '',
    characterColor: '#888888',
    content: 'Words here.',
    order,
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}

/** A character who speaks in a scene without being in its cast is still in that scene. */
export async function testPovAuditSpeakerScenes(): Promise<string[]> {
  return withEnglish(async () => {
    const P = `pov-leftovers-${Date.now()}`;
    const s1 = scene(P, 's1', 0);
    const s2 = scene(P, 's2', 1);
    const s3 = scene(P, 's3', 2);
    const cast: SceneCast[] = [
      { id: `${P}-c1`, sceneId: s1.id, characterId: `${P}-ana`, characterName: 'Ana', color: '#f00' },
      { id: `${P}-c2`, sceneId: s3.id, characterId: `${P}-ana`, characterName: 'Ana', color: '#f00' },
    ];
    const blocks: DialogBlock[] = [
      // Ana: in the cast of s1 and speaks there too → still ONE scene for s1.
      block(s1, 'b1', 0, { characterId: `${P}-ana`, characterName: 'Ana' }),
      block(s1, 'b1b', 1, { characterId: `${P}-ana`, characterName: 'Ana' }),
      // Bob: never in any cast, speaks in s1 and twice in s2.
      block(s1, 'b2', 2, { characterId: `${P}-bob`, characterName: 'Bob' }),
      block(s2, 'b3', 0, { characterId: `${P}-bob`, characterName: 'Bob' }),
      block(s2, 'b4', 1, { characterId: `${P}-bob`, characterName: 'Bob' }),
      // An uncast, unmapped speaker in s2, and an action line that names Cleo.
      block(s2, 'b5', 2, { characterName: 'EXTRA (V.O.)' }),
      block(s3, 'b6', 0, { type: 'action', characterId: `${P}-cleo`, characterName: 'Cleo' }),
    ];
    const codex = ['ana', 'bob', 'cleo'].map((name) => ({
      id: `${P}-${name}`, projectId: P, type: 'character', title: name[0].toUpperCase() + name.slice(1),
      content: '', tags: [], createdAt: now, updatedAt: now,
    }));
    await db.scenes.bulkAdd([s1, s2, s3]);
    await db.sceneCasts.bulkAdd(cast);
    await db.dialogBlocks.bulkAdd(blocks);
    await db.table('codexEntries').bulkAdd(codex);
    try {
      const report = await computeUsage(P);
      const row = (id: string) => report.rows.find((r) => r.characterId === id);
      const ana = row(`${P}-ana`);
      const bob = row(`${P}-bob`);
      const cleo = row(`${P}-cleo`);
      const extra = report.rows.find((r) => r.isUnmapped);
      assert(ana?.sceneCount === 2 && ana.lineCount === 2, `Ana: ${JSON.stringify(ana)}`);
      assert(bob?.sceneCount === 2 && bob.lineCount === 3 && !bob.isUnused, `Bob (speaks, not cast): ${JSON.stringify(bob)}`);
      assert(cleo?.sceneCount === 0 && cleo.isUnused, `an action line made Cleo a speaker: ${JSON.stringify(cleo)}`);
      assert(extra?.sceneCount === 1 && extra.lineCount === 1, `unmapped speaker: ${JSON.stringify(extra)}`);
      assert(report.totals.sceneCount === 3 && report.totals.blockCount === blocks.length, 'totals changed');
    } finally {
      await db.scenes.bulkDelete([s1.id, s2.id, s3.id]);
      await db.sceneCasts.bulkDelete(cast.map((c) => c.id));
      await db.dialogBlocks.bulkDelete(blocks.map((b) => b.id));
      await db.table('codexEntries').bulkDelete(codex.map((c) => c.id));
    }
    return ['POV audit counts distinct scenes from cast rows AND dialog lines (a speaker outside the cast is no longer 0)'];
  });
}

/** Deleting a timeline refreshes the swim-lane stats (events, connections). */
export async function testTimelineDeleteRefreshesStats(): Promise<string[]> {
  return withEnglish(async () => {
    const P = `tl-leftovers-${Date.now()}`;
    const timeline = (id: string, title: string): Timeline => ({ id: `${P}-${id}`, projectId: P, title, color: '#c4973b', createdAt: now, updatedAt: now });
    const timelines = [timeline('t1', 'Doomed'), timeline('t2', 'Second'), timeline('t3', 'Third')];
    const event = (id: string, tl: Timeline, order: number): TimelineEvent => ({
      id: `${P}-${id}`, projectId: P, timelineId: tl.id, title: id, description: '', date: `${order}`,
      dateMode: 'text', eventType: 'point', order, lane: '', color: '#c4973b', createdAt: now, updatedAt: now,
    });
    const events = [
      event('e1', timelines[0], 0), event('e2', timelines[0], 1),
      event('e3', timelines[1], 0), event('e4', timelines[2], 0),
    ];
    const connection: TimelineConnection = {
      id: `${P}-x1`, projectId: P, timelineId: timelines[1].id, sourceEventId: events[2].id,
      targetEventId: events[0].id, color: '#fff', style: 'solid', createdAt: now,
    };
    await db.timelines.bulkAdd(timelines);
    await db.timelineEvents.bulkAdd(events);
    await db.timelineConnections.add(connection);
    const view = await mount(<TimelineEngine projectId={P} />);
    const text = () => view.host.textContent ?? '';
    try {
      await waitFor(() => text().includes('3 timelines · 4 events · 1 connections'), () => `stats did not load: ${text().slice(0, 200)}`);
      const del = Array.from(view.host.querySelectorAll<HTMLButtonElement>('button[title="Delete Timeline"]'));
      assert(del.length === 3, `delete buttons: ${del.length}`);
      await act(async () => del[0].click());
      const confirm = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
        .find((b) => b.textContent?.trim() === 'Delete');
      await waitFor(() => Boolean(confirm()), 'timeline delete did not ask');
      await act(async () => confirm()!.click());
      await waitFor(
        () => text().includes('2 timelines · 2 events · 0 connections'),
        () => `stats stale after deleting a timeline: ${text().match(/\d+ timelines[^\n]*?connections/)?.[0]}`,
      );
    } finally {
      await view.unmount();
      await db.timelines.bulkDelete(timelines.map((t) => t.id));
      await db.timelineEvents.bulkDelete(events.map((e) => e.id));
      await db.timelineConnections.delete(connection.id);
    }
    return ['deleting a timeline refreshes the swim-lane event and connection counts without a remount'];
  });
}

/** Dialog blocks (single and dual pair) ask before deleting, like every other delete. */
export async function testDialogBlockDeleteConfirms(): Promise<string[]> {
  return withEnglish(async () => {
    const P = `dlg-leftovers-${Date.now()}`;
    const s = scene(P, 's', 0);
    const action = block(s, 'action', 0, { type: 'action', content: 'She walks in.' });
    const left = block(s, 'left', 1, { characterName: 'Ana', dualGroupId: `${P}-dual` });
    const right = block(s, 'right', 2, { characterName: 'Bob', dualGroupId: `${P}-dual` });
    await db.projects.add({ id: P, title: 'Leftovers', description: '', type: 'standalone', status: 'draft', mode: 'custom', color: '#c4973b', enabledEngines: ['dialog-scene'], engineOrder: [], createdAt: now, updatedAt: now });
    await db.scenes.add(s);
    await db.dialogBlocks.bulkAdd([action, left, right]);
    const view = await mount(<SceneEditor scene={s} scenes={[s]} onUpdateScene={async () => {}} onBack={() => {}} />);
    const dialogButton = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((b) => b.textContent?.trim() === label);
    const blockIds = async () => (await db.dialogBlocks.where('sceneId').equals(s.id).toArray()).map((b) => b.id).sort();
    try {
      await waitFor(() => view.host.querySelectorAll('button[title="Delete block"]').length === 1
        && view.host.querySelectorAll('button[title="Delete both"]').length === 1, 'scene blocks did not render');

      // One click only asks; Cancel keeps the block.
      await act(async () => view.host.querySelector<HTMLButtonElement>('button[title="Delete block"]')!.click());
      await waitFor(() => document.body.textContent?.includes('Delete this block? This cannot be undone.') ?? false, 'single block delete did not ask');
      assert((await blockIds()).length === 3, 'block deleted before confirmation');
      await act(async () => dialogButton('Cancel')!.click());
      await waitFor(() => !document.querySelector('[role="dialog"]'), 'cancel did not close the dialog');
      assert((await blockIds()).length === 3, 'cancel deleted the block');

      await act(async () => view.host.querySelector<HTMLButtonElement>('button[title="Delete block"]')!.click());
      await waitFor(() => Boolean(dialogButton('Delete block')), 'no confirm button');
      await act(async () => dialogButton('Delete block')!.click());
      await waitFor(() => view.host.querySelectorAll('button[title="Delete block"]').length === 0, 'confirmed block not removed from view');
      assert(JSON.stringify(await blockIds()) === JSON.stringify([left.id, right.id].sort()), 'wrong block deleted');

      // The dual pair's "Delete both" is ONE question for its two blocks.
      await act(async () => view.host.querySelector<HTMLButtonElement>('button[title="Delete both"]')!.click());
      await waitFor(() => document.body.textContent?.includes('Delete both blocks of this dual dialogue?') ?? false, 'dual delete did not ask');
      assert((await blockIds()).length === 2, 'dual blocks deleted before confirmation');
      await act(async () => dialogButton('Delete both')!.click());
      await waitFor(() => view.host.querySelectorAll('button[title="Delete both"]').length === 0, 'dual pair not removed');
      assert((await blockIds()).length === 0, 'dual pair not deleted after confirmation');
    } finally {
      await view.unmount();
      await db.dialogBlocks.bulkDelete([action.id, left.id, right.id]);
      await db.scenes.delete(s.id);
      await db.projects.delete(P);
    }
    return ['dialog blocks and dual pairs ask via ConfirmDialog before deleting; Cancel keeps them'];
  });
}

export async function testEngineLeftovers(): Promise<string[]> {
  return [
    ...(await testPovAuditSpeakerScenes()),
    ...(await testTimelineDeleteRefreshesStats()),
    ...(await testDialogBlockDeleteConfirms()),
  ];
}
