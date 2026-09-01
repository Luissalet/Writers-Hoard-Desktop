const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

location.hash = '#/project/proj_mthy3jeu_q7kvd1/writings';
await sleep(2400);

const order = () =>
  [...document.querySelectorAll('*')]
    .filter((el) => el.children.length === 0 && /^\d+$/.test((el.textContent || '').trim()))
    .slice(0, 0); // placeholder

out.toolbar = [...document.querySelectorAll('button')]
  .map((b) => (b.textContent || '').trim())
  .filter((text) => text && text.length < 26)
  .slice(0, 14);

const ups = [...document.querySelectorAll('button')].filter((b) =>
  /subir en el manuscrito/i.test(b.getAttribute('aria-label') || b.title || ''),
);
const downs = [...document.querySelectorAll('button')].filter((b) =>
  /bajar en el manuscrito/i.test(b.getAttribute('aria-label') || b.title || ''),
);
out.upArrows = ups.length;
out.downArrows = downs.length;
out.renumberButton = [...document.querySelectorAll('button')].some((b) =>
  /^renumerar$/i.test((b.textContent || '').trim()),
);

const listText = () =>
  ((document.querySelector('main') || document.body).innerText || '')
    .replace(/\s*\n\s*/g, ' | ');

out.before = listText().slice(0, 700);

// Move the last chapter up one place and see the numbers change.
if (downs.length) {
  ups[ups.length - 1]?.click();
  await sleep(2600);
  out.after = listText().slice(0, 700);
}

return JSON.stringify(out, null, 2);
