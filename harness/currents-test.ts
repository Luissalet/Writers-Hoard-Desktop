// Does the current model actually reproduce the coast asymmetry it exists for?
// Real Earth: tropical WEST coasts are cold and bone dry (Atacama, Namib, Baja);
// mid-latitude WEST coasts are mild and wet (Ireland, Oregon, Chile). The east
// coasts at the same latitudes are the opposite.
import { getWorld } from './world-cache';

const w = getWorld({ seed: process.argv[2] || 'monstruo', width: Number(process.argv[3] || 1024) });
const { width: W, height: H, elevation, temperature, precipitation, sst, currentSpeed } = w;

// Classify each coastal land cell by which side of its landmass it faces:
// look a short way east and west and see which way the open ocean lies.
const probe = Math.max(4, Math.round(W / 90));
interface Bin { n: number; t: number; p: number; s: number }
const bins = new Map<string, Bin>();
const add = (k: string, t: number, p: number, s: number) => {
  let b = bins.get(k);
  if (!b) bins.set(k, (b = { n: 0, t: 0, p: 0, s: 0 }));
  b.n++; b.t += t; b.p += p; b.s += s;
};

for (let y = 2; y < H - 2; y++) {
  const lat = Math.abs((0.5 - (y + 0.5) / H) * 180);
  const band = lat < 12 ? null : lat < 34 ? 'trópico' : lat < 58 ? 'medias  ' : null;
  if (!band) continue;
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (elevation[i] <= 0) continue;
    // coastal?
    let coastal = false;
    for (const d of [-1, 1]) if (elevation[y * W + ((x + d + W) % W)] <= 0) coastal = true;
    if (!coastal) continue;
    let seaW = 0, seaE = 0;
    for (let k = 1; k <= probe; k++) {
      if (elevation[y * W + ((x - k + W) % W)] <= 0) seaW++;
      if (elevation[y * W + ((x + k) % W)] <= 0) seaE++;
    }
    // "West coast" = open water to the west and land to the east.
    const facing = seaW > probe * 0.7 && seaE < probe * 0.3 ? 'oeste'
      : seaE > probe * 0.7 && seaW < probe * 0.3 ? 'este ' : null;
    if (!facing) continue;
    add(`${band} ${facing}`, temperature[i], precipitation[i], sst[i]);
  }
}

let spd = 0, nsea = 0, maxSst = -99, minSst = 99;
for (let i = 0; i < W * H; i++) {
  if (elevation[i] > 0) continue;
  spd += currentSpeed[i]; nsea++;
  if (sst[i] > maxSst) maxSst = sst[i];
  if (sst[i] < minSst) minSst = sst[i];
}
console.log(`corriente: velocidad media ${(spd / nsea).toFixed(3)}  anomalía SST ${minSst.toFixed(1)}…${maxSst.toFixed(1)} °C\n`);
console.log('banda / orientación   celdas    T °C   lluvia mm   SST anom');
for (const k of [...bins.keys()].sort()) {
  const b = bins.get(k)!;
  console.log(`${k}          ${String(b.n).padStart(6)}  ${(b.t/b.n).toFixed(1).padStart(6)}  ${(b.p/b.n).toFixed(0).padStart(9)}   ${(b.s/b.n).toFixed(2).padStart(7)}`);
}
