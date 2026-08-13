// ¿QUÉ PINTA TIENE LA VISTA DE VERDAD, A DISTINTAS HORAS?
//
// `world3d-zoom-run.mjs` monta World3D y comprueba que monta. Éste monta el
// mismo componente y lo LLEVA a las poses que importan —costa al atardecer, de
// día, de noche, al amanecer, mapa y globo— y saca un PNG de cada una, porque
// lo que había que arreglar (el cielo, la niebla del terreno, el color del sol)
// no se puede comprobar de ninguna otra forma que mirándolo.
//
// La hora se cambia MOVIENDO EL MANDO, como haría el lector: es un input de
// rango controlado por React, así que hay que escribir con el setter nativo y
// disparar el evento a mano, o React no se entera.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

mkdirSync('harness/out/sky3d', { recursive: true });

const SRC = String.raw`
import { createRoot } from 'react-dom/client';
import { createElement, useState } from 'react';
import World3D from '../src/engines/worldgen/components/World3D';
import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '../src/engines/worldgen/core/types';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { THEMES } from '../src/engines/worldgen/cartography/theme';
import { DEFAULT_PAINT_TOOL } from '../src/engines/worldgen/components/PaintPanel';

declare global {
  interface Window {
    sky3d?: string;
    setShape?: (s: 'plane' | 'globe') => void;
    flyTo?: (u: number, v: number, spanKm: number) => void;
    setViewport?: (u: number, v: number, spanKm: number) => void;
    coast?: { u: number; v: number };
  }
}

const log: string[] = [];
const origErr = console.error;
console.error = (...a: unknown[]) => { log.push(String(a[0]).slice(0, 300)); origErr(...a); };

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 'banco', width: 256 });
const geography = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);

// La punta de tierra con más mar alrededor: es donde se ve a la vez orilla,
// bajío y mar abierto, o sea donde la costa puede partirse en dos si la niebla
// del terreno y la del agua no coinciden.
let bx = 0, by = 0, best = -1;
for (let y = Math.round(world.height * 0.2); y < world.height * 0.8; y += 2) {
  for (let x = 0; x < world.width; x += 2) {
    const e = world.elevation[y * world.width + x];
    if (e <= 0.02 || e > 0.6) continue;
    let sea = 0;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const sx = ((Math.round(x + Math.cos(a) * 6) % world.width) + world.width) % world.width;
      const sy = Math.min(world.height - 1, Math.max(0, Math.round(y + Math.sin(a) * 6)));
      if (world.elevation[sy * world.width + sx] < -0.15) sea++;
    }
    if (sea > best) { best = sea; bx = x; by = y; }
  }
}
window.coast = { u: bx / world.width, v: by / world.height };

const host = document.createElement('div');
host.style.cssText = 'position:fixed;inset:0';
document.body.appendChild(host);

function App() {
  const [shape, setShape] = useState<'plane' | 'globe'>('plane');
  const [fly, setFly] = useState<{ u: number; v: number; spanKm: number } | null>(null);
  const [vp, setVp] = useState<{ u: number; v: number; spanKm: number } | undefined>(undefined);
  window.setShape = setShape;
  window.flyTo = (u, v, spanKm) => setFly({ u, v, spanKm });
  // El encuadre compartido, que es como llega el lector desde el 2D: la vista
  // lo ADOPTA al reencuadrar y coloca la camara de golpe. El vuelo haria lo
  // mismo en 42 fotogramas, y contra SwiftShader un fotograma de costa cuesta
  // diez segundos: siete minutos de banco por pose.
  window.setViewport = (u, v, spanKm) => setVp({ u, v, spanKm });
  return createElement(World3D, {
    world,
    geography,
    theme: THEMES[0],
    waypoints: [],
    showWaypoints: false,
    showSettlements: false,
    showLandmarks: false,
    skin: 'satelite' as const,
    shape,
    onShape: setShape,
    exaggeration: 20,
    tool: DEFAULT_PAINT_TOOL,
    onEdit: () => undefined,
    revision: 0,
    flyTarget: fly,
    viewport: vp,
  });
}
createRoot(host).render(createElement(App));

setTimeout(() => {
  // El panel de Aspecto, donde vive el mando de la hora.
  [...document.querySelectorAll('button')]
    .find((b) => b.getAttribute('title') === 'Aspecto')?.click();
  setTimeout(() => {
    window.sky3d = JSON.stringify({
      ok: log.filter((l) => !/Warning: |act\(/.test(l)).length === 0,
      costa: [bx, by],
      mandos: document.querySelectorAll('input[type=range]').length,
      errores: log.filter((l) => !/Warning: |act\(/.test(l)).slice(0, 6),
    }, null, 1);
  }, 2500);
}, 2500);
`;

