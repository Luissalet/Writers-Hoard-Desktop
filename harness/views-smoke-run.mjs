// ============================================================================
// CORREDOR DEL BANCO DE ARRANQUE DE VISTAS
// ============================================================================
// Monta cada vista del motor de mundos en un Chromium de verdad y le hace
// cuatro preguntas que PUEDEN salir mal:
//
//   1. ¿Existe la raíz que debería existir?
//   2. ¿Ha dibujado? — tinta medida sobre la captura del elemento, no un
//      `ok:true`. Y no sólo tinta: un relleno plano tiene 100 % de tinta y no
//      dibuja nada, así que se cuentan también BORDES y COLORES.
//   3. ¿Mide el lienzo lo que se le pidió? — la trampa del 1100x8.
//   4. ¿Se ha quejado alguien? — `pageerror`, `console.error` y avisos de React.
//
// Y todo dos veces: montar, medir, DESMONTAR de verdad, volver a montar, volver
// a medir. Los fallos de orden de efectos y los almacenes que sobreviven al
// componente sólo asoman en el segundo pase.
//
// Lecciones que este fichero paga: #26 («contar cosas no es medirlas»), #21
// («medir el renderizador no es medir la vista») y la del lienzo 1100x8 — un
// banco 3D que daba verde con el contenedor a cero de alto porque la página no
// tenía Tailwind. De ahí el calzo de CSS de más abajo, que es obligatorio.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// La raíz del repo, desde este propio fichero: la ruta cableada del contenedor
// de una pasada anterior ('/home/claude/wg') convertía el corredor en un banco
// que sólo corría en aquella máquina concreta.
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = `${RAIZ}/harness/out/views-smoke`;
const PUERTO = 8137;
mkdirSync(SALIDA, { recursive: true });

// ---------------------------------------------------------------------------
// 1. El paquete
// ---------------------------------------------------------------------------
// El alias `@/` es de Vite y esbuild no lo conoce. Sin este resolutor la mitad
// de los componentes no entra siquiera en el paquete (`@/i18n/useTranslation`
// lo usan doce de ellos) y el banco se quedaría en las cuatro vistas que no
// traducen nada — cobertura falsa por fallo de fontanería.
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
await build({ ...comunes, entryPoints: [`${RAIZ}/harness/views-smoke.tsx`], outfile: `${SALIDA}/app.js` });
// LOS DOS WORKERS, empaquetados aparte y servidos en la ruta que el propio
// código pide. `client.ts` hace `new Worker(new URL('../region.worker.ts',
// import.meta.url))` y `useWorldGeneration` lo mismo con el suyo: desde
// `/app.js` eso resuelve a `/region.worker.ts` y a `/worldgen.worker.ts`. Sin
// esto la hoja de comarca se queda en «dibujando…» para siempre y `WorldView`
// nunca llega a tener mundo — y ambas cosas darían un cero de tinta que NO es
// culpa de la aplicación. Un banco que no distingue esos dos ceros no sirve.
await build({ ...comunes, entryPoints: [`${RAIZ}/src/engines/worldgen/region.worker.ts`], outfile: `${SALIDA}/region.worker.js` });
await build({ ...comunes, entryPoints: [`${RAIZ}/src/engines/worldgen/worldgen.worker.ts`], outfile: `${SALIDA}/worldgen.worker.js` });

