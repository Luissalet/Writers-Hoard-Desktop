const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { errors: [] };
window.addEventListener('error', (e) => out.errors.push(String(e.message)));
window.onunhandledrejection = (e) => out.errors.push('rejection: ' + String(e.reason));

location.hash = '#/project/proj_mthy3jeu_q7kvd1/writings';
await sleep(3500);
const screen = ((document.querySelector('main') || document.body).innerText || '')
  .replace(/\s*\n\s*/g, ' | ');
out.crashed = /No se pudo abrir este motor/.test(screen);

// The boundary has a details toggle; open it.
const details = [...document.querySelectorAll('button, summary')].find((b) =>
  /detalle/i.test(b.textContent || ''),
);
if (details) { details.click(); await sleep(900); }
out.detail = ((document.querySelector('main') || document.body).innerText || '')
  .replace(/\s*\n\s*/g, ' | ')
  .slice(0, 900);
out.stored = (window.__whErrors || []).slice(-4);
return JSON.stringify(out, null, 2);
