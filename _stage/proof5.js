location.hash = '#/project/proj_mthy3jeu_q7kvd1/overview';
await new Promise(r => setTimeout(r, 1200));
const sup = [...document.querySelectorAll('button')].find(b => /supervisar/i.test(b.innerText || ''));
if (sup) { sup.click(); await new Promise(r => setTimeout(r, 700)); }
const estado = [...document.querySelectorAll('button')].find(b => (b.innerText || '').trim() === 'Estado');
if (estado) { estado.click(); await new Promise(r => setTimeout(r, 700)); }
const analyse = [...document.querySelectorAll('button')].find(b => /analizar el manuscrito|analizar de nuevo/i.test(b.innerText || ''));
if (!analyse) return { step: 'no analyse', tail: (document.body.innerText || '').slice(-800) };
analyse.click();
for (let i = 0; i < 60; i++) {
  await new Promise(r => setTimeout(r, 500));
  const t = document.body.innerText || '';
  if (!/Aún no se ha analizado nada|Leyendo el manuscrito/i.test(t)) break;
}
const text = document.body.innerText || '';
const idx = text.search(/lector de pruebas/i);
return idx >= 0 ? text.slice(idx, idx + 3000) : text.slice(-3000);
