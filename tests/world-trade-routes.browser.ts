import { Biome } from '@/engines/worldgen/core/types';
import { simulateEconomy, type EconomyPlace, type EconomyWorld } from '@/engines/worldgen/core/economy';
import { findRoute, isOpenSea, routeLength, shipmentPath, simplifyRoute } from '@/engines/worldgen/core/tradeRoutes';
import { drawTradeLayer, drawTradeLayerProjected, type TradeLayer } from '@/engines/worldgen/cartography/tradeMarks';
import { PROJECTIONS } from '@/engines/worldgen/core/projections';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

const W = 96, H = 48;

/** Grassland with a narrow bay coming down from the north, desert east of it and a river valley in the south. */
function makeWorld(): EconomyWorld {
  const n = W * H;
  const world: EconomyWorld = {
    width: W, height: H, elevation: new Float32Array(n).fill(0.3), temperature: new Float32Array(n).fill(15),
    biome: new Uint8Array(n).fill(Biome.Grassland), lake: new Uint8Array(n), flow: new Float32Array(n),
    // A sheet 2400 km wide: 25 km a cell, so roads reach 32 cells.
    params: { worldKm: 2400 },
  };
  const fill = (x0: number, x1: number, y0: number, y1: number, biome: number, elevation: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; world.biome[i] = biome; world.elevation[i] = elevation; }
  };
  fill(43, 47, 0, 28, Biome.Ocean, -1);   // the bay
  fill(48, 95, 0, H - 1, Biome.Desert, 0.3); // no farmland east of it
  for (let x = 5; x <= 40; x++) world.flow![40 * W + x] = 0.9; // a river along row 40
  return world;
}

const place = (id: number, name: string, x: number, y: number, rank: EconomyPlace['rank'], population: number, port = false): EconomyPlace =>
  ({ id, name, x, y, rank, population, port, realm: 0 });

/** Trade that goes round: roads round a bay and along a river, ships on the water, and the lens on curved maps. */
export async function testWorldTradeRoutes(): Promise<string[]> {
  const world = makeWorld();
  const A = { x: 36, y: 22 }, B = { x: 54, y: 22 };
  // ---- by land, round the bay ---------------------------------------------------------
  const road = findRoute(world, A, B, false, 18 * 1.8, 24)!;
  assert(road && road.length > 2, 'A way round the bay');
  const wet = road.filter((p) => isOpenSea(world, ((Math.floor(p.y)) * W) + ((Math.floor(p.x) % W) + W) % W));
  assert(wet.length === 0, `The road crosses the bay at ${JSON.stringify(wet.slice(0, 3))}`);
  assert(road.some((p) => p.y >= 29), 'It goes round the head of the bay');
  const roadLen = routeLength(road);
  assert(roadLen > 18 && roadLen < 18 * 1.8, `Round the bay: ${roadLen.toFixed(1)} cells against 18 straight`);
  assert(!findRoute(world, A, B, false, 20, 24), 'Not within a straight line and a bit');
  // ---- along the river ---------------------------------------------------------------
  const valley = findRoute(world, { x: 5, y: 43 }, { x: 40, y: 43 }, false, 80, 10)!;
  const onRiver = valley.filter((p) => world.flow![Math.floor(p.y) * W + Math.floor(p.x)] > 0.45).length;
  assert(onRiver > valley.length * 0.6, `The road follows the river valley: ${onRiver} of ${valley.length} cells`);
  // ---- by sea ----------------------------------------------------------------------------
  const port1 = { x: 44, y: 3 }, port2 = { x: 46, y: 26 };
  const lane = findRoute(world, port1, port2, true, 60, 10)!;
  assert(lane && lane.slice(1, -1).every((p) => isOpenSea(world, Math.floor(p.y) * W + Math.floor(p.x))), 'Ships keep to the water');
  const simple = simplifyRoute(road);
  assert(simple.length >= 3 && simple.length < road.length, `Simplified for drawing: ${simple.length} of ${road.length} points`);
  const drawn = shipmentPath(world, A, B, false);
  assert(drawn[0].x === A.x && drawn[0].y === A.y && drawn[drawn.length - 1].x === B.x && drawn[drawn.length - 1].y === B.y && drawn.length >= 3, `The drawn way ends on the towns: ${JSON.stringify(drawn)}`);
  // ---- the economy uses the way round --------------------------------------------------
  const input = { world, seed: 'routes', places: [place(0, 'Westbay', A.x, A.y, 'town', 2500), place(1, 'Sandholt', B.x, B.y, 'town', 2500)] };
  const run = simulateEconomy(input, 12);
  const carted = run.flatMap((s) => s.movements).filter((m) => m.good === 'grain' && m.from === 0 && m.to === 1 && !m.bySea);
  assert(carted.length > 0, 'Grain goes round the bay by road to the desert town');
  // ---- the lens draws the way, not the ruler line ---------------------------------------
  const k = 8;
  const canvas = new OffscreenCanvas(W * k, H * k);
  const ctx = canvas.getContext('2d')!;
  const layer: TradeLayer = { sites: [], movements: [{ fromX: A.x, fromY: A.y, toX: B.x, toY: B.y, bySea: false, path: drawn }] };
  drawTradeLayer(ctx, layer, 0, (wy) => wy * k, k, W);
  const ink = (x: number, y: number) => { const d = ctx.getImageData(Math.round((x + 0.5) * k) - 3, Math.round((y + 0.5) * k) - 3, 7, 7).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; };
  assert(ink(45, 22) === 0, 'Nothing drawn across the bay');
  const head = drawn.reduce((best, p) => (p.y > best.y ? p : best), drawn[0]);
  assert(ink(head.x, head.y) > 0, `The line goes round the head of the bay at ${head.x},${head.y}`);
  // ---- on a curved projection -------------------------------------------------------------
  const mollweide = PROJECTIONS.mollweide;
  const size = mollweide.outputSize(W * k);
  const curved = new OffscreenCanvas(size.w, size.h);
  const cctx = curved.getContext('2d')!;
  const far: TradeLayer = { sites: [{ x: 10, y: 10, kind: 'farm', manual: false }], movements: [{ fromX: 10, fromY: 10, toX: 80, toY: 12, bySea: true }] };
  drawTradeLayerProjected(cctx, far, (wx, wy) => { const [X, Y] = mollweide.forward(wx / W, wy / H); return [X * size.w, Y * size.h]; }, k, W);
  const cd = cctx.getImageData(0, 0, size.w, size.h).data;
  let blue = 0; for (let i = 0; i < cd.length; i += 4) if (cd[i + 3] > 40 && cd[i + 2] > cd[i] + 40) blue++;
  // The short way from x 10 to 80 runs west over the seam: the run splits there, so both ends are drawn and nothing crosses the whole map.
  const mid = cctx.getImageData(Math.round(size.w * 0.45), 0, Math.round(size.w * 0.1), size.h).data;
  let middle = 0; for (let i = 3; i < mid.length; i += 4) if (mid[i] > 40) middle++;
  assert(blue > 40 && middle === 0, `Curved projection: ${blue} blue pixels, ${middle} across the middle`);
  return [
    `By land round a bay: the way (${roadLen.toFixed(1)} cells against 18 straight) never touches the water and rounds its head; a river valley is the cheaper going (${onRiver} of ${valley.length} cells on the river); ships keep to the water`,
    'The economy carts grain round the bay to a desert town it could not reach in a straight line; the lens draws the way round, not a line across the water',
    'On a curved projection (Mollweide) the lens goes through the projection: a sea lane over the seam splits there instead of crossing the whole map',
  ];
}