// ---------------------------------------------------------------------------
// 2. EL CALZO DE CSS — la parte obligatoria
// ---------------------------------------------------------------------------
// Esto es lo que faltaba en el banco 3D que daba verde dibujando nada. Todas
// estas vistas se colocan con utilidades de Tailwind: `absolute inset-0`,
// `flex-1 min-h-0`, `w-[21rem] shrink-0`. Sin ellas el contenedor mide CERO de
// alto, el lienzo nace de 1100x8 y la captura sale negra — y el componente no
// se queja, porque desde su punto de vista todo va bien.
//
// No es Tailwind entero: son las utilidades de COLOCACIÓN que estos ficheros
// usan de verdad (sacadas de sus `className`) más una paleta que imita los
// colores del tema, para que la hoja de contactos se pueda mirar. Las de color
// no cambian ningún tamaño; las de layout sí, y por eso el corredor comprueba
// después que cada lienzo mide exactamente el hueco que se le dio.
const ESCALA = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 52, 56, 60, 64, 72, 80, 96];
const FRAC = { '0.5': 0.125, '1.5': 0.375, '2.5': 0.625, '3.5': 0.875 };
function espaciado() {
  const out = [];
  const add = (nombre, valor) => {
    out.push(`.p-${nombre}{padding:${valor}}`, `.px-${nombre}{padding-left:${valor};padding-right:${valor}}`,
      `.py-${nombre}{padding-top:${valor};padding-bottom:${valor}}`, `.pt-${nombre}{padding-top:${valor}}`,
      `.pb-${nombre}{padding-bottom:${valor}}`, `.pl-${nombre}{padding-left:${valor}}`, `.pr-${nombre}{padding-right:${valor}}`,
      `.m-${nombre}{margin:${valor}}`, `.mx-${nombre}{margin-left:${valor};margin-right:${valor}}`,
      `.my-${nombre}{margin-top:${valor};margin-bottom:${valor}}`, `.mt-${nombre}{margin-top:${valor}}`,
      `.mb-${nombre}{margin-bottom:${valor}}`, `.ml-${nombre}{margin-left:${valor}}`, `.mr-${nombre}{margin-right:${valor}}`,
      `.gap-${nombre}{gap:${valor}}`, `.w-${nombre}{width:${valor}}`, `.h-${nombre}{height:${valor}}`,
      `.max-h-${nombre}{max-height:${valor}}`, `.max-w-${nombre}{max-width:${valor}}`,
      `.top-${nombre}{top:${valor}}`, `.bottom-${nombre}{bottom:${valor}}`, `.left-${nombre}{left:${valor}}`,
      `.right-${nombre}{right:${valor}}`, `.inset-${nombre}{inset:${valor}}`,
      `.space-y-${nombre}>*+*{margin-top:${valor}}`, `.space-x-${nombre}>*+*{margin-left:${valor}}`);
  };
  for (const n of ESCALA) add(String(n), `${n * 0.25}rem`);
  for (const [n, r] of Object.entries(FRAC)) add(n.replace('.', '\\.'), `${r}rem`);
  return out.join('');
}

