const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const titles = [...document.querySelectorAll('input[type="text"]')].map(el => el.value).filter(Boolean);
const doImport = [...document.querySelectorAll('button')].find(b => /^importar$/i.test((b.innerText || '').trim()));
if (!doImport) return { titles, step: 'no import button' };
doImport.click();
await sleep(1200);
// A ConfirmDialog stands between the click and the write.
const confirm = [...document.querySelectorAll('button')].find(b => /^(importar|crear|confirmar|sí)/i.test((b.innerText || '').trim()) && b !== doImport);
const dialogText = (document.body.innerText || '');
const ci = dialogText.search(/crear \d+ escritos nuevos/i);
if (confirm) { confirm.click(); await sleep(3000); }
const after = document.body.innerText || '';
return {
  titles,
  confirmSeen: ci >= 0 ? dialogText.slice(ci, ci + 220).replace(/\n+/g, ' | ') : 'no confirm text',
  listTail: after.slice(0, 1400).replace(/\n+/g, ' | '),
};