await build({
  stdin: { contents: SRC, resolveDir: 'harness', loader: 'ts', sourcefile: 'world3d-sky.ts' },
  bundle: true,
  outfile: 'harness/out/world3d-sky.js',
  format: 'esm',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.css': 'text' },
  logLevel: 'warning',
});

const js = readFileSync('harness/out/world3d-sky.js');
const server = createServer((req, res) => {
  if (req.url.startsWith('/app.js')) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(js);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  // El mismo calzo de CSS que world3d-zoom-run: esta página no lleva Tailwind y
  // sin `absolute inset-0` el contenedor mide cero de alto.
  res.end('<!doctype html><html><head><style>'
    + 'html,body{margin:0;height:100%;background:#0b0e14}'
    + '.absolute{position:absolute}.relative{position:relative}.fixed{position:fixed}'
    + '.inset-0{inset:0}.overflow-hidden{overflow:hidden}.select-none{user-select:none}'
    + '.pointer-events-none{pointer-events:none}'
    + '</style></head><body>'
    // EL CONTADOR DE DIBUJOS. Parchea las dos llamadas de dibujo de WebGL2
    // ANTES de que el módulo se cargue, así que cuenta absolutamente todo lo
    // que sale por el pipeline. Es la única forma honesta de saber si el pulso
    // está parado: `st.need` vive dentro del componente y no se expone.
    + '<script>window.__d=0;(function(){var P=WebGL2RenderingContext.prototype;'
    + 'var a=P.drawElements,b=P.drawArrays;'
    + 'P.drawElements=function(){window.__d++;return a.apply(this,arguments)};'
    + 'P.drawArrays=function(){window.__d++;return b.apply(this,arguments)};})()</script>'
    + '<script type="module" src="/app.js"></script></body></html>');
});
await new Promise((r) => server.listen(8139, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 580 } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR ' + String(e).slice(0, 400)));
page.on('console', (m) => {
  if (m.type() === 'error' || /shader|GLSL|WebGL/i.test(m.text())) logs.push(m.text().slice(0, 500));
});
await page.goto('http://localhost:8139/', { waitUntil: 'commit', timeout: 120000 });
await page.waitForFunction(() => window.sky3d !== undefined, { timeout: 300000 }).catch(() => {});
console.log('resultado:', await page.evaluate(() => window.sky3d ?? 'sin resultado'));

/** Mover el mando de la hora como lo movería una mano. */
const setHour = (h) => page.evaluate((v) => {
  const inputs = [...document.querySelectorAll('input[type=range]')];
  // Orden del panel: detalle, cavidad, sombras, HORA, curvas.
  const el = inputs[3];
  if (!el) return 'sin mando';
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
}, h);

/** Esconder el HUD para la foto: lo que se juzga es el fotograma, no los mandos. */
const hud = (on) => page.evaluate((v) => {
  document.querySelectorAll('div.absolute').forEach((n) => {
    if (n.querySelector('canvas') || n.getAttribute('class')?.includes('inset-0')) return;
    n.style.visibility = v ? 'visible' : 'hidden';
  });
}, on);

const coast = await page.evaluate(() => window.coast);
console.log('costa', coast);

/**
 * Esperar a que el pulso PARE, y decir cuánto ha tardado.
 *
 * Contra SwiftShader un fotograma de costa cuesta segundos, así que esperar un
 * número fijo era esperar en medio del vuelo: la captura de Playwright se
 * quedaba sin hilo principal y vencía su propio plazo de dos minutos. Esto mide
 * los dibujos de verdad y sólo fotografía cuando no queda ninguno — que además
 * es la comprobación de que el mar se duerme (SEA_AWAKE_MS).
 */
const settle = async (maxMs) => {
  const t0 = Date.now();
  let last = await page.evaluate(() => window.__d);
  let quiet = 0;
  const trace = [];
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(2000);
    const now = await page.evaluate(() => window.__d);
    trace.push(now - last);
    quiet = now === last ? quiet + 1 : 0;
    last = now;
    if (quiet >= 2) break;
  }
  return { ms: Date.now() - t0, trace: trace.slice(-14) };
};

