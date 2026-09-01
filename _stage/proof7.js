const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

location.hash = '#/project/proj_mthy3jeu_q7kvd1/overview?panel=health';
await sleep(1800);

const analyse = [...document.querySelectorAll('button')].find((b) =>
  /analizar/i.test(b.textContent || ''),
);
if (analyse) analyse.click();
await sleep(7000);

// The deepest element holding the collapsed detail is the finding row.
const hits = [...document.querySelectorAll('div')].filter((d) =>
  /Ningún escrito está en la columna narrativa/.test(d.textContent || ''),
);
const row = hits[hits.length - 1]?.closest('div.flex.flex-col') || hits[hits.length - 1];
out.rowText = row ? (row.innerText || '').replace(/\s*\n\s*/g, ' | ').slice(0, 200) : '(none)';
const openBtn = row
  ? [...row.querySelectorAll('button')].find((b) => /^abrir$/i.test((b.textContent || '').trim()))
  : null;
out.foundOpen = Boolean(openBtn);
if (openBtn) openBtn.click();
await sleep(2200);
out.routeAfterOpen = location.hash;
out.screen = ((document.querySelector('main') || document.body).innerText || '')
  .replace(/\s*\n\s*/g, ' | ')
  .slice(0, 320);

return JSON.stringify(out, null, 2);
