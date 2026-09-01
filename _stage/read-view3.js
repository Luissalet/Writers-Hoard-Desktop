const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { steps: [] };

const pct = () => {
  const spans = [...document.querySelectorAll('span')].filter((s) =>
    /^\s*\d+\s*%\s*$/.test(s.textContent || ''),
  );
  return spans.length ? (spans[spans.length - 1].textContent || '').trim() : '(none)';
};

const scroller = [...document.querySelectorAll('div')].find(
  (d) => d.querySelector('[data-piece-id]') && d.scrollHeight > d.clientHeight + 10,
);
if (!scroller) return JSON.stringify({ error: 'reading view not open' });

// The list is virtualised: reaching the bottom mounts the last pieces at their
// REAL heights, which makes the book taller than the estimate did. Keep asking
// for the bottom until the scroller stops moving under us.
let previous = -1;
for (let attempt = 0; attempt < 8 && scroller.scrollTop !== previous; attempt += 1) {
  previous = scroller.scrollTop;
  scroller.scrollTop = scroller.scrollHeight;
  scroller.dispatchEvent(new Event('scroll'));
  await sleep(700);
  out.steps.push({ attempt, scrollTop: Math.round(scroller.scrollTop), height: scroller.scrollHeight, pct: pct() });
}
out.settledPct = pct();
out.pieceOf = ((document.querySelector('header') || document.body).innerText || '')
  .replace(/\s*\n\s*/g, ' | ')
  .slice(-80);
return JSON.stringify(out, null, 2);
