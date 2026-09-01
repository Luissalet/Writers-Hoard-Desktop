function setValue(el, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function palette() {
  const input = [...document.querySelectorAll('input')].find(el => /buscar o ejecutar/i.test(el.placeholder || ''));
  if (!input) return null;
  let node = input;
  for (let i = 0; i < 8 && node.parentElement; i++) {
    node = node.parentElement;
    const pos = getComputedStyle(node).position;
    if (pos === 'fixed' || pos === 'absolute') break;
  }
  return { input, box: node };
}
let p = palette();
if (!p) {
  const open = [...document.querySelectorAll('button')].find(b => /buscar/i.test(b.getAttribute('aria-label') || ''));
  if (open) open.click();
  await new Promise(r => setTimeout(r, 800));
  p = palette();
}
if (!p) return 'palette did not open';

const out = [];
for (const q of ['carta', 'Aurelia', '"cruzo el patio"', 'marek -carta', 'engine:codex marek', 'cruzó', 'CRUZO']) {
  setValue(p.input, q);
  await new Promise(r => setTimeout(r, 1000));
  const t = (p.box.innerText || '').replace(/\n+/g, ' | ');
  out.push({ q, palette: t.slice(0, 320) });
}
return out;
