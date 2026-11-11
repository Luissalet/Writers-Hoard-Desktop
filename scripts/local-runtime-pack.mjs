import {readFile,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import ts from 'typescript';
import {canonicalRuntimeJson,inspectRuntimePacket,runtimeBase64,runtimeBytesHash,runtimeManifestIdentity,LOCAL_RUNTIME_PACKAGE_FORMAT,RUNTIME_CATALOGUE_PATH,RUNTIME_CATALOGUE_MIME} from '../src/engines/local/runtimeFormat.mjs';
import {localToolSourcePath} from '../src/engines/local/releaseFormat.mjs';
async function ownFile(root,relative){if(!localToolSourcePath(relative))throw Error('local_runtime_package_source_path_invalid');let current=root;for(const part of relative.split('/')){current=path.join(current,part);if((await lstat(current)).isSymbolicLink())throw Error('local_runtime_package_source_link');}return current;}
const repository=fileURLToPath(new URL('../',import.meta.url));
const strict=(value,names)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===names;
let catalogueCompiler;
// Only Writer's own compiler is loaded. Author declarations are JSON.
function loadCatalogueCompiler(){
 return catalogueCompiler??=build({absWorkingDir:repository,entryPoints:['src/engines/local/agentStateFields.ts'],bundle:true,write:false,format:'esm',platform:'node',target:'node22',alias:{'@':path.join(repository,'src')},logLevel:'error'})
  .then(bundle=>import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64')));
}
export async function validatePackedRuntimeCatalogue(checked){
 if(!checked.catalogue)return;
 const {validateLocalToolDerivedCatalogue}=await loadCatalogueCompiler();
 validateLocalToolDerivedCatalogue(checked.catalogue);
}
async function compileCatalogue(root,entries,members){
 if(!Array.isArray(entries)||!entries.length||entries.length>members.length)throw Error('local_runtime_package_catalogue_config_invalid');
 const available=new Set(members.filter(member=>member.kind==='tool').map(member=>member.namespace)),seen=new Set();
 const declarations=[];
 for(const entry of entries){
  if(!strict(entry,'file,namespace')||!available.has(entry.namespace)||seen.has(entry.namespace)||typeof entry.file!=='string'||!entry.file.endsWith('.json'))throw Error('local_runtime_package_catalogue_config_invalid');
  seen.add(entry.namespace);
  const bytes=await readFile(await ownFile(root,entry.file));
  if(bytes.length>128*1024)throw Error('local_runtime_package_catalogue_config_invalid');
  const spec=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!(strict(spec,'documentBacked,stateFields')||strict(spec,'documentBacked,index,stateFields'))||typeof spec.documentBacked!=='boolean'||Object.hasOwn(spec,'index')&&(!spec.index||typeof spec.index!=='object'||Array.isArray(spec.index)))throw Error('local_runtime_package_catalogue_config_invalid');
  declarations.push({namespace:entry.namespace,spec});
 }
 const {describeLocalToolStateFields}=await loadCatalogueCompiler();
 const tools=declarations.sort((a,b)=>a.namespace<b.namespace?-1:a.namespace>b.namespace?1:0)
  .map(({namespace,spec})=>({namespace,...describeLocalToolStateFields(spec.stateFields,spec.documentBacked,spec.index)}));
 return new TextEncoder().encode(canonicalRuntimeJson({version:1,tools})+'\n');
}
export async function packLocalRuntimeSource(sourceDir){
 const root=await realpath(sourceDir),config=JSON.parse(await readFile(await ownFile(root,'local-tool.runtime.json'),'utf8'));
 if(!(strict(config,'assets,entry,members,namespace,version')||strict(config,'assets,catalogue,entry,members,namespace,version'))||!Array.isArray(config.assets)||!Array.isArray(config.members))throw Error('local_runtime_package_source_config_invalid');
 const input=await ownFile(root,config.entry),external=['react','react/jsx-runtime','@writers-hoard/local-sdk','@writers-hoard/local-apps'];
 const encoded=Object.create(null),files=[];
 for(const asset of config.assets){if(!asset||Object.keys(asset).sort().join(',')!=='mime,path'||asset.path==='bundle.mjs'||asset.path===RUNTIME_CATALOGUE_PATH&&Object.hasOwn(config,'catalogue')||typeof asset.mime!=='string'||!asset.mime)throw Error('local_runtime_package_source_asset_invalid');const bytes=new Uint8Array(await readFile(await ownFile(root,asset.path)));encoded[asset.path]=runtimeBase64(bytes);files.push({path:asset.path,bytes:bytes.length,sha256:await runtimeBytesHash(bytes),mime:asset.mime});}
 const bundle=await build({entryPoints:[input],absWorkingDir:root,bundle:true,write:false,format:'cjs',platform:'browser',target:'es2022',jsx:'automatic',jsxDev:false,metafile:true,external,plugins:[{name:'runtime-author-assets',setup(api){api.onResolve({filter:/\?url$/},async args=>{const resolved=path.resolve(args.resolveDir,args.path.slice(0,-4)),relative=path.relative(root,resolved).split(path.sep).join('/');await ownFile(root,relative);if(!Object.hasOwn(encoded,relative))throw Error('local_runtime_package_asset_not_declared: '+relative);return {path:relative,namespace:'runtime-asset'};});api.onLoad({filter:/.*/,namespace:'runtime-asset'},args=>{const asset=files.find(file=>file.path===args.path);return {contents:'export default '+JSON.stringify('data:'+asset.mime+';base64,'+encoded[args.path]),loader:'js'};});}}]});
 for(const output of Object.values(bundle.metafile.outputs))for(const item of output.imports)if(item.external&&!external.includes(item.path))throw Error('local_runtime_package_external_module: '+item.path);
 const code=bundle.outputFiles[0].text,syntax=ts.createSourceFile('bundle.cjs',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 if(syntax.parseDiagnostics.length)throw Error('local_runtime_package_bundle_syntax_invalid');
 const inspect=node=>{if(ts.isCallExpression(node)){const name=node.expression;if(name.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(name)&&['eval','Function','__require','require'].includes(name.text)&&!(name.text==='require'&&node.arguments.length===1&&ts.isStringLiteral(node.arguments[0])&&external.includes(node.arguments[0].text)))throw Error('local_runtime_package_dynamic_module_not_supported');}if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='Function')throw Error('local_runtime_package_eval_not_supported');ts.forEachChild(node,inspect);};inspect(syntax);
 const members=[...config.members].sort((a,b)=>a.namespace<b.namespace?-1:a.namespace>b.namespace?1:0);
 const prefix=`export const runtimeVersion=1;\nexport const packageNamespace=${JSON.stringify(config.namespace)};\nexport const version=${JSON.stringify(config.version)};\nexport function createPackage(host){\nconst module={exports:{}},exports=module.exports;\nconst modules={'react':host.React,'react/jsx-runtime':host.jsxRuntime,'@writers-hoard/local-sdk':host.sdk,'@writers-hoard/local-apps':host.apps};\nconst require=id=>{if(!Object.hasOwn(modules,id))throw Error('local_runtime_package_external_module: '+id);return modules[id];};\n`;
 const suffix=`\nconst value=module.exports.default;const definitions=Array.isArray(value)?value:[value];return {members:definitions.map(definition=>({namespace:definition.namespace,version:${JSON.stringify(config.version)},definition}))};\n}\n`;
 const bytes=new TextEncoder().encode(prefix+code+suffix);encoded['bundle.mjs']=runtimeBase64(bytes);files.push({path:'bundle.mjs',bytes:bytes.length,sha256:await runtimeBytesHash(bytes),mime:'text/javascript'});
 if(Object.hasOwn(config,'catalogue')){
  const catalogue=await compileCatalogue(root,config.catalogue,members);
  encoded[RUNTIME_CATALOGUE_PATH]=runtimeBase64(catalogue);
  files.push({path:RUNTIME_CATALOGUE_PATH,bytes:catalogue.length,sha256:await runtimeBytesHash(catalogue),mime:RUNTIME_CATALOGUE_MIME});
 }
 files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const manifest={format:LOCAL_RUNTIME_PACKAGE_FORMAT,apiVersion:1,runtimeVersion:1,namespace:config.namespace,version:config.version,entry:'bundle.mjs',members,files};manifest.contentHash=await runtimeBytesHash(new TextEncoder().encode(runtimeManifestIdentity(manifest)));
 const packet=new TextEncoder().encode(canonicalRuntimeJson({manifest,files:encoded})+'\n');await inspectRuntimePacket(packet);return {packet,manifest};
}
