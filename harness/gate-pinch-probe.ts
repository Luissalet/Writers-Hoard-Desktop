// ============================================================================
// SONDA: el cuello de botella exacto de cada puerta ciega
// ============================================================================
// La sonda anterior demostró que TODA puerta tiene su avenida (d=0,00 en las
// quince). Así que el fallo es de obra: algo estrecha el paso por debajo del
// ancho de carro DESPUÉS de trazar la avenida. Aquí: malla idéntica a la del
// banco (misma celda, mismo chamfer, mismo dominio), y un Dijkstra de camino
// más ancho (max-min holgura) del mercado a cada puerta ciega. El vértice de
// holgura mínima del camino ganador ES el cuello: se imprime dónde está, qué
// barrio pisa y qué edificios lo forman. Lección #29: el dominio y la LISTA de
// bolsas, no el porcentaje.
import { generateCity, DEFAULT_CITY, type CityParams, type CityPlan, type WardType } from '../src/engines/worldgen/city/generate';

type V = { x: number; y: number };
type Poly = V[];
const dist = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);
const centroid = (p: Poly): V => {
  let x = 0, y = 0;
  for (const v of p) { x += v.x; y += v.y; }
  return { x: x / p.length, y: y / p.length };
};

// ---- malla replicada del banco (misma resolución y chamfer) ---------------
interface Malla {
  x0: number; y0: number; cell: number; w: number; h: number;
  bloq: Uint8Array; agua: Uint8Array; dentro: Uint8Array; holgura: Float32Array;
}
const celdaDe = (m: Malla, v: V) => {
  const i = Math.floor((v.x - m.x0) / m.cell), j = Math.floor((v.y - m.y0) / m.cell);
  return i < 0 || j < 0 || i >= m.w || j >= m.h ? -1 : j * m.w + i;
};
function pintaPoligono(m: Malla, buf: Uint8Array, poly: Poly, valor = 1): void {
  if (poly.length < 3) return;
  let ya = Infinity, yb = -Infinity;
  for (const v of poly) { ya = Math.min(ya, v.y); yb = Math.max(yb, v.y); }
  const j0 = Math.max(0, Math.floor((ya - m.y0) / m.cell));
  const j1 = Math.min(m.h - 1, Math.ceil((yb - m.y0) / m.cell));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const yc = m.y0 + (j + 0.5) * m.cell;
    xs.length = 0;
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      if ((a.y <= yc) === (b.y <= yc)) continue;
      xs.push(a.x + ((yc - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - m.x0) / m.cell - 0.5));
      const i1 = Math.min(m.w - 1, Math.floor((xs[k + 1] - m.x0) / m.cell - 0.5));
      for (let i = i0; i <= i1; i++) buf[j * m.w + i] = valor;
    }
  }
}
function pintaLinea(m: Malla, buf: Uint8Array, pts: V[], r: number, valor = 1): void {
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1];
    const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - r - m.x0) / m.cell));
    const i1 = Math.min(m.w - 1, Math.ceil((Math.max(a.x, b.x) + r - m.x0) / m.cell));
    const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - r - m.y0) / m.cell));
    const j1 = Math.min(m.h - 1, Math.ceil((Math.max(a.y, b.y) + r - m.y0) / m.cell));
    const dx = b.x - a.x, dy = b.y - a.y;
    const ll = dx * dx + dy * dy || 1e-9;
    for (let j = j0; j <= j1; j++) {
      const yc = m.y0 + (j + 0.5) * m.cell;
      for (let i = i0; i <= i1; i++) {
        const xc = m.x0 + (i + 0.5) * m.cell;
        let t = ((xc - a.x) * dx + (yc - a.y) * dy) / ll;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = xc - (a.x + dx * t), ey = yc - (a.y + dy * t);
        if (ex * ex + ey * ey <= r * r) buf[j * m.w + i] = valor;
      }
    }
  }
}
function pintaDisco(m: Malla, buf: Uint8Array, c: V, r: number, valor = 1): void {
  const i0 = Math.max(0, Math.floor((c.x - r - m.x0) / m.cell));
  const i1 = Math.min(m.w - 1, Math.ceil((c.x + r - m.x0) / m.cell));
  const j0 = Math.max(0, Math.floor((c.y - r - m.y0) / m.cell));
  const j1 = Math.min(m.h - 1, Math.ceil((c.y + r - m.y0) / m.cell));
  for (let j = j0; j <= j1; j++) {
    const yc = m.y0 + (j + 0.5) * m.cell;
    for (let i = i0; i <= i1; i++) {
      const xc = m.x0 + (i + 0.5) * m.cell;
      if ((xc - c.x) ** 2 + (yc - c.y) ** 2 <= r * r) buf[j * m.w + i] = valor;
    }
  }
}
const anchoRio = (plan: CityPlan) => plan.waters?.river?.width ?? plan.radius * 0.09;
function construyeMalla(plan: CityPlan): Malla {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const mete = (v: V) => { x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); };
  for (const q of plan.patches) if (q.withinCity) for (const v of q.shape) mete(v);
  for (const g of plan.gates) mete(g);
  for (const r of plan.roads) mete(r[Math.min(2, r.length - 1)]);
  if (!Number.isFinite(x0)) { x0 = plan.center.x - plan.radius; y0 = plan.center.y - plan.radius; x1 = -x0; y1 = -y0; }
  const pad = 8;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const extent = Math.max(x1 - x0, y1 - y0);
  const cell = Math.max(0.3, extent / 2000);
  const w = Math.max(4, Math.ceil((x1 - x0) / cell));
  const h = Math.max(4, Math.ceil((y1 - y0) / cell));
  const m: Malla = { x0, y0, cell, w, h, bloq: new Uint8Array(w * h), agua: new Uint8Array(w * h), dentro: new Uint8Array(w * h), holgura: new Float32Array(w * h) };
  for (const q of plan.patches) if (q.withinCity) pintaPoligono(m, m.dentro, q.shape);
  for (const g of plan.gates) pintaDisco(m, m.dentro, g, 3.0);
  for (const q of plan.patches) for (const b of q.buildings) pintaPoligono(m, m.bloq, b.shape);
  const rio = anchoRio(plan);
  if (plan.coast) {
    const c = plan.coast;
    for (let j = 0; j < h; j++) {
      const yc = y0 + (j + 0.5) * cell;
      for (let i = 0; i < w; i++) {
        const xc = x0 + (i + 0.5) * cell;
        if ((xc - c.p.x) * c.n.x + (yc - c.p.y) * c.n.y > 0) m.agua[j * w + i] = 1;
      }
    }
  }
  if (plan.river) pintaLinea(m, m.agua, plan.river, rio * 0.8);
  for (const b of plan.bridges) pintaPoligono(m, m.agua, b, 0);
  for (const p of plan.piers) pintaPoligono(m, m.agua, p, 0);
  for (let k = 0; k < m.agua.length; k++) if (m.agua[k]) m.bloq[k] = 1;
  for (const b of plan.bridges) { pintaPoligono(m, m.bloq, b, 0); pintaPoligono(m, m.dentro, b, 1); }
  const D = m.holgura, BIG = 1e6;
  for (let k = 0; k < D.length; k++) D[k] = m.bloq[k] ? 0 : BIG;
  const d1 = 0.9619, d2 = 1.3604;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (D[k] === 0) continue;
    let v = D[k];
    if (i > 0) v = Math.min(v, D[k - 1] + d1);
    if (j > 0) v = Math.min(v, D[k - w] + d1);
    if (i > 0 && j > 0) v = Math.min(v, D[k - w - 1] + d2);
    if (i < w - 1 && j > 0) v = Math.min(v, D[k - w + 1] + d2);
    D[k] = v;
  }
  for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
    const k = j * w + i;
    if (D[k] === 0) continue;
    let v = D[k];
    if (i < w - 1) v = Math.min(v, D[k + 1] + d1);
    if (j < h - 1) v = Math.min(v, D[k + w] + d1);
    if (i < w - 1 && j < h - 1) v = Math.min(v, D[k + w + 1] + d2);
    if (i > 0 && j < h - 1) v = Math.min(v, D[k + w - 1] + d2);
    D[k] = v;
  }
  for (let k = 0; k < D.length; k++) D[k] = Math.min(D[k], BIG) * cell;
  return m;
}

