const el = [...document.querySelectorAll('button')].find(b => (b.title || '').startsWith('Leer desde'));
if (!el) return 'NOT FOUND';
el.click();
await new Promise(r => setTimeout(r, 1500));
return document.body.innerText.slice(0, 1200);
