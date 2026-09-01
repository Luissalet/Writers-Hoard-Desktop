const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

location.hash = '#/project/proj_mthy3jeu_q7kvd1/writings';
await sleep(1200);
location.hash = '#/project/proj_mthy3jeu_q7kvd1/outline';
await sleep(2600);

out.outline = ((document.querySelector('main') || document.body).innerText || '')
  .replace(/\s*\n\s*/g, ' | ')
  .slice(0, 420);
out.writeButtonsLeft = [...document.querySelectorAll('button')].filter((b) =>
  /escribir este beat/i.test(b.getAttribute('aria-label') || ''),
).length;
out.linkChips = [...document.querySelectorAll('[title]')]
  .filter((el) => /enlazado a|linked to/i.test(el.title || ''))
  .map((el) => el.title.slice(0, 70));

// Second beat: press it too, so two of three are written.
const write = [...document.querySelectorAll('button')].filter((b) =>
  /escribir este beat/i.test(b.getAttribute('aria-label') || ''),
);
if (write.length) {
  write[0].click();
  await sleep(3200);
  out.secondRoute = location.hash;
}

return JSON.stringify(out, null, 2);
