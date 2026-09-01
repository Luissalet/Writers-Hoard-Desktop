const open = [...document.querySelectorAll('button')].find(b => /buscar/i.test(b.getAttribute('aria-label') || ''));
const before = document.querySelectorAll('input').length;
if (open) open.click();
await new Promise(r => setTimeout(r, 900));
const afterInputs = [...document.querySelectorAll('input')].map((el, i) => ({
  i, type: el.type, placeholder: el.placeholder || null, visible: el.offsetParent !== null,
}));
// Try the keyboard route too.
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
await new Promise(r => setTimeout(r, 900));
const afterKey = [...document.querySelectorAll('input')].map((el, i) => ({
  i, type: el.type, placeholder: el.placeholder || null, visible: el.offsetParent !== null,
}));
return { before, afterInputs, afterKey, dialogs: document.querySelectorAll('[role="dialog"]').length };
