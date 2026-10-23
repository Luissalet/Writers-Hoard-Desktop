import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { buildHumanGeography } from '@/engines/worldgen/core/settlements';
import { drawHourLight, hourWash, MAP_HOURS, partyHour } from '@/engines/worldgen/core/hourLight';
import { normalizeStoryEvent, STORY_COLORS, STORY_TYPES } from '@/engines/worldgen/core/storyEvents';
import { normalizeTravelProfile, planRoute, FLY_KMH, type TravelProfile } from '@/engines/worldgen/core/travel';
import { saveWorldJourney, saveWorldTravelSettings } from '@/engines/worldgen/journeyOperations';
import { placesFromSettlements, portTrade, simulateEconomy, autoSites, type EconomyInput } from '@/engines/worldgen/core/economy';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** The map at an hour, the party's marks, the world's own ways of travelling and a port's sea trade; the bridge. */
export async function testWorldLightWays(): Promise<string[]> {
  const P = 'synthetic-light-ways', Wid = 'light-ways-world';
  try {
    // The hour: plain at noon, blue at night, red at dusk; the party's clock.
    assert(hourWash(MAP_HOURS.noon).alpha === 0, 'Noon is plain');
    const night = hourWash(MAP_HOURS.night), dusk = hourWash(MAP_HOURS.dusk), dawn = hourWash(MAP_HOURS.dawn);
    assert(night.alpha > 0.5 && night.rgb[2] > night.rgb[0] * 2 && night.glow > 0.9, `Night ${JSON.stringify(night)}`);
    assert(dusk.rgb[0] > dusk.rgb[2] * 2 && dusk.alpha > 0.3, `Dusk ${JSON.stringify(dusk)}`);
    assert(dawn.alpha > 0.2 && JSON.stringify(hourWash(25)) === JSON.stringify(hourWash(1)), 'Dawn and the wrap');
    assert(partyHour(0) === 7 && Math.abs(partyHour(0.3) - 12.5) < 1e-9 && partyHour(0.8) >= 0 && partyHour(0.8) < 3, `Party hours ${partyHour(0)}, ${partyHour(0.3)}, ${partyHour(0.8)}`);
    const canvas = document.createElement('canvas'); canvas.width = 200; canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    const paint = () => { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.fillStyle = 'rgb(180,170,140)'; ctx.fillRect(0, 0, 200, 100); };
    const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
    paint(); drawHourLight(ctx, 0, 0, 200, 100, MAP_HOURS.noon);
    assert(JSON.stringify(at(10, 10)) === JSON.stringify([180, 170, 140]), 'Noon leaves the map alone');
    paint(); drawHourLight(ctx, 0, 0, 200, 100, MAP_HOURS.night, [{ x: 150, y: 50 }], 30);
    const dark = at(10, 10), lit = at(150, 50);
    assert(dark[0] < 120 && dark[2] < 140 && lit[0] > dark[0] + 40, `Night ${dark} lantern ${lit}`);

    // The party's marks.
    for (const type of ['lantern', 'sneaking', 'inside'] as const) {
      assert(STORY_TYPES.includes(type) && !!STORY_COLORS[type], `Type ${type}`);
      assert(normalizeStoryEvent({ id: `e-${type}`, x: 1, y: 1, type, title: 'x' }).type === type, `Event ${type}`);
    }

    // The world's own ways.
    const griffin = { id: 'grifo', name: 'Grifo', base: 'horse', flies: true } as const;
    const profile = normalizeTravelProfile({ ways: [griffin, { id: 'trineo', name: 'Trineo', base: 'cart', speed: 2, night: true }] });
    assert(profile.ways?.length === 2 && profile.ways[1].speed === 2 && profile.ways[1].night === true, `Ways ${JSON.stringify(profile)}`);
    for (const bad of [{ ways: [{ id: 'a', name: 'A', base: 'dragon' }] }, { ways: [griffin, griffin] }, { ways: Array.from({ length: 13 }, (_, i) => ({ id: `w${i}`, name: `W${i}`, base: 'foot' })) }, { ways: [{ id: 'a', name: '', base: 'foot' }] }]) {
      let refused = false; try { normalizeTravelProfile(bad); } catch { refused = true; }
      assert(refused, `Refused ${JSON.stringify(bad).slice(0, 80)}`);
    }
    const params = { ...DEFAULT_PARAMS, width: 256, seed: 'light-ways-planet' };
    const world = generateWorld(params);
    const geo = buildHumanGeography(world);
    // Two towns with no land route between them (another landmass), or failing that the farthest pair.
    let pair: { a: typeof geo.settlements[number]; b: typeof geo.settlements[number] } | null = null;
    for (const a of geo.settlements) { for (const b of geo.settlements) { if (a !== b && planRoute(world, geo, a, b, { mode: 'foot', season: 'summer' }).impossible) { pair = { a, b }; break; } } if (pair) break; }
    assert(pair, 'No two towns apart by sea');
    const flight = planRoute(world, geo, pair.a, pair.b, { mode: 'foot', season: 'summer', profile, way: 'grifo' });
    assert(!flight.impossible && flight.crossings.length === 0 && Math.abs(flight.hours - flight.km / FLY_KMH) < 0.01 * flight.hours + 0.01, `Flight ${flight.impossible ?? `${flight.hours} h for ${flight.km} km`}`);
    const missing = planRoute(world, geo, pair.a, pair.b, { mode: 'foot', season: 'summer', profile, way: 'dragon' });
    assert(!!missing.impossible, 'An unknown way is refused');
    // Night travel arrives in fewer days than the same mode by day.
    let land: { a: typeof geo.settlements[number]; b: typeof geo.settlements[number]; days: number } | null = null;
    for (const a of geo.settlements) { for (const b of geo.settlements) { if (a === b) continue; const r = planRoute(world, geo, a, b, { mode: 'cart', season: 'summer', profile: { speed: { cart: 2 } } }); if (!r.impossible && r.days > 3) { land = { a, b, days: r.days }; break; } } if (land) break; }
    assert(land, 'No cart journey of some days');
    const sledge = planRoute(world, geo, land.a, land.b, { mode: 'foot', season: 'summer', profile, way: 'trineo' });
    assert(!sledge.impossible && sledge.days < land.days * 0.7, `Night sledge ${sledge.days} vs ${land.days} days`);

    // Saved with the world, merged with its factors; an itinerary keeps a way it was planned with.
    await db.projects.put({ id: P, title: 'Light', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Light planet', params, edits: '[]', createdAt: 1, updatedAt: 1, travelProfile: { speed: { foot: 1.5 } } });
    await saveWorldTravelSettings({ projectId: P }, Wid, { ways: [griffin] });
    let row = (await db.generatedWorlds.get(Wid))!;
    assert(row.travelProfile?.speed?.foot === 1.5 && row.travelProfile.ways?.[0].id === 'grifo', `Merged ${JSON.stringify(row.travelProfile)}`);
    await saveWorldTravelSettings({ projectId: P }, Wid, { factors: [{ table: 'speed', key: 'horse', value: 2 }] });
    row = (await db.generatedWorlds.get(Wid))!;
    assert(row.travelProfile?.ways?.length === 1 && row.travelProfile.speed?.horse === 2, 'Factors keep the ways');
    const stops = [{ name: pair.a.name, u: pair.a.x / world.width, v: pair.a.y / world.height }, { name: pair.b.name, u: pair.b.x / world.width, v: pair.b.y / world.height }];
    const tripProfile: TravelProfile = { ways: [griffin] };
    await saveWorldJourney(Wid, P, { id: 'trip', name: 'By griffin', stops, options: { mode: 'horse', season: 'summer', way: 'grifo', profile: tripProfile }, recipeKey: 'x', createdAt: 1, updatedAt: 1 });
    let refused = false;
    try { await saveWorldJourney(Wid, P, { id: 'trip2', name: 'Bad', stops, options: { mode: 'horse', season: 'summer', way: 'dragon', profile: tripProfile }, recipeKey: 'x', createdAt: 1, updatedAt: 1 }); } catch { refused = true; }
    assert(refused, 'An itinerary with a way it does not carry is refused');
    await saveWorldTravelSettings({ projectId: P }, Wid, { ways: null });
    assert(!(await db.generatedWorlds.get(Wid))!.travelProfile?.ways, 'Ways removed');

    // A port's sea trade.
    const input: EconomyInput = { world, places: placesFromSettlements(geo.settlements), seed: String(params.seed) };
    const sites = autoSites(input);
    const snaps = simulateEconomy(input, 8, 0, sites);
    const sea = snaps.flatMap((s) => s.movements).find((m) => m.bySea);
    let portLine = 'no sea trade in this world';
    if (sea) {
      const from = input.places.find((p) => p.id === sea.from)!;
      const pt = portTrade(snaps, from, snaps.length - 1);
      const shipped = Object.values(pt.shipped).reduce((s, v) => s + (v ?? 0), 0);
      const all = snaps.flatMap((s) => s.movements).filter((m) => m.bySea && m.from === from.id).reduce((s, m) => s + m.amount, 0);
      assert(pt.port && Math.abs(shipped - all) < 1e-6 && pt.partners.length > 0, `Port ${JSON.stringify(pt).slice(0, 200)}`);
      portLine = `${from.name} shipped ${Math.round(shipped)} by sea in eight months to ${pt.partners.length} port(s)`;
    }
    const inland = input.places.find((p) => !p.port);
    if (inland) assert(!portTrade(snaps, inland, 7).port && !Object.keys(portTrade(snaps, inland, 7).shipped).length, 'An inland place ships nothing by sea');

    // The bridge.
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), world);
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    const set = await runBridgeTool('wh_set_world_travel_settings', { worldId: Wid, profile: { ways: [griffin] } });
    assert(set.ok && (await db.generatedWorlds.get(Wid))!.travelProfile?.ways?.[0].id === 'grifo', `Set ways ${JSON.stringify(set).slice(0, 200)}`);
    let plan: BridgeReply | undefined;
    for (let i = 0; i < 60; i++) { plan = await runBridgeTool('wh_plan_journey', { worldId: Wid, stops: [{ x: pair.a.x, y: pair.a.y }, { x: pair.b.x, y: pair.b.y }], way: 'grifo' }); if (!(plan.ok && (plan.result as { pending?: boolean }).pending)) break; await new Promise((r) => setTimeout(r, 500)); }
    const planned = plan!.result as { impossible?: string; way?: { id: string; flies: boolean }; days?: number };
    assert(plan!.ok && !planned.impossible && planned.way?.id === 'grifo' && planned.way.flies, `Plan by griffin ${JSON.stringify(planned).slice(0, 300)}`);
    bad(await runBridgeTool('wh_plan_journey', { worldId: Wid, stops: [{ x: pair.a.x, y: pair.a.y }, { x: pair.b.x, y: pair.b.y }], way: 'dragon' }), /way must be/, 'unknown way');
    bad(await runBridgeTool('wh_plan_journey', { worldId: Wid, stops: [{ x: pair.a.x, y: pair.a.y }, { x: pair.b.x, y: pair.b.y }], way: 'grifo', mode: 'foot' }), /not both/, 'way and mode');
    const plain = await runBridgeTool('wh_render_world_map', { worldId: Wid, width: 320 });
    const nightMap = await runBridgeTool('wh_render_world_map', { worldId: Wid, width: 320, hour: 'night' });
    assert(plain.ok && nightMap.ok && (nightMap.result as { hour: number }).hour === MAP_HOURS.night && (nightMap.result as { dataUrl: string }).dataUrl !== (plain.result as { dataUrl: string }).dataUrl, 'Night render differs');
    bad(await runBridgeTool('wh_render_world_map', { worldId: Wid, width: 320, hour: 'teatime' }), /hour must be/, 'bad hour');
    const lantern = await runBridgeTool('wh_add_story_event', { worldId: Wid, x: pair.a.x, y: pair.a.y, title: 'By lantern', type: 'lantern' });
    assert(lantern.ok, `Lantern event ${JSON.stringify(lantern).slice(0, 200)}`);
    let econ: BridgeReply | undefined;
    for (let i = 0; i < 60; i++) { econ = await runBridgeTool('wh_world_economy', { worldId: Wid, month: 8, place: (sea ? input.places.find((p) => p.id === sea.from)! : input.places[0]).name }); if (!(econ.ok && (econ.result as { pending?: boolean }).pending)) break; await new Promise((r) => setTimeout(r, 500)); }
    const detail = (econ!.result as { placesDetail: { port?: boolean; shippedBySea?: Record<string, number> }[] }).placesDetail[0];
    assert(econ!.ok && typeof detail.port === 'boolean' && (!sea || (detail.port && Object.keys(detail.shippedBySea ?? {}).length > 0)), `Economy port detail ${JSON.stringify(detail).slice(0, 300)}`);
    return [
      'The map at an hour: noon untouched, dawn pink, dusk red, night blue with a lantern round the party; the party\'s clock runs from its set-off hour through the night',
      'The party\'s marks: by lantern-light, sneaking and gone inside are kinds of story event',
      `The world's own ways: a flying griffin crosses from ${pair.a.name} to ${pair.b.name} over the sea (${flight.km.toFixed(0)} km, ${flight.hours.toFixed(1)} h, no fords) where no one can walk; a sledge going day and night arrives in ${sledge.days.toFixed(1)} days against ${land.days.toFixed(1)}; an unknown way is refused; ways are saved with the world beside its factors, kept in an itinerary, and removed`,
      `A port's sea trade: ${portLine}; an inland place ships nothing`,
      'Bridge: wh_set_world_travel_settings saves ways, wh_plan_journey flies by griffin and refuses an unknown way or a way with a mode, wh_render_world_map draws the night and refuses a made-up hour, wh_add_story_event takes a lantern mark, wh_world_economy tells a port and its sea trade',
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
