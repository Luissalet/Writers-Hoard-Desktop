// ==========================================================================
// CORREDOR de la sonda visual del descenso 3D
// ==========================================================================
// Monta `descent-look-3d.ts` en un Chromium de verdad (swiftshader), pide el
// mismo cuadro con la cuenta VIEJA y con la NUEVA a cuatro vanos, y compone
// una lámina con los ocho.
//
// LA VARA ES LA INVARIANCIA DE ESCALA, y no una medida de nitidez. La cámara
// encuadra siempre la misma ventana del mundo con la misma piel, así que los
// cuatro cuadros de una fila TIENEN QUE SALIR IGUALES: bajar no cambia lo que
// se ve, sólo dónde estás. Con la cuenta vieja el cuadro se va deshaciendo
// según baja el vano; con la nueva no se mueve. Comparar cada cuadro con el de
// 2 km de su propia fila no necesita ningún umbral inventado, que es
// exactamente lo que hundió los dos primeros intentos de vara: «contraste
// local» premiaba el ruido (más contraste que una calle limpia) y «moteado»
// contaba las calles de un píxel como si fueran ruido.
//
//   node harness/descent-look-3d-run.mjs
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = `${RAIZ}/harness/out/descent-look-3d`;
const PUERTO = 8147;
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

console.log('empaquetando…');
await build({
  bundle: true, format: 'esm', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.css': 'text' }, plugins: [aliasArroba], logLevel: 'warning',
  entryPoints: [`${RAIZ}/harness/descent-look-3d.ts`], outfile: `${SALIDA}/app.js`,
});

const HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>html,body{margin:0;background:#111}canvas{display:block}</style>
</head><body><script type="module" src="/app.js"></script></body></html>`;
writeFileSync(`${SALIDA}/index.html`, HTML);

const server = createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/app.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(readFileSync(`${SALIDA}/app.js`));
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
const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });
const averias = [];
page.on('pageerror', (e) => { averias.push(String(e?.stack || e)); });
page.on('console', (m) => { if (m.type() === 'error') averias.push(m.text()); });

await page.goto(`http://127.0.0.1:${PUERTO}/`);
await page.waitForFunction(() => window.__banco?.listo, undefined, { timeout: 60_000 });

const VANOS = [2, 1, 0.5, 0.25];
const cuadros = [];
for (const km of VANOS) {
  for (const legado of [true, false]) {
    const url = await page.evaluate(([k, l]) => window.__banco.cuadro(k, l), [km, legado]);
    cuadros.push({ km, legado, url });
    console.log(`  ${km} km · ${legado ? 'antes' : 'ahora'} · ${Math.round(url.length / 1024)} KB`);
  }
}
await browser.close();
server.close();

if (averias.length) {
  console.error('AVERÍAS EN LA PÁGINA:\n' + averias.slice(0, 5).join('\n'));
  process.exit(2);
}

// ── La lámina y la vara ────────────────────────────────────────────────────
const imgs = [];
for (const c of cuadros) imgs.push({ ...c, img: await loadImage(Buffer.from(c.url.split(',')[1], 'base64')) });
const A = imgs[0].img.width, B = imgs[0].img.height;
const PAD = 14, TIT = 24, CAB = 34;
const lam = createCanvas(PAD + (A + PAD) * 4, CAB + (B + TIT + PAD) * 2 + PAD);
const L = lam.getContext('2d');
L.fillStyle = '#181818'; L.fillRect(0, 0, lam.width, lam.height);
L.font = 'bold 15px sans-serif'; L.fillStyle = '#e8e8e8';
L.fillText('EL MARCO LOCAL — mismo mundo, misma cámara, misma piel; sólo cambia la cuenta del vértice y la del fragmento',
  PAD, 22);

/** Luminancias de una imagen, para comparar dos cuadros píxel a píxel. */
function luces(img) {
  const c = createCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  const out = new Float32Array(img.width * img.height);
  for (let i = 0, k = 0; k < out.length; k++, i += 4) {
    out[k] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  }
  return out;
}
/** Cuánto se ha movido un cuadro respecto a otro, sobre el terreno (el fondo
 *  negro no cuenta: es la mitad del lienzo y diluiría cualquier diferencia). */
function divergencia(a, b) {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < 6 && b[i] < 6) continue;
    s += Math.abs(a[i] - b[i]); n++;
  }
  return s / Math.max(1, n);
}

let fallos = 0;
const filas = [true, false];
const medidas = new Map();
const refs = new Map();
for (const legado of filas) refs.set(legado, luces(imgs.find((c) => c.legado === legado && c.km === 2).img));
filas.forEach((legado, fi) => {
  imgs.filter((c) => c.legado === legado).forEach((c, ci) => {
    const x = PAD + (A + PAD) * ci;
    const y = CAB + (B + TIT + PAD) * fi;
    const d = divergencia(luces(c.img), refs.get(legado));
    medidas.set(`${c.km}:${legado}`, d);
    L.font = 'bold 13px sans-serif';
    L.fillStyle = legado ? '#e08b6a' : '#9fc98a';
    L.fillText(`${legado ? 'ANTES' : 'AHORA'} · vano ${c.km} km · se ha movido ${d.toFixed(1)}`, x, y + 16);
    L.drawImage(c.img, x, y + TIT);
  });
});
writeFileSync(`${RAIZ}/harness/out/descent-look-3d.png`, lam.toBuffer('image/png'));
console.log('\nharness/out/descent-look-3d.png');

console.log('\n── la vara: bajar no puede cambiar lo que se ve ──');
console.log('   (distancia media al cuadro de 2 km de la misma fila, en luma)');
for (const km of VANOS.filter((k) => k !== 2)) {
  const antes = medidas.get(`${km}:true`), ahora = medidas.get(`${km}:false`);
  // La vara es un COCIENTE contra el «antes» de su propia fila: no hace falta
  // inventar un umbral en unidades de luma, que es lo que ha hecho fallar a las
  // dos varas anteriores de esta sonda.
  const ok = ahora < antes * 0.5;
  if (!ok) fallos++;
  console.log(`${ok ? 'VERDE' : 'ROJO '} · vano ${km} km — el cuadro se movía ${antes.toFixed(1)} y ahora `
    + `${ahora.toFixed(1)} (tenía que bajar de la mitad)`);
}
{
  // Y la que impide que la sonda se vuelva un adorno: si el ANTES no se rompe,
  // no está midiendo el fallo que dice medir y su «después» no prueba nada.
  const roto = medidas.get('0.25:true');
  const ok = roto > 5;
  if (!ok) fallos++;
  console.log(`${ok ? 'VERDE' : 'ROJO '} · la sonda reproduce el fallo — con la cuenta vieja, `
    + `bajar a 0,25 km movía el cuadro ${roto.toFixed(1)} puntos de luma`);
}
console.log(fallos ? `\n${fallos} varas ROJAS` : '\nTODO VERDE');
process.exit(fallos ? 1 : 0);
