const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { tries: [] };

location.hash = '#/project/proj_mthy3jeu_q7kvd1/seeds';
await sleep(2200);

const findPicker = () =>
  [...document.querySelectorAll('select')].find((s) =>
    [...s.options].some((o) => /La carta quemada/.test(o.text)),
  );

// The action is a toggle and the list loads lazily, so open it and wait for the
// picker rather than assuming one click at a fixed delay does both.
for (let attempt = 0; attempt < 3 && !findPicker(); attempt += 1) {
  const mark = [...document.querySelectorAll('button')].find((b) =>
    /marcar como pagada/i.test(b.textContent || ''),
  );
  out.tries.push({ attempt, foundButton: Boolean(mark) });
  if (mark) mark.click();
  await sleep(2500);
}

const picker = findPicker();
if (!picker) return JSON.stringify({ ...out, error: 'no chapter picker after 3 tries' });

const option = [...picker.options].find((o) => /La carta quemada/.test(o.text));
Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(picker, option.value);
picker.dispatchEvent(new Event('change', { bubbles: true }));
await sleep(1000);
out.picked = picker.options[picker.selectedIndex].text;

const scope = picker.closest('div[class*="rounded"]')?.parentElement || document;
out.scopeButtons = [...scope.querySelectorAll('button')]
  .map((b) => (b.textContent || '').trim())
  .filter(Boolean)
  .slice(0, 10);

const confirm = [...document.querySelectorAll('button')].find((b) =>
  /^a[ñn]adir pago$/i.test((b.textContent || '').trim()),
);
out.confirmLabel = confirm ? (confirm.textContent || '').trim() : '(none)';
if (confirm) confirm.click();
await sleep(3200);

out.after = ((document.querySelector('main') || document.body).innerText || '')
  .replace(/\s*\n\s*/g, ' | ').slice(0, 640);
return JSON.stringify(out, null, 2);
