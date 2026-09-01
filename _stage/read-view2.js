const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

location.hash = '#/project/proj_mthy3jeu_q7kvd1/writings';
await sleep(1800);

const read = [...document.querySelectorAll('button')].find((b) =>
  /^leer$/i.test((b.textContent || '').trim()),
);
out.readBtn = Boolean(read);
if (read) read.click();
await sleep(2500);

const pct = () => {
  const spans = [...document.querySelectorAll('span')].filter((s) =>
    /^\s*\d+\s*%\s*$/.test(s.textContent || ''),
  );
  return spans.length ? (spans[spans.length - 1].textContent || '').trim() : '(none)';
};

// The scroller is the tall overflow-y-auto element holding the pieces.
const scroller = [...document.querySelectorAll('div')].find(
  (d) => d.querySelector('[data-piece-id]') && d.scrollHeight > d.clientHeight + 10,
);
out.hasScroller = Boolean(scroller);
out.atTop = pct();

if (scroller) {
  out.scrollHeight = scroller.scrollHeight;
  out.clientHeight = scroller.clientHeight;
  scroller.scrollTop = Math.floor((scroller.scrollHeight - scroller.clientHeight) / 2);
  scroller.dispatchEvent(new Event('scroll'));
  await sleep(900);
  out.atMiddle = pct();

  scroller.scrollTop = scroller.scrollHeight;
  scroller.dispatchEvent(new Event('scroll'));
  await sleep(1200);
  out.atBottom = pct();
}

// The keyboard hint must be reachable at any width now.
const kbd = [...document.querySelectorAll('span[title]')].find((s) =>
  /Espacio para seguir/.test(s.title || ''),
);
out.keyboardHintTitle = kbd ? kbd.title : '(none)';
out.keyboardHintWidth = kbd ? Math.round(kbd.getBoundingClientRect().width) : null;
out.windowWidth = window.innerWidth;

return JSON.stringify(out, null, 2);
