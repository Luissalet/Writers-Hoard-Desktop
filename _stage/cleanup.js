const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const dbMod = await import('/src/db/index.ts');
const db = dbMod.db;

out.before = (await db.projects.toArray()).map((p) => p.title);

// Delete it the way a writer would: from the dashboard card's own button.
location.hash = '#/';
await sleep(2600);
const cards = [...document.querySelectorAll('*')].filter(
  (el) => el.children.length === 0 && /ZZ Prueba Claude \(borrar\)/.test(el.textContent || ''),
);
const card = cards[0]?.closest('div[class*="rounded"]')?.parentElement
  ?? cards[0]?.closest('div');
const del = card
  ? [...card.querySelectorAll('button')].find((b) => /borrar|eliminar|delete/i.test(b.getAttribute('aria-label') || b.title || ''))
  : null;
out.foundDeleteButton = Boolean(del);
if (!del) {
  out.dashboard = document.body.innerText.replace(/\s*\n\s*/g, ' | ').slice(0, 500);
  return JSON.stringify(out, null, 2);
}
del.click();
await sleep(1600);

const dialog = document.body.innerText.replace(/\s*\n\s*/g, ' | ');
const i = dialog.indexOf('TODOS sus datos');
out.confirmText = i >= 0 ? dialog.slice(Math.max(0, i - 90), i + 320) : '(no dialog)';

const confirm = [...document.querySelectorAll('button')].find((b) =>
  /^(borrar|eliminar|confirmar)$/i.test((b.textContent || '').trim()),
);
out.confirmLabel = confirm ? confirm.textContent.trim() : '(none)';
if (confirm) confirm.click();
await sleep(6000);

out.toast = document.body.innerText.replace(/\s*\n\s*/g, ' | ').slice(0, 420);
out.after = (await db.projects.toArray()).map((p) => p.title);
out.gone = !out.after.some((t) => /ZZ Prueba Claude/.test(t));
return JSON.stringify(out, null, 2);
