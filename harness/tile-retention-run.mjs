// ============================================================================
// CORREDOR DEL BANCO DE RETENCIÓN DE TESELAS
// ============================================================================
// Monta `tile-retention.tsx` en un Chromium de verdad, baja con la RUEDA (el
// gesto de Luis, no un setViewport de laboratorio) hasta el suelo hondo y
// deja la cámara quieta. La vara: en el reposo ninguna coordenada del nivel
// hondo renace, y el `setGeneration` del almacén no cambia. Si falla, el
// informe trae la pila del que vació el almacén y las coordenadas renacidas
// — el mismo retrato que costó tres capturas y un volcado de consola.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calzoCSS } from './calzo.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = `${RAIZ}/harness/out/tile-retention`;
const PUERTO = 8143;
mkdirSync(SALIDA, { recursive: true });

const aliasArroba = {
  name: 'alias-arroba',
  setup(b) {
    b.onResolve({ filter: /^@\// }, (args) => {
      const base = path.join(RAIZ, 'src', args.path.slice(2));
      for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
        if (existsSync(base + ext) && !existsSync(base + ext + '/')) return { path: base + ext };
      }
      return { path: base };
    });
  },
};

const comunes = {
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.css': 'text' },
  plugins: [aliasArroba],
  logLevel: 'warning',
};

console.log('empaquetando…');
await build({ ...comunes, entryPoints: [`${RAIZ}/harness/tile-retention.tsx`], outfile: `${SALIDA}/app.js` });
await build({ ...comunes, entryPoints: [`${RAIZ}/src/engines/worldgen/region.worker.ts`], outfile: `${SALIDA}/region.worker.js` });

// El calzo es OBLIGATORIO (la trampa del lienzo 1100x8): sin las utilidades
// de colocación el Map2D montó un lienzo de 1280x3925 y la rueda giraba
// fuera de la ventana.
const HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>${calzoCSS()}</style>
</head><body><script type="module" src="/app.js"></script></body></html>`;
writeFileSync(`${SALIDA}/index.html`, HTML);

const ficheros = {
  '/app.js': [`${SALIDA}/app.js`, 'text/javascript'],
  '/region.worker.ts': [`${SALIDA}/region.worker.js`, 'text/javascript'],
};
const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const f = ficheros[url];
  if (f) {
    res.writeHead(200, { 'Content-Type': f[1] });
    res.end(readFileSync(f[0]));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(HTML);
});
await new Promise((r) => server.listen(PUERTO, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 });

const consola = [];
page.on('console', (m) => {
  const texto = m.text();
  consola.push(texto);
  // En vivo: un banco que se cuelga sin decir dónde cuesta una tarde. Las
  // trazas de teselas son legión; al terminal van sólo las señales de fase y
  // los errores, el resto queda en consola.log.
  if (!texto.startsWith('[teselas')) console.log('  »', texto.slice(0, 200));
});
const averias = [];
page.on('pageerror', (e) => { averias.push(String(e?.stack || e)); console.log('  ¡PAGEERROR!', String(e).slice(0, 300)); });

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`http://127.0.0.1:${PUERTO}/`);
await page.waitForFunction(() => window.__banco?.listo, undefined, { timeout: 30_000 });

// Mundo 512: el de los bancos del canon de la pasada 8, con niveles hondos de
// verdad y una generación que cabe en un banco.
console.log(`generando mundo ${Number(process.env.BANCO_ANCHO || 512)}${process.env.BANCO_LEGADO === '1' ? ' LEGADO' : ''} + geografía full…`);
const ANCHO = Number(process.env.BANCO_ANCHO || 512);
const LEGADO = process.env.BANCO_LEGADO === '1';
const prep = await page.evaluate(({ w, l }) => window.__banco.preparar(w, l), { w: ANCHO, l: LEGADO });
console.log('mundo listo:', JSON.stringify(prep));
if (prep.topZ < 11) {
  console.error(`ROJO DE PLOMERÍA: el mundo no llega a suelo hondo (topZ ${prep.topZ})`);
  process.exit(2);
}

// El primer asentamiento de la vista (raster somero + primeras teselas).
await espera(4000);

