const sleep = (ms) => new Promise(r => setTimeout(r, ms));
location.hash = '#/project/proj_mthy3jeu_q7kvd1/writings';
await sleep(1500);
const exp = [...document.querySelectorAll('button')].find(b => /compilar/i.test(b.innerText || ''));
if (!exp) return { step: 'no compile button', buttons: [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).filter(Boolean).slice(0, 30) };
exp.click();
await sleep(3000);
const fixed = [...document.querySelectorAll('div')].filter(d => {
  const s = getComputedStyle(d);
  return s.position === 'fixed' && d.offsetHeight > 250;
});
const last = fixed[fixed.length - 1];
const t = last ? (last.innerText || '').replace(/\n+/g, ' | ') : 'none';
return { fixedCount: fixed.length, hasPreview: /vista previa/i.test(t), text: t.slice(0, 1800) };
