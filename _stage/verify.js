const report = {};
// Close whatever is already open (a palette left over from an earlier probe
// sits on top of everything and would be mistaken for the modal under test).
for (let i = 0; i < 3; i++) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const buttons = () => [...document.querySelectorAll('button')];
const byText = (re) => buttons().filter(b => re.test((b.innerText || '') + ' ' + (b.title || '')));
const modalText = (expect) => {
  const fixed = [...document.querySelectorAll('div')].filter(d => {
    const s = getComputedStyle(d);
    return s.position === 'fixed' && d.offsetHeight > 250 && d.offsetWidth > 350;
  });
  const match = expect ? fixed.filter(d => expect.test(d.innerText || '')) : fixed;
  const top = match[match.length - 1] ?? fixed[fixed.length - 1];
  return top ? (top.innerText || '').replace(/\n+/g, ' | ').slice(0, 1100) : null;
};

// 1. Engine manager
const emCandidates = byText(/gestionar motores/i);
report.engineManagerButtons = emCandidates.length;
if (emCandidates.length) {
  emCandidates[0].click();
  await sleep(1100);
  report.engineManagerModal = modalText(/motor|preset|modo/i);
  const change = byText(/cambiar modo/i)[0];
  report.hasChangePreset = Boolean(change);
  if (change) { change.click(); await sleep(800); report.presetPicker = modalText(/modo|preset/i); }
  const close = buttons().find(b => /^(cancelar|cerrar)$/i.test((b.innerText || '').trim()));
  if (close) { close.click(); await sleep(600); }
}

// 2. Export modal + preview
const exp = byText(/^exportar$|exportar proyecto/i)[0];
if (exp) {
  exp.click();
  await sleep(1400);
  const t = modalText(/publicar|exportar|formato|compilar/i);
  report.exportModal = t;
  report.hasPreview = /vista previa/i.test(t || '');
  const close2 = buttons().find(b => /^(cancelar|cerrar)$/i.test((b.innerText || '').trim()));
  if (close2) { close2.click(); await sleep(600); }
} else report.exportModal = 'no export button';

return report;
