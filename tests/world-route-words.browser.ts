import { db } from '@/db';
import type { Project } from '@/types';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { buildHumanGeography } from '@/engines/worldgen/core/settlements';
import { planRoute } from '@/engines/worldgen/core/travel';
import { clockAt, clockText, dayPart, legClocks, placesPassed, roadsTaken, groundsCrossed, routeStretches } from '@/engines/worldgen/core/routeWords';
import { effectiveHoursPerDay, HARD_PACE_REST_EVERY } from '@/engines/worldgen/core/travel';
import { saveWorldJourney } from '@/engines/worldgen/journeyOperations';
import { runBridgeTool, type BridgeReply } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** A journey in words: the clock, the towns passed, the roads followed, the inns slept in; the bridge. */
export async function testWorldRouteWords(): Promise<string[]> {
  const P = 'synthetic-route-words', Wid = 'route-words-world';
  try {
    // The clock.
    assert(dayPart(6) === 'dawn' && dayPart(9) === 'morning' && dayPart(13) === 'noon' && dayPart(16) === 'afternoon' && dayPart(19.5) === 'dusk' && dayPart(23) === 'night' && dayPart(2) === 'night', 'Parts of the day');
    const c = clockAt(25, 10, 7);
    assert(c.day === 3 && Math.abs(c.hour - 12) < 1e-9 && c.part === 'noon', `25 h at 10 a day from 07:00: ${JSON.stringify(c)}`);
    const end = clockAt(20, 10, 7, true);
    assert(end.day === 2 && Math.abs(end.hour - 17) < 1e-9, `Arriving exactly at a day's end is that day's evening: ${JSON.stringify(end)}`);
    assert(clockText(7.5) === '07:30' && clockText(24.25) === '00:15', 'Clock text');
    // A hard pace's rest days push the calendar on: with a rest after every 2 days on the move, the 3rd day on the move is calendar day 4.
    assert(clockAt(25, 10, 7, false, 2).day === 4 && clockAt(15, 10, 7, false, 2).day === 2, 'Rest days in the calendar');

    // A real journey between two towns far apart, by way of a third.
    const params = { ...DEFAULT_PARAMS, width: 256, seed: 'route-words-planet' };
    const world = generateWorld(params);
    const geo = buildHumanGeography(world);
    let picked: { a: typeof geo.settlements[number]; b: typeof geo.settlements[number]; route: ReturnType<typeof planRoute> } | null = null;
    const towns = geo.settlements;
    for (const a of towns) {
      for (const b of towns) {
        if (a === b) continue;
        const route = planRoute(world, geo, a, b, { mode: 'foot', season: 'summer' }, 'es');
        if (!route.impossible && route.roadFraction > 0.2 && placesPassed(world, geo, route, { ends: [a.name, b.name] }).length > 0) { picked = { a, b, route }; break; }
      }
      if (picked) break;
    }
    assert(picked, 'No journey partly on roads that passes a town');
    const { route } = picked;
    // Stretches are in travel order: they add up to the route, and the first starts where the journey does.
    const stretches = routeStretches(route);
    const stretchKm = stretches.reduce((a, l) => a + l.km, 0), stretchHours = stretches.reduce((a, l) => a + l.hours, 0);
    assert(route.stretches && Math.abs(stretchKm - route.km) < 1e-6 * Math.max(1, route.km) + 0.01 && Math.abs(stretchHours - route.hours) < 0.01, `Stretches add up: ${stretchKm} of ${route.km} km`);
    const clocks = legClocks(route, 11, 7);
    assert(clocks.length === stretches.length && clocks[0].day === 1 && Math.abs(clocks[0].hour - 7) < 1e-9, 'The first stretch starts on day 1 at the set-off hour');
    assert(clocks.every((k, i) => i === 0 || k.day > clocks[i - 1].day || (k.day === clocks[i - 1].day && k.hour >= clocks[i - 1].hour)), 'Stretch clocks run forward');
    // A hard pace: the arrival day counts the rest days, as the trip's length does.
    const hard = planRoute(world, geo, picked.a, picked.b, { mode: 'foot', season: 'summer', pace: 'hard' }, 'es');
    const hpdHard = effectiveHoursPerDay({ season: 'summer', pace: 'hard' });
    const hardArrive = clockAt(hard.hours, hpdHard, 7, true, HARD_PACE_REST_EVERY);
    assert(hardArrive.day === Math.ceil(hard.hours / hpdHard - 1e-9) + (hard.restDays ?? 0), `Hard pace arrival day ${hardArrive.day}, travel ${hard.hours / hpdHard} days + ${hard.restDays} rest`);
    const passes = placesPassed(world, geo, route, { ends: [picked.a.name, picked.b.name] });
    assert(passes.length > 0 && passes.every((p, i) => i === 0 || p.atKm >= passes[i - 1].atKm), 'Passes in order');
    assert(passes.every((p) => p.name !== picked!.a.name && p.name !== picked!.b.name && p.atKm >= 0 && p.atKm <= route.km + 1e-6), `Ends left out, km within the route: ${JSON.stringify(passes)}`);
    const roads = roadsTaken(world, geo, route);
    const names = new Set(geo.settlements.map((s) => s.name));
    assert(roads.length > 0 && roads.every((r) => names.has(r.from) && names.has(r.to) && r.km > 0), `Roads named by their towns: ${JSON.stringify(roads)}`);
    // A journey of several stretches (on and off the road): grounds come in the order first met, clocks run forward through them.
    let varied: ReturnType<typeof planRoute> | null = null;
    for (const a of towns) { for (const b of towns) { if (a === b) continue; const r = planRoute(world, geo, a, b, { mode: 'foot', season: 'summer' }, 'es'); if (!r.impossible && routeStretches(r).length >= 3 && groundsCrossed(r, 6).length >= 1) { varied = r; break; } } if (varied) break; }
    assert(varied, 'No journey with three stretches or more');
    const variedStretches = routeStretches(varied);
    const realGrounds = groundsCrossed(varied, 6);
    const firstSeen = (g: string) => variedStretches.findIndex((l) => l.terrain === g && !l.onRoad);
    assert(realGrounds.every((g, i) => i === 0 || firstSeen(g) > firstSeen(realGrounds[i - 1])), `Grounds in travel order: ${realGrounds}`);
    const variedClocks = legClocks(varied, 11, 7);
    assert(variedClocks.every((k, i) => i === 0 || k.day > variedClocks[i - 1].day || (k.day === variedClocks[i - 1].day && k.hour >= variedClocks[i - 1].hour)), 'Clocks run forward through the stretches');
    assert(variedStretches.every((l, i) => i === 0 || l.terrain !== variedStretches[i - 1].terrain || l.onRoad !== variedStretches[i - 1].onRoad), 'Neighbouring stretches are different ground');
    // Grounds: land off the road only, in order of first meeting, no repeats.
    const grounds = groundsCrossed({ legs: [{ terrain: 'calzada', km: 5, hours: 1, onRoad: true }, { terrain: 'pradera', km: 9, hours: 3, onRoad: false }, { terrain: 'mar', km: 40, hours: 6, onRoad: false }, { terrain: 'bosque', km: 4, hours: 2, onRoad: false }, { terrain: 'pradera', km: 2, hours: 1, onRoad: false }] }, 6);
    assert(grounds.join('|') === 'pradera|bosque', `Grounds ${grounds}`);
    // Inns: a night with a shelter is not rough and sleeps in the nearest place.
    for (const stage of route.stages) {
      if (stage.shelter) assert(!stage.rough && stage.nearest && stage.shelter.name === stage.nearest.name && stage.nearest.km <= 8, `Night ${stage.night}: ${JSON.stringify(stage)}`);
    }
    const inns = route.stages.filter((s) => s.shelter).length;
    // A village where the first night falls: the night is at its inn.
    const night1 = route.stages[0];
    const withInn = { ...geo, settlements: [...geo.settlements, { ...geo.settlements[0], x: night1.x, y: night1.y, name: 'Posada del Cruce', rank: 'village' }] };
    const innRoute = planRoute(world, withInn as typeof geo, picked.a, picked.b, { mode: 'foot', season: 'summer' }, 'es');
    assert(innRoute.stages[0].shelter?.name === 'Posada del Cruce' && !innRoute.stages[0].rough, `First night by a village: ${JSON.stringify(innRoute.stages[0])}`);
    // A town on the way, made a stop, is passed.
    const near = geo.settlements.find((s) => s.name === passes[0].name)!;
    const viaRoute = planRoute(world, geo, picked.a, picked.b, { mode: 'foot', season: 'summer', via: [{ x: near.x, y: near.y }] }, 'es');
    const viaPasses = viaRoute.impossible ? [] : placesPassed(world, geo, viaRoute, { ends: [picked.a.name, picked.b.name] });
    assert(!viaRoute.impossible && viaPasses.some((p) => p.name === near.name), `A stop on the way is listed as passed: ${near.name} not in ${viaPasses.map((p) => p.name)}`);

    // A saved journey keeps a whole set-off hour and refuses a bad one.
    await db.projects.put({ id: P, title: 'Route words', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['worldgen'], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.generatedWorlds.put({ id: Wid, projectId: P, title: 'Road planet', params, edits: '[]', createdAt: 1, updatedAt: 1 });
    await saveSnapshot(worldRuntimeKey(Wid), paramsKey(params), world);
    const stops = [{ name: picked.a.name, u: (picked.a.x + 0.5) / world.width, v: (picked.a.y + 0.5) / world.height }, { name: picked.b.name, u: (picked.b.x + 0.5) / world.width, v: (picked.b.y + 0.5) / world.height }];
    await saveWorldJourney(Wid, P, { id: 'early', name: 'Early', stops, options: { mode: 'foot', season: 'summer', setOffHour: 5 }, recipeKey: 'x', createdAt: 1, updatedAt: 1 });
    assert((await db.generatedWorlds.get(Wid))!.journeys?.find((j) => j.id === 'early')?.options.setOffHour === 5, 'The set-off hour was not saved');
    let refused = false;
    try { await saveWorldJourney(Wid, P, { id: 'bad', name: 'Bad', stops, options: { mode: 'foot', season: 'summer', setOffHour: 25 }, recipeKey: 'x', createdAt: 1, updatedAt: 1 }); } catch { refused = true; }
    assert(refused, 'A set-off hour of 25 was saved');

    // The bridge.
    const bad = (reply: BridgeReply, pattern: RegExp, label: string) => assert(!reply.ok && pattern.test(reply.error ?? ''), `${label}: ${JSON.stringify(reply).slice(0, 300)}`);
    const at = (s: typeof picked.a) => ({ x: s.x, y: s.y });
    bad(await runBridgeTool('wh_plan_journey', { worldId: Wid, stops: [at(picked.a), at(picked.b)], setOffHour: 7.5 }), /setOffHour/, 'half hour');
    let reply: BridgeReply | undefined;
    for (let i = 0; i < 60; i++) { reply = await runBridgeTool('wh_plan_journey', { worldId: Wid, stops: [at(picked.a), at(picked.b)], mode: 'foot', season: 'summer', setOffHour: 6, locale: 'es' }); if (reply.ok && !(reply.result as { pending?: boolean }).pending) break; await new Promise((r) => setTimeout(r, 500)); }
    const plan = reply!.result as { passes: { name: string; atKm: number }[]; roads: { from: string; to: string }[]; clock: { setsOff: string; makesCamp: string; arrives: { day: number; at: string; partOfDay: string } }; stretches: { day: number; partOfDay: string; startsAt: string }[]; nights: { shelter?: { kind: string } }[]; hoursPerDay: number };
    assert(reply!.ok && plan.clock.setsOff === '06:00' && plan.clock.makesCamp === clockText(6 + plan.hoursPerDay) && plan.stretches[0].day === 1 && plan.stretches[0].startsAt === '06:00', `Bridge clock ${JSON.stringify(plan.clock)} / ${JSON.stringify(plan.stretches?.[0])}`);
    assert(plan.stretches.every((st, i) => i === 0 || st.day >= plan.stretches[i - 1].day) && plan.stretches.length === Math.min(30, stretches.length), `Bridge stretches in order: ${JSON.stringify(plan.stretches.slice(0, 5))}`);
    assert(plan.roads.length > 0 && Array.isArray(plan.passes) && plan.nights.filter((n) => n.shelter).length === inns, `Bridge words ${JSON.stringify({ roads: plan.roads, passes: plan.passes.length, inns })}`);
    return [
      'Clock: parts of the day, the day and hour after N hours on the move (a moment on a day\'s end belongs to that evening), 07:30-style text',
      `From ${picked.a.name} to ${picked.b.name}: ${stretches.length} stretches in travel order adding up to the route, with clocks from day 1 at the set-off hour running forward (a hard pace's arrival counts its ${hard.restDays ?? 0} rest days); a journey of ${variedStretches.length} stretches gives its grounds in the order first met (${realGrounds.join(', ')}) with clocks running forward`,
      `Towns and roads: ${passes.length} towns passed in order (ends left out; a stop on the way is listed), ${roads.length} roads named after their towns (${roads.map((r) => `${r.from}–${r.to}`).join(', ')}), a mixed list of legs gives the land grounds off the road (${grounds.join(', ')}); ${inns} of ${route.stages.length} nights at an inn or ruin, each one the nearest place within reach; a village where the first night falls makes it a night at its inn`,
      'A saved itinerary keeps its whole set-off hour; 25 is refused',
      `Bridge: wh_plan_journey refuses a half-hour set-off, and with setOffHour 6 sets off at 06:00, makes camp at ${plan.clock.makesCamp}, arrives on day ${plan.clock.arrives.day} ${plan.clock.arrives.partOfDay} (${plan.clock.arrives.at}); reports passes, roads, the stretches in order each with its day, and the nights' shelters`,
    ];
  } finally {
    await db.worldSnapshots.delete(worldRuntimeKey(Wid));
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
