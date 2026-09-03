location.hash = '#/project/proj_mth8y8hc_kbzaa8/writings';
await new Promise(r => setTimeout(r, 1500));
const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Compilar');
b.click(); await new Promise(r => setTimeout(r, 1500));
const nav = document.querySelector('nav[aria-label]');
return { toc: nav ? nav.innerText.replace(/\n/g, ' | ') : null, checked: [...document.querySelectorAll('label')].find(l => l.textContent.includes('Índice'))?.querySelector('input')?.checked };
