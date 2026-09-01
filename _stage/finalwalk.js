const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { routes: {}, crashes: [] };
const dbMod = await import('/src/db/index.ts');
const pid = (await dbMod.db.projects.toArray()).find((p) => /Herederos/.test(p.title))?.id;
out.project = pid;

const routes = ['overview', 'writings', 'outline', 'codex', 'timeline', 'board', 'seeds', 'notes', 'gallery', 'maps'];
for (const r of routes) {
  location.hash = `#/project/${pid}/${r}`;
  await sleep(1700);
  const text = ((document.querySelector('main') || document.body).innerText || '')
    .replace(/\s*\n\s*/g, ' | ');
  const crashed = /No se pudo abrir este motor/.test(text);
  if (crashed) out.crashes.push(r);
  out.routes[r] = crashed ? 'CRASHED' : 'ok (' + text.length + ' chars)';
}

// The dashboard too.
location.hash = '#/';
await sleep(1800);
const dash = document.body.innerText.replace(/\s*\n\s*/g, ' | ');
out.dashboard = /No se pudo/.test(dash) ? 'CRASHED' : 'ok';
out.storageChip = (dash.match(/\d+(\.\d+)?\s*(KB|MB|GB)/) || ['(none)'])[0];
return JSON.stringify(out, null, 2);
