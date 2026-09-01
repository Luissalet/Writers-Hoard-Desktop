// Walk every engine tab of the open project, collecting console errors and any
// visible text that looks like a raw i18n key. Read-only: it only navigates.
if (!window.__whSweepHooked) {
  window.__whSweepHooked = true;
  window.__whErrors = [];
  const origError = console.error;
  console.error = (...args) => { try { window.__whErrors.push(args.map(String).join(' ').slice(0, 300)); } catch {} origError(...args); };
  window.addEventListener('error', (e) => window.__whErrors.push('window.error: ' + (e.message || '')));
  window.addEventListener('unhandledrejection', (e) => window.__whErrors.push('unhandled: ' + String(e.reason).slice(0, 300)));
}

const RAW_KEY = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]+){1,5}$/;
const projectMatch = location.hash.match(/#\/project\/([^/?]+)/);
if (!projectMatch) return 'NO PROJECT OPEN — open one first';
const projectId = projectMatch[1];

const tabs = [...document.querySelectorAll('nav button, aside button')]
  .map(b => (b.innerText || '').trim().split('\n')[0])
  .filter(Boolean);

const engines = ['overview','writings','codex','timeline','board','maps','gallery','storyboard',
  'character-arc','relationships','seeds','scrapper','worldgen','notes','outline','diary',
  'dialog-scene','biography','pov-audit','writing-stats','annotations','image-studio','video-planner','real-atlas'];

const report = [];
for (const engine of engines) {
  const before = window.__whErrors.length;
  location.hash = `#/project/${projectId}/${engine}`;
  await new Promise(r => setTimeout(r, 700));
  const text = document.body.innerText || '';
  const rawKeys = [...new Set(text.split('\n').map(l => l.trim()).filter(l => RAW_KEY.test(l) && l.length < 60))];
  const newErrors = window.__whErrors.slice(before);
  const landed = location.hash.includes(`/${engine}`);
  report.push({ engine, landed, rawKeys: rawKeys.slice(0, 6), errors: newErrors.slice(0, 4), chars: text.length });
}
return report.filter(r => !r.landed || r.rawKeys.length || r.errors.length || r.chars < 400);
