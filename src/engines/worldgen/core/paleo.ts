// ============================================
// World Generator — Physical time depth
// ============================================
// Geography, not history. The world already computes ice thickness at the
// glacial maximum; sea level is the other half of the same fact, because the
// water in an ice sheet comes out of the ocean and goes back into it. Move the
// two together and the map shows the same planet at a different moment: land
// bridges open, continental shelves come up as plains, the ice comes down to the
// mid-latitudes, and half the coastline the reader has been writing about turns
// out to be twenty thousand years old.
//
// Nothing here invents history — no peoples, no migrations, no dates beyond the
// physical ones. It answers exactly one question: what was the SHAPE of this
// place when the sea was lower.

import { Biome, type WorldData } from './types';

export interface PaleoState {
  /**
   * Sea level relative to today, in metres. Negative is a glacial low stand;
   * Earth's last was about −125 m. Positive is an ice-free hothouse: about
   * +70 m if everything melts.
   */
  seaLevelM: number;
  /** 0 = today's ice, 1 = the full glacial maximum the world computed. */
  ice: number;
}

export const TODAY: PaleoState = { seaLevelM: 0, ice: 0 };

/**
 * Earth's own curve, and it is not a matter of taste: sea level and ice volume
 * are the same water. A world at its glacial maximum has ~125 m less ocean, and
 * one with no ice at all has ~70 m more.
 */
export function seaLevelForIce(iceFraction: number): number {
  return iceFraction >= 0
    ? -125 * iceFraction
    : 70 * -iceFraction;
}

export interface PaleoMap {
  state: PaleoState;
  /** 1 where there is land at this sea level. */
  land: Uint8Array;
  /** 1 where today's sea floor is exposed — the shelf, and the good bit. */
  exposed: Uint8Array;
  /** 1 where today's land is drowned. */
  drowned: Uint8Array;
  /** 0–1 ice cover at this state. */
  ice: Float32Array;
  /** Land area as a fraction of the surface, then and now. */
  landFractionThen: number;
  landFractionNow: number;
  /** Land bridges: pairs of today's separate landmasses joined at this level. */
  bridges: { x: number; y: number; a: number; b: number; name?: string }[];
}

/**
 * Recompute the shape of the world at a different sea level and ice volume.
 *
 * Cheap on purpose — two passes over the grid and one connected-component
 * labelling — because this is meant to sit under a slider and answer while the
 * reader is still dragging it.
 */
export function paleoMap(world: WorldData, state: PaleoState): PaleoMap {
  const W = world.width, H = world.height, N = W * H;
  const level = state.seaLevelM / 1000;
  const land = new Uint8Array(N);
  const exposed = new Uint8Array(N);
  const drowned = new Uint8Array(N);
  const ice = new Float32Array(N);

  let thenCount = 0, nowCount = 0;
  for (let i = 0; i < N; i++) {
    const e = world.elevation[i];
    const isLandNow = e > 0;
    const isLandThen = e > level;
    if (isLandNow) nowCount++;
    if (isLandThen) { land[i] = 1; thenCount++; }
    if (isLandThen && !isLandNow) exposed[i] = 1;
    if (!isLandThen && isLandNow) drowned[i] = 1;

    // Ice grows from the world's own glacial-maximum field, and it only sits on
    // ground: a shelf that has just come up out of the sea gets buried too,
    // which is exactly what happened to the Barents Sea.
    if (state.ice > 0 && land[i]) {
      const glacial = world.ice[i];
      const today = world.biome[i] === Biome.IceCap || world.biome[i] === Biome.Glacier ? 1 : 0;
      ice[i] = Math.min(1, today + (glacial - today * glacial) * state.ice);
    } else if (land[i]) {
      ice[i] = world.biome[i] === Biome.IceCap || world.biome[i] === Biome.Glacier ? 1 : 0;
    }
  }

  return {
    state,
    land, exposed, drowned, ice,
    landFractionThen: thenCount / N,
    landFractionNow: nowCount / N,
    bridges: findLandBridges(world, land),
  };
}

/**
 * Where the falling sea joined two landmasses that are separate today.
 *
 * This is the payoff of the whole module. A land bridge is not a curiosity: it
 * is the reason two peoples share a language, the reason an animal is on the
 * wrong continent, and — for a novel — the reason there is an old road that goes
 * into the sea. Finding them is a matter of labelling today's landmasses,
 * labelling the ancient ones, and reporting any ancient mass that contains more
 * than one modern one.
 */
function findLandBridges(
  world: WorldData, landThen: Uint8Array,
): { x: number; y: number; a: number; b: number; name?: string }[] {
  const W = world.width, H = world.height, N = W * H;
  const now = labelMasses(W, H, (i) => world.elevation[i] > 0);
  const then = labelMasses(W, H, (i) => landThen[i] === 1);

  // Which modern masses each ancient mass swallowed.
  const members = new Map<number, Set<number>>();
  for (let i = 0; i < N; i++) {
    if (then.label[i] < 0 || now.label[i] < 0) continue;
    if (now.sizes[now.label[i]] < 60) continue;   // skerries are not continents
    let set = members.get(then.label[i]);
    if (!set) members.set(then.label[i], (set = new Set()));
    set.add(now.label[i]);
  }

  const out: { x: number; y: number; a: number; b: number; name?: string }[] = [];
  for (const [, set] of members) {
    if (set.size < 2) continue;
    // The bridge itself is exposed ground with two different modern masses
    // within sight of it — that is the narrowest useful definition and it lands
    // the marker on the isthmus rather than in the middle of the new plain.
    for (let i = 0; i < N; i++) {
      if (landThen[i] !== 1 || world.elevation[i] > 0) continue;
      const x = i % W, y = (i / W) | 0;
      const seen = new Set<number>();
      for (let dy = -3; dy <= 3; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -3; dx <= 3; dx++) {
          const nx = ((x + dx) % W + W) % W;
          const l = now.label[ny * W + nx];
          if (l >= 0 && now.sizes[l] >= 60 && set.has(l)) seen.add(l);
        }
      }
      if (seen.size >= 2) {
        const [a, b] = [...seen];
        // One marker per bridge, not one per cell of it.
        if (!out.some((o) => Math.hypot(o.x - x, o.y - y) < 14
          && ((o.a === a && o.b === b) || (o.a === b && o.b === a)))) {
          out.push({ x, y, a, b });
        }
      }
    }
  }
  return out;
}

