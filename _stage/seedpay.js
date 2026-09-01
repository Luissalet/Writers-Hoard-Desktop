const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

// First: the outline chip after two beats were written.
location.hash = '#/project/proj_mthy3jeu_q7kvd1/outline';
await sleep(2400);
out.outline = ((document.querySelector('main') || document.body).innerText || '')
  .replace(/\s*\n\s*/g, ' | ').slice(0, 330);
out.chipTitles = [...document.querySelectorAll('div[title]')]
  .filter((el) => /Enlazado:/.test(el.title || ''))
  .map((el) => el.title.slice(0, 80));

// Then the seeds quick payoff.
location.hash = '#/project/proj_mthy3jeu_q7kvd1/seeds';
await sleep(2200);
const mark = [...document.querySelectorAll('button')].find((b) =>
  /marcar como pagada/i.test(b.textContent || ''),
);
out.markButton = Boolean(mark);
if (!mark) {
  out.seeds = ((document.querySelector('main') || document.body).innerText || '')
    .replace(/\s*\n\s*/g, ' | ').slice(0, 500);
  return JSON.stringify(out, null, 2);
}
mark.click();
await sleep(2500);
out.drawer = ((document.querySelector('main') || document.body).innerText || '')
  .replace(/\s*\n\s*/g, ' | ').slice(0, 700);
out.selects = [...document.querySelectorAll('select')].map((s) => ({
  optionCount: s.options.length,
  first: [...s.options].slice(0, 4).map((o) => o.text.slice(0, 32)),
}));

return JSON.stringify(out, null, 2);