// LA BAJADA, con la rueda y hacia la capital: la cámara del Map2D hace zoom
// hacia el cursor, así que el cursor se queda clavado en el centro, donde el
// banco ha centrado la capital. Se baja hasta que el nivel hondo objetivo
// lleve dos segundos naciendo, o hasta agotar los tiques (el clamp de la
// cámara hace el resto).
// z11, no z13: las varas de retención (renacida-tras-entrega, reposo mudo,
// hueco re-pedible) son idénticas en todo nivel hondo, y la escalera hasta
// z13 encolaba tanta fragua de canon que en un contenedor lento el banco
// medía la CPU y no la retención (ROJO COJO con las curas ya probadas en
// verde a z13 en corrida solitaria, 60/60 · 0 caducadas · reposo mudo).
const objetivo = Math.min(prep.topZ, 11);
console.log('buscando el lienzo…');
const canvas = await page.locator('#escenario canvas').first().boundingBox({ timeout: 20_000 });
console.log('lienzo:', JSON.stringify(canvas));
const cx = canvas.x + canvas.width / 2;
const cy = canvas.y + canvas.height / 2;
await page.mouse.move(cx, cy);
// EN RÁFAGAS CON PAUSA, como baja una persona: la bajada de un tirón encolaba
// ~180 teselas de niveles intermedios por delante del plan final, y con dos
// sesiones lentas de contenedor el nivel objetivo no llegaba a tocar sesión
// en seis minutos (ROJO COJO del 2026-08-12 — cola, no retención). Pausar por
// nivel deja las superteselas del vecindario ya fraguadas cuando llega el
// nivel hondo, que es exactamente lo que pasa con un lector de verdad.
let nivel = -1;
for (let rafaga = 0; rafaga < 8 && nivel < objetivo; rafaga++) {
  for (let tique = 0; tique < 10 && nivel < objetivo; tique++) {
    await page.mouse.wheel(0, -160);
    await espera(140);
    nivel = await page.evaluate(() => window.__banco.nivelActual(2));
  }
  if (nivel >= objetivo) break;
  // La pausa: hasta que el nivel VISIBLE deje de moverse (45 s de techo).
  const t0 = Date.now();
  let antes = -1;
  while (Date.now() - t0 < 45_000) {
    await espera(5000);
    const p = await page.evaluate((n) => window.__banco.progreso(n), Math.max(2, nivel));
    if (p.entregadas === antes && p.entregadas > 0) break;
    antes = p.entregadas;
  }
}
console.log(`bajada hecha: nivel visto ${nivel} (objetivo ${objetivo})`);

// EL REPOSO, adaptativo. La primera supertesela de canon cuesta ~40 s en este
// contenedor (probe-supertesela.ts, medido), así que el reposo espera a que el
// plan del nivel PROGRESE: o todas las coordenadas entregadas, o seis minutos.
// Sólo ENTONCES se abre la ventana de veredicto — quince segundos que, con el
// bucle de la captura vivo, darían ~10 renacimientos por coordenada.
console.log('reposo: esperando el plan del nivel…');
let prog = null;
const esperaDesde = Date.now();
for (;;) {
  await espera(5000);
  prog = await page.evaluate((n) => window.__banco.progreso(n), nivel);
  console.log(`  plan z${nivel}: ${prog.entregadas}/${prog.coords} entregadas`);
  const completo = prog.coords > 0 && prog.entregadas >= prog.coords;
  const callado = prog.t - prog.ultimoNaceT > 8;
  if ((completo && callado) || Date.now() - esperaDesde > 600_000) break;
}
const reposoDesde = await page.evaluate(() => window.__banco.ahora());
await espera(15_000);
const inf = await page.evaluate(
  ({ nivel: n, desde }) => window.__banco.informe(n, desde),
  { nivel, desde: reposoDesde },
);

writeFileSync(`${SALIDA}/informe.json`, JSON.stringify({ prep, nivel, inf, averias }, null, 2));
writeFileSync(`${SALIDA}/consola.log`, consola.join('\n'));

console.log('\n=== INFORME ===');
console.log(JSON.stringify(inf, null, 2));
if (averias.length) console.log('\nAVERÍAS DE PÁGINA:\n' + averias.join('\n---\n'));