/** Camino más ancho (max-min holgura) por las 8 direcciones sobre el dominio. */
function caminoMasAncho(m: Malla, desde: V, hasta: V): { cuello: number; donde: V } | null {
  const n = m.w * m.h;
  const best = new Float32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const s = celdaDe(m, desde), t0 = celdaDe(m, hasta);
  if (s < 0 || t0 < 0) return null;
  // objetivo: la celda libre más cercana a la puerta (la puerta pisa muralla)
  let t = -1;
  {
    let bd = Infinity;
    const rad = Math.ceil(4 / m.cell);
    const ti = t0 % m.w, tj = (t0 / m.w) | 0;
    for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
      const i = ti + di, j = tj + dj;
      if (i < 0 || j < 0 || i >= m.w || j >= m.h) continue;
      const k = j * m.w + i;
      if (!m.dentro[k] || m.bloq[k] || m.holgura[k] < 0.25) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; t = k; }
    }
  }
  if (t < 0) return null;
  // Dijkstra max-min con cola por cubos de holgura (holguras < ~8u, 0.05 de paso)
  const buckets: number[][] = Array.from({ length: 400 }, () => []);
  const bOf = (h: number) => Math.max(0, Math.min(399, Math.floor(h * 20)));
  let sSeed = s;
  if (!m.dentro[s] || m.bloq[s]) {
    // el centroide del mercado puede caer en un puesto: busca libre cerca
    let bd = Infinity; const rad = Math.ceil(4 / m.cell);
    const si = s % m.w, sj = (s / m.w) | 0;
    for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
      const i = si + di, j = sj + dj;
      if (i < 0 || j < 0 || i >= m.w || j >= m.h) continue;
      const k = j * m.w + i;
      if (!m.dentro[k] || m.bloq[k]) continue;
      const d = di * di + dj * dj;
      if (d < bd) { bd = d; sSeed = k; }
    }
  }
  best[sSeed] = m.holgura[sSeed];
  buckets[bOf(best[sSeed])].push(sSeed);
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  for (let b = 399; b >= 0; b--) {
    const q = buckets[b];
    while (q.length) {
      const k = q.pop()!;
      if (bOf(best[k]) !== b) continue; // entrada rancia
      if (k === t) break;
      const i = k % m.w, j = (k / m.w) | 0;
      for (let d = 0; d < 8; d++) {
        const ni = i + DI[d], nj = j + DJ[d];
        if (ni < 0 || nj < 0 || ni >= m.w || nj >= m.h) continue;
        const nk = nj * m.w + ni;
        if (!m.dentro[nk] || m.bloq[nk]) continue;
        const cand = Math.min(best[k], m.holgura[nk]);
        if (cand > best[nk]) { best[nk] = cand; prev[nk] = k; buckets[bOf(cand)].push(nk); }
      }
    }
  }
  if (best[t] < 0) return null;
  // el cuello: la celda de holgura mínima del camino
  let cuello = Infinity, donde: V = { x: 0, y: 0 };
  for (let k = t; k >= 0; k = prev[k]) {
    if (m.holgura[k] < cuello) {
      cuello = m.holgura[k];
      donde = { x: m.x0 + ((k % m.w) + 0.5) * m.cell, y: m.y0 + (((k / m.w) | 0) + 0.5) * m.cell };
    }
    if (k === sSeed) break;
  }
  return { cuello, donde };
}

