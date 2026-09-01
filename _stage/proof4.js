const analyse = [...document.querySelectorAll('button')].find(b => /analizar el manuscrito|analizar de nuevo/i.test(b.innerText || ''));
if (!analyse) return 'no analyse button on this tab';
const t0 = performance.now();
analyse.click();
// Poll until the idle state goes away or we give up.
for (let i = 0; i < 40; i++) {
  await new Promise(r => setTimeout(r, 500));
  const t = document.body.innerText || '';
  if (!/Aún no se ha analizado nada|Leyendo el manuscrito/i.test(t)) break;
}
const text = document.body.innerText || '';
const idx = text.search(/lector de pruebas/i);
return { ms: Math.round(performance.now() - t0), panel: idx >= 0 ? text.slice(idx, idx + 2500) : text.slice(-2500) };
