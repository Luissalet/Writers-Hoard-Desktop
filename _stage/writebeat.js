const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

location.hash = '#/project/proj_mthy3jeu_q7kvd1/outline';
await sleep(2200);

// The action is hover-revealed; find it by its accessible name, not by hovering.
const write = [...document.querySelectorAll('button')].filter(
  (b) => /escribir este beat/i.test(b.getAttribute('aria-label') || ''),
);
out.writeButtons = write.length;
if (write.length === 0) {
  out.outline = ((document.querySelector('main') || document.body).innerText || '')
    .replace(/\s*\n\s*/g, ' | ').slice(0, 400);
  return JSON.stringify(out, null, 2);
}

write[0].click();
await sleep(3500);

out.routeAfter = location.hash;
out.toast = [...document.querySelectorAll('[role="status"], [role="alert"], .toast, [data-toast]')]
  .map((n) => (n.innerText || '').trim().replace(/\s*\n\s*/g, ' | '))
  .filter(Boolean)
  .slice(0, 3);
out.screen = ((document.querySelector('main') || document.body).innerText || '')
  .replace(/\s*\n\s*/g, ' | ')
  .slice(0, 800);

return JSON.stringify(out, null, 2);
