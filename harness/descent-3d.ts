// ==========================================================================
// Banco: EL DESCENSO — ¿llega el 3D hasta la calle?
// ==========================================================================
// El proyecto tiene tres metas y la tercera es FlowScape: una vista 3D a la
// que se pueda bajar. El 2D ya baja —su pirámide toca fondo en z18, unos 0,6
// m/px— y las ciudades ya se dibujan con el MISMO generador tipo Watabou en
// las dos vistas (`region/townPlan.ts` llama a `generateCity`). Lo que no
// bajaba era el 3D, y este banco es la cuenta de por qué.
//
//   npx tsx harness/descent-3d.ts
//
// La cadena, de arriba abajo: el vano de la cámara → la ventana uv que pide la
// piel (con su suelo `MIN_UV_WINDOW`) → el nivel que elige `planZoomSkin` → los
// metros por píxel que sale entintando → ¿pasa del umbral de 5 m/px al que
// `region/townPlan.ts` empieza a dibujar calles?
//
// Todo con las funciones REALES. La tabla que imprime es la que justifica los
// números de `MIN_3D_SPAN_KM` en `core/camera.ts`.

import { planZoomSkin } from '../src/engines/worldgen/cartography/zoomSkin';
import { MIN_UV_WINDOW } from '../src/engines/worldgen/sculpt/scene3d';
import { PLAN_MAX_METRES_PER_PX } from '../src/engines/worldgen/region/townPlan';
import { EARTH_KM, MIN_3D_SPAN_KM, MIN_SPAN_KM } from '../src/engines/worldgen/core/camera';
import { MAX_SAT_TILE_Z, satelliteDeepSupported } from '../src/engines/worldgen/region/satelliteTile';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'VERDE' : 'ROJO '} · ${name} — ${detail}`);
  if (!ok) failures++;
};

const world = { width: 2048, height: 1024 };

/** Lo que la piel consigue entintar para un vano de cámara, en m/px. */
function skinAt(spanKm: number): { z: number; mpp: number; px: number } | null {
  const uSize = Math.max(MIN_UV_WINDOW, spanKm / EARTH_KM);
  const plan = planZoomSkin(world, { u: 0.5, v: 0.5, uSize, vSize: uSize }, { maxZ: MAX_SAT_TILE_Z });
  if (!plan) return null;
  const km = (plan.view.w / world.width) * EARTH_KM;
  return { z: plan.z, mpp: (km * 1000) / plan.width, px: plan.width };
}

console.log('── la escalera del descenso ──');
console.log('   vano | z de la piel |    m/px | ¿calles?');
for (const km of [1000, 100, 25, 20, 10, 6, 4, 2, 1]) {
  const s = skinAt(km);
  console.log(`${String(km).padStart(7)} | ${s ? `z${String(s.z).padStart(2)}` : '  —'}          | ${s ? s.mpp.toFixed(2).padStart(7) : '      —'} | ${s && s.mpp <= PLAN_MAX_METRES_PER_PX ? 'SÍ' : 'no'}`);
}

console.log('\n── lo que este banco tiene que impedir que vuelva ──');

// 1 · El tope escondido. `MIN_UV_WINDOW` valía 0,0005 —20 km de suelo, MÁS
//     ancho que el propio suelo de la vista— así que la piel no podía enfocar
//     más apretado que eso por mucho que la cámara bajara.
{
  const viejo = 0.0005;
  const uSize = Math.max(viejo, MIN_3D_SPAN_KM / EARTH_KM);
  const plan = planZoomSkin(world, { u: 0.5, v: 0.5, uSize, vSize: uSize }, { maxZ: MAX_SAT_TILE_Z })!;
  const mppViejo = ((plan.view.w / world.width) * EARTH_KM * 1000) / plan.width;
  const ahora = skinAt(MIN_3D_SPAN_KM)!;
  check('el suelo de la ventana uv ya no es el tope', MIN_UV_WINDOW * EARTH_KM < MIN_3D_SPAN_KM / 4,
    `${(MIN_UV_WINDOW * EARTH_KM).toFixed(2)} km de ventana contra ${MIN_3D_SPAN_KM} km de vano`);
  check('con el tope viejo NO se veían calles', mppViejo > PLAN_MAX_METRES_PER_PX,
    `${mppViejo.toFixed(2)} m/px con la ventana clavada en 20 km`);
  check('con el de ahora SÍ', ahora.mpp <= PLAN_MAX_METRES_PER_PX,
    `${ahora.mpp.toFixed(2)} m/px en z${ahora.z} · umbral ${PLAN_MAX_METRES_PER_PX}`);
  check('y con margen, no por los pelos', ahora.mpp <= PLAN_MAX_METRES_PER_PX / 3,
    `${(PLAN_MAX_METRES_PER_PX / ahora.mpp).toFixed(1)}× por debajo del umbral`);
}

// 1b · Y el AFINADO, que es el que pone el techo de verdad: la primera pasada
//      va con el presupuesto por defecto y, tras la posada, `World3D` vuelve a
//      planear un nivel más hondo con 160 teselas y 4096 px.
{
  const uSize = Math.max(MIN_UV_WINDOW, MIN_3D_SPAN_KM / EARTH_KM);
  const primera = skinAt(MIN_3D_SPAN_KM)!;
  const afinado = planZoomSkin(world, { u: 0.5, v: 0.5, uSize, vSize: uSize }, {
    maxZ: primera.z + 1, maxTiles: 160, maxPx: 4096, margin: 0.03,
  });
  const mpp = afinado ? ((afinado.view.w / world.width) * EARTH_KM * 1000) / afinado.width : NaN;
  check('el afinado baja un nivel más sobre el suelo nuevo',
    !!afinado && afinado.z === primera.z + 1,
    afinado ? `z${primera.z} → z${afinado.z} · ${mpp.toFixed(2)} m/px` : 'no encontró plan');
}

// 2 · El suelo de la vista contra el del contrato compartido.
check('el suelo del 3D no se mete por debajo del contrato', MIN_3D_SPAN_KM >= MIN_SPAN_KM,
  `vista ${MIN_3D_SPAN_KM} km · contrato ${MIN_SPAN_KM} km`);

// 3 · El presupuesto de precisión, que es lo que IMPEDÍA bajar más.
//
//     Estas varas decían, hasta el 2026-08-16, «a 0,25 km el escalón son 15 px:
//     por eso el suelo no baja ahí». Ya no: el vértice trabaja en marco local y
//     ese escalón pasó de 2,39 m a 9 µm. Lo que se queda aquí es la cuenta VIEJA
//     —la que justificaba el tope— convertida en lo que de verdad es: el retrato
//     del problema que se resolvió, para que nadie vuelva a sumar el
//     desplazamiento sobre una coordenada de mundo creyendo que da igual. El
//     presupuesto de AHORA se mide entero en `harness/descent-precision.ts`.
{
  const escalonM = Math.pow(2, -24) * EARTH_KM * 1000;
  const anchoPx = 1600;
  check('el escalón de coma flotante sobre u = 0,5 mide lo que se dijo',
    Math.abs(escalonM - 2.39) < 0.02,
    `${escalonM.toFixed(2)} m por ulp de float32 — el que había que esquivar`);
  const a025 = escalonM / ((MIN_SPAN_KM * 1000) / anchoPx);
  check('y en el suelo de hoy habría sido insoportable sin el marco local',
    a025 > 8, `${a025.toFixed(0)} px de banda con la cuenta vieja a ${MIN_SPAN_KM} km`);
  // Y la vara que ata las dos: el suelo de la vista sólo puede ser el del
  // contrato si alguien ha hecho el trabajo de precisión. Si alguien baja
  // `MIN_3D_SPAN_KM` sin tocar el shader, esto no lo pilla — lo pilla
  // `descent-precision`, y por eso los dos bancos van juntos.
  check('el suelo de la vista y el del contrato son el mismo número',
    MIN_3D_SPAN_KM === MIN_SPAN_KM, `${MIN_3D_SPAN_KM} km`);
}

// 4 · Que el fondo de la pirámide siga estando donde se cree.
check('la pirámide satélite llega a z18 en un mundo estándar',
  satelliteDeepSupported({ ...world, params: { seed: 'x' } } as never, MAX_SAT_TILE_Z),
  `z${MAX_SAT_TILE_Z}`);
{
  const fondo = skinAt(1)!;
  check('un vano de 1 km toca ese fondo', fondo.z === MAX_SAT_TILE_Z && fondo.mpp < 1,
    `z${fondo.z} · ${fondo.mpp.toFixed(2)} m/px`);
}

console.log(failures ? `\n${failures} varas ROJAS` : '\nTODO VERDE');
process.exit(failures ? 1 : 0);
