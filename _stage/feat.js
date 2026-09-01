const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

// 1. Reading resume: open the reader, scroll in, leave, reopen.
location.hash = '#/project/proj_mthy3jeu_q7kvd1/writings';
await sleep(2200);
const read = [...document.querySelectorAll('button')].find((b) => /^leer$/i.test((b.textContent || '').trim()));
out.readBtn = Boolean(read);
if (read) read.click();
await sleep(2500);

const scroller = [...document.querySelectorAll('div')].find(
  (d) => d.querySelector('[data-piece-id]') && d.scrollHeight > d.clientHeight + 10,
);
if (scroller) {
  scroller.scrollTop = Math.floor(scroller.scrollHeight * 0.55);
  scroller.dispatchEvent(new Event('scroll'));
  await sleep(3000);
  const pct = [...document.querySelectorAll('span')].filter((s) => /^\s*\d+\s*%\s*$/.test(s.textContent || ''));
  out.pctBeforeLeaving = pct.length ? pct[pct.length - 1].textContent.trim() : '(none)';
}

// Leave with Escape, then reopen.
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await sleep(1500);
const exit = [...document.querySelectorAll('button')].find((b) => /salir|cerrar/i.test(b.getAttribute('aria-label') || b.title || ''));
if (exit) exit.click();
await sleep(1800);
out.leftReader = !document.querySelector('[data-piece-id]');

const read2 = [...document.querySelectorAll('button')].find((b) => /^leer$/i.test((b.textContent || '').trim()));
if (read2) read2.click();
await sleep(3500);
const pct2 = [...document.querySelectorAll('span')].filter((s) => /^\s*\d+\s*%\s*$/.test(s.textContent || ''));
out.pctAfterReopen = pct2.length ? pct2[pct2.length - 1].textContent.trim() : '(none)';
out.resumeNote = ((document.querySelector('header') || document.body).innerText || '')
  .replace(/\s*\n\s*/g, ' | ').slice(0, 260);

return JSON.stringify(out, null, 2);