// La vara, en tres varas:
//  · el BUCLE de la captura: una coordenada que renace DESPUÉS de entregada
//    (el z13(3490,955) de Luis, cinco vidas en cuatro segundos);
//  · el reposo tiene que ser MUDO: ni nacimientos ni cambios de generación
//    con la cámara quieta;
//  · y el plan tiene que haber PROGRESADO — un banco que no entrega nada no
//    ha medido la retención, ha medido la cola.
const bucle = inf.renacidasTrasEntregaTotal > 0 || inf.nacimientosEnReposo > 0 || inf.genEnReposo > 0;
const cojo = inf.entregadasNivel === 0;
if (bucle) {
  console.log(`\nROJO: bucle de renacimiento — ${inf.renacidasTrasEntregaTotal} coordenadas renacidas`
    + ` tras su entrega (${inf.renacidasTrasEntrega.join(', ')}), ${inf.nacimientosEnReposo} nacimientos`
    + ` y ${inf.genEnReposo} cambios de generación en reposo`);
  for (const c of inf.genUltimos) {
    console.log(`  gen +${c.t.toFixed(1)}s: «${c.de}» → «${c.a}»\n    ${c.pila}`);
  }
} else if (cojo) {
  console.log(`\nROJO COJO: el nivel z${inf.nivel} no entregó ni una tesela — la cola, no la retención.`);
} else {
  console.log(`\nVERDE: ${inf.entregadasNivel}/${inf.coords} coordenadas de z${inf.nivel} entregadas,`
    + ` ninguna renace tras su entrega, reposo mudo`
    + ` (${inf.genCambiosTotal} cambios de generación en toda la bajada).`);
}

// ============================================================================
// SEGUNDA VISITA — el almacén de entintadas ENTRE SESIONES (F1)
// ============================================================================
// La promesa central de ARQUITECTURA-TESELAS §3.2: suelo dibujado una vez es
// suelo dibujado para siempre. Se recarga la página (módulos frescos, almacén
// de pantalla vacío, worker nuevo — una sesión nueva de verdad sobre el MISMO
// IndexedDB), se regenera el mismo mundo desde la semilla y se repite la
// bajada: las teselas hondas tienen que venir del disco, no de la fragua.
let segunda = null;
if (!bucle && !cojo) {
  console.log('\n=== SEGUNDA VISITA (el disco de entintadas) ===');
  await page.reload();
  await page.waitForFunction(() => window.__banco?.listo, undefined, { timeout: 30_000 });
  const prep2 = await page.evaluate(({ w, l }) => window.__banco.preparar(w, l), { w: ANCHO, l: LEGADO });
  console.log(`mundo regenerado en ${prep2.segundos}s`);
  await espera(4000);
  const caja2 = await page.locator('#escenario canvas').first().boundingBox({ timeout: 20_000 });
  await page.mouse.move(caja2.x + caja2.width / 2, caja2.y + caja2.height / 2);
  const t0v2 = Date.now();
  let nivel2 = -1;
  for (let rafaga = 0; rafaga < 8 && nivel2 < objetivo; rafaga++) {
    for (let tique = 0; tique < 10 && nivel2 < objetivo; tique++) {
      await page.mouse.wheel(0, -160);
      await espera(140);
      nivel2 = await page.evaluate(() => window.__banco.nivelActual(2));
    }
    if (nivel2 >= objetivo) break;
    await espera(3000);
  }
  let p2 = null;
  const d2 = Date.now();
  for (;;) {
    await espera(2000);
    p2 = await page.evaluate((n) => window.__banco.progreso(n), Math.max(2, nivel2));
    if ((p2.coords > 0 && p2.entregadas >= p2.coords) || Date.now() - d2 > 120_000) break;
  }
  const inf2 = await page.evaluate(
    ({ nivel: n, desde }) => window.__banco.informe(n, desde),
    { nivel: Math.max(2, nivel2), desde: 0 },
  );
  segunda = {
    segundos: (Date.now() - t0v2) / 1000, nivel: nivel2, plan: p2, servicio: inf2.servicio,
  };
  writeFileSync(`${SALIDA}/informe2.json`, JSON.stringify(segunda, null, 2));
  console.log('servicio de la segunda visita:', JSON.stringify(inf2.servicio));
  if (inf2.servicio.diskHits === 0) {
    segunda.rojo = true;
    console.log('\nROJO DEL DISCO: la segunda visita no sirvió NI UNA tesela del almacén de entintadas.');
  } else {
    console.log(`\nVERDE DEL DISCO: la segunda visita sirvió ${inf2.servicio.diskHits} teselas del disco`
      + ` (plan z${nivel2}: ${p2.entregadas}/${p2.coords} · bajada ${segunda.segundos.toFixed(1)} s).`);
  }
}

await browser.close();
server.close();
process.exit(bucle || cojo || (segunda && segunda.rojo) ? 1 : 0);
