import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {hash} from './check-publishing-wasm.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const native='publishing/editorial/native',wrapper='publishing/editorial/wasm';
const out='src/engines/writings/pdf/generated';
const target=path.resolve(process.env.PUBLISHING_WASM_TARGET??path.join(os.tmpdir(),'writer-publishing-wasm-target'));
const bindgen=process.env.WASM_BINDGEN??'wasm-bindgen';
const toolchain='1.92.0',bindgenVersion='0.2.129';
function run(command,args,options={}){
 const result=spawnSync(command,args,{cwd:root,encoding:'utf8',...options});
 if(result.status!==0)throw Error(`${command} ${args.join(' ')}\n${result.stdout??''}\n${result.stderr??''}\n${result.error??''}`);
 return (result.stdout??'').trim();
}
const rustc=run('rustup',['run',toolchain,'rustc','--version']);
const cargo=run('rustup',['run',toolchain,'cargo','--version']);
const version=run(bindgen,['--version']);
if(!version.endsWith(bindgenVersion))throw Error(`Requires wasm-bindgen ${bindgenVersion}; set WASM_BINDGEN to its executable. This script never installs tools.`);
const targets=run('rustup',['target','list','--installed','--toolchain',toolchain]);
if(!targets.split(/\r?\n/).includes('wasm32-unknown-unknown'))throw Error(`Install the official wasm32-unknown-unknown target for ${toolchain}; default toolchain remains unchanged.`);
const cargoHome=process.env.CARGO_HOME??path.join(os.homedir(),'.cargo');
const flags=[`--remap-path-prefix=${root}=/writer`,`--remap-path-prefix=${cargoHome}=/cargo`,`--remap-path-prefix=${target}=/build`];
const buildEnv={...process.env,CARGO_ENCODED_RUSTFLAGS:flags.join('\x1f')};
delete buildEnv.RUSTFLAGS;
run('rustup',['run',toolchain,'cargo','build','--manifest-path',`${wrapper}/Cargo.toml`,'--target','wasm32-unknown-unknown','--target-dir',target,'--release','--locked'],{env:buildEnv,stdio:['ignore','inherit','inherit']});
fs.mkdirSync(path.join(root,out),{recursive:true});
run(bindgen,[path.join(target,'wasm32-unknown-unknown/release/writer_publishing_pdf_wasm.wasm'),'--target','web','--out-dir',path.join(root,out),'--out-name','writer_publishing_pdf_wasm']);
for(const name of ['writer_publishing_pdf_wasm.d.ts','writer_publishing_pdf_wasm_bg.wasm.d.ts']){
 const p=path.join(root,out,name);fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/^\/\* (?:tslint|eslint)[^\n]*\*\/\r?\n/gm,''));
}
const metadata=JSON.parse(run('rustup',['run',toolchain,'cargo','metadata','--manifest-path',`${wrapper}/Cargo.toml`,'--format-version','1','--locked','--filter-platform','wasm32-unknown-unknown']));
const inputSet=new Set([`${native}/Cargo.toml`,`${native}/Cargo.lock`,`${native}/NOTICE`,`${native}/LICENSE-MIT`,`${native}/LICENSE-APACHE`,`${wrapper}/Cargo.toml`,`${wrapper}/Cargo.lock`,'scripts/build-publishing-wasm.mjs','scripts/check-publishing-wasm.mjs']);
function walk(relative){for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){const p=`${relative}/${entry.name}`;if(entry.isDirectory())walk(p);else inputSet.add(p)}}
walk(`${wrapper}/src`);
for(const name of ['doc','compose','fonts','images','pdf','color','geom']){inputSet.add(`${native}/crates/${name}/Cargo.toml`);walk(`${native}/crates/${name}/src`)}
walk(`${native}/assets/fonts`);walk(`${native}/assets/hyphenation`);
const texts=[`${native}/NOTICE`,`${native}/LICENSE-MIT`,`${native}/LICENSE-APACHE`,...Array.from(inputSet).filter(p=>p.includes('/assets/fonts/OFL-'))];
const notices=['Writer publishing PDF WASM\nExisting detached editorial core; original notices and font licenses follow.\nNo system or remote fonts are included.',...texts.map(p=>`\n--- ${p} ---\n${fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n')}`),'\nRust packages resolved by the isolated lock:'];
for(const p of metadata.packages.sort((a,b)=>a.name.localeCompare(b.name)))notices.push(`${p.name} ${p.version} | ${p.license??'see license file'} | ${p.repository??'local source'}`);
// License files of dependencies are attribution material, never crate source copies.
const licenses=new Set();
for(const p of metadata.packages){
 if(!p.source)continue;
 const directory=path.dirname(p.manifest_path);
 for(const name of fs.readdirSync(directory).filter(n=>/^(LICENSE|LICENCE|COPYING|NOTICE)([-_.].*)?$/i.test(n))){
  const file=path.join(directory,name);if(!fs.statSync(file).isFile())continue;const text=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');const digest=hash(text);
  if(!licenses.has(digest)){licenses.add(digest);notices.push(`\n--- ${p.name} ${p.version}: ${name} ---\n${text}`)}
 }
}
fs.writeFileSync(path.join(root,out,'THIRD_PARTY_NOTICES.txt'),notices.join('\n')+'\n');
function record(relative,input=false){
 const raw=fs.readFileSync(path.join(root,relative)),text=raw.toString('utf8');
 const textual=/\.(?:rs|toml|lock|mjs|md|txt)$/i.test(relative)||/\/(?:NOTICE|LICENSE-[^/]+)$/.test(relative);
 const normalization=input&&textual&&!raw.includes(0)&&Buffer.from(text).equals(raw)?'lf':undefined;
 const bytes=normalization?Buffer.from(text.replace(/\r\n/g,'\n')):raw;
 return {path:relative,bytes:bytes.length,sha256:hash(bytes),...(normalization?{normalization}: {})};
}
const outputNames=['writer_publishing_pdf_wasm.js','writer_publishing_pdf_wasm.d.ts','writer_publishing_pdf_wasm_bg.wasm','writer_publishing_pdf_wasm_bg.wasm.d.ts','THIRD_PARTY_NOTICES.txt'];
const manifest={schema:1,toolchain,target:'wasm32-unknown-unknown',wasmBindgen:bindgenVersion,rustc,cargo,flags:['checkout=/writer','cargo-home=/cargo','target=/build'],inputs:Array.from(inputSet).sort().map(p=>record(p,true)),outputs:outputNames.map(name=>record(`${out}/${name}`)),gzip:outputNames.slice(0,4).map(name=>({path:`${out}/${name}`,bytes:gzipSync(fs.readFileSync(path.join(root,out,name)),{mtime:0}).length})),packages:metadata.packages.map(p=>({name:p.name,version:p.version,license:p.license})).sort((a,b)=>a.name.localeCompare(b.name))};
fs.writeFileSync(path.join(root,out,'artifacts.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({outputs:manifest.outputs,gzip:manifest.gzip}));
