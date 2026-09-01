const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function setValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}
location.hash = '#/project/proj_mthy3jeu_q7kvd1/writings';
await sleep(1500);
const open = [...document.querySelectorAll('button')].find(b => /importar manuscrito/i.test(b.innerText || ''));
if (!open) return { step: 'no import button', buttons: [...document.querySelectorAll('button')].map(b => (b.innerText||'').trim()).filter(Boolean).slice(0, 24) };
open.click();
await sleep(1200);

const paste = [...document.querySelectorAll('textarea')].find(el => /pega|paste/i.test(el.placeholder || ''));
if (!paste) return { step: 'no paste area', modal: (document.body.innerText || '').slice(-1200) };

const manuscript = [
  '# El pozo seco',
  '',
  'Aurelia bajo al pozo con una cuerda prestada. El agua se habia ido hacia anos.',
  '',
  '# La carta quemada',
  '',
  'Marek miro arder el papel y no sintio nada. Era **suyo** y ya no lo era.',
  '',
  '# El mar al final',
  '',
  'El mar estaba mas lejos de lo que decian los mapas.',
].join('\n');
setValue(paste, manuscript);
await sleep(500);
const use = [...document.querySelectorAll('button')].find(b => /usar este texto/i.test(b.innerText || ''));
if (!use) return { step: 'no use-paste button' };
use.click();
await sleep(1500);
const preview = (document.body.innerText || '');
const i = preview.search(/capítulos que se van a crear/i);
return { step: 'preview', preview: (i >= 0 ? preview.slice(i, i + 900) : preview.slice(-900)).replace(/\n+/g, ' | ') };
