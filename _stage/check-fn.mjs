import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const TOKEN = fs.readFileSync(path.join(process.env.APPDATA, 'writers-hoard', 'aibridge', 'token'), 'utf8').trim();
const call = (tool, args) => new Promise((res) => {
  const data = JSON.stringify({ tool, args, client: 'check-fn' });
  const req = http.request({ method:'POST', hostname:'127.0.0.1', port:8766, path:'/api/call',
    headers:{ Authorization:`Bearer ${TOKEN}`, 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(data) } },
    (r) => { let raw=''; r.on('data',c=>raw+=c); r.on('end',()=>res(JSON.parse(raw))); });
  req.write(data); req.end();
});
const projectId = 'proj_mth8y8hc_kbzaa8', id = 'writing_mtjz89l7_rcvmli';
const got = await call('wh_get_writing', { projectId, id });
const body = JSON.stringify(got.result).slice(0, 200);
console.log('SHAPE:', body);
const content = got.result?.writing?.content ?? got.result?.content ?? '';
console.log('HAS_REF:', /\[\^/.test(content), '| HAS_DEF:', /^\[\^[^\]]+\]:/m.test(content));
console.log('TAIL:', JSON.stringify(content.slice(-200)));