const SEMILLA = 'calidad';
const CIEGAS: [string, Partial<CityParams>, number, number][] = [
  ['interior', {}, 40, 1],
  ['río', { river: true, riverDir: { x: 1, y: 0.25 } }, 40, 1],
  ['costa', { coast: true, coastDir: { x: 0, y: 1 } }, 40, 2],
];
for (const [gtag, g, size, gi] of CIEGAS) {
  const plan = generateCity({
    ...DEFAULT_CITY, seed: `${SEMILLA}-${gtag}-${size}`, size,
    walls: true, citadel: true, farms: true, river: false, coast: false, ...g,
  });
  const m = construyeMalla(plan);
  const market = plan.patches.find((q) => q.ward === 'market');
  const desde = market ? centroid(market.shape) : plan.center;
  const res = caminoMasAncho(m, desde, plan.gates[gi]);
  if (!res) { console.log(`${gtag} ${size}#${gi}: SIN CAMINO NI A PIE (dominio partido)`); continue; }
  console.log(`\n${gtag} ${size} puerta #${gi} en (${plan.gates[gi].x.toFixed(1)},${plan.gates[gi].y.toFixed(1)})`);
  console.log(`  cuello del mejor camino: ${res.cuello.toFixed(2)} u de holgura (carro pide 0.25+) en (${res.donde.x.toFixed(1)},${res.donde.y.toFixed(1)})`);
  // qué hay alrededor del cuello
  const cerca: string[] = [];
  for (const q of plan.patches) {
    for (let bi = 0; bi < q.buildings.length; bi++) {
      const c = centroid(q.buildings[bi].shape);
      const d = dist(c, res.donde);
      if (d < 4) cerca.push(`${q.ward}[${bi}] ${q.buildings[bi].kind} a ${d.toFixed(1)} u`);
    }
  }
  const dAve = Math.min(...plan.mainStreets.flatMap((st) => st.map((v) => dist(v, res.donde))));
  const dGate = dist(plan.gates[gi], res.donde);
  console.log(`  a ${dAve.toFixed(1)} u de la avenida más cercana · a ${dGate.toFixed(1)} u de la puerta`);
  console.log(`  edificios a <4 u del cuello: ${cerca.length ? cerca.join(' · ') : 'ninguno'}`);
}