const CALZO = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:#0b0e14;color:#e6e8ee;
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:16px}
button,input,select,textarea{font:inherit;color:inherit}
button{background:transparent;border:0;cursor:pointer}
input,select,textarea{background:#0e121b;border:1px solid #2a3040;border-radius:4px;padding:2px 4px}
input[type=range]{padding:0;border:0;background:transparent;accent-color:#c4973b}
input[type=checkbox]{accent-color:#c4973b}
svg{display:inline-block;vertical-align:middle}
${espaciado()}
/* --- colocación --- */
.block{display:block}.inline-flex{display:inline-flex}.flex{display:flex}.grid{display:grid}.hidden{display:none}
.flex-col{flex-direction:column}.flex-row{flex-direction:row}.flex-wrap{flex-wrap:wrap}
.flex-1{flex:1 1 0%}.flex-none{flex:none}.shrink-0{flex-shrink:0}.grow{flex-grow:1}
.min-w-0{min-width:0}.min-h-0{min-height:0}
.items-center{align-items:center}.items-start{align-items:flex-start}.items-end{align-items:flex-end}
.items-stretch{align-items:stretch}.items-baseline{align-items:baseline}
.justify-center{justify-content:center}.justify-between{justify-content:space-between}
.justify-end{justify-content:flex-end}.justify-start{justify-content:flex-start}
.place-items-center{place-items:center}
.grid-cols-1{grid-template-columns:repeat(1,minmax(0,1fr))}
.grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}
.grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.grid-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}
.grid-cols-5{grid-template-columns:repeat(5,minmax(0,1fr))}
.col-span-2{grid-column:span 2/span 2}.col-span-3{grid-column:span 3/span 3}
.absolute{position:absolute}.relative{position:relative}.fixed{position:fixed}.sticky{position:sticky}
.inset-0{inset:0}.top-full{top:100%}.left-1\\/2{left:50%}
.-translate-x-1\\/2{transform:translateX(-50%)}
.z-10{z-index:10}.z-20{z-index:20}.z-30{z-index:30}.z-50{z-index:50}
.w-full{width:100%}.h-full{height:100%}.w-px{width:1px}.h-px{height:1px}
.w-\\[21rem\\]{width:21rem}.h-\\[min\\(92vh\\,900px\\)\\]{height:min(92vh,900px)}
.max-w-xs{max-width:20rem}.max-w-5xl{max-width:64rem}.max-w-\\[70\\%\\]{max-width:70%}
.overflow-hidden{overflow:hidden}.overflow-y-auto{overflow-y:auto}.overflow-x-auto{overflow-x:auto}
.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.whitespace-nowrap{white-space:nowrap}.select-none{user-select:none}
.pointer-events-none{pointer-events:none}.touch-none{touch-action:none}
.resize-none{resize:none}.outline-none{outline:none}
.cursor-pointer{cursor:pointer}.cursor-grab{cursor:grab}.cursor-crosshair{cursor:crosshair}
.text-left{text-align:left}.text-center{text-align:center}.text-right{text-align:right}
.tabular-nums{font-variant-numeric:tabular-nums}.font-mono{font-family:ui-monospace,monospace}
.uppercase{text-transform:uppercase}.tracking-wide{letter-spacing:.025em}.tracking-wider{letter-spacing:.05em}
.leading-none{line-height:1}.leading-snug{line-height:1.375}.leading-relaxed{line-height:1.625}
.font-normal{font-weight:400}.font-medium{font-weight:500}.font-semibold{font-weight:600}
.underline{text-decoration:underline}.decoration-dotted{text-decoration-style:dotted}
.rounded-sm{border-radius:2px}.rounded{border-radius:4px}.rounded-md{border-radius:6px}
.rounded-lg{border-radius:8px}.rounded-xl{border-radius:12px}.rounded-full{border-radius:9999px}
.rounded-\\[2px\\]{border-radius:2px}
.border{border-width:1px;border-style:solid}.border-0{border-width:0}
.border-t{border-top-width:1px;border-top-style:solid}.border-b{border-bottom-width:1px;border-bottom-style:solid}
.border-l{border-left-width:1px;border-left-style:solid}.border-r{border-right-width:1px;border-right-style:solid}
.border-dashed{border-style:dashed}
.backdrop-blur,.backdrop-blur-sm{backdrop-filter:blur(4px)}
.transition,.transition-opacity,.transition-\\[width\\]{transition:all .15s ease}
.opacity-0{opacity:0}.opacity-50{opacity:.5}.opacity-60{opacity:.6}
.animate-spin{animation:giro 1s linear infinite}@keyframes giro{to{transform:rotate(360deg)}}
.shadow-lg,.shadow-xl{box-shadow:0 8px 24px rgba(0,0,0,.5)}
/* --- tipos --- */
.text-\\[9px\\]{font-size:9px}.text-\\[10px\\]{font-size:10px}.text-\\[11px\\]{font-size:11px}
.text-\\[13px\\]{font-size:13px}.text-xs{font-size:12px}.text-sm{font-size:14px}.text-lg{font-size:18px}
/* --- paleta del tema (los tokens del CSS de la aplicación no viajan en esta
   copia recortada; se replican a ojo para que el texto se LEA en la hoja de
   contactos. No cambian ningún tamaño). --- */
.bg-deep{background:#0b0e14}.bg-surface{background:#141924}.bg-elevated{background:#1b2130}
.bg-deep\\/70{background:rgba(11,14,20,.7)}.bg-deep\\/60{background:rgba(11,14,20,.6)}
.bg-surface\\/50{background:rgba(20,25,36,.5)}.bg-surface\\/85{background:rgba(20,25,36,.85)}
.bg-surface\\/95{background:rgba(20,25,36,.95)}.bg-elevated\\/60{background:rgba(27,33,48,.6)}
.bg-accent-gold{background:#c4973b}.bg-accent-gold\\/10{background:rgba(196,151,59,.1)}
.bg-accent-gold\\/15{background:rgba(196,151,59,.15)}.bg-accent-gold\\/25{background:rgba(196,151,59,.25)}
.bg-accent-gold\\/5{background:rgba(196,151,59,.05)}
.bg-danger\\/10{background:rgba(200,60,60,.1)}
.text-text-primary{color:#e6e8ee}.text-text-muted{color:#9aa3b5}.text-text-dim{color:#6b7488}
.text-accent-gold{color:#c4973b}.text-accent-gold\\/80{color:rgba(196,151,59,.8)}
.text-accent-gold\\/90{color:rgba(196,151,59,.9)}.text-danger{color:#d4635c}.text-deep{color:#0b0e14}
.text-white{color:#fff}.text-black{color:#000}.text-amber-200{color:#fde68a}
.text-amber-300\\/80{color:rgba(252,211,77,.8)}.text-red-200{color:#fecaca}.text-red-300\\/85{color:rgba(252,165,165,.85)}
.border-border{border-color:#2a3040}.border-border\\/60{border-color:rgba(42,48,64,.6)}
.border-accent-gold{border-color:#c4973b}.border-transparent{border-color:transparent}
.border-danger\\/30{border-color:rgba(212,99,92,.3)}
.accent-\\[\\#c4973b\\],.accent-accent-gold,.accent-amber-400{accent-color:#c4973b}
`;

// Las variantes con barra (`bg-white/8`, `text-white/45`, `border-white/20`,
// `bg-black/50`, `bg-accent-gold/40`…) son legión y todas son SÓLO color. Se
// generan en bloque para que la hoja de contactos se lea; ninguna toca el
// tamaño de nada.
function opacidades() {
  const out = [];
  const grados = [0, 3, 5, 6, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 88, 90, 92, 95, 100];
  const esc = (s) => s.replace(/\//g, '\\/').replace(/\./g, '\\.').replace(/[[\]#()%,]/g, (m) => `\\${m}`);
  for (const g of grados) {
    const a = (g / 100).toFixed(2);
    out.push(`.${esc(`bg-white/${g}`)}{background:rgba(255,255,255,${a})}`);
    out.push(`.${esc(`bg-black/${g}`)}{background:rgba(0,0,0,${a})}`);
    out.push(`.${esc(`text-white/${g}`)}{color:rgba(255,255,255,${a})}`);
    out.push(`.${esc(`border-white/${g}`)}{border-color:rgba(255,255,255,${a})}`);
    out.push(`.${esc(`border-black/${g}`)}{border-color:rgba(0,0,0,${a})}`);
    out.push(`.${esc(`bg-accent-gold/${g}`)}{background:rgba(196,151,59,${a})}`);
    out.push(`.${esc(`border-accent-gold/${g}`)}{border-color:rgba(196,151,59,${a})}`);
    out.push(`.${esc(`bg-amber-400/${g}`)}{background:rgba(251,191,36,${a})}`);
    out.push(`.${esc(`bg-red-400/${g}`)}{background:rgba(248,113,113,${a})}`);
    out.push(`.${esc(`border-red-400/${g}`)}{border-color:rgba(248,113,113,${a})}`);
    out.push(`.${esc(`bg-sky-400/${g}`)}{background:rgba(56,189,248,${a})}`);
    out.push(`.${esc(`bg-white/[0.0${g}]`)}{background:rgba(255,255,255,0.0${g})}`);
  }
  out.push('.bg-amber-400{background:#fbbf24}.bg-white\\/\\[0\\.06\\]{background:rgba(255,255,255,.06)}');
  out.push('.bg-white\\/\\[0\\.05\\]{background:rgba(255,255,255,.05)}.bg-white\\/\\[0\\.03\\]{background:rgba(255,255,255,.03)}');
  return out.join('');
}

const HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>${CALZO}${opacidades()}</style></head><body>
<script type="module" src="/app.js"></script></body></html>`;
// La página se deja en disco: cuando una vista sale colapsada, lo primero que
// hay que poder mirar es el calzo con el que se montó.
writeFileSync(`${SALIDA}/index.html`, HTML);

// Un filtro por línea de órdenes. Una pasada entera son ~25 min de SwiftShader
// y arreglar una vista a ciegas por no poder repetir sólo esa es como se acaba
// bajando el listón para no volver a esperar.
const SOLO = process.argv.slice(2).filter((a) => !a.startsWith('-'));

// ---------------------------------------------------------------------------
// 3. El servidor
// ---------------------------------------------------------------------------
const ficheros = {
  '/app.js': [`${SALIDA}/app.js`, 'text/javascript'],
  '/region.worker.ts': [`${SALIDA}/region.worker.js`, 'text/javascript'],
  '/worldgen.worker.ts': [`${SALIDA}/worldgen.worker.js`, 'text/javascript'],
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

// ---------------------------------------------------------------------------
// 4. El navegador
// ---------------------------------------------------------------------------
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
// El escenario más grande es la cáscara entera (1560x920) y la ventana tiene
// que caber alrededor, o el elemento se recorta al capturarlo y la tinta que se
// mide es la de media vista.
const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1 });

const averias = [];
// Con la CABECERA DE LA PILA. Sin ella el parte decía «TypeError: Cannot read
// properties of null (reading 'setTransform')» y había que salir a buscar a
// mano cuál de los seis `getContext('2d')` del fichero era — que es justo el
// trabajo que un banco existe para ahorrar.
page.on('pageerror', (e) => {
  const pila = (e.stack || String(e)).split('\n').slice(0, 3).map((l) => l.trim()).join(' ← ');
  averias.push(`PAGEERROR ${pila.slice(0, 400)}`);
});
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const texto = m.text();
  // El descargador de tipografías y las extensiones que SwiftShader no trae son
  // del contenedor, no del programa.
  if (/favicon|net::ERR_|THREE\.WebGL|EXT_|OES_/i.test(texto)) return;
  averias.push(`CONSOLE ${texto.slice(0, 400)}`);
});
page.on('weberror', (e) => averias.push(`WEBERROR ${String(e.error()).slice(0, 300)}`));

await page.goto(`http://localhost:${PUERTO}/`, { waitUntil: 'commit', timeout: 60000 });
await page.waitForFunction('window.__humo && window.__humo.listo === true', null, { timeout: 120000 });

console.log('forjando el mundo…');
const resumenMundo = await page.evaluate(() => window.__humo.preparar());
console.log(`mundo ${resumenMundo.ancho}x${resumenMundo.alto} en ${resumenMundo.segundos}s · `
  + `${resumenMundo.poblaciones} poblaciones · ${resumenMundo.reinos} reinos · `
  + `${resumenMundo.ruinas} ruinas · ${resumenMundo.caminos} caminos`);
// Un mundo sin poblaciones ni caminos dibujaría un mapa vacío y TODAS las
// vistas de abajo darían poca tinta sin que ninguna tuviese la culpa. Se
// comprueba aquí para no diagnosticar diecisiete fallos donde hay uno.
const mundoValido = resumenMundo.poblaciones >= 5 && resumenMundo.caminos >= 1 && resumenMundo.reinos >= 1;
if (!mundoValido) console.log('  ¡el mundo de partida ya viene vacío! las medidas de abajo no valen');

const todos = await page.evaluate(() => window.__humo.casos());
const casos = SOLO.length ? todos.filter((c) => SOLO.includes(c.id)) : todos;
if (SOLO.length && casos.length !== SOLO.length) {
  console.log(`aviso: pedidos ${SOLO.join(', ')}; encontrados ${casos.map((c) => c.id).join(', ')}`);
}

// ---------------------------------------------------------------------------
// 5. Las medidas
// ---------------------------------------------------------------------------
/**
 * Lo que se puede leer desde dentro de la página: qué raíz hay, qué lienzos
 * hay y de qué tamaño, cuánto texto se ha pintado y —lo más útil— cuántas
 * claves de traducción se han quedado SIN traducir. `useTranslation` devuelve
 * la clave cuando falta, así que un panel que enseña `worldgen.panel.regions`
 * es un fallo real de la aplicación, no del banco.
 */
const sondaDom = () => {
  const stage = document.getElementById('escenario');
  if (!stage) return { raiz: false };
  const hueco = { w: stage.clientWidth, h: stage.clientHeight };
  const lienzos = [...stage.querySelectorAll('canvas')].map((c) => ({
    w: c.width,
    h: c.height,
    cw: Math.round(c.getBoundingClientRect().width),
    ch: Math.round(c.getBoundingClientRect().height),
    ctx: (() => {
      try { return c.getContext('webgl2') ? 'webgl2' : (c.getContext('2d') ? '2d' : '?'); } catch { return '?'; }
    })(),
  }));
  const andador = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
  const textos = [];
  let n;
  while ((n = andador.nextNode())) {
    const t = (n.textContent || '').trim();
    if (!t) continue;
    const padre = n.parentElement;
    if (!padre) continue;
    const r = padre.getBoundingClientRect();
    // Sólo lo que de verdad ocupa sitio en pantalla: un `<option>` de un
    // desplegable cerrado o un nodo con `display:none` no es texto pintado, y
    // contarlo convertiría un panel en blanco en un panel "con 40 textos".
    if (r.width < 1 || r.height < 1) continue;
    if (getComputedStyle(padre).visibility === 'hidden') continue;
    textos.push(t);
  }
  // La firma de una clave sin traducir: puntos, sin espacios, empieza por un
  // prefijo de módulo conocido.
  const sinTraducir = [...new Set(textos.filter((t) => /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+){2,}$/.test(t)))];
  return {
    raiz: true,
    hueco,
    lienzos,
    textos: textos.length,
    caracteres: textos.join('').length,
    controles: stage.querySelectorAll('button,input,select,textarea').length,
    sinTraducir: sinTraducir.slice(0, 8),
    dpr: window.devicePixelRatio,
  };
};

/**
 * Tinta, bordes y colores de una captura.
 *
 * Tinta sola NO basta y esa es la lección #26: un lienzo que se limpia con un
 * azul de océano tiene el 100 % de «tinta» y no ha dibujado nada. Los BORDES
 * (píxeles que difieren del vecino de la derecha) y los COLORES distintos son
 * los que separan «una vista» de «un rectángulo».
 */
function medirPng(buf) {
  return loadImage(buf).then((img) => {
    const w = img.width;
    const h = img.height;
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    // El fondo del escenario es #0b0e14 — el mismo que la aplicación usa para
    // el hueco vacío. Todo lo que se aparte de él es algo que alguien dibujó.
    const FR = 0x0b, FG = 0x0e, FB = 0x14;
    let tinta = 0;
    let bordes = 0;
    const paleta = new Set();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        if (Math.abs(r - FR) + Math.abs(g - FG) + Math.abs(b - FB) > 12) tinta++;
        paleta.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
        if (x + 1 < w) {
          const j = i + 4;
          if (Math.abs(px[j] - r) + Math.abs(px[j + 1] - g) + Math.abs(px[j + 2] - b) > 24) bordes++;
        }
      }
    }
    const total = w * h;
    return {
      w, h,
      tinta: (100 * tinta) / total,
      bordes: (100 * bordes) / total,
      colores: paleta.size,
    };
  });
}

/** Los umbrales. Cada uno nombra la falta que caza — regla #30: un umbral por
 *  cada falta, no una vara para dos cosas distintas. */
const MIN_TINTA = 3;      // menos de esto es «no dibujó»: el lienzo negro.
const MIN_BORDES = 0.5;   // menos de esto es «pintó un rectángulo liso».
const MIN_COLORES = 12;   // menos de esto es «pintó dos colores planos».
const MIN_TEXTOS = 5;     // un panel de DOM sin cinco textos es un panel vacío.
const MIN_LADO = 200;     // la trampa del 1100x8.

const filas = [];
for (const caso of casos) {
  const pases = [];
  for (let pase = 1; pase <= 2; pase++) {
    const antes = averias.length;
    let fallo = null;
    try {
      await page.evaluate(([id, p]) => window.__humo.montar(id, p), [caso.id, pase]);
    } catch (e) {
      fallo = String(e).slice(0, 200);
    }
    const dom = fallo ? { raiz: false } : await page.evaluate(sondaDom);
    let img = { w: 0, h: 0, tinta: 0, bordes: 0, colores: 0 };
    let png = null;
    if (dom.raiz) {
      try {
        // Se captura por RECORTE y no con `locator.screenshot`, y la diferencia
        // no es cosmética: el localizador espera a que el elemento esté
        // «estable» y el globo nunca lo está —redibuja sin parar bajo
        // SwiftShader—, así que la captura reventaba a los 60 s y el banco
        // apuntaba «0 % de tinta» para una vista que sí dibujaba. Un fallo del
        // banco disfrazado de fallo del programa es lo peor que puede pasar
        // aquí.
        const caja = await page.evaluate(() => {
          const r = document.getElementById('escenario').getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        });
        // 150 s de plazo, y no es generosidad: MEDIDO en este contenedor, un
        // fotograma del globo cuesta 15,3 s con SwiftShader (el del plano,
        // 2,6 s) y en el SEGUNDO montaje va aún más lento porque el contexto
        // WebGL del primero sigue vivo — ver el hallazgo del `forceContextLoss`
        // que falta. Con 60 s la captura reventaba y el banco anotaba «0 % de
        // tinta» para una vista que sí dibuja: un rojo falso que tapa el rojo
        // verdadero.
        png = await page.screenshot({ clip: caja, timeout: 150000, animations: 'allow' });
        img = await medirPng(png);
      } catch (e) {
        fallo = fallo ?? `captura: ${String(e).slice(0, 120)}`;
      }
    }
    if (pase === 2 && png) writeFileSync(`${SALIDA}/${caso.id}.png`, png);
    const quejas = await page.evaluate(() => window.__humo.quejas());
    const mias = quejas.filter((q) => q.caso === caso.id && q.pase === pase);
    const deLaPagina = averias.slice(antes);
    await page.evaluate(() => window.__humo.desmontar());
    pases.push({ dom, img, fallo, quejas: [...mias.map((q) => q.texto), ...deLaPagina] });
  }

  // ---- el juicio, pase a pase ----
  const veredicto = (p) => {
    const malas = [];
    if (p.fallo) malas.push(p.fallo);
    if (!p.dom.raiz) malas.push('sin raíz');
    else {
      const esperado = { w: caso.w, h: caso.h };
      if (p.dom.hueco.w !== esperado.w || p.dom.hueco.h !== esperado.h) {
        malas.push(`hueco ${p.dom.hueco.w}x${p.dom.hueco.h} ≠ ${esperado.w}x${esperado.h}`);
      }
      if (caso.tipo === 'lienzo') {
        if (!p.dom.lienzos.length) malas.push('sin lienzo');
        else {
          // EL 1100x8. Se comprueba el lienzo MAYOR: las vistas llevan uno de
          // terreno y otro de rótulos encima, y el pequeño puede ser legítimo.
          const grande = p.dom.lienzos.reduce((a, b) => (a.cw * a.ch >= b.cw * b.ch ? a : b));
          if (grande.ch < MIN_LADO || grande.cw < MIN_LADO * 2) {
            malas.push(`lienzo colapsado ${grande.cw}x${grande.ch}`);
          } else {
            // Y que el lienzo llene su hueco: un lienzo de 400x300 dentro de un
            // hueco de 1180x760 dibuja bien y enseña un cuarto del mundo.
            const cabe = grande.cw <= p.dom.hueco.w + 2 && grande.ch <= p.dom.hueco.h + 2;
            const llena = grande.cw >= p.dom.hueco.w * 0.5 && grande.ch >= p.dom.hueco.h * 0.5;
            if (!cabe || !llena) malas.push(`lienzo ${grande.cw}x${grande.ch} en hueco ${p.dom.hueco.w}x${p.dom.hueco.h}`);
            // El búfer tiene que ser el CSS por UNA escala uniforme y cuerda,
            // no css×dpr exacto: la escalera de calidad del 3D baja el
            // pixelRatio a propósito (0,85, 0,70…) cuando el fotograma real es
            // lento — y en SwiftShader lo es SIEMPRE, así que con la vía
            // rápida de la escalera (3 muestras > 2 s) el globo del banco
            // llega aquí ya rebajado, legítimamente. Lo que este control caza
            // es otra cosa: un búfer que no siguió al CSS en un eje (se dibuja
            // estirado) o una escala fuera de [0,5 dpr, 2] (borroso de verdad
            // o memoria tirada). La escala IGUAL en los dos ejes es lo que
            // separa «rebajado adrede» de «desincronizado».
            const dpr = Math.min(2, p.dom.dpr || 1);
            const rw = grande.w / grande.cw;
            const rh = grande.h / grande.ch;
            if (Math.abs(rw - rh) > 0.02 || rw < dpr * 0.5 - 0.01 || rw > dpr * 2 + 0.01) {
              malas.push(`búfer ${grande.w}x${grande.h} ≁ css ${grande.cw}x${grande.ch} (escala ${rw.toFixed(2)}/${rh.toFixed(2)}, dpr ${dpr})`);
            }
          }
        }
        if (p.img.tinta < MIN_TINTA) malas.push(`tinta ${p.img.tinta.toFixed(1)}% < ${MIN_TINTA}%`);
        if (p.img.bordes < MIN_BORDES) malas.push(`bordes ${p.img.bordes.toFixed(2)}% — relleno plano`);
        if (p.img.colores < MIN_COLORES) malas.push(`${p.img.colores} colores — relleno plano`);
      } else {
        if (p.dom.textos < MIN_TEXTOS) malas.push(`${p.dom.textos} textos < ${MIN_TEXTOS}`);
        if (p.img.tinta < MIN_TINTA) malas.push(`tinta ${p.img.tinta.toFixed(1)}% < ${MIN_TINTA}%`);
      }
      if (p.dom.sinTraducir?.length) malas.push(`sin traducir: ${p.dom.sinTraducir.join(', ')}`);
    }
    if (p.quejas.length) malas.push(`${p.quejas.length} queja(s)`);
    return malas;
  };

  const m1 = veredicto(pases[0]);
  const m2 = veredicto(pases[1]);
  // Y la comparación entre pases: una vista que dibuja la mitad al volver a
  // montarse está viva pero rota, y ninguno de los dos veredictos por separado
  // lo dice.
  const caida = pases[0].img.tinta > 1 && pases[1].img.tinta < pases[0].img.tinta * 0.6
    ? [`tinta cae ${pases[0].img.tinta.toFixed(1)}% → ${pases[1].img.tinta.toFixed(1)}% al remontar`]
    : [];
  filas.push({ caso, pases, malas: [...m1.map((x) => `1: ${x}`), ...m2.map((x) => `2: ${x}`), ...caida] });
  const p2 = pases[1];
  const lienzo = p2.dom.lienzos?.length
    ? (() => { const g = p2.dom.lienzos.reduce((a, b) => (a.cw * a.ch >= b.cw * b.ch ? a : b)); return `${g.cw}x${g.ch}`; })()
    : '—';
  console.log(`  ${[...m1, ...m2, ...caida].length ? '✗' : '✓'} ${caso.id.padEnd(18)} `
    + `lienzo ${lienzo.padEnd(9)} tinta ${p2.img.tinta.toFixed(1).padStart(5)}% `
    + `bordes ${p2.img.bordes.toFixed(2).padStart(5)}% textos ${String(p2.dom.textos ?? 0).padStart(3)}`);
}

await browser.close();
server.close();

// ---------------------------------------------------------------------------
// 6. La tabla
// ---------------------------------------------------------------------------
const col = (s, n) => String(s).padEnd(n).slice(0, n);
const der = (s, n) => String(s).padStart(n);
console.log('');
console.log('┌──────────────────────┬───────┬────────────┬──────────┬────────┬────────┬────────┐');
console.log('│ vista                │ monta │ lienzo     │ tinta %  │ bordes │ textos │ quejas │');
console.log('├──────────────────────┼───────┼────────────┼──────────┼────────┼────────┼────────┤');
for (const f of filas) {
  const p = f.pases[1];
  const g = p.dom.lienzos?.length ? p.dom.lienzos.reduce((a, b) => (a.cw * a.ch >= b.cw * b.ch ? a : b)) : null;
  const quejas = f.pases[0].quejas.length + f.pases[1].quejas.length;
  console.log(`│ ${col(f.caso.id, 20)} │ ${col(p.dom.raiz ? '  sí' : '  NO', 5)} │ `
    + `${col(g ? `${g.cw}x${g.ch}` : '—', 10)} │ ${der(p.img.tinta.toFixed(1), 8)} │ `
    + `${der(p.img.bordes.toFixed(2), 6)} │ ${der(p.dom.textos ?? 0, 6)} │ ${der(quejas, 6)} │`);
}
console.log('└──────────────────────┴───────┴────────────┴──────────┴────────┴────────┴────────┘');

const rotos = filas.filter((f) => f.malas.length);
if (rotos.length) {
  console.log('\nEN ROJO');
  for (const f of rotos) {
    console.log(`  ${f.caso.id} — ${f.caso.titulo}`);
    for (const m of f.malas) console.log(`      ${m}`);
    for (const p of f.pases) {
      for (const q of [...new Set(p.quejas)].slice(0, 4)) console.log(`      · ${q}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 7. La hoja de contactos
// ---------------------------------------------------------------------------
// Para que una persona pueda mirar las diecisiete de un vistazo y decir «esa no
// es esa vista» — que es la única comprobación que ningún número hace.
const COLS = 5;
const CW = 420;
const CH = 300;
const CAB = 26;
const filas2 = Math.ceil(filas.length / COLS);
const hoja = createCanvas(COLS * CW, filas2 * (CH + CAB) + 34);
const hctx = hoja.getContext('2d');
hctx.fillStyle = '#12151c';
hctx.fillRect(0, 0, hoja.width, hoja.height);
hctx.fillStyle = '#e6e8ee';
hctx.font = 'bold 16px sans-serif';
hctx.fillText(`banco de vistas · mundo ${resumenMundo.ancho}x${resumenMundo.alto} · `
  + `${resumenMundo.poblaciones} poblaciones · ${filas.length - rotos.length}/${filas.length} en verde`, 10, 22);
for (let i = 0; i < filas.length; i++) {
  const f = filas[i];
  const x = (i % COLS) * CW;
  const y = Math.floor(i / COLS) * (CH + CAB) + 34;
  const p = f.pases[1];
  hctx.fillStyle = f.malas.length ? '#5a1f1f' : '#1a2230';
  hctx.fillRect(x + 2, y, CW - 4, CH + CAB - 4);
  hctx.fillStyle = f.malas.length ? '#ffb4b4' : '#c8d2e4';
  hctx.font = '12px sans-serif';
  hctx.fillText(`${f.malas.length ? '✗' : '✓'} ${f.caso.id} · ${p.img.tinta.toFixed(1)}% tinta`
    + `${p.dom.textos ? ` · ${p.dom.textos} txt` : ''}`, x + 8, y + 16);
  const ruta = `${SALIDA}/${f.caso.id}.png`;
  if (existsSync(ruta)) {
    const im = await loadImage(readFileSync(ruta));
    const s = Math.min((CW - 12) / im.width, (CH - 8) / im.height);
    hctx.drawImage(im, x + 6, y + CAB, im.width * s, im.height * s);
  }
}
writeFileSync(`${SALIDA}/contactos.png`, hoja.toBuffer('image/png'));
console.log(`\nhoja de contactos: ${SALIDA}/contactos.png`);
console.log(`${filas.length - rotos.length}/${filas.length} vistas en verde`);
if (!mundoValido) console.log('AVISO: el mundo de partida vino vacío');
process.exit(rotos.length || !mundoValido ? 1 : 0);
