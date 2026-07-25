// ¿Cuánto cuesta la carta con la base en GPU, y se parece a la de CPU?
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
const CACHE='harness/cache'; let meta=null,bin=null;
for (const f of readdirSync(CACHE)) {
  if (f.endsWith('.json')&&f.startsWith('monstruo-1024')) meta=`${CACHE}/${f}`;
  if (f.endsWith('.bin')&&f.startsWith('monstruo-1024')) bin=`${CACHE}/${f}`;
}
mkdirSync('harness/out',{recursive:true});
await build({ entryPoints:['harness/carto-gl.ts'], bundle:true, outfile:'harness/out/carto-gl.js',
  format:'iife', define:{'process.env.NODE_ENV':'"development"'}, logLevel:'warning' });
const html='<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#222}</style></head><body><script src="/carto-gl.js"></script></body></html>';
const server=createServer((req,res)=>{const u=(req.url||'/').split('?')[0];const s=(t,b)=>{res.writeHead(200,{'content-type':t});res.end(b)};
if(u==='/')return s('text/html',html); if(u==='/carto-gl.js')return s('text/javascript',readFileSync('harness/out/carto-gl.js'));
if(u==='/world.json')return s('application/json',readFileSync(meta)); if(u==='/world.bin')return s('application/octet-stream',readFileSync(bin));
res.writeHead(404);res.end('no')});
await new Promise(r=>server.listen(4176,r));
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',
  args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:1400,height:820}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,300)));
p.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,300)); else console.log('  '+m.text()); });
await p.goto('http://localhost:4176/');
await p.waitForFunction('window.wgDone === true',null,{timeout:180000});
await p.screenshot({path:'harness/out/carto-gl.png'});
console.log(errs.length?`ERRORES:\n${errs.slice(0,4).join('\n')}`:'sin errores');
await b.close(); server.close();
