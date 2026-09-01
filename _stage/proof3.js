const names = ['Estado', 'Inteligencia narrativa', 'Resumen'];
const out = [];
for (const name of names) {
  const btn = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === name);
  if (!btn) { out.push({ name, clicked: false }); continue; }
  btn.click();
  await new Promise(r => setTimeout(r, 900));
  const text = document.body.innerText || '';
  const has = /lector de pruebas/i.test(text);
  const analyse = [...document.querySelectorAll('button')].find(b => /analizar/i.test(b.innerText || ''));
  out.push({ name, clicked: true, hasProofreader: has, hasAnalyse: Boolean(analyse), sample: text.slice(text.length - 900) });
  if (has) break;
}
return out;
