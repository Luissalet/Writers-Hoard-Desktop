const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

// The synopsis field must hold the beat's plan, and the page must be empty.
const synopsis = [...document.querySelectorAll('textarea, input')].find((el) =>
  /sinopsis/i.test(el.getAttribute('aria-label') || el.placeholder || ''),
);
out.synopsisValue = synopsis ? (synopsis.value || '').slice(0, 160) : '(field not found)';
const prose = document.querySelector('.ProseMirror');
out.pageText = prose ? (prose.innerText || '').trim().slice(0, 120) : '(no editor)';

// Back to the spine: that beat must no longer offer to be written, and must
// now show the chapter it points at.
location.hash = '#/project/proj_mthy3jeu_q7kvd1/outline';
await sleep(2500);
out.writeButtonsLeft = [...document.querySelectorAll('button')].filter((b) =>
  /escribir este beat/i.test(b.getAttribute('aria-label') || ''),
).length;
out.outline = ((document.querySelector('main') || document.body).innerText || '')
  .replace(/\s*\n\s*/g, ' | ')
  .slice(0, 400);

return JSON.stringify(out, null, 2);
