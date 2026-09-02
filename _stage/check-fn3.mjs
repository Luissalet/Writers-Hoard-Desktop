import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const TOKEN = fs.readFileSync(path.join(process.env.APPDATA, 'writers-hoard', 'aibridge', 'token'), 'utf8').trim();
const call = (tool, args) => new Promise((res) => {
  const data = JSON.stringify({ tool, args, client: 'check-fn3' });
  const req = http.request({ method:'POST', hostname:'127.0.0.1', port:8766, path:'/api/call',
    headers:{ Authorization:`Bearer ${TOKEN}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(data) } },
    (r) => { let raw=''; r.on('data',c=>raw+=c); r.on('end',()=>res(JSON.parse(raw))); });
  req.write(data); req.end();
});
const projectId = 'proj_mth8y8hc_kbzaa8', id = 'writing_mtjz89l7_rcvmli';
// 1. Repair chapter 1: turn the literal text back into a real note.
const got = await call('wh_get_writing', { projectId, id });
const fixed = got.result.content.replace(/\\\[\^ia\]/g, '[^ia]');
const upd = await call('wh_update_writing', { projectId, id, content: fixed });
console.log('UPDATE ok:', upd.ok);
const again = await call('wh_get_writing', { projectId, id });
const c = again.result.content;
console.log('escaped refs left:', (c.match(/\\\[\^/g) || []).length, '| real defs:', (c.match(/^\[\^[^\]]+\]:/gm) || []).length);
// 2. Fresh append on chapter 2 with a note of its own, app restarted with it3 code.
const id2 = 'writing_mtjz89lp_130fo9';
const app = await call('wh_append_writing', { projectId, id: id2, content: 'Frase con nota de la IA[^dos].\n\n[^dos]: Nota añadida tras el reinicio.' });
const g2 = await call('wh_get_writing', { projectId, id: id2 });
console.log('APPEND ok:', app.ok, '| ch2 defs:', (g2.result.content.match(/^\[\^[^\]]+\]:/gm) || []).join(' ; '), '| escaped:', (g2.result.content.match(/\\\[\^/g) || []).length);
