location.hash = '#/';
await new Promise(r => setTimeout(r, 900));
const btn = [...document.querySelectorAll('button')].find(b => /nuevo proyecto/i.test(b.innerText || ''));
if (!btn) return 'no new-project button';
btn.click();
await new Promise(r => setTimeout(r, 800));
const fields = [...document.querySelectorAll('input, textarea, select')].map((el, i) => ({
  i, tag: el.tagName, type: el.type, placeholder: el.placeholder || null, value: (el.value || '').slice(0, 30),
}));
const modeButtons = [...document.querySelectorAll('button')]
  .map(b => (b.innerText || '').trim().split('\n')[0]).filter(Boolean).slice(0, 40);
return { fields, modeButtons };
