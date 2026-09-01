const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

location.hash = '#/project/proj_mthy3jeu_q7kvd1/outline';
await sleep(1800);

// What does a beat card actually offer without opening anything?
const card = [...document.querySelectorAll('div')].find((d) =>
  /Aurelia descubre la carta/.test(d.textContent || '') && d.querySelectorAll('button').length > 0
  && !/Marek decide/.test(d.textContent || ''),
);
out.cardText = card ? (card.innerText || '').replace(/\s*\n\s*/g, ' | ').slice(0, 200) : '(none)';
out.cardButtons = card
  ? [...card.querySelectorAll('button')].map((b) => ({
      text: (b.textContent || '').trim().slice(0, 40),
      title: b.title || b.getAttribute('aria-label') || null,
    }))
  : [];

// How many clicks to link a beat to a chapter?
if (card) {
  const clickable = card.querySelector('button') || card;
  clickable.click();
  await sleep(1500);
}
out.afterClick = ((document.querySelector('main') || document.body).innerText || '')
  .replace(/\s*\n\s*/g, ' | ')
  .slice(0, 900);
const selects = [...document.querySelectorAll('select')];
out.selects = selects.map((s) => ({
  label: s.getAttribute('aria-label') || s.previousElementSibling?.textContent?.trim().slice(0, 40) || null,
  options: [...s.options].slice(0, 6).map((o) => o.text.slice(0, 40)),
}));

return JSON.stringify(out, null, 2);
