const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

const pid = 'proj_mthy3jeu_q7kvd1';
location.hash = `#/project/${pid}/overview?panel=health`;
await sleep(2000);

// Press the analyse button inside the proofreader panel.
const buttons = [...document.querySelectorAll('button')];
const analyse = buttons.find((b) => /analizar|analyse|analyze|revisar de nuevo/i.test(b.textContent || ''));
out.analyseBtn = analyse ? (analyse.textContent || '').trim().slice(0, 60) : '(not found)';
if (analyse) analyse.click();
await sleep(7000);

const root = document.querySelector('main') || document.body;
out.text = (root.innerText || '').replace(/\s*\n\s*/g, ' | ').slice(0, 3200);
return JSON.stringify(out, null, 2);
