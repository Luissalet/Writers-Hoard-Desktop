const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

// 1. The shortcuts panel.
location.hash = '#/';
await sleep(1800);
document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true, cancelable: true }));
await sleep(1600);
const sheet = document.body.innerText.replace(/\s*\n\s*/g, ' | ');
out.panelOpened = /Atajos de teclado/.test(sheet) && /En cualquier sitio/.test(sheet);
out.panelSample = sheet.slice(sheet.indexOf('Atajos de teclado'), sheet.indexOf('Atajos de teclado') + 620);
document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
await sleep(900);

// The mouse path: a button in the top bar.
out.topBarButton = [...document.querySelectorAll('button')].some((b) =>
  /atajos de teclado/i.test(b.getAttribute('aria-label') || b.title || ''),
);

// 2. Empty states, on a project with nothing in it.
const dbMod = await import('/src/db/index.ts');
const db = dbMod.db;
const pid = 'proj_empty_probe';
const now = Date.now();
await db.projects.put({
  id: pid, title: 'ZZ Vacio (borrar)', mode: 'novelist', type: 'standalone',
  color: '#7c3aed', description: '', status: 'in-progress',
  enabledEngines: ['seeds', 'outline', 'character-arc', 'relationships', 'dialog-scene'],
  engineOrder: [], createdAt: now, updatedAt: now,
});
await sleep(900);

out.emptyStates = {};
for (const route of ['seeds', 'outline', 'character-arc', 'relationships', 'dialog-scene']) {
  location.hash = `#/project/${pid}/${route}`;
  await sleep(1900);
  out.emptyStates[route] = ((document.querySelector('main') || document.body).innerText || '')
    .replace(/\s*\n\s*/g, ' | ')
    .slice(-380);
}

await db.projects.delete(pid);
return JSON.stringify(out, null, 2);
