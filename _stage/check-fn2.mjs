import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const TOKEN = fs.readFileSync(path.join(process.env.APPDATA, 'writers-hoard', 'aibridge', 'token'), 'utf8').trim();
const call = (tool, args) => new Promise((res) => {
  const data = JSON.stringify({ tool, args, client: 'check-fn2' });
  const req = http.request({ method:'POST', hostname:'127.0.0.1', port:8766, path:'/api/call',
    headers:{ Authorization:`Bearer ${TOKEN}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(data) } },
    (r) => { let raw=''; r.on('data',c=>raw+=c); r.on('end',()=>res(JSON.parse(raw))); });
  req.write(data); req.end();
});
const projectId = 'proj_mth8y8hc_kbzaa8', id = 'writing_mtjz89l7_rcvmli';
// The AI appends a paragraph carrying a footnote of its own.
const app = await call('wh_append_writing', { projectId, id,
  content: 'Un párrafo añadido por la IA[^ia] al final del capítulo.\n\n[^ia]: Nota escrita por el puente, no por el editor.' });
console.log('APPEND ok:', app.ok, app.ok ? '' : JSON.stringify(app).slice(0,200));
const got = await call('wh_get_writing', { projectId, id });
const c = got.result.content;
const refs = [...c.matchAll(/\[\^([^\]]+)\]/g)].map(m => m[1]);
console.log('REFS+DEFS:', JSON.stringify(refs));
console.log('TAIL:', JSON.stringify(c.slice(-260)));