function labelMasses(
  W: number, H: number, isLand: (i: number) => boolean,
): { label: Int32Array; sizes: number[] } {
  const N = W * H;
  const label = new Int32Array(N).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (label[s] >= 0 || !isLand(s)) continue;
    const id = sizes.length;
    let sp = 0, count = 0;
    stack[sp++] = s;
    label[s] = id;
    while (sp > 0) {
      const i = stack[--sp];
      count++;
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = ((x + dx) % W + W) % W;
          const j = ny * W + nx;
          if (label[j] >= 0 || !isLand(j)) continue;
          label[j] = id;
          stack[sp++] = j;
        }
      }
    }
    sizes.push(count);
  }
  return { label, sizes };
}

/**
 * Name each bridge after the two shores it joins.
 *
 * "Puente de tierra entre Hruegrueram y Skiislue" is a thing a reader can write
 * a chapter around; an unlabelled red circle is a curiosity. Uses whatever the
 * world already calls those landmasses rather than coining anything new, because
 * the bridge is not a new place — it is a temporary fact about two old ones.
 */
export function nameBridges(
  world: WorldData,
  features: { kind: string; name: string; x: number; y: number; extent: number }[],
  p: PaleoMap,
): void {
  const W = world.width;
  const land = features.filter((f) => f.kind === 'continent' || f.kind === 'isle' || f.kind === 'plain');
  if (!land.length) return;
  const nearestName = (x: number, y: number, exclude?: string): string | undefined => {
    let best: string | undefined; let bd = Infinity;
    for (const f of land) {
      if (f.name === exclude) continue;
      let dx = Math.abs(f.x - x);
      if (dx > W / 2) dx = W - dx;
      const d = Math.hypot(dx, f.y - y);
      if (d < bd) { bd = d; best = f.name; }
    }
    return best;
  };
  for (const b of p.bridges) {
    // Look a little way to each side along the bridge for the two shores.
    const a1 = nearestName(b.x, b.y);
    const a2 = nearestName(b.x, b.y, a1);
    b.name = a1 && a2 ? `${a1} — ${a2}` : a1;
  }
}

/** A sentence a reader can put in a note. */
export function describePaleo(world: WorldData, p: PaleoMap, locale: 'es' | 'en' = 'es'): string {
  const delta = (p.landFractionThen - p.landFractionNow) / Math.max(1e-6, p.landFractionNow);
  const surfaceKm2 = 4 * Math.PI * 6371 * 6371;
  const gainedKm2 = (p.landFractionThen - p.landFractionNow) * surfaceKm2;
  if (locale === 'en') {
    const bits = p.state.seaLevelM < -2
      ? [`With sea level ${Math.abs(Math.round(p.state.seaLevelM))} m lower, ${Math.round(gainedKm2 / 1000) * 1000} km² of continental shelf emerges (${Math.round(delta * 100)}% more land).`]
      : p.state.seaLevelM > 2
        ? [`With sea level ${Math.round(p.state.seaLevelM)} m higher, ${Math.round(-gainedKm2 / 1000) * 1000} km² of coast is submerged.`]
        : ['Sea level is the same as today.'];
    if (p.bridges.length) bits.push(p.bridges.length === 1 ? 'One land bridge joins two currently separate landmasses.' : `${p.bridges.length} land bridges join currently separate landmasses.`);
    if (p.state.ice > 0.05) {
      let iced = 0, landCells = 0;
      for (let i = 0; i < p.ice.length; i++) if (p.land[i]) { landCells++; if (p.ice[i] > 0.35) iced++; }
      bits.push(`Ice covers ${Math.round(iced / Math.max(1, landCells) * 100)}% of the land.`);
    }
    return bits.join(' ');
  }
  const bits: string[] = [];
  if (p.state.seaLevelM < -2) {
    bits.push(`Con el mar ${Math.abs(Math.round(p.state.seaLevelM))} m más bajo emergen `
      + `${Math.round(gainedKm2 / 1000) * 1000} km² de plataforma continental `
      + `(un ${Math.round(delta * 100)} % más de tierra firme).`);
  } else if (p.state.seaLevelM > 2) {
    bits.push(`Con el mar ${Math.round(p.state.seaLevelM)} m más alto se anegan `
      + `${Math.round(-gainedKm2 / 1000) * 1000} km² de costa.`);
  } else {
    bits.push('El mar está donde está hoy.');
  }
  if (p.bridges.length) {
    bits.push(p.bridges.length === 1
      ? 'Se abre un puente de tierra entre dos masas hoy separadas.'
      : `Se abren ${p.bridges.length} puentes de tierra entre masas hoy separadas.`);
  }
  if (p.state.ice > 0.05) {
    let iced = 0, landCells = 0;
    for (let i = 0; i < p.ice.length; i++) {
      if (p.land[i]) { landCells++; if (p.ice[i] > 0.35) iced++; }
    }
    bits.push(`El hielo cubre el ${Math.round((iced / Math.max(1, landCells)) * 100)} % de la tierra.`);
  }
  void world;
  return bits.join(' ');
}
