function setValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
const mode = [...document.querySelectorAll('button')].find(b => /^Novelista/.test((b.innerText || '').trim()));
if (!mode) return 'no Novelista button (is the modal open?)';
mode.click();
await new Promise(r => setTimeout(r, 800));

const text = [...document.querySelectorAll('input')].filter(el => el.type === 'text' || !el.type || el.type === 'search');
if (!text.length) return { step: 'no text field', body: (document.body.innerText || '').slice(-1500) };
setValue(text[0], 'ZZ Prueba Claude (borrar)');
await new Promise(r => setTimeout(r, 400));

const create = [...document.querySelectorAll('button')].find(b => /^(crear|crear proyecto)/i.test((b.innerText || '').trim()));
const labels = [...document.querySelectorAll('button')].map(b => (b.innerText || '').trim()).filter(Boolean).slice(-14);
if (!create) return { step: 'no create button', labels, body: (document.body.innerText || '').slice(-1200) };
create.click();
await new Promise(r => setTimeout(r, 1800));
return { step: 'created', hash: location.hash, body: (document.body.innerText || '').slice(0, 700) };
