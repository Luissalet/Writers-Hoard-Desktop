// Normal Node regression entry: no Stage inputs, browser, database or server startup.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {build}=require('esbuild');
// Normalize Windows paths explicitly; graph patterns contain no backslash character classes.
const graphName=file=>file.split(path.win32.sep).join('/');
const applicationGraph=new RegExp('(?:^|/)node_modules/(react|react-dom|dexie)/|(?:^|/)src/db(?:/|[.])|(?:^|/)local/(storage|registry|bootstrap)[.]|(?:^|/)worldEras/(store|adapters|assets)[.]|(?:^|/)aiBridge/(dispatch|manifest)[.]');
const causalGraph=new RegExp('(?:^|/)node_modules/yjs/|(?:^|/)convergence/replica[.]');
function assertGraphGuards(){
 const windows=parts=>['C:',...parts].join(path.win32.sep);
 for(const parts of [['repo','node_modules','react','index.js'],['repo','node_modules','dexie','dist','dexie.js'],['repo','src','db','index.ts'],['repo','src','engines','local','registry.tsx'],['repo','src','services','worldEras','store.ts'],['repo','src','services','aiBridge','dispatch.ts']]){
  for(const file of [windows(parts),'/'+parts.join('/')])if(!applicationGraph.test(graphName(file)))throw Error('Graph guard self-check failed: '+file);
 }
 for(const parts of [['repo','node_modules','yjs','dist','yjs.cjs'],['repo','src','engines','local','convergence','replica.ts']]){
  for(const file of [windows(parts),'/'+parts.join('/')])if(!causalGraph.test(graphName(file)))throw Error('Core graph guard self-check failed: '+file);
 }
 for(const parts of [['repo','src','engines','local','openDocuments.ts'],['repo','src','engines','local','testing.ts'],['repo','node_modules','reactive-fixture','index.js']]){
  for(const file of [windows(parts),'/'+parts.join('/')])if(applicationGraph.test(graphName(file)))throw Error('Graph guard false positive: '+file);
 }
}
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if(process.argv[2]==='--worker'){
 const [, , , bundle, exported, resultFile]=process.argv,events=[],blocked=[];
 const write=value=>fs.writeFileSync(resultFile,JSON.stringify(value,null,2)+'\n');
 const fail=kind=>{blocked.push(kind);throw Error('Unexpected '+kind+' in pure Node regression');};
 globalThis.fetch=()=>fail('network');Object.defineProperty(globalThis,'indexedDB',{configurable:true,get:()=>fail('IndexedDB')});
 void(async()=>{
  if(typeof globalThis.window!=='undefined'||typeof globalThis.document!=='undefined')throw Error('Unexpected browser globals');
  const output=await require(bundle)[exported](event=>{events.push(event);write({ok:false,running:true,events,blocked});});
  if(blocked.length)throw Error('Forbidden IO attempted');write({ok:true,output,events,blocked});
 })().catch(error=>{write({ok:false,error:String(error),stack:error.stack,events,blocked});console.error(error.stack||error);process.exitCode=1;});
}else{
 const root=path.resolve(__dirname,'..'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'wh-open-documents-node-'));
 const save=(name,value)=>fs.writeFileSync(path.join(directory,name),JSON.stringify(value,null,2)+'\n');
 const guards=new Map(),groups=[];
 const report={ok:false,directory,scope:'Pure membership/projector and explicit author memory host; no DB/Native/browser coverage',groups};
 void(async()=>{
  assertGraphGuards();
  for(const [name,filename,exported]of [['core','local-tool-open-documents.core.node.ts','testLocalToolOpenDocumentsCore'],['kit','local-tool-open-documents.kit.node.ts','testLocalToolOpenDocumentsKit']]){
   const built=await build({entryPoints:[path.join(root,'tests',filename)],bundle:true,platform:'node',format:'cjs',target:'node22',alias:{'@':path.join(root,'src')},write:false,metafile:true,logLevel:'error'});
   const inputs=Object.keys(built.metafile.inputs).map(file=>path.resolve(root,file));
   const forbidden=inputs.filter(file=>applicationGraph.test(graphName(file)));
   if(name==='core')forbidden.push(...inputs.filter(file=>causalGraph.test(graphName(file))));
   save(name+'.metafile.json',built.metafile);if(forbidden.length)throw Error('Unexpected graph imports: '+forbidden.join(','));
   for(const input of inputs){if(!fs.existsSync(input))throw Error('Missing physical input '+input);guards.set(input,hash(input));}
   const bundle=path.join(directory,name+'.cjs'),resultFile=path.join(directory,name+'.RESULT.json');fs.writeFileSync(bundle,built.outputFiles[0].contents);
   const child=spawnSync(process.execPath,[__filename,'--worker',bundle,exported,resultFile],{cwd:root,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
   fs.writeFileSync(path.join(directory,name+'.stdout.log'),child.stdout||'');fs.writeFileSync(path.join(directory,name+'.stderr.log'),child.stderr||'');
   const result=fs.existsSync(resultFile)?JSON.parse(fs.readFileSync(resultFile,'utf8')):null;
   if(child.error||child.status!==0||result?.ok!==true)throw Error(name+' failed: '+(result?.error||child.error||'no completed result'));
   for(const group of result.output.groups){groups.push(group);console.log('PASS '+group);}
  }
  const changed=[...guards].filter(([file,before])=>!fs.existsSync(file)||hash(file)!==before).map(([file])=>file);
  report.guard={inputs:guards.size,changed};if(changed.length)throw Error('Consumed inputs changed');
  report.ok=true;save('RESULT.json',report);console.log('PASS Node graph/no DB/React/network; evidence '+directory);
 })().catch(error=>{report.error=String(error);report.stack=error.stack;report.guard={inputs:guards.size,changed:[...guards].filter(([file,before])=>!fs.existsSync(file)||hash(file)!==before).map(([file])=>file)};save('RESULT.json',report);console.error(error.stack||error);process.exitCode=1;});
}
