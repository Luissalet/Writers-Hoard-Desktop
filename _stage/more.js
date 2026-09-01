const out = {};
// --- Engine manager: open it and read the preset switcher ---
const em = [...document.querySelectorAll('button')].find(b => /gestionar motores/i.test(b.innerText || ''));
if (em) {
  em.click();
  await new Promise(r => setTimeout(r, 900));
  const change = [...document.querySelectorAll('button')].find(b => /cambiar modo/i.test(b.innerText || ''));
  if (change) { change.click(); await new Promise(r => setTimeout(r, 700)); }
  const t = document.body.innerText || '';
  const i = t.search(/gestionar motores|modo actual/i);
  out.engineManager = i >= 0 ? t.slice(i, i + 1400).replace(/\n+/g, ' | ') : 'not found';
  const close = [...document.querySelectorAll('button')].find(b => /^(cancelar|cerrar)$/i.test((b.innerText || '').trim()));
  if (close) { close.click(); await new Promise(r => setTimeout(r, 500)); }
} else out.engineManager = 'no button';
return out;
