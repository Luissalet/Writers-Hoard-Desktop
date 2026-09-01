const projectMatch = location.hash.match(/#\/project\/([^/?]+)/);
if (!projectMatch) return 'NO PROJECT';
location.hash = `#/project/${projectMatch[1]}/overview`;
await new Promise(r => setTimeout(r, 900));

// The cockpit has tabbed sections; find the one that holds the health block.
const tabs = [...document.querySelectorAll('button')]
  .map(b => (b.innerText || '').trim())
  .filter(t => t && t.length < 30);

const health = [...document.querySelectorAll('button')].find(b => /salud|health/i.test(b.innerText || ''));
if (health) { health.click(); await new Promise(r => setTimeout(r, 900)); }

const analyse = [...document.querySelectorAll('button')].find(b => /analizar/i.test(b.innerText || ''));
if (!analyse) {
  return { step: 'no analyse button', tabs: tabs.slice(0, 24), bodyTail: (document.body.innerText || '').slice(-1200) };
}
analyse.click();
await new Promise(r => setTimeout(r, 4000));
const text = document.body.innerText || '';
const idx = text.search(/lector de pruebas/i);
return { step: 'analysed', panel: idx >= 0 ? text.slice(idx, idx + 2000) : text.slice(-2000) };
