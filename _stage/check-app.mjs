import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const TOKEN = fs.readFileSync(path.join(process.env.APPDATA, 'writers-hoard', 'aibridge', 'token'), 'utf8').trim();
const call = (tool, args) => new Promise((res) => {
  const data = JSON.stringify({ tool, args, client: 'check-app' });
  const req = http.request({ method:'POST', hostname:'127.0.0.1', port:8766, path:'/api/call',
    headers:{ Authorization:`Bearer ${TOKEN}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(data) } },
    (r) => { let raw=''; r.on('data',c=>raw+=c); r.on('end',()=>res(JSON.parse(raw))); });
  req.write(data); req.end();
});
const projectId = 'proj_mth8y8hc_kbzaa8';
const r = await call('wh_append_writing', { projectId, id: 'writing_mtjz89m5_eqd5zm', content: 'Al amanecer llegaron a Toledo por el puente de Alcántara.' });
console.log('APPEND', r.ok);
const p = await call('wh_list_atlas_places', { projectId });
const toledo = (p.result.places ?? []).find(x => x.name === 'Toledo');
console.log('TOLEDO', toledo?.id, JSON.stringify(toledo).slice(0, 300));
