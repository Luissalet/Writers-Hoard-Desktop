function setValue(el, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const results = [];
const open = [...document.querySelectorAll('button')].find(b => /buscar/i.test(b.getAttribute('aria-label') || ''));
if (!open) return 'no search button';
open.click();
await new Promise(r => setTimeout(r, 700));

const queries = ['carta', 'Aurelia', '"cruzo el patio"', 'marek -carta', 'engine:codex marek', 'cruzo', 'CRUZÓ'];
for (const q of queries) {
  const input = document.querySelector('input[type="text"], input:not([type])');
  if (!input) { results.push({ q, error: 'no input' }); continue; }
  setValue(input, q);
  await new Promise(r => setTimeout(r, 900));
  const text = document.body.innerText || '';
  const idx = text.search(/operadores|resultado|sin resultados/i);
  results.push({ q, sample: text.slice(Math.max(0, idx - 60), idx + 420).replace(/\n+/g, ' | ').slice(0, 420) });
}
return results;
