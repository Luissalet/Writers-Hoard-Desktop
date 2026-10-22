import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { buildHumanGeography } from '@/engines/worldgen/core/settlements';
import { rollLabelName, ROLL_STYLES } from '@/engines/worldgen/core/rollName';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** Rolling a name for a label: in the world's languages, suited to the label, never one already used; the bridge tool. */
export async function testWorldRollName(): Promise<string[]> {
  const P = 'synthetic-roll', Wid = 'roll-world';
  try {
    const params = { ...DEFAULT_PARAMS, width: 128, seed: 'roll-planet' };
    const world = generateWorld(params);
    const geo = buildHumanGeography(world);
    const seed = String(params.seed);
    assert(geo.languages.living.length >= 2 && geo.settlements.length > 0, 'A world with languages and towns');
    const used = new Set([...geo.settlements.map((s) => s.name), ...geo.features.map((f) => f.name), ...geo.realms.map((r) => r.name)].map((n) => n.toLowerCase()));
    const prefixes: Record<string, RegExp> = { region: /^(Tierras de |Reino de )?\S/, water: /^(Mar de|Lago|Bahía de) \S/, range: /^(Montes|Sierra de|Picos de) \S/, settlement: /^(?!Mar de |Lago |Montes |Tierras de )\S/ };
    const languages = new Set<string>();
    for (const style of ROLL_STYLES) {
      const names = Array.from({ length: 8 }, (_, roll) => rollLabelName(geo, seed, style, roll));
      for (const name of names) {
        assert(prefixes[style].test(name.text), `${style}: "${name.text}"`);
        assert(!used.has(name.text.toLowerCase()) && !used.has(name.word.toLowerCase()), `${style}: "${name.text}" is already on the map`);
        assert(/^«.+» \(< \*.+\)$/.test(name.etymology), `Etymology ${name.etymology}`);
        languages.add(name.languageId);
      }
      assert(new Set(names.map((n) => n.text)).size >= 6, `${style}: rolls repeat ${names.map((n) => n.text)}`);
      assert(rollLabelName(geo, seed, style, 3).text === names[3].text, `${style}: the same roll gives another name`);
    }
    assert(languages.size === geo.languages.living.length, `Rolls walk through the languages: ${[...languages]} of ${geo.languages.living.length}`);
    // A name the author already wrote on the map is never rolled again.
    const taken = rollLabelName(geo, seed, 'water', 0).text;
    assert(rollLabelName(geo, seed, 'water', 0, undefined, { painted: [taken] }).text !== taken, 'A painted name was rolled again');
    // At a spot: the language of the nearest town.
    const town = geo.settlements[0];
    const local = geo.languages.byId.get(geo.languageOf[town.culture])!.name;
    const localId = geo.languageOf[town.culture];
    const atTown = Array.from({ length: 4 }, (_, roll) => rollLabelName(geo, seed, 'range', roll, { x: town.x + 0.5, y: town.y + 0.5 }));
    assert(atTown.every((n) => n.languageId === localId), `Near ${town.name} the names are in ${local}: ${atTown.map((n) => n.language)}`);

    // Across the seam: a spot just west of the map's east edge is next to a town just east of its west edge.
    const westmost = geo.settlements.reduce((a, b) => (b.x < a.x ? b : a));
    const seamSpot = { x: world.width - 0.4 + westmost.x - Math.floor(westmost.x), y: westmost.y + 0.5 };
    const nearest = geo.settlements.reduce((best, s) => { const d = (v: typeof s) => { let dx = Math.abs(v.x - seamSpot.x); if (dx > world.width / 2) dx = world.width - dx; return dx * dx + (v.y - seamSpot.y) ** 2; }; return d(s) < d(best) ? s : best; });
    const seamName = rollLabelName(geo, seed, 'range', 0, seamSpot, { width: world.width });
    assert(seamName.languageId === geo.languageOf[nearest.culture], `Across the seam the name should be in ${nearest.name}'s language`);

    // The bridge.
    await db.projects.put({ id: P, title: 'Roll', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Roll planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), world);
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    bad(await runBridgeTool('wh_roll_name', { worldId: Wid }), /style/, 'no style');
    bad(await runBridgeTool('wh_roll_name', { worldId: Wid, style: 'note' }), /style/, 'a note');
    bad(await runBridgeTool('wh_roll_name', { worldId: Wid, style: 'water', x: 3 }), /both x and y/, 'x without y');
    let reply: BridgeReply | undefined;
    for (let i = 0; i < 60; i++) { reply = await runBridgeTool('wh_roll_name', { worldId: Wid, style: 'water', count: 4 }); if (reply.ok && !(reply.result as { pending?: boolean }).pending) break; await new Promise((r) => setTimeout(r, 500)); }
    const water = reply!.result as { names: { text: string; language: string; etymology: string }[] };
    assert(reply!.ok && water.names.length === 4 && water.names.every((n) => /^(Mar de|Lago|Bahía de) /.test(n.text) && n.language && n.etymology), `Bridge water names ${JSON.stringify(reply).slice(0, 400)}`);
    // The bridge leaves out names already painted: put the first water name on as a label and roll again.
    await db.generatedWorlds.update(Wid, { edits: JSON.stringify([{ kind: 'label', x: 5, y: 5, text: water.names[0].text, style: 'water' }]) });
    let again: BridgeReply | undefined;
    for (let i = 0; i < 60; i++) { again = await runBridgeTool('wh_roll_name', { worldId: Wid, style: 'water', count: 4 }); if (again.ok && !(again.result as { pending?: boolean }).pending) break; await new Promise((r) => setTimeout(r, 500)); }
    const againNames = (again!.result as { names: { text: string }[] }).names.map((n) => n.text);
    assert(again!.ok && !againNames.includes(water.names[0].text), `The painted "${water.names[0].text}" came back: ${againNames}`);
    await db.generatedWorlds.update(Wid, { edits: '[]' });
    const local2 = await runBridgeTool('wh_roll_name', { worldId: Wid, style: 'settlement', count: 3, x: town.x, y: town.y });
    const towns = (local2.result as { names: { text: string; language: string }[] }).names;
    assert(local2.ok && towns.length === 3 && towns.every((n) => n.language === local), `Bridge names at ${town.name}: ${JSON.stringify(local2).slice(0, 300)}`);
    assert(((await db.generatedWorlds.get(Wid))!.edits ?? '[]') === '[]', 'Rolling a name wrote to the world');
    return [
      `Rolled names for region, water, range and settlement labels carry fitting words (${water.names[0].text}), walk through all ${geo.languages.living.length} languages, never repeat a name on the map or one the author painted, give the same name for the same roll and come with an etymology`,
      `Near ${town.name} the rolls are all in ${local}, the language spoken there; across the map's east-west seam the nearest town is found the short way round`,
      'Bridge: wh_roll_name refuses a missing style, a note and x without y; returns water names with language and etymology (leaving out one painted as a label), settlement names in the local language at a spot; writes nothing',
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
