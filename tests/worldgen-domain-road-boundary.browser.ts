import { db } from '../src/db';
import { deleteProject } from '../src/db/operations';
import { runBridgeTool } from '../src/services/aiBridge/dispatch';
import { openWorldForReading } from '../src/engines/worldgen/bridgeAccess';
import { deserializeEdits } from '../src/engines/worldgen/core/edits';
import { DOMAIN_GRIDS } from '../src/engines/worldgen/core/domainReplay';

// Prepared for tests/; imports deliberately use its eventual directory.
export const trace: { checks: { name: string; passed: boolean }[]; [key: string]: unknown } = { checks: [] };
function check(value: unknown, name: string): asserts value {
  trace.checks.push({ name, passed: !!value }); if (!value) throw Error(name);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
type Point = { x: number; y: number };

export async function testWorldgenDomainRoadBoundary() {
  const projectId = 'qa-road-boundary-' + crypto.randomUUID(), siblingId = projectId + '-sibling';
  const marker = 'Own disposable public Road boundary regression';
  const observations: unknown[] = []; trace.observations = observations;
  for (const id of [projectId, siblingId]) await db.projects.add({ id, title: marker, description: marker, mode: 'custom', type: 'standalone', status: 'draft', color: '#777777', enabledEngines: ['worldgen'], engineOrder: ['worldgen'], createdAt: 1, updatedAt: 1 });
  const authored = () => db.transaction('r', db.tables, async () => JSON.stringify(await Promise.all(db.tables.filter(table => !['worldSnapshots', 'canonTiles', 'renderedTiles'].includes(table.name)).map(async table => [table.name, await table.toArray()]))));
  const sibling = () => db.transaction('r', db.tables, async () => JSON.stringify(await Promise.all(db.tables.map(async table => [table.name, (await table.toArray()).filter(row => row.id === siblingId || row.projectId === siblingId)]))));
  const siblingBefore = await sibling();
  async function call(tool: string, args: Record<string, unknown>) {
    const before = await authored(), response = await runBridgeTool(tool, args);
    const record = { tool, args, response, before, after: await authored() }; observations.push(record); return record;
  }
  async function create(title: string, finite: boolean) {
    const result = await call('wh_create_world', { projectId, title, preset: 'blankLand', seed: finite ? 'own-finite-road-boundary-r1' : 'own-legacy-road-boundary-r1', ...(finite ? { sheetSize: { widthKm: 600, heightKm: 300, resolution: 128 } } : { width: 1024 }) });
    check(result.response.ok, 'Road fixture uses public world creation'); return (result.response.result as any).worldId as string;
  }
  async function state(worldId: string) {
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      const row = await db.generatedWorlds.get(worldId); check(row?.projectId === projectId, 'Reader owns exact Road fixture');
      const opened = await openWorldForReading(row, 'full');
      if (!opened.ok) { await pause(40); continue; }
      const data = structuredClone(opened.world.data);
      const grids = await Promise.all(DOMAIN_GRIDS.map(async field => {
        const values = data[field]; check(values?.length === data.width * data.height, 'Road reader materializes real grid ' + field);
        const digest = await crypto.subtle.digest('SHA-256', values.buffer.slice(values.byteOffset, values.byteOffset + values.byteLength) as ArrayBuffer);
        return { field, sha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('') };
      }));
      return { data, rowEdits: row.edits, roads: deserializeEdits(row.edits ?? '').filter(edit => edit.kind === 'road'), painted: data.painted?.roads ?? [], grids };
    }
    throw Error('Actual Road reader readiness deadline');
  }
  const compact = (s: Awaited<ReturnType<typeof state>>) => ({ rowEdits: s.rowEdits, roads: s.roads, painted: s.painted, grids: s.grids });
  async function road(worldId: string, from: Point, to: Point, dryRun = false) {
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      const record = await call('wh_add_world_road', { projectId, worldId, from, to, ...(dryRun ? { dryRun: true } : {}) });
      if (record.response.ok && (record.response.result as any)?.pending) {
        check(record.before === record.after && !(record.response.result as any)?.__audit, 'Pending public Road is readonly'); await pause(40); continue;
      }
      return record;
    }
    throw Error('Public Road readiness deadline');
  }
  async function healthy(worldId: string, side: 'east' | 'west' | 'top' | 'bottom') {
    const { data } = await state(worldId), W = data.width, H = data.height;
    const candidates: { from: Point; to: Point }[] = [];
    const dry = (x: number, y: number) => data.elevation[y * W + x] > 0 && !data.lake[y * W + x];
    if (side === 'east' || side === 'west') {
      for (let y = 1; y < H - 1; y++) {
        const x = side === 'east' ? W - 1 : 0, endX = side === 'east' ? W - 3 : 2;
        if ([x, (x + endX) / 2, endX].every(px => dry(px, y))) candidates.push({ from: { x, y }, to: { x: endX, y } });
      }
      candidates.sort((a, b) => Math.abs(a.from.y - H / 2) - Math.abs(b.from.y - H / 2));
    } else {
      const y = side === 'top' ? 0 : H - 1;
      for (let x = 1; x < W - 3; x++) if ([x, x + 1, x + 2].every(px => dry(px, y))) candidates.push({ from: { x, y }, to: { x: x + 2, y } });
      candidates.sort((a, b) => Math.abs(a.from.x - W / 2) - Math.abs(b.from.x - W / 2));
    }
    for (const candidate of candidates.slice(0, 32)) {
      const preview = await road(worldId, candidate.from, candidate.to, true), value = preview.response.result as any;
      check(preview.before === preview.after && !value?.__audit, 'Real cart planner dryRun never publishes');
      if (preview.response.ok && value.dryRun === true && value.cells >= 2) return candidate;
    }
    throw Error('HEALTH: no actual dry public cart route at ' + side);
  }
  async function exercise(worldId: string, from: Point, to: Point, expected: Point | null, name: string) {
    const before = await state(worldId), record = await road(worldId, from, to), after = await state(worldId);
    const result = record.response.result as any, added = after.roads.slice(before.roads.length), first = added[0];
    const passed = expected
      ? record.response.ok && added.length === 1 && same(first.pts[0], expected) && same(first.pts.at(-1), to)
      : !record.response.ok && record.response.code === 'bad-args' && !result?.__audit && record.before === record.after && same(compact(before), compact(after));
    observations.push({ name, before: compact(before), after: compact(after), passed });
    // Undo real writes, including unexpected exterior success, before assertions.
    if (record.response.ok) {
      check(result?.__audit, 'Successful Road returns its own actual Undo envelope');
      const undone = await call('__undo', { entry: { ...result.__audit, tool: 'wh_add_world_road', kind: 'update' } });
      check(undone.response.ok, 'Normal dispatcher Road Undo succeeds');
      const restored = await state(worldId);
      check(same(restored.roads, before.roads) && same(restored.painted, before.painted) && same(restored.grids, before.grids), 'Road Undo restores roads and all14 RAW grids');
    }
    check(passed, name);
  }
  try {
    const finite = await create('Own finite Road boundary', true), legacy = await create('Own legacy Road boundary', false);
    const f = await state(finite), l = await state(legacy);
    check(f.data.width === 128 && f.data.height === 64 && f.data.domain?.topology === 'finite', 'Actual finite Road128x64 fixture');
    check(l.data.width === 1024 && l.data.height === 512 && !l.data.domain, 'Actual legacy Road1024x512 fixture');
    const east = await healthy(finite, 'east'), west = await healthy(finite, 'west'), top = await healthy(finite, 'top'), bottom = await healthy(finite, 'bottom'), legacyEast = await healthy(legacy, 'east');
    await exercise(legacy, { x: -1, y: legacyEast.from.y }, legacyEast.to, legacyEast.from, 'Legacy original negativeX retains wrap with actual write/Undo');
    await exercise(finite, east.from, east.to, east.from, 'Finite lawful cart edge has actual write/Undo');
    for (const item of [
      { from: { x: -1, y: east.from.y }, to: east.to, name: 'Finite Road original negativeX rejects before write' },
      { from: { x: 128, y: west.from.y }, to: west.to, name: 'Finite Road original x=W rejects before write' },
      { from: { x: top.from.x, y: -.25 }, to: top.to, name: 'Finite Road original fractional negativeY rejects before rounding' },
      { from: { x: bottom.from.x, y: 64 }, to: bottom.to, name: 'Finite Road original y=H rejects before write' },
    ]) await exercise(finite, item.from, item.to, null, item.name);
    await exercise(finite, { x: 127.9, y: east.from.y }, east.to, east.from, 'Finite Road lawful W-.1 clamps to last cell');
    await exercise(finite, { x: bottom.from.x, y: 63.9 }, bottom.to, bottom.from, 'Finite Road lawful H-.1 clamps to last cell');
    check(await sibling() === siblingBefore, 'Other own Road project stays literal');
  } finally {
    const cleanup = [];
    for (const id of [projectId, siblingId]) {
      check((await db.projects.get(id))?.description === marker, 'Cleanup owns exact Road project marker');
      const worlds = await db.generatedWorlds.where('projectId').equals(id).primaryKeys(); await deleteProject(id);
      const counts: Record<string, number> = {};
      for (const table of db.tables) if (table.schema.idxByName.projectId || table.schema.primKey.name === 'projectId') counts[table.name] = await table.where('projectId').equals(id).count();
      check(!await db.projects.get(id) && Object.values(counts).every(count => count === 0) && (await Promise.all(worlds.map(world => db.worldSnapshots.get(world)))).every(row => !row), 'Own Road projects/indexed rows/snapshots removed');
      cleanup.push({ projectId: id, counts, snapshots: worlds.length });
    }
    trace.cleanup = cleanup;
  }
}
