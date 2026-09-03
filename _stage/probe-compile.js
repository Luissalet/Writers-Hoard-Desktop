location.hash = '#/project/proj_mth8y8hc_kbzaa8/writings';
await new Promise(r => setTimeout(r, 1500));
const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Compilar');
if (!b) return 'no compile button';
b.click(); await new Promise(r => setTimeout(r, 1200));
const labels = [...document.querySelectorAll('label')].map(l => { const r = l.getBoundingClientRect(); return { t: l.textContent.trim().slice(0, 40), x: Math.round(r.x + 10), y: Math.round(r.y + r.height / 2), checked: l.querySelector('input')?.checked }; }).filter(l => l.t);
const buttons = [...document.querySelectorAll('button')].filter(b => /HTML|Markdown|PDF|EPUB|DOCX|Word|Exportar|Compilar/i.test(b.textContent)).map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim().slice(0, 30), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
return { labels, buttons };
