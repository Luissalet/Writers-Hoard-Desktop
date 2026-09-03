await new Promise(r => setTimeout(r, 1200));
const map = document.querySelector('[data-pin-id]')?.closest('div[tabindex]');
const pins = [...document.querySelectorAll('[data-pin-id]')].map(p => { const b = p.getBoundingClientRect(); return { id: p.getAttribute('data-pin-id'), x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; });
const zoomText = [...document.querySelectorAll('*')].map(e => e.childNodes.length === 1 && e.textContent).filter(t => t && /km|zoom|escala/i.test(t)).slice(0, 4);
return { pins, chromeTop: window.outerHeight - window.innerHeight, zoomText };
