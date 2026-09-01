const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pid = 'proj_mthy3jeu_q7kvd1';
const seen = {};

const routes = [
  'overview', 'writings', 'outline', 'codex', 'seeds', 'relationships',
  'timeline', 'writing-stats', 'annotations', 'publishing',
];

for (const route of routes) {
  location.hash = `#/project/${pid}/${route}`;
  await sleep(1300);
  const main = document.querySelector('main') || document.body;
  seen[route] = (main.innerText || '').replace(/\s*\n\s*/g, ' | ').slice(0, 520);
}

seen.__errors = (window.__whErrors || []).slice(-10);
return JSON.stringify(seen, null, 2);
