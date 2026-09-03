import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const TOKEN = fs.readFileSync(path.join(process.env.APPDATA, 'writers-hoard', 'aibridge', 'token'), 'utf8').trim();
function call(tool, args) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ tool, args, client: 'verify-it4' });
    const req = http.request({ method: 'POST', hostname: '127.0.0.1', port: 8766, path: '/api/call',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); } }); });
    req.write(data); req.end();
  });
}
const A = 'proj_mth8y8hc_kbzaa8';
const projects = await call('wh_list_projects', {});
const list = projects.result?.projects ?? projects.result ?? projects;
console.log('projects:', JSON.stringify(list).slice(0, 400));
const other = (Array.isArray(list) ? list : []).find((p) => p.id !== A);
console.log('other project:', other?.id, other?.name);
const place = await call('wh_get_atlas_place', { projectId: A, id: 'place_mtjzooez_5i8647' });
console.log('toledo appearsIn:', JSON.stringify(place.result?.appearsIn), 'truncated:', place.result?.appearsInTruncated);
// characters in the other project
if (other) {
  const chars = await call('wh_list_codex', { projectId: other.id });
  console.log('codex shape:', JSON.stringify(chars).slice(0,200)); const c = (chars.result?.entries ?? chars.result?.codex ?? [])[0];
  console.log('other char:', c?.id, c?.name);
  if (c) {
    const bad = await call('wh_create_arc', { projectId: A, title: 'Arco cruzado (prueba)', characterId: c.id });
    console.log('arc with foreign character ->', JSON.stringify(bad).slice(0, 300));
  }
}
const ghost = await call('wh_create_arc', { projectId: A, title: 'Arco fantasma (prueba)', characterId: 'codex_no_existe' });
console.log('arc with missing character ->', JSON.stringify(ghost).slice(0, 300));
const arcs = await call('wh_list_arcs', { projectId: A });
console.log('arcs in A now:', JSON.stringify(arcs).slice(0, 200));
