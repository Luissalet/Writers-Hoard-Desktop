const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

location.hash = '#/project/proj_mthy3jeu_q7kvd1/seeds';
await sleep(2200);
const mark = [...document.querySelectorAll('button')].find((b) =>
  /marcar como pagada/i.test(b.textContent || ''),
);
if (!mark) return JSON.stringify({ error: 'no mark button' });
mark.click();
await sleep(2200);

// Pick "La carta quemada" — the chapter where a hidden letter would pay off.
const picker = [...document.querySelectorAll('select')].find((s) =>
  [...s.options].some((o) => /La carta quemada/.test(o.text)),
);
if (!picker) return JSON.stringify({ error: 'no chapter picker' });
const option = [...picker.options].find((o) => /La carta quemada/.test(o.text));
const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
setter.call(picker, option.value);
picker.dispatchEvent(new Event('change', { bubbles: true }));
await sleep(900);
out.picked = picker.options[picker.selectedIndex].text;

out.buttons = [...document.querySelectorAll('button')]
  .map((b) => (b.textContent || '').trim())
  .filter((text) => text && text.length < 30)
  .slice(-10);

const confirm = [...document.querySelectorAll('button')].find((b) =>
  /a[ñn]adir pago|añadir payoff|guardar/i.test(b.textContent || ''),
);
out.confirmLabel = confirm ? (confirm.textContent || '').trim() : '(none)';
if (confirm) confirm.click();
await sleep(3000);

out.after = ((document.querySelector('main') || document.body).innerText || '')
  .replace(/\s*\n\s*/g, ' | ').slice(0, 620);

return JSON.stringify(out, null, 2);
