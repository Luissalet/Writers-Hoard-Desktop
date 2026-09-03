await new Promise(r => setTimeout(r, 5000));
const btn = document.querySelector('button[title^="Regla"]');
if (!btn) return { hash: location.hash, btn: false };
if (btn.getAttribute('aria-pressed') !== 'true' && !/active|bg-accent/.test(btn.className)) btn.click();
await new Promise(r => setTimeout(r, 1500));
const ruler = document.querySelector('[data-testid="worldgen-ruler"]');
const legend = document.querySelector('[data-testid="worldgen-legend"]');
const canvas = document.querySelector('canvas');
return { hash: location.hash, ruler: ruler && ruler.getBoundingClientRect().toJSON(), legend: legend && legend.getBoundingClientRect().toJSON(), canvas: canvas && canvas.getBoundingClientRect().toJSON() };
