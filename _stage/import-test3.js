const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const titles = [...document.querySelectorAll('input')].filter(el => el.type === 'text' && el.value).map(el => el.value);
// The ConfirmDialog is the topmost fixed layer; take its own confirm button.
const layers = [...document.querySelectorAll('div')].filter(d => {
  const s = getComputedStyle(d);
  return s.position === 'fixed' && d.offsetHeight > 120 && /crear \d+ escritos nuevos/i.test(d.innerText || '');
});
const dialog = layers[layers.length - 1];
if (!dialog) return { titles, step: 'no confirm dialog on screen' };
const confirm = [...dialog.querySelectorAll('button')].find(b => /^importar$/i.test((b.innerText || '').trim()));
if (!confirm) return { titles, step: 'no confirm button', buttons: [...dialog.querySelectorAll('button')].map(b => b.innerText.trim()) };
confirm.click();
await sleep(4000);
const t = document.body.innerText || '';
const i = t.search(/Todos\n/);
return {
  titles,
  toast: (t.match(/\d+ capítulos importados[^\n]*/) || ['(no toast)'])[0],
  list: t.slice(i, i + 1000).replace(/\n+/g, ' | '),
};