/** Poner el encuadre y hacer que la vista lo adopte: el efecto que reencuadra
 *  corre al cambiar de forma, y en la segunda pasada si adopta el viewport. */
const goTo = async (u, v, spanKm) => {
  await page.evaluate(([a, b, c]) => window.setViewport(a, b, c), [u, v, spanKm]);
  await page.waitForTimeout(600);
  await page.evaluate(() => window.setShape('globe'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.setShape('plane'));
  await page.waitForTimeout(1500);
};

/** Girar la camara como el lector: arrastrando con el boton izquierdo, que sin
 *  pincel fuera es lo que hace orbitar. dy hacia abajo baja el punto de vista
 *  hacia el horizonte; dx gira el rumbo. OrbitControls escala los dos por la
 *  ALTURA del lienzo: 2*PI*d/alto. */
const orbit = async (dx, dy) => {
  await page.mouse.move(450, 290);
  await page.mouse.down();
  for (let k = 1; k <= 6; k++) {
    await page.mouse.move(450 + (dx * k) / 6, 290 + (dy * k) / 6);
    await page.waitForTimeout(150);
  }
  await page.mouse.up();
  // Y sacar el puntero de la vista: mientras este encima, el mar sigue
  // despierto (es la senal de "hay alguien delante") y la captura se queda sin
  // hilo. Que se duerma es justo lo que se quiere fotografiar.
  await page.mouse.move(2, 2);
};

const POSES = [
  { name: 'mapa-tarde', hour: 15 },
  // La costa, bajando la vista hasta casi rasar el mar (unos 41 grados de giro
  // polar) y girando el rumbo un cuarto de vuelta para meter el sol poniente
  // —a las 18:00 esta justo en el oeste— dentro del encuadre.
  { name: 'costa-atardecer', hour: 18, goTo: [coast.u, coast.v, 1200], orbit: [150, 66] },
  { name: 'costa-noche', hour: 21.5 },
  { name: 'costa-mediodia', hour: 12 },
  { name: 'costa-amanecer', hour: 6.5, orbit: [-300, 0] },
  { name: 'globo', hour: 15, shape: 'globe' },
];

for (let i = 0; i < POSES.length; i++) {
  const p = POSES[i];
  if (p.goTo) await goTo(p.goTo[0], p.goTo[1], p.goTo[2]);
  if (p.shape) await page.evaluate((s) => window.setShape(s), p.shape);
  if (p.orbit) await orbit(p.orbit[0], p.orbit[1]);
  await setHour(p.hour);
  const q = await settle(150000);
  console.log(p.name, 'quieto en', (q.ms / 1000).toFixed(0), 's · dibujos por tanda de 2 s:', q.trace.join(' '));
  await hud(false);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `harness/out/sky3d/${i}-${p.name}.png`, timeout: 120000 })
    .catch((e) => console.log('sin foto', p.name, String(e).slice(0, 80)));
  await hud(true);
}

if (logs.length) console.log('mensajes:\n' + logs.slice(0, 8).join('\n'));
await browser.close();
server.close();
