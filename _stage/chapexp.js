const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

location.hash = '#/project/proj_mthy3jeu_q7kvd1/writings';
await sleep(2000);

// The reader is a full-screen overlay on this route; leave it if it is open.
const exit = [...document.querySelectorAll('button')].find((b) =>
  /salir \(esc\)/i.test((b.textContent || '') + (b.getAttribute('aria-label') || '')),
);
out.closedReader = Boolean(exit);
if (exit) { exit.click(); await sleep(2000); }

// Open a chapter card's own menu.
const menus = [...document.querySelectorAll('button')].filter((b) => {
  const label = (b.getAttribute('aria-label') || b.title || '').toLowerCase();
  return /mover, copiar o enviar/.test(label);
});
out.menuButtons = menus.length;
out.menuLabels = menus.slice(0, 3).map((b) => b.getAttribute('aria-label') || b.title);
if (menus.length) {
  menus[0].click();
  await sleep(1400);
}
const panel = document.body.innerText.replace(/\s*\n\s*/g, ' | ');
out.menuText = panel.slice(0, 900);
out.hasExportSection = /Enviar este cap/i.test(panel);
out.formatButtons = [...document.querySelectorAll('button')]
  .map((b) => (b.textContent || '').trim())
  .filter((x) => /^(Word|ePub|Markdown)$/.test(x));

// Intercept the download so nothing lands on disk.
const captured = [];
const origCreate = URL.createObjectURL;
URL.createObjectURL = function (blob) { captured.push({ size: blob.size, type: blob.type }); return origCreate.call(URL, blob); };
try {
  const word = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Word');
  if (word) { word.click(); await sleep(4000); }
  out.downloads = captured;
} finally {
  URL.createObjectURL = origCreate;
}
out.toastAfter = document.body.innerText.replace(/\s*\n\s*/g, ' | ').slice(-320);
return JSON.stringify(out, null, 2);
