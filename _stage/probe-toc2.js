const cb = [...document.querySelectorAll('label')].find(l => l.textContent.includes('Índice'))?.querySelector('input');
if (!cb.checked) cb.click();
await new Promise(r => setTimeout(r, 1500));
const nav = document.querySelector('nav[aria-label]');
return { checked: cb.checked, toc: nav ? nav.innerText.replace(/\n/g, ' | ') : null };
