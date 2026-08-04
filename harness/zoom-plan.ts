// LA ESCALERA, EN NÚMEROS: qué nivel de la pirámide, cuántas teselas y cuántos
// metros por píxel pide la piel de cerca del 3D en cada encuadre, desde el
// planeta entero hasta el suelo de la vista.
//
// Es aritmética pura —ni GPU ni mundo— así que corre en un segundo y se puede
// leer entera de un vistazo. Sirve para lo que una captura no puede: ver que la
// escalera SUBE de forma monótona, que el gasto está acotado en todos los
// peldaños, y dónde se apaga.
import { planZoomSkin, zoomSkinCovers } from '../src/engines/worldgen/cartography/zoomSkin';

const world = { width: Number(process.argv[2] || 2048), height: Number(process.argv[3] || 1024) };
const EARTH_KM = 40075;
const MAX_Z = 8;
// Un encuadre 3:2, que es la forma de la ventana de la vista.
const ASPECT = 1.5;
// Y la inclinación con la que se mira de verdad: la cámara del 3D no cae a
// plomo, y a 45 grados el suelo a lo largo de la vista mide un 41 % más.
const TILT_DEG = Number(process.argv[4] || 45);
const STRETCH = Math.min(2, 1 / Math.max(0.5, Math.sin((TILT_DEG * Math.PI) / 180)));

console.log(`mundo ${world.width}x${world.height} · ${(EARTH_KM / world.width).toFixed(1)} km/celda`);
console.log('la piel de mundo entero, para comparar: '
  + `${Math.round((EARTH_KM * 1000) / world.width)} m/px`);
console.log('');
// Y lo que de verdad decide si se ve nítido: metros por píxel DE PANTALLA.
// Una pantalla de 2300 px de ancho, que es un portátil moderno a escala real.
const SCREEN_PX = Number(process.argv[5] || 2300);
console.log(`pantalla de ${SCREEN_PX} px de ancho`);
console.log('');
console.log('encuadre    ventana uv        z  bloque   imagen       m/px    x mejor  teselas  vs pantalla');

console.log(`inclinación ${TILT_DEG}° → el suelo a lo largo de la vista, x${STRETCH.toFixed(2)}`);
console.log('');
for (const km of [40000, 20000, 12000, 8000, 5000, 3000, 2000, 1500, 1200, 900, 600, 400, 250, 150]) {
  const vSize = (km / (EARTH_KM / 2)) * STRETCH;
  const uSize = ((km / (EARTH_KM / 2)) * ASPECT) / 2;
  const focus = { u: 0.37, v: 0.44, uSize, vSize };
  const plan = planZoomSkin(world, focus, { maxZ: MAX_Z });
  if (!plan) {
    console.log(`${String(km).padStart(6)} km   ${uSize.toFixed(4)}x${vSize.toFixed(4)}`
      + '    — la piel de mundo entero basta');
    continue;
  }
  const mPerPx = (plan.view.w * (EARTH_KM / world.width) * 1000) / plan.width;
  const gain = ((EARTH_KM * 1000) / world.width) / mPerPx;
  // ¿Aguanta un empujón de cámara de un diez por ciento de la ventana sin
  // recomponer? Ése es el margen que evita rehacerla en cada gesto.
  const drift = zoomSkinCovers(plan, { ...focus, u: focus.u + uSize * 0.10 });
  console.log(
    `${String(km).padStart(6)} km   ${uSize.toFixed(4)}x${vSize.toFixed(4)}`
    + `   z${plan.z}  ${`${plan.nx}x${plan.ny}`.padEnd(7)}`
    + `${`${plan.width}x${plan.height}`.padEnd(12)}`
    + `${String(Math.round(mPerPx)).padStart(6)}  ${gain.toFixed(1).padStart(6)}x`
    + `  ${String(plan.nx * plan.ny).padStart(4)}`
    + `   ${(mPerPx / ((km * 1000 * ASPECT) / SCREEN_PX)).toFixed(1)}x`
    + `${drift ? '' : '  (sin margen)'}`,
  );
}

// ---------------------------------------------------------------------------
// LA TRAMPA QUE HIZO QUE ESTO PARECIERA NO FUNCIONAR
// ---------------------------------------------------------------------------
// Un bloque hecho a vista de planeta CONTIENE cualquier encuadre posterior, así
// que la prueba «¿sigue cabiendo?» es verdad para siempre y la escalera nunca
// baja. Medido en la máquina de Luis: `suelo z4 · 9,8 km/px` con el encuadre a
// mil quinientos kilómetros. Esto simula el paseo entero: un plan, y luego
// acercarse paso a paso comprobando si el plan sigue valiendo.
import { zoomSkinCovers as covers, samePlan } from '../src/engines/worldgen/cartography/zoomSkin';

console.log('');
console.log('acercándose desde 20 000 km, ¿se rehace el bloque cuando toca?');
let plan = null as ReturnType<typeof planZoomSkin>;
let rehechos = 0;
for (const km of [20000, 12000, 8000, 5000, 3000, 2000, 1500, 1200, 900, 600, 400]) {
  const vSize = (km / (EARTH_KM / 2)) * STRETCH;
  const focus = { u: 0.37, v: 0.44, uSize: ((km / (EARTH_KM / 2)) * ASPECT) / 2, vSize };
  const vale = plan ? covers(plan, focus) : false;
  if (!vale) {
    const next = planZoomSkin(world, focus, { maxZ: MAX_Z });
    if (!samePlan(next, plan)) { plan = next; rehechos++; }
  }
  // Y después de componerlo entero, el afinado intenta un nivel más.
  let fino = plan;
  if (plan && plan.z < MAX_Z) {
    const deeper = planZoomSkin(world, focus, {
      maxZ: plan.z + 1, maxTiles: 160, maxPx: 4096, margin: 0.03,
    });
    if (deeper && deeper.z > plan.z) fino = deeper;
  }
  const mpp = (p2: typeof plan) => (p2 ? (p2.view.w * (EARTH_KM / world.width) * 1000) / p2.width : 0);
  console.log(`${String(km).padStart(6)} km  ${vale ? 'vale     ' : 'SE REHACE'}`
    + `  → ${plan ? `z${plan.z} · ${Math.round(mpp(plan))} m/px` : 'sin piel de cerca'}`
    + (fino !== plan
      ? `   → afina a z${fino!.z} · ${Math.round(mpp(fino))} m/px `
        + `(${fino!.nx}x${fino!.ny} = ${fino!.nx * fino!.ny} teselas)`
      : ''));
}
console.log(`${rehechos} bloques compuestos en todo el paseo`);
