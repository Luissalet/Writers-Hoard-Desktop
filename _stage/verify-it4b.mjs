import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const TOKEN = fs.readFileSync(path.join(process.env.APPDATA, 'writers-hoard', 'aibridge', 'token'), 'utf8').trim();
function call(tool, args) { return new Promise((resolve) => { const data = JSON.stringify({ tool, args, client: 'verify-it4' });
  const req = http.request({ method: 'POST', hostname: '127.0.0.1', port: 8766, path: '/api/call', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
  (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); } }); }); req.write(data); req.end(); }); }
const A = 'proj_mth8y8hc_kbzaa8';
const entry = await call('wh_create_codex_entry', { projectId: A, title: 'Inés de Toledo (prueba)', type: 'character', content: 'Personaje de prueba.' });
console.log('codex:', JSON.stringify(entry).slice(0, 200));
const entryId = entry.result?.id ?? entry.result?.entry?.id;
const tl = await call('wh_create_timeline', { projectId: A, title: 'Línea de prueba' });
console.log('timeline:', JSON.stringify(tl).slice(0, 160));
const timelineId = tl.result?.id ?? tl.result?.timeline?.id;
const ghost = await call('wh_create_event', { projectId: A, timelineId, title: 'Evento fantasma', linkedEntryId: 'codex_no_existe' });
console.log('event with missing entry ->', JSON.stringify(ghost).slice(0, 200));
const good = await call('wh_create_event', { projectId: A, timelineId, title: 'Evento enlazado', linkedEntryId: entryId });
console.log('event with own entry ->', JSON.stringify(good).slice(0, 200));
