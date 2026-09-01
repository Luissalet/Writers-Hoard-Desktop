const sleep = (ms) => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 4; i++) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(300);
}
// Click any leftover close/cancel buttons.
for (const b of [...document.querySelectorAll('button')]) {
  if (/^(cancelar|cerrar)$/i.test((b.innerText || '').trim())) { b.click(); await sleep(400); }
}
const exp = [...document.querySelectorAll('button')].find(b => /exportar/i.test((b.innerText || '') + ' ' + (b.title || '')));
if (!exp) return 'no export button';
exp.click();
await sleep(2500);
const fixed = [...document.querySelectorAll('div')].filter(d => {
  const s = getComputedStyle(d);
  return s.position === 'fixed' && d.offsetHeight > 250;
});
const texts = fixed.map(d => (d.innerText || '').replace(/\n+/g, ' | ').slice(0, 1400));
return { count: fixed.length, last: texts[texts.length - 1] };
