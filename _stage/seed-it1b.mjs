import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const TOKEN = fs.readFileSync(path.join(process.env.APPDATA, 'writers-hoard', 'aibridge', 'token'), 'utf8').trim();
function call(tool, args) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ tool, args, client: 'seed-it1' });
    const req = http.request({ method: 'POST', hostname: '127.0.0.1', port: 8766, path: '/api/call',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => resolve(JSON.parse(raw))); });
    req.write(data); req.end();
  });
}
const projectId = 'proj_mth8y8hc_kbzaa8';
const para = (n) => `Párrafo ${n}. La ciudad dormía bajo una luz de estaño, y el río, que nadie había visto crecer, arrastraba las últimas hojas del otoño hacia un mar que sólo existía en los mapas antiguos. Nadie hablaba de la torre, aunque todos la miraban al pasar.`;
const docs = {
  writing_mtjz89l7_rcvmli: `El primer capítulo empieza aquí y sigue con prosa.\n\n` + Array.from({ length: 30 }, (_, i) => para(i + 1)).join('\n\n') + `\n\nY cierra con una frase final.`,
  writing_mtjz89lp_130fo9: `## Una sección\n\nSegundo capítulo.\n\n` + Array.from({ length: 12 }, (_, i) => para(i + 1)).join('\n\n'),
  writing_mtjz89m5_eqd5zm: `Tercer capítulo, corto, sin notas.\n\n> Una cita.`,
};
for (const [id, content] of Object.entries(docs)) {
  const r = await call('wh_update_writing', { projectId, id, content });
  console.log(id, r.ok ? 'ok' : JSON.stringify(r).slice(0, 300));
}
