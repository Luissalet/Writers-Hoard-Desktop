location.hash = '#/project/proj_mth8y8hc_kbzaa8/real-atlas';
await new Promise(r => setTimeout(r, 1500));
const tab = [...document.querySelectorAll('button, [role="tab"]')].find(b => /^Mapa$/i.test((b.textContent || '').trim()));
if (tab) { tab.click(); await new Promise(r => setTimeout(r, 2000)); }
const pins = [...document.querySelectorAll('[data-pin-id]')].map(p => { const b = p.getBoundingClientRect(); return { id: p.getAttribute('data-pin-id'), x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; });
return { tab: !!tab, pins };
