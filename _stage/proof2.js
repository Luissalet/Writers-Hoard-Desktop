const sup = [...document.querySelectorAll('button')].find(b => /supervisar/i.test(b.innerText || ''));
if (!sup) return 'no Supervisar';
sup.click();
await new Promise(r => setTimeout(r, 900));
const subTabs = [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).filter(t => t && t.length < 26);
const analyse = [...document.querySelectorAll('button')].find(b => /analizar/i.test(b.innerText || ''));
if (analyse) {
  analyse.click();
  await new Promise(r => setTimeout(r, 5000));
}
const text = document.body.innerText || '';
const idx = text.search(/lector de pruebas/i);
return {
  foundAnalyse: Boolean(analyse),
  subTabs: subTabs.slice(0, 30),
  panel: idx >= 0 ? text.slice(idx, idx + 1800) : 'PROOFREADER NOT IN DOM',
};
