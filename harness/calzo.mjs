// ============================================================================
// EL CALZO DE CSS DE LOS BANCOS DE VISTAS — compartido
// ============================================================================
// Copiado tal cual del corredor del banco de arranque (views-smoke-run.mjs),
// donde su comentario explica por qué es OBLIGATORIO: sin las utilidades de
// colocación el contenedor mide cero, el lienzo nace deforme (el 1100x8 —
// aquí, un 1280x3925) y la vista «dibuja» sin que nada se vea. Cualquier
// banco que monte una vista real debe servir `calzoCSS()` en su página.
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


export function calzoCSS() { return CALZO + opacidades(); }
