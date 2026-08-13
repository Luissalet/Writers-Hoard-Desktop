// ============================================================================
// SONDA: ¿por qué esas tres puertas no se alcanzan en carro desde el mercado?
// ============================================================================
// Lección #29: instrumenta el dominio antes de tocar nada. Para cada puerta de
// las tres ciudades ciegas: ¿arranca una avenida en ella? ¿a qué distancia está
// el vértice de calle más cercano? Una puerta sin avenida es un fallo de
// ENRUTADO (routeStreet devolvió null y se tragó el continue); una puerta con
// avenida es un fallo de OBRA (algo la estrangula después).
import { generateCity, DEFAULT_CITY, type CityParams, type CityPlan } from '../src/engines/worldgen/city/generate';

const SEMILLA = 'calidad';
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

const casos: [string, Partial<CityParams>, number][] = [
  ['interior', {}, 40],
  ['río', { river: true, riverDir: { x: 1, y: 0.25 } }, 40],
  ['costa', { coast: true, coastDir: { x: 0, y: 1 } }, 40],
];
for (const [gtag, g, size] of casos) {
  const plan: CityPlan = generateCity({
    ...DEFAULT_CITY, seed: `${SEMILLA}-${gtag}-${size}`, size,
    walls: true, citadel: true, farms: true, river: false, coast: false, ...g,
  });
  console.log(`\n${gtag} ${size} — ${plan.gates.length} puertas, ${plan.mainStreets.length} avenidas, ${plan.streets.length} calles`);
  for (let i = 0; i < plan.gates.length; i++) {
    const g0 = plan.gates[i];
    let dAve = Infinity; let arranca = false;
    for (const st of plan.mainStreets) {
      dAve = Math.min(dAve, ...st.map((v) => dist(v, g0)));
      if (dist(st[0], g0) < 1.5 || dist(st[st.length - 1], g0) < 1.5) arranca = true;
    }
    let dCalle = Infinity;
    for (const st of plan.streets) dCalle = Math.min(dCalle, ...st.map((v) => dist(v, g0)));
    console.log(`  puerta ${i} (${g0.x.toFixed(1)},${g0.y.toFixed(1)}): avenida arranca=${arranca} · d(avenida)=${dAve.toFixed(2)} u · d(calle)=${dCalle.toFixed(2)} u`);
  }
}