// CONTROL (lección #29): una puerta que el banco SÍ alcanza tiene que dar
// camino aquí, o la sonda mide otra cosa.
{
  const plan = generateCity({
    ...DEFAULT_CITY, seed: `${SEMILLA}-interior-40`, size: 40,
    walls: true, citadel: true, farms: true, river: false, coast: false,
  });
  const m = construyeMalla(plan);
  const market = plan.patches.find((q) => q.ward === 'market');
  const desde = market ? centroid(market.shape) : plan.center;
  for (const gi of [0, 2, 3, 4]) {
    const res = caminoMasAncho(m, desde, plan.gates[gi]);
    console.log(`control interior 40 puerta #${gi}: ${res ? `cuello ${res.cuello.toFixed(2)} u` : 'SIN CAMINO'}`);
  }
}

// El TABIQUE: inunda a pie desde el mercado y desde la puerta, y busca el par
// de celdas (una de cada lado) más próximo. Ahí está lo que sella, sea lo que sea.
function inundaPie(m: Malla, semilla: number): Uint8Array {
  const vis = new Uint8Array(m.w * m.h);
  const cola = new Int32Array(m.w * m.h);
  let cab = 0, fin = 0;
  if (semilla >= 0 && m.dentro[semilla] && !m.bloq[semilla]) { vis[semilla] = 1; cola[fin++] = semilla; }
  while (cab < fin) {
    const k = cola[cab++];
    const i = k % m.w, j = (k / m.w) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= m.w || nj >= m.h) continue;
      const nk = nj * m.w + ni;
      if (vis[nk] || !m.dentro[nk] || m.bloq[nk]) continue;
      vis[nk] = 1; cola[fin++] = nk;
    }
  }
  return vis;
}
function libreCerca(m: Malla, v: V, rad: number): number {
  const c = celdaDe(m, v);
  if (c < 0) return -1;
  const ci = c % m.w, cj = (c / m.w) | 0;
  let best = -1, bd = Infinity;
  const R = Math.ceil(rad / m.cell);
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
    const i = ci + di, j = cj + dj;
    if (i < 0 || j < 0 || i >= m.w || j >= m.h) continue;
    const k = j * m.w + i;
    if (!m.dentro[k] || m.bloq[k]) continue;
    const d = di * di + dj * dj;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
for (const [gtag, g, size, gi] of CIEGAS) {
  const plan = generateCity({
    ...DEFAULT_CITY, seed: `${SEMILLA}-${gtag}-${size}`, size,
    walls: true, citadel: true, farms: true, river: false, coast: false, ...g,
  });
  const m = construyeMalla(plan);
  const market = plan.patches.find((q) => q.ward === 'market');
  const desde = market ? centroid(market.shape) : plan.center;
  const A = inundaPie(m, libreCerca(m, desde, 5));
  const B = inundaPie(m, libreCerca(m, plan.gates[gi], 4));
  let nA = 0, nB = 0; for (let k = 0; k < A.length; k++) { nA += A[k]; nB += B[k]; }
  // par más próximo (muestreado cada 2 celdas para no pagar n²)
  let bd = Infinity, pa: V | null = null, pb: V | null = null;
  const cellsA: V[] = [], cellsB: V[] = [];
  for (let k = 0; k < A.length; k += 1) {
    if (A[k]) cellsA.push({ x: m.x0 + ((k % m.w) + 0.5) * m.cell, y: m.y0 + (((k / m.w) | 0) + 0.5) * m.cell });
    if (B[k]) cellsB.push({ x: m.x0 + ((k % m.w) + 0.5) * m.cell, y: m.y0 + (((k / m.w) | 0) + 0.5) * m.cell });
  }
  const paso = Math.max(1, Math.floor(cellsA.length / 4000));
  for (let a = 0; a < cellsA.length; a += paso) {
    for (let b = 0; b < cellsB.length; b += 1) {
      const d = (cellsA[a].x - cellsB[b].x) ** 2 + (cellsA[a].y - cellsB[b].y) ** 2;
      if (d < bd) { bd = d; pa = cellsA[a]; pb = cellsB[b]; }
    }
  }
  console.log(`\n${gtag} ${size}#${gi}: isla del mercado ${nA} celdas · isla de la puerta ${nB} celdas`);
  if (pa && pb) {
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    console.log(`  tabique de ${Math.sqrt(bd).toFixed(1)} u en (${mid.x.toFixed(1)},${mid.y.toFixed(1)})`);
    const dentroK = celdaDe(m, mid);
    console.log(`  en el tabique: dentro=${dentroK >= 0 ? m.dentro[dentroK] : '?'} bloq=${dentroK >= 0 ? m.bloq[dentroK] : '?'} agua=${dentroK >= 0 ? m.agua[dentroK] : '?'}`);
    const cerca: string[] = [];
    for (const q of plan.patches) {
      for (let bi = 0; bi < q.buildings.length; bi++) {
        const c0 = centroid(q.buildings[bi].shape);
        if (dist(c0, mid) < 5) cerca.push(`${q.ward} ${q.buildings[bi].kind} a ${dist(c0, mid).toFixed(1)}u`);
      }
      if (q.withinCity && q.shape.length >= 3 && dist(centroid(q.shape), mid) < 14) cerca.push(`[distrito ${q.ward}]`);
    }
    console.log(`  alrededor: ${cerca.slice(0, 10).join(' · ') || 'nada'}`);
  }
}

// ¿Qué distrito debería pisar el tabique, y por qué no está en el dominio?
for (const [gtag, g, size, gi] of CIEGAS) {
  const plan = generateCity({
    ...DEFAULT_CITY, seed: `${SEMILLA}-${gtag}-${size}`, size,
    walls: true, citadel: true, farms: true, river: false, coast: false, ...g,
  });
  const g0 = plan.gates[gi];
  console.log(`\n${gtag} ${size}#${gi} — parcelas a <12 u de la puerta (${g0.x.toFixed(1)},${g0.y.toFixed(1)}):`);
  for (const q of plan.patches) {
    if (!q.shape.length) continue;
    const d = Math.min(...q.shape.map((v) => dist(v, g0)));
    if (d > 12) continue;
    console.log(`  ${q.ward} withinCity=${q.withinCity} vértices=${q.shape.length} edificios=${q.buildings.length} · d(min)=${d.toFixed(1)}u`);
  }
}

// CENSO DE BOLSAS (para la fachada): celdas de suelo urbano que la inundación
// a pie desde las puertas NO alcanza, agrupadas en componentes. La lista de
// bolsas dice qué está sellado y de qué barrio es (lección #29).
const GEOS: [string, Partial<CityParams>][] = [
  ['interior', {}],
  ['río', { river: true, riverDir: { x: 1, y: 0.25 } }],
  ['costa', { coast: true, coastDir: { x: 0, y: 1 } }],
  ['río+costa', { river: true, riverDir: { x: 0.25, y: 1 }, coast: true, coastDir: { x: 0, y: 1 } }],
];
let totCeldas = 0, totBolsa = 0;
const bolsasPorBarrio = new Map<string, number>();
for (const [gtag, g] of GEOS) {
  for (const size of [8, 20, 40]) {
    const plan = generateCity({
      ...DEFAULT_CITY, seed: `${SEMILLA}-${gtag}-${size}`, size,
      walls: true, citadel: true, farms: true, river: false, coast: false, ...g,
    });
    const m = construyeMalla(plan);
    // inundación a pie desde TODAS las puertas (como el banco)
    const vis = new Uint8Array(m.w * m.h);
    const cola: number[] = [];
    for (const g0 of plan.gates) {
      const k = libreCerca(m, g0, 5);
      if (k >= 0 && !vis[k]) { vis[k] = 1; cola.push(k); }
    }
    while (cola.length) {
      const k = cola.pop()!;
      const i = k % m.w, j = (k / m.w) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= m.w || nj >= m.h) continue;
        const nk = nj * m.w + ni;
        if (vis[nk] || !m.dentro[nk] || m.bloq[nk]) continue;
        vis[nk] = 1; cola.push(nk);
      }
    }
    // componentes no alcanzadas
    const comp = new Int32Array(m.w * m.h).fill(-1);
    const tam: number[] = []; const donde: V[] = [];
    for (let k0 = 0; k0 < comp.length; k0++) {
      if (comp[k0] >= 0 || vis[k0] || !m.dentro[k0] || m.bloq[k0]) continue;
      const id = tam.length; tam.push(0); donde.push({ x: 0, y: 0 });
      const q2 = [k0]; comp[k0] = id;
      while (q2.length) {
        const k = q2.pop()!;
        tam[id]++;
        donde[id] = { x: m.x0 + ((k % m.w) + 0.5) * m.cell, y: m.y0 + (((k / m.w) | 0) + 0.5) * m.cell };
        const i = k % m.w, j = (k / m.w) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= m.w || nj >= m.h) continue;
          const nk = nj * m.w + ni;
          if (comp[nk] >= 0 || vis[nk] || !m.dentro[nk] || m.bloq[nk]) continue;
          comp[nk] = id; q2.push(nk);
        }
      }
    }
    let celdas = 0; for (let k = 0; k < m.dentro.length; k++) if (m.dentro[k] && !m.bloq[k]) celdas++;
    const bolsa = tam.reduce((a, b) => a + b, 0);
    totCeldas += celdas; totBolsa += bolsa;
    const top = tam.map((t, i) => ({ t, i })).sort((a, b) => b.t - a.t).slice(0, 4);
    const m2 = (n: number) => (n * m.cell * m.cell * 16).toFixed(0); // u²→m²: 1u=4m
    const wardAt = (v: V) => plan.patches.find((q) => q.withinCity && q.shape.length >= 3 && ((): boolean => {
      let dentro = false;
      for (let a = 0, b = q.shape.length - 1; a < q.shape.length; b = a++) {
        const pa = q.shape[a], pb = q.shape[b];
        if ((pa.y > v.y) !== (pb.y > v.y) && v.x < ((pb.x - pa.x) * (v.y - pa.y)) / (pb.y - pa.y) + pa.x) dentro = !dentro;
      }
      return dentro;
    })())?.ward ?? '¿?';
    for (const { t, i } of top) { if (t * m.cell * m.cell * 16 > 200) bolsasPorBarrio.set(wardAt(donde[i]), (bolsasPorBarrio.get(wardAt(donde[i])) ?? 0) + 1); }
    console.log(`${gtag} ${size}: ${tam.length} bolsas · ${(100 * bolsa / Math.max(1, celdas)).toFixed(1)} % del suelo sellado · mayores: ${top.map(({ t, i }) => `${m2(t)} m² (${wardAt(donde[i])})`).join(' · ')}`);
  }
}
console.log(`\nTOTAL: ${(100 * totBolsa / Math.max(1, totCeldas)).toFixed(1)} % del suelo urbano sellado`);
console.log('bolsas >200 m² por barrio:', [...bolsasPorBarrio.entries()].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`).join(' · '));

// LÁMINA de una bolsa concreta: río+costa 20 (bolsa craftsmen de 3 725 m²).
// Mirar la captura antes de teorizar (lección #31).
{
  const { createCanvas } = await import('@napi-rs/canvas');
  const plan = generateCity({
    ...DEFAULT_CITY, seed: `${SEMILLA}-río+costa-20`, size: 20,
    walls: true, citadel: true, farms: true,
    river: true, riverDir: { x: 0.25, y: 1 }, coast: true, coastDir: { x: 0, y: 1 },
  });
  const m = construyeMalla(plan);
  const vis = new Uint8Array(m.w * m.h);
  const cola: number[] = [];
  for (const g0 of plan.gates) { const k = libreCerca(m, g0, 5); if (k >= 0 && !vis[k]) { vis[k] = 1; cola.push(k); } }
  while (cola.length) {
    const k = cola.pop()!;
    const i = k % m.w, j = (k / m.w) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= m.w || nj >= m.h) continue;
      const nk = nj * m.w + ni;
      if (vis[nk] || !m.dentro[nk] || m.bloq[nk]) continue;
      vis[nk] = 1; cola.push(nk);
    }
  }
  const S = 3;
  const cv = createCanvas(m.w * S, m.h * S);
  const cx = cv.getContext('2d');
  cx.fillStyle = '#12131a'; cx.fillRect(0, 0, cv.width, cv.height);
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    const k = j * m.w + i;
    if (m.agua[k]) { cx.fillStyle = '#1c3550'; }
    else if (m.bloq[k]) { cx.fillStyle = '#6b5a44'; }
    else if (m.dentro[k] && vis[k]) { cx.fillStyle = '#2c2e33'; }
    else if (m.dentro[k]) { cx.fillStyle = '#c03434'; } // BOLSA: rojo
    else continue;
    cx.fillRect(i * S, j * S, S, S);
  }
  cx.fillStyle = '#ffd479';
  for (const g0 of plan.gates) {
    const i = Math.floor((g0.x - m.x0) / m.cell), j = Math.floor((g0.y - m.y0) / m.cell);
    cx.fillRect((i - 2) * S, (j - 2) * S, 5 * S, 5 * S);
  }
  const { writeFileSync } = await import('node:fs');
  writeFileSync('/tmp/bolsa-riocosta20.png', cv.toBuffer('image/png'));
  console.log('lámina: /tmp/bolsa-riocosta20.png');
}

// ZOOM a la bolsa norte: recorte a 8x alrededor de la mayor bolsa craftsmen.
{
  const { createCanvas } = await import('@napi-rs/canvas');
  const plan = generateCity({
    ...DEFAULT_CITY, seed: `${SEMILLA}-río+costa-20`, size: 20,
    walls: true, citadel: true, farms: true,
    river: true, riverDir: { x: 0.25, y: 1 }, coast: true, coastDir: { x: 0, y: 1 },
  });
  const m = construyeMalla(plan);
  const vis = new Uint8Array(m.w * m.h);
  const cola: number[] = [];
  for (const g0 of plan.gates) { const k = libreCerca(m, g0, 5); if (k >= 0 && !vis[k]) { vis[k] = 1; cola.push(k); } }
  while (cola.length) {
    const k = cola.pop()!;
    const i = k % m.w, j = (k / m.w) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= m.w || nj >= m.h) continue;
      const nk = nj * m.w + ni;
      if (vis[nk] || !m.dentro[nk] || m.bloq[nk]) continue;
      vis[nk] = 1; cola.push(nk);
    }
  }
  // mayor componente sellada
  const comp = new Int32Array(m.w * m.h).fill(-1);
  let mejor: number[] = [];
  for (let k0 = 0; k0 < comp.length; k0++) {
    if (comp[k0] >= 0 || vis[k0] || !m.dentro[k0] || m.bloq[k0]) continue;
    const cur: number[] = [k0]; comp[k0] = 1;
    const stack = [k0];
    while (stack.length) {
      const k = stack.pop()!;
      const i = k % m.w, j = (k / m.w) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= m.w || nj >= m.h) continue;
        const nk = nj * m.w + ni;
        if (comp[nk] >= 0 || vis[nk] || !m.dentro[nk] || m.bloq[nk]) continue;
        comp[nk] = 1; cur.push(nk); stack.push(nk);
      }
    }
    if (cur.length > mejor.length) mejor = cur;
  }
  let ci = 0, cj = 0;
  for (const k of mejor) { ci += k % m.w; cj += (k / m.w) | 0; }
  ci = Math.round(ci / mejor.length); cj = Math.round(cj / mejor.length);
  const R = 90, S = 8;
  const cv = createCanvas(2 * R * S, 2 * R * S);
  const cx = cv.getContext('2d');
  cx.fillStyle = '#0a0a10'; cx.fillRect(0, 0, cv.width, cv.height);
  const enMejor = new Set(mejor);
  for (let dj = -R; dj < R; dj++) for (let di = -R; di < R; di++) {
    const i = ci + di, j = cj + dj;
    if (i < 0 || j < 0 || i >= m.w || j >= m.h) continue;
    const k = j * m.w + i;
    if (m.agua[k]) cx.fillStyle = '#1c3550';
    else if (m.bloq[k]) cx.fillStyle = '#6b5a44';
    else if (enMejor.has(k)) cx.fillStyle = '#c03434';
    else if (m.dentro[k] && vis[k]) cx.fillStyle = '#2c2e33';
    else if (m.dentro[k]) cx.fillStyle = '#803060';
    else continue;
    cx.fillRect((di + R) * S, (dj + R) * S, S, S);
  }
  const { writeFileSync } = await import('node:fs');
  writeFileSync('/tmp/bolsa-zoom.png', cv.toBuffer('image/png'));
  const cxu = m.x0 + (ci + 0.5) * m.cell, cyu = m.y0 + (cj + 0.5) * m.cell;
  console.log(`zoom en (${cxu.toFixed(1)},${cyu.toFixed(1)}) u · ${mejor.length} celdas: /tmp/bolsa-zoom.png`);
  // ¿de qué manzana es? distancia a distritos
  for (const q of plan.patches) {
    if (!q.withinCity || q.shape.length < 3) continue;
    let dentro = false;
    const v = { x: cxu, y: cyu };
    for (let a = 0, b = q.shape.length - 1; a < q.shape.length; b = a++) {
      const pa = q.shape[a], pb = q.shape[b];
      if ((pa.y > v.y) !== (pb.y > v.y) && v.x < ((pb.x - pa.x) * (v.y - pa.y)) / (pb.y - pa.y) + pa.x) dentro = !dentro;
    }
    if (dentro) console.log(`  distrito: ${q.ward} · ${q.buildings.length} edificios · patio(s) del distrito: ${q.courts?.length ?? '¿?'}`);
  }
}
