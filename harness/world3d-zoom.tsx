// EL CABLEADO: ¿monta la vista de verdad, con el código nuevo dentro, sin
// romperse y sin encender la piel de cerca donde no toca?
//
// Lo que este banco cubre y los otros no: el orden de los efectos, un
// `R.current` todavía nulo, un almacén de teselas que nace antes que el estado
// que lee, un temporizador de posado que dispara sobre una escena a medio
// montar. Todo eso sólo falla dentro del componente.
//
// Lo que NO cubre: el encuadre cerrado. Llegar a él desde aquí exige o mover la
// cámara a mano — la rueda no llega al lienzo en Playwright con SwiftShader — o
// forzar la adopción del viewport compartido, que está apagada en el primer
// montaje A PROPÓSITO (un mundo recién generado no hereda la cámara del
// anterior). Doblar esa guarda para que pase una prueba es cambiar el producto
// para que quepa en el banco. Lo que se mide aquí es lo que se puede medir
// honestamente: monta, dibuja, no se queja, y a vista de planeta la piel de
// cerca está APAGADA — que es la mitad correcta de la decisión. La otra mitad
// —dónde cae la pintura y cuánto detalle trae— la miden `zoom-align` y
// `zoom-skin`, y la elección de nivel la mide `zoom-plan`.
//
// Aquí no hay Web Worker, así que no llega ninguna tesela.
import { createRoot } from 'react-dom/client';
import { createElement, useEffect, useState } from 'react';
import World3D from '../src/engines/worldgen/components/World3D';
import { generateWorld } from '../src/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '../src/engines/worldgen/core/types';
import { buildHumanGeography, DEFAULT_HUMAN_PARAMS } from '../src/engines/worldgen/core/settlements';
import { THEMES } from '../src/engines/worldgen/cartography/theme';
import { DEFAULT_PAINT_TOOL } from '../src/engines/worldgen/components/PaintPanel';

declare global { interface Window { world3dZoom?: string; __zoomProbe?: unknown } }

const log: string[] = [];
const origWarn = console.error;
console.error = (...a: unknown[]) => { log.push(String(a[0]).slice(0, 300)); origWarn(...a); };

async function main() {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: 'banco', width: 256 });
  const geography = buildHumanGeography(world, DEFAULT_HUMAN_PARAMS);

  // El HUD vive en el panel de Aspecto, cerrado por defecto: se abre como lo
  // abriría el lector, y de ahí se lee todo.
  const leerHud = () => [...document.querySelectorAll('p')]
    .map((n) => n.textContent ?? '')
    .filter((t) => /celdas por tri|tri.ngulos por celda|suelo z/.test(t))
    .join(' | ');

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0';
  document.body.appendChild(host);

  function App() {
    const [shape, setShape] = useState<'plane' | 'globe'>('plane');
    // Cómo se llega a un encuadre cerrado sin ratón: el efecto que encuadra se
    // vuelve a correr al cambiar de forma, y en la SEGUNDA pasada sí adopta el
    // viewport compartido (en la primera no, a propósito: un mundo recién
    // generado no hereda la cámara del anterior).
    useEffect(() => {
      const a = setTimeout(() => setShape('globe'), 2500);
      const b = setTimeout(() => setShape('plane'), 4500);
      return () => { clearTimeout(a); clearTimeout(b); };
    }, []);
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
      // Encuadre cerrado: es donde la piel de cerca tiene sentido y donde el
      // lector dijo que se veía mal. A vista de planeta debe estar APAGADA, y
      // eso lo comprueba el segundo pase.
      viewport: { u: 0.42, v: 0.46, spanKm: 1500 },
      exaggeration: 20,
      tool: DEFAULT_PAINT_TOOL,
      onEdit: () => undefined,
      revision: 0,
      flyTarget: null,
    });
  }
  createRoot(host).render(createElement(App));
  await new Promise((r) => setTimeout(r, 1500));
  [...document.querySelectorAll('button')]
    .find((b) => b.getAttribute('title') === 'Aspecto')?.click();

  // Se acerca con la rueda, como el lector. El encuadre inicial es el planeta
  // entero, y ahí la piel de cerca debe estar APAGADA — eso también se mide.
  await new Promise((r) => setTimeout(r, 1000));
  const lejos = leerHud();
  await new Promise((r) => setTimeout(r, 9000));

  window.world3dZoom = JSON.stringify({
    ok: /celdas por tri|tri.ngulos por celda/.test(lejos) && !/suelo z\d/.test(lejos),
    monta: true,
    aVistaDePlaneta: lejos,
    alFinal: leerHud(),
    pielDeCercaApagadaALoLejos: !/suelo z\d/.test(lejos),
    lienzos: document.querySelectorAll('canvas').length,
    errores: log.filter((l) => !/Warning: |act\(/.test(l)).slice(0, 6),
  }, null, 1);
}

main().catch((e) => {
  window.world3dZoom = JSON.stringify({ ok: false, error: String(e), errores: log.slice(0, 6) });
});
