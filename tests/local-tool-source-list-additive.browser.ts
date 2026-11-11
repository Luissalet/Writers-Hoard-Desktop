import {db} from '@/db';
import {createProject,deleteProject} from '@/db/operations';
import {defineLocalTool,type LocalToolJson,type LocalToolDefinition} from '@/engines/local/sdk';
import {registerLocalToolModules} from '@/engines/local/registry';
import {localToolReleaseIdentity,type LocalToolReleaseManifest} from '@/engines/local/releaseFormat.mjs';
import {pinLocalToolRelease} from '@/engines/local/releases';
import {createSourceToolDocument,readSourceToolDocument} from '@/engines/local/documents/store';
import {createLocalToolClient} from '@/engines/local/storage';
import {localToolConvergenceContext} from '@/engines/local/convergence/context';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import fixtureSource from './local-tool-source-list-additive.browser.ts?raw';

/** Baseline-runnable: only public existing declarations/creator/writer, no future imports.
 * Registry fixtures are normal runtime modules with real manifest hashes; this is
 * not a SourceHost/compiler/CLI installation test. The standard hidden runner owns
 * a new empty private library; it never opens Luis's library. */
export async function testSourceListAdditiveDeclarationRed(){
 const checks:string[]=[],projects:string[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{
  if(convergenceCanonical(actual)!==convergenceCanonical(expected))throw Error(label);
  checks.push(label);Reflect.set(window,'__testStage',label);
 };
 // IndexedDB records may contain own undefined (documentHistory is one normal
 // example). Encode every supported value with a disjoint type envelope; never
 // stringify raw records or erase fields to fit the product's JSON-only codec.
 let dbSnapshotNumber=0;
 const allRows=async(stage:string)=>{
  const snapshot=++dbSnapshotNumber;
  console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage,snapshot,event:'collect',completedChecks:checks.length}));
  const tables=await Promise.all(db.tables.map(async table=>({name:table.name,rows:await table.toArray()})));
  tables.sort((a,b)=>a.name.localeCompare(b.name));
  const seen=new WeakMap<object,number>();let serial=0;const ownUndefinedPaths:string[]=[];
  const unsupported=(path:string,reason:string):never=>{
   console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage,snapshot,event:'unsupported',path,reason}));
   throw Error('Source list IndexedDB comparator unsupported at '+path+': '+reason);
  };
  const encode=async(value:unknown,path:string):Promise<LocalToolJson>=>{
   if(value===undefined){ownUndefinedPaths.push(path);return ['undefined'];}
   if(value===null)return ['null'];
   if(typeof value==='string')return ['string',value];
   if(typeof value==='boolean')return ['boolean',value];
   if(typeof value==='number')return ['number',Object.is(value,-0)?'-0':String(value)];
   if(typeof value==='bigint')return ['bigint',String(value)];
   if(typeof value!=='object')return unsupported(path,typeof value);
   const previous=seen.get(value);if(previous!==undefined)return ['reference',previous];
   const id=++serial;seen.set(value,id);
   if(typeof File!=='undefined'&&value instanceof File)return ['file',id,value.name,value.lastModified,value.type,value.size,Array.from(new Uint8Array(await value.arrayBuffer()))];
   if(value instanceof Blob)return ['blob',id,value.type,value.size,Array.from(new Uint8Array(await value.arrayBuffer()))];
   if(value instanceof ArrayBuffer)return ['array-buffer',id,value.byteLength,Array.from(new Uint8Array(value))];
   if(ArrayBuffer.isView(value))return ['array-buffer-view',id,Object.prototype.toString.call(value),value.byteOffset,value.byteLength,await encode(value.buffer,path+'.buffer')];
   // Other structured-clone classes are rejected explicitly, not silently reduced.
   const prototype=Object.getPrototypeOf(value);
   if(!Array.isArray(value)&&prototype!==Object.prototype&&prototype!==null)return unsupported(path,Object.prototype.toString.call(value));
   const entries:LocalToolJson[]=[];
   const keys=Reflect.ownKeys(value);
   if(keys.some(key=>typeof key!=='string'))return unsupported(path,'symbol key');
   for(const key of Object.getOwnPropertyNames(value).sort()){
    if(Array.isArray(value)&&key==='length')continue;
    const property=Object.getOwnPropertyDescriptor(value,key);
    if(!property||!('value'in property))return unsupported(path+'['+JSON.stringify(key)+']','accessor');
    entries.push([key,!!property.enumerable,!!property.configurable,!!property.writable,await encode(property.value,path+'['+JSON.stringify(key)+']')]);
   }
   return Array.isArray(value)?['array',id,value.length,entries]:['object',id,prototype===null?'null-prototype':'Object',entries];
  };
  const encoded=await encode(tables,'$');
  console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage,snapshot,event:'encoded',tables:tables.length,objectCount:serial,ownUndefinedPaths}));
  return encoded;
 };
 const empty=async()=>{
  const counts=await Promise.all(db.tables.map(table=>table.count()));
  return {tables:counts.length,total:counts.reduce((a,b)=>a+b,0)};
 };
 const object=(value:LocalToolJson):value is Record<string,LocalToolJson>=>!!value&&typeof value==='object'&&!Array.isArray(value);
 const validOne=(value:LocalToolJson):value is Record<string,LocalToolJson>=>{
  if(!object(value)||typeof value.name!=='string'||!value.name||!object(value.other)||!Array.isArray(value.prior))return false;
  return value.prior.every(item=>object(item)&&typeof item.id==='string'&&!!item.id&&typeof item.label==='string');
 };
 const one=(namespace:string)=>defineLocalTool<Record<string,LocalToolJson>>({
  namespace,stateSchemaVersion:'1',name:{en:'Own review V1',es:'Revisión propia V1'},
  description:{en:'Own offline Source list fixture',es:'Prueba propia de lista Source local'},
  document:{defaultTitle:{en:'Own review',es:'Revisión propia'}},
  codec:{version:1,fields:{name:{kind:'scalar'},other:{kind:'map'},prior:{kind:'list',idKey:'id'}}},
  index:{version:1,fields:{name:{path:'$.name',type:'string'}}},
  initialState:{name:'Initial',other:{keep:'Literal á/ñ/漢字/🧭'},prior:[{id:'old-row',label:'Anterior Ω'}]},
  validateState:validOne,component:()=>null,
 });
 const from=(definition:LocalToolDefinition<Record<string,LocalToolJson>>)=>({
  namespace:definition.namespace,codec:definition.codec!,...localToolConvergenceContext(definition)!,
 });
 const sha=async(data:Uint8Array<ArrayBuffer>)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(value=>value.toString(16).padStart(2,'0')).join('');
 const bytes=new TextEncoder().encode(fixtureSource),files=[{path:'module.tsx',sha256:await sha(bytes),bytes:bytes.length}];
 const register=async(definitions:{definition:LocalToolDefinition<Record<string,LocalToolJson>>;version:string}[])=>{
  const hashes:string[]=[],modules:Record<string,{default:LocalToolDefinition<Record<string,LocalToolJson>>}>={},manifests:Record<string,LocalToolReleaseManifest>={};
  for(const {definition,version}of definitions){
   const identity={format:'writers-hoard-local-tool-source/1',apiVersion:1,namespace:definition.namespace,version,files} as const;
   const manifest:LocalToolReleaseManifest={...identity,contentHash:await sha(new TextEncoder().encode(localToolReleaseIdentity(identity)))};
   const path='./installed/'+definition.namespace+'/versions/'+manifest.contentHash;
   modules[path+'/module.tsx']={default:definition};manifests[path+'/release.json']=manifest;hashes.push(manifest.contentHash);
  }
  registerLocalToolModules(modules,manifests);return hashes;
 };
 const project=async(namespace:string)=>{
  const id='own-list2540-'+crypto.randomUUID(),now=Date.now();
  await createProject({id,title:'Own additive list',description:'Synthetic private Source fixture',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['local-tool-'+namespace],engineOrder:['local-tool-'+namespace],createdAt:now,updatedAt:now});
  projects.push(id);return id;
 };
 try{
  equal('private library begins with 89 empty tables',await empty(),{tables:89,total:0});
  // Existing scalar2088 is a positive control, exercised through real Source APIs.
  const scalarOne=one('tests.source-list-control');
  const scalarTwo=defineLocalTool<Record<string,LocalToolJson>>({...scalarOne,stateSchemaVersion:'2',
   codec:{version:1,fields:{...scalarOne.codec!.fields,habitat:{kind:'scalar'}}},
   initialState:{...scalarOne.initialState,habitat:'Coast'},
   validateState:(value):value is Record<string,LocalToolJson>=>validOne(value)&&typeof value.habitat==='string',
   sourceAdditive:{from:from(scalarOne),field:'habitat',defaultValue:'Coast'},
  });
  const [scalarV1,scalarV2]=await register([{definition:scalarOne,version:'1.0.0'},{definition:scalarTwo,version:'2.0.0'}]);
  const scalarProject=await project(scalarOne.namespace),scalarScope={projectId:scalarProject};
  const scalarPin=await pinLocalToolRelease(scalarProject,scalarOne.namespace,scalarV1,null);
  const scalarId=(await createSourceToolDocument(scalarScope,scalarOne.namespace,'Scalar control')).id;
  const oldScalar=createLocalToolClient(scalarProject,scalarOne,{documentId:scalarId,releaseHash:scalarV1,requireSelectedRelease:true});
  await oldScalar.convergence!.start(await oldScalar.read());
  await oldScalar.state!.apply(await oldScalar.read(),[{type:'set',field:'name',value:'Escalar válido Ω'}]);
  const scalarBefore=await readSourceToolDocument(scalarScope,scalarId,scalarOne.namespace);
  equal('scalar control retains origin engine1',scalarBefore?.document.convergence?.checkpoint.engine.version,'1');
  await pinLocalToolRelease(scalarProject,scalarOne.namespace,scalarV2,scalarPin.revision);
  const currentScalar=createLocalToolClient(scalarProject,scalarTwo,{documentId:scalarId,releaseHash:scalarV2,requireSelectedRelease:true});
  equal('existing scalar default projects without raw property',(await currentScalar.read()).data.habitat,'Coast');
  const scalarApplied=await currentScalar.state!.apply(await currentScalar.read(),[{type:'set',field:'habitat',value:'Forest'}]);
  equal('existing scalar writer and receipt work',[scalarApplied.snapshot.data.habitat,typeof scalarApplied.receiptId],['Forest','string']);
  equal('scalar control preserves existing ordinary list',scalarApplied.snapshot.data.prior,[{id:'old-row',label:'Anterior Ω'}]);
  // Normal V1 with prior list/map, both started and unstarted; no Source row seeding.
  const targetOne=one('tests.source-list-target');
  const [targetV1]=await register([{definition:targetOne,version:'1.0.0'}]);
  const targetProject=await project(targetOne.namespace),scope={projectId:targetProject};
  await pinLocalToolRelease(targetProject,targetOne.namespace,targetV1,null);
  const documents:string[]=[];
  for(const started of[false,true]){
   const id=(await createSourceToolDocument(scope,targetOne.namespace,started?'Started V1':'Unstarted V1')).id;
   documents.push(id);
   const client=createLocalToolClient(targetProject,targetOne,{documentId:id,releaseHash:targetV1,requireSelectedRelease:true});
   if(started)await client.convergence!.start(await client.read());
   const saved=await client.state!.apply(await client.read(),[{type:'set',field:'name',value:'Revisión á/ñ/漢字/🧭'},{type:'map-set',field:'other',key:'keep',value:'Conservar Ω'}]);
   equal('normal V1 data is literal '+started,saved.snapshot.data,{name:'Revisión á/ñ/漢字/🧭',other:{keep:'Conservar Ω'},prior:[{id:'old-row',label:'Anterior Ω'}]});
   const stored=await readSourceToolDocument(scope,id,targetOne.namespace);
   equal('normal V1 checkpoint status '+started,stored?.document.convergence?.checkpoint.engine.version??null,started?'1':null);
  }
  const before=await allRows('before list declaration');let code:string|null=null,accepted=false;
  try{
   defineLocalTool<Record<string,LocalToolJson>>({...targetOne,stateSchemaVersion:'2',
    codec:{version:1,fields:{...targetOne.codec!.fields,steps:{kind:'list',idKey:'id'}}},
    initialState:{...targetOne.initialState,steps:[]},
    validateState:(value):value is Record<string,LocalToolJson>=>validOne(value)&&Array.isArray(value.steps)&&value.steps.every(item=>object(item)&&typeof item.id==='string'&&!!item.id&&typeof item.label==='string'),
    sourceAdditive:{from:from(targetOne),field:'steps',defaultValue:[]},
   });
   accepted=true;
  }catch(error){code=error instanceof Error?error.message:String(error);}
  const after=await allRows('after list declaration');
  console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage:'public declaration never writes library rows',event:'compare'}));
  equal('public declaration never writes library rows',after,before);
  console.log('SOURCE_LIST_ADDITIVE_DECLARATION '+JSON.stringify({scalarControlPassed:true,v1ControlPassed:true,predecessorEngine:'1',startedAndUnstarted:documents.length===2,accepted,error:code,expectedBaselineError:'local_tool_source_additive_invalid',snapshotUnchanged:true}));
  if(!accepted&&code!=='local_tool_source_additive_invalid')throw Error('Unexpected setup/declaration error: '+code);
  equal('public empty-list additive declaration must be accepted',accepted,true);
  return checks;
 }finally{
  for(const id of projects.reverse())await deleteProject(id);
  registerLocalToolModules({});
  equal('private library cleanup returns all 89 tables to zero',await empty(),{tables:89,total:0});
 }
}

import * as listEffectsY from 'yjs';
import {convergenceBytes as listEffectsBytes} from '@/engines/local/convergence/format';
import {exportLocalToolConvergenceCheckpoint as listEffectsExport} from '@/engines/local/convergence/replica';

/** P1-P3 and sparse native entry: normal Source APIs, no private Source row seeding. */
export async function testSourceListAdditiveEffects(){
 const checks:string[]=[],projects:string[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{
  if(convergenceCanonical(actual)!==convergenceCanonical(expected))throw Error(label);
  checks.push(label);Reflect.set(window,'__testStage',label);
 };
 const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const reject=async(label:string,run:()=>Promise<unknown>)=>{let rejected=false;try{await run();}catch{rejected=true;}equal(label,rejected,true);};
 // IndexedDB records may contain own undefined (documentHistory is one normal

 // example). Encode every supported value with a disjoint type envelope; never

 // stringify raw records or erase fields to fit the product's JSON-only codec.

 let dbSnapshotNumber=0;

 const allRows=async(stage:string)=>{

  const snapshot=++dbSnapshotNumber;

  console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage,snapshot,event:'collect',completedChecks:checks.length}));

  const tables=await Promise.all(db.tables.map(async table=>({name:table.name,rows:await table.toArray()})));

  tables.sort((a,b)=>a.name.localeCompare(b.name));

  const seen=new WeakMap<object,number>();let serial=0;const ownUndefinedPaths:string[]=[];

  const unsupported=(path:string,reason:string):never=>{

   console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage,snapshot,event:'unsupported',path,reason}));

   throw Error('Source list IndexedDB comparator unsupported at '+path+': '+reason);

  };

  const encode=async(value:unknown,path:string):Promise<LocalToolJson>=>{

   if(value===undefined){ownUndefinedPaths.push(path);return ['undefined'];}

   if(value===null)return ['null'];

   if(typeof value==='string')return ['string',value];

   if(typeof value==='boolean')return ['boolean',value];

   if(typeof value==='number')return ['number',Object.is(value,-0)?'-0':String(value)];

   if(typeof value==='bigint')return ['bigint',String(value)];

   if(typeof value!=='object')return unsupported(path,typeof value);

   const previous=seen.get(value);if(previous!==undefined)return ['reference',previous];

   const id=++serial;seen.set(value,id);

   if(typeof File!=='undefined'&&value instanceof File)return ['file',id,value.name,value.lastModified,value.type,value.size,Array.from(new Uint8Array(await value.arrayBuffer()))];

   if(value instanceof Blob)return ['blob',id,value.type,value.size,Array.from(new Uint8Array(await value.arrayBuffer()))];

   if(value instanceof ArrayBuffer)return ['array-buffer',id,value.byteLength,Array.from(new Uint8Array(value))];

   if(ArrayBuffer.isView(value))return ['array-buffer-view',id,Object.prototype.toString.call(value),value.byteOffset,value.byteLength,await encode(value.buffer,path+'.buffer')];

   // Other structured-clone classes are rejected explicitly, not silently reduced.

   const prototype=Object.getPrototypeOf(value);

   if(!Array.isArray(value)&&prototype!==Object.prototype&&prototype!==null)return unsupported(path,Object.prototype.toString.call(value));

   const entries:LocalToolJson[]=[];

   const keys=Reflect.ownKeys(value);

   if(keys.some(key=>typeof key!=='string'))return unsupported(path,'symbol key');

   for(const key of Object.getOwnPropertyNames(value).sort()){

    if(Array.isArray(value)&&key==='length')continue;

    const property=Object.getOwnPropertyDescriptor(value,key);

    if(!property||!('value'in property))return unsupported(path+'['+JSON.stringify(key)+']','accessor');

    entries.push([key,!!property.enumerable,!!property.configurable,!!property.writable,await encode(property.value,path+'['+JSON.stringify(key)+']')]);

   }

   return Array.isArray(value)?['array',id,value.length,entries]:['object',id,prototype===null?'null-prototype':'Object',entries];

  };

  const encoded=await encode(tables,'$');

  console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage,snapshot,event:'encoded',tables:tables.length,objectCount:serial,ownUndefinedPaths}));

  return encoded;

 };

 const counts=async()=>{const values=await Promise.all(db.tables.map(table=>table.count()));return{tables:values.length,total:values.reduce((a,b)=>a+b,0)};};
 const namespace='tests.source-list-effects';
 const valid=(value:LocalToolJson):value is Record<string,LocalToolJson>=>{
  if(!record(value)||typeof value.name!=='string'||!value.name||!record(value.other)||!Array.isArray(value.prior))return false;
  return value.prior.every(item=>record(item)&&typeof item.id==='string'&&!!item.id&&typeof item.label==='string');
 };
 const one=defineLocalTool<Record<string,LocalToolJson>>({namespace,stateSchemaVersion:'1',
  name:{en:'Own review V1',es:'Revisión propia V1'},description:{en:'Own offline review',es:'Revisión propia local'},
  document:{defaultTitle:{en:'Own review',es:'Revisión propia'}},
  codec:{version:1,fields:{name:{kind:'scalar'},other:{kind:'map'},prior:{kind:'list',idKey:'id'}}},
  index:{version:1,fields:{name:{path:'$.name',type:'string'}}},
  initialState:{name:'Initial',other:{keep:'Conservar á/ñ/漢字/🧭'},prior:[{id:'old-row',label:'Anterior Ω'}]},validateState:valid,component:()=>null,
 });
 const from={namespace,codec:one.codec!,...localToolConvergenceContext(one)!};
 const two=defineLocalTool<Record<string,LocalToolJson>>({...one,stateSchemaVersion:'2',
  codec:{version:1,fields:{...one.codec!.fields,steps:{kind:'list',idKey:'id'}}},
  initialState:{...one.initialState,steps:[]},
  validateState:(value):value is Record<string,LocalToolJson>=>valid(value)&&Array.isArray(value.steps)&&value.steps.every(item=>record(item)&&typeof item.id==='string'&&!!item.id&&typeof item.label==='string'&&typeof item.done==='boolean'),
  sourceAdditive:{from,field:'steps',defaultValue:[]},
 });
 const sha=async(bytes:Uint8Array<ArrayBuffer>)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const sourceBytes=new TextEncoder().encode(fixtureSource),files=[{path:'module.tsx',sha256:await sha(sourceBytes),bytes:sourceBytes.length}];
 const manifest=async(version:string):Promise<LocalToolReleaseManifest>=>{
  const base={format:'writers-hoard-local-tool-source/1',apiVersion:1,namespace,version,files} as const;
  return{...base,contentHash:await sha(new TextEncoder().encode(localToolReleaseIdentity(base)))};
 };
 const v1=await manifest('1.0.0'),v2=await manifest('2.0.0');
 const root=(hash:string)=>'./installed/'+namespace+'/versions/'+hash;
 registerLocalToolModules({[root(v1.contentHash)+'/module.tsx']:{default:one},[root(v2.contentHash)+'/module.tsx']:{default:two}},{[root(v1.contentHash)+'/release.json']:v1,[root(v2.contentHash)+'/release.json']:v2});
 const slot=(value:object,key:string)=>Object.hasOwn(value,key)?['present',Object.getOwnPropertyDescriptor(value,key)!.value]:['absent'];
 const envelope=(checkpoint:Parameters<typeof listEffectsExport>[0])=>{
  const doc=new listEffectsY.Doc({gc:false});try{
   listEffectsY.applyUpdate(doc,listEffectsBytes(checkpoint.checkpointBase64));
   const values=doc.getArray<string>('convergence-source-additive').toArray().map(encoded=>JSON.parse(encoded));
   if(!record(values[0]))throw Error('List authority header missing');
   return{header:values[0],witnesses:values.slice(1)};
  }finally{doc.destroy();}
 };
 try{
  equal('P1 private library starts empty',await counts(),{tables:89,total:0});
  const projectId='own-list-effects-'+crypto.randomUUID(),now=Date.now();
  await createProject({id:projectId,title:'Own list effects',description:'Synthetic private library',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['local-tool-'+namespace],engineOrder:['local-tool-'+namespace],createdAt:now,updatedAt:now});projects.push(projectId);
  const scope={projectId},pin=await pinLocalToolRelease(projectId,namespace,v1.contentHash,null);
  const cases:{id:string;started:boolean;before:NonNullable<Awaited<ReturnType<typeof readSourceToolDocument>>>}[]=[];
  for(const started of[false,true]){
   const id=(await createSourceToolDocument(scope,namespace,started?'Started own V1':'Unstarted own V1')).id;
   const client=createLocalToolClient(projectId,one,{documentId:id,releaseHash:v1.contentHash,requireSelectedRelease:true});
   if(started)await client.convergence!.start(await client.read());
   await client.state!.apply(await client.read(),[{type:'set',field:'name',value:'Escena á/ñ/漢字/🧭'},{type:'map-set',field:'other',key:'keep',value:'Conservar Ω'}]);
   const before=await readSourceToolDocument(scope,id,namespace);if(!before)throw Error('Own V1 creator did not persist');
   equal('P1 V1 checkpoint status '+started,before.document.convergence?.checkpoint.engine.version??null,started?'1':null);
   cases.push({id,started,before});
  }
  await pinLocalToolRelease(projectId,namespace,v2.contentHash,pin.revision);
  for(const item of cases){
   const client=createLocalToolClient(projectId,two,{documentId:item.id,releaseHash:v2.contentHash,requireSelectedRelease:true});
   equal('P1 pin preserves complete raw document '+item.started,await readSourceToolDocument(scope,item.id,namespace),item.before);
   const passive=await allRows('P1 before read '+item.started),view=await client.read();
   equal('P1 read projects empty list '+item.started,view.data.steps,[]);
   equal('P1 passive read preserves all rows '+item.started,await allRows('P1 after read '+item.started),passive);
   const noopBefore=await allRows('P2 before noop '+item.started);
   const noop=await client.state!.apply(view,[{type:'set',field:'name',value:view.data.name}]);
   equal('P2 no-op has no receipt and preserves supported snapshot '+item.started,[noop.receiptId,noop.snapshot.revision,noop.snapshot.updatedAt,noop.snapshot.data,noop.snapshot.document??null],[null,view.revision,view.updatedAt,view.data,view.document??null]);
   equal('P2 no-op preserves complete library '+item.started,await allRows('P2 after noop '+item.started),noopBefore);
   await reject('P2 invalid first insert rejected '+item.started,async()=>client.state!.apply(await client.read(),[{type:'list-insert',field:'steps',item:{id:'invalid',label:3,done:false},afterId:null}]));
   equal('P2 invalid leaves library unchanged '+item.started,await allRows('P2 after invalid '+item.started),noopBefore);
   const edit=await client.state!.apply(await client.read(),[{type:'list-insert',field:'steps',item:{id:'A',label:'Revisar el faro Ω',done:false},afterId:null}]);
   equal('P3 first insert exposes exact row '+item.started,edit.snapshot.data,{name:'Escena á/ñ/漢字/🧭',other:{keep:'Conservar Ω'},prior:[{id:'old-row',label:'Anterior Ω'}],steps:[{id:'A',label:'Revisar el faro Ω',done:false}]});
   equal('P3 first effect returns new revision and scoped receipt '+item.started,[edit.snapshot.revision,typeof edit.receiptId],[item.before.document.revision+1,'string']);
   const after=await readSourceToolDocument(scope,item.id,namespace);if(!after?.document.convergence)throw Error('First insert must persist causal checkpoint');
   const checkpoint=after.document.convergence.checkpoint;
   equal('P3 one document revision '+item.started,after.document.revision,item.before.document.revision+1);
   equal('P3 ID/generation/lineage preserved '+item.started,[after.document.id,slot(after.document,'generation'),after.lineage],[item.before.document.id,slot(item.before.document,'generation'),item.before.lineage]);
   if(item.before.document.convergence)equal('P3 existing genesis preserved',checkpoint.genesisId,item.before.document.convergence.checkpoint.genesisId);
   equal('P3 independent full reader is complete '+item.started,listEffectsExport(checkpoint).pending,false);
   const born=envelope(checkpoint);
   equal('P3 discriminated list header '+item.started,born.header.format,'writers-hoard-source-additive-list/1');
   equal('P3 legacy bootstrap has one promotion and birth '+item.started,[record(born.header.promotion),born.witnesses.length],[true,1]);
   const undone=await client.state!.undo(edit.receiptId!);
   equal('P3 Undo returns default and keeps old fields '+item.started,undone.snapshot.data,{name:'Escena á/ñ/漢字/🧭',other:{keep:'Conservar Ω'},prior:[{id:'old-row',label:'Anterior Ω'}],steps:[]});
   const undoRead=await readSourceToolDocument(scope,item.id,namespace);if(!undoRead?.document.convergence||!record(undoRead.document.data))throw Error('Undo lost Source checkpoint');
   equal('P3 Undo preserves sparse raw field '+item.started,Object.hasOwn(undoRead.document.data,'steps'),false);
   equal('P3 Undo retains D and physical birth '+item.started,envelope(undoRead.document.convergence.checkpoint),born);
   equal('P3 Undo full reader remains complete '+item.started,listEffectsExport(undoRead.document.convergence.checkpoint).pending,false);
   const redone=await client.state!.redo(undone.receiptId!);
   equal('P3 Redo restores same row '+item.started,redone.snapshot.data.steps,[{id:'A',label:'Revisar el faro Ω',done:false}]);
  }
  // Direct V2 creator prunes its default. The first effect must use native8, not D.
  const nativeId=(await createSourceToolDocument(scope,namespace,'Own native sparse V2')).id;
  const native=createLocalToolClient(projectId,two,{documentId:nativeId,releaseHash:v2.contentHash,requireSelectedRelease:true});
  const nativeBefore=await readSourceToolDocument(scope,nativeId,namespace);if(!nativeBefore||!record(nativeBefore.document.data))throw Error('Native creator missing');
  equal('P3 native creator stores sparse default and no checkpoint',[Object.hasOwn(nativeBefore.document.data,'steps'),nativeBefore.document.convergence??null],[false,null]);
  const nativeRows=await allRows('P3 native before no-op'),nativeView=await native.read();
  const noNative=await native.state!.apply(nativeView,[{type:'set',field:'name',value:nativeView.data.name}]);
  equal('P3 native no-op has no receipt and preserves supported snapshot',[noNative.receiptId,noNative.snapshot.revision,noNative.snapshot.updatedAt,noNative.snapshot.data,noNative.snapshot.document??null],[null,nativeView.revision,nativeView.updatedAt,nativeView.data,nativeView.document??null]);
  equal('P3 native no-op writes nothing',await allRows('P3 native after no-op'),nativeRows);
  const nativeEdit=await native.state!.apply(await native.read(),[{type:'list-insert',field:'steps',item:{id:'N',label:'Paso nativo ñ',done:true},afterId:null}]);
  const nativeAfter=await readSourceToolDocument(scope,nativeId,namespace);if(!nativeAfter?.document.convergence)throw Error('Native first insert missing checkpoint');
  equal('P3 native first row',nativeEdit.snapshot.data.steps,[{id:'N',label:'Paso nativo ñ',done:true}]);
  equal('P3 native preserves identity/lineage',[nativeAfter.document.id,slot(nativeAfter.document,'generation'),nativeAfter.lineage],[nativeBefore.document.id,slot(nativeBefore.document,'generation'),nativeBefore.lineage]);
  const nativeBorn=envelope(nativeAfter.document.convergence.checkpoint);
  equal('P3 native has header without promotion and one birth',[nativeBorn.header.format,Object.hasOwn(nativeBorn.header,'promotion'),nativeBorn.witnesses.length],['writers-hoard-source-additive-list/1',false,1]);
  equal('P3 native independent reader complete',listEffectsExport(nativeAfter.document.convergence.checkpoint).pending,false);
  await native.state!.undo(nativeEdit.receiptId!);
  equal('P3 native Undo returns empty projection',(await native.read()).data.steps,[]);
  const nativeUndo=await readSourceToolDocument(scope,nativeId,namespace);if(!nativeUndo?.document.convergence||!record(nativeUndo.document.data))throw Error('Native Undo lost document');
  equal('P3 native Undo restores raw absence',Object.hasOwn(nativeUndo.document.data,'steps'),false);
  equal('P3 native Undo retains full history',envelope(nativeUndo.document.convergence.checkpoint),nativeBorn);
  console.log('SOURCE_LIST_EFFECTS_RESULT '+JSON.stringify({p1Passive:true,p2NoopAndInvalid:true,p3StartedAndUnstarted:true,p3NativeSparse:true,checkCount:checks.length}));
  return checks;
 }finally{
  for(const id of projects.reverse())await deleteProject(id);
  registerLocalToolModules({});
  equal('P1-P3 private cleanup89zero',await counts(),{tables:89,total:0});
 }
}

import {createLocalToolGenesis as listFunctionalGenesis,prepareSourceAdditiveCheckpoint as listFunctionalPromote,createLocalToolReplica as listFunctionalReplica} from '@/engines/local/convergence/replica';
import {projectSourceDefault as listFunctionalDefault} from '@/engines/local/convergence/sourceAdditive';

/** P4/P5/P8: actual public SDK writer and replicas. No DB row or checkpoint seeding. */
export async function testSourceListAdditiveFunctional(){
 const checks:string[]=[],owned:{destroy():void}[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{if(convergenceCanonical(actual)!==convergenceCanonical(expected))throw Error(label);checks.push(label);Reflect.set(window,'__testStage',label);};
 const object=(v:unknown):v is Record<string,LocalToolJson>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const needReceipt=(value:string|null)=>{if(!value)throw Error('Normal SDK edit must provide its receipt');return value;};
 const reject=(label:string,run:()=>unknown)=>{let failed=false;try{run();}catch{failed=true;}equal(label,failed,true);};
 const counts=async()=>{const v=await Promise.all(db.tables.map(table=>table.count()));return{tables:v.length,total:v.reduce((a,b)=>a+b,0)};};
 const namespace='tests.source-list-functional';
 const valid=(v:LocalToolJson):v is Record<string,LocalToolJson>=>object(v)&&typeof v.name==='string'&&object(v.other)&&Array.isArray(v.prior)&&v.prior.every(row=>object(row)&&typeof row.id==='string'&&typeof row.label==='string');
 const initial={name:'Revisión á/ñ/漢字/🧭',other:{keep:'Conservar Ω'},prior:[{id:'old-row',label:'Anterior'}]};
 const one=defineLocalTool<Record<string,LocalToolJson>>({namespace,stateSchemaVersion:'1',name:{en:'Own V1',es:'V1 propio'},description:{en:'Own SDK list control',es:'Control propio de lista SDK'},document:{defaultTitle:{en:'Own list',es:'Lista propia'}},codec:{version:1,fields:{name:{kind:'scalar'},other:{kind:'map'},prior:{kind:'list',idKey:'id'}}},initialState:initial,validateState:valid,component:()=>null});
 const from={namespace,codec:one.codec!,...localToolConvergenceContext(one)!};
 const two=defineLocalTool<Record<string,LocalToolJson>>({...one,stateSchemaVersion:'2',codec:{version:1,fields:{...one.codec!.fields,steps:{kind:'list',idKey:'key'}}},initialState:{...initial,steps:[]},validateState:(v):v is Record<string,LocalToolJson>=>valid(v)&&Array.isArray(v.steps)&&v.steps.every(row=>object(row)&&typeof row.key==='string'&&!!row.key&&typeof row.label==='string'&&typeof row.done==='boolean'),sourceAdditive:{from,field:'steps',defaultValue:[]}});
 const contract={namespace,codec:two.codec!,...localToolConvergenceContext(two)!,validateState:two.validateState};
 const rows=(data:LocalToolJson)=>{const view=listFunctionalDefault(data,two.codec!.sourceDefault);if(!object(view)||!Array.isArray(view.steps))throw Error('Declared list projection must be an array');return view.steps;};
 const keys=(data:LocalToolJson)=>rows(data).map(row=>{if(!object(row)||typeof row.key!=='string')throw Error('Declared custom key missing');return row.key;});
 const oldFields=(data:Record<string,LocalToolJson>)=>({name:data.name,other:data.other,prior:data.prior});
 const make=(checkpoint:Parameters<typeof listFunctionalReplica>[0],authorId:string)=>{const value=listFunctionalReplica(checkpoint,{contract,authorId});owned.push(value);return value;};
 try{
  equal('P4 private library starts89zero',await counts(),{tables:89,total:0});
  const legacy=listFunctionalGenesis(initial,{...from,validateState:one.validateState});
  equal('P4 genuine public predecessor is engine1 and readable',[legacy.engine.version,listEffectsExport(legacy).pending],['1',false]);
  const promoted=listFunctionalPromote(legacy,initial,from,contract);
  equal('P4 public promotion retains genesis and completes',[promoted.genesisId,listEffectsExport(promoted).pending],[legacy.genesisId,false]);
  // Independent authors branch from the same D. Never construct their updates by hand.
  const a=make(promoted,'functional-concurrent-A'),b=make(promoted,'functional-concurrent-B');
  const ae=a.apply([{type:'list-insert',field:'steps',item:{key:'A',label:'Paso A Ω',done:false},afterId:null}]);
  const be=b.apply([{type:'list-insert',field:'steps',item:{key:'B',label:'Paso B ñ',done:true},afterId:null}]);
  a.receive(be.update);b.receive(ae.update);
  equal('P4 concurrent replicas converge on exact whole data',a.read(),b.read());
  equal('P4 both disjoint custom IDs survive',keys(a.read()).sort(),['A','B']);
  equal('P4 old fields stay literal',oldFields(a.read()),initial);
  const duplicateBefore=a.checkpoint();a.receive(be.update);a.receive(be.update);
  equal('P4 duplicate delivery changes no checkpoint',a.checkpoint(),duplicateBefore);
  const au=a.undo(needReceipt(ae.receiptId));b.receive(au.update);
  equal('P4 Undo A preserves B in both replicas',[rows(a.read()),rows(b.read())],[[{key:'B',label:'Paso B ñ',done:true}],[{key:'B',label:'Paso B ñ',done:true}]]);
  a.receive(ae.update);b.receive(ae.update);
  equal('P4 late replay does not re-enable undone author',[keys(a.read()),keys(b.read())],[['B'],['B']]);
  const ar=a.redo(needReceipt(au.receiptId));b.receive(ar.update);
  equal('P4 Redo converges without duplicate IDs',[a.read(),keys(a.read()).sort()],[b.read(),['A','B']]);
  equal('P4 full reader completes both concurrent histories',[listEffectsExport(a.checkpoint()).pending,listEffectsExport(b.checkpoint()).pending],[false,false]);
  // B observes A before inserting. Undo A still must not remove B's field support.
  const sa=make(promoted,'functional-sequential-A'),sb=make(promoted,'functional-sequential-B');
  const sae=sa.apply([{type:'list-insert',field:'steps',item:{key:'SA',label:'Anterior observado',done:false},afterId:null}]);
  sb.receive(sae.update);
  const sbe=sb.apply([{type:'list-insert',field:'steps',item:{key:'SB',label:'Posterior conservado',done:false},afterId:'SA'}]);
  sa.receive(sbe.update);equal('P4 sequential replicas converge',sa.read(),sb.read());
  const sau=sa.undo(needReceipt(sae.receiptId));sb.receive(sau.update);
  equal('P4 sequential Undo A preserves B alone',[keys(sa.read()),keys(sb.read())],[['SB'],['SB']]);
  equal('P4 sequential field is still materially present',Object.hasOwn(sb.read(),'steps'),true);
  equal('P4 sequential full histories complete',[listEffectsExport(sa.checkpoint()).pending,listEffectsExport(sb.checkpoint()).pending],[false,false]);
  // One writer transaction has multiple births for A but only its final selected register.
  const batch=make(promoted,'functional-batch');
  const insert=batch.apply([
   {type:'list-insert',field:'steps',item:{key:'MA',label:'Múltiple A',done:false},afterId:null},
   {type:'list-insert',field:'steps',item:{key:'MB',label:'Múltiple B',done:false},afterId:'MA'},
   {type:'list-move',field:'steps',id:'MA',afterId:'MB'},
   {type:'list-move',field:'steps',id:'MA',afterId:'MB'},
  ]);
  equal('P5 one batch with repeated move has each ID once',rows(batch.read()),[{key:'MB',label:'Múltiple B',done:false},{key:'MA',label:'Múltiple A',done:false}]);
  equal('P5 full reader accepts intermediate births without selected versions',listEffectsExport(batch.checkpoint()).pending,false);
  const noMoveBefore=batch.checkpoint(),noMove=batch.apply([{type:'list-move',field:'steps',id:'MA',afterId:'MB'}]);
  equal('P5 ordinary same-position move is a true no-op',[noMove.receiptId,batch.checkpoint()],[null,noMoveBefore]);
  const update=batch.apply([{type:'list-update',field:'steps',id:'MB',item:{key:'MB',label:'B actualizado á',done:true}}]);
  equal('P5 custom-key update replaces exact item',rows(batch.read()),[{key:'MB',label:'B actualizado á',done:true},{key:'MA',label:'Múltiple A',done:false}]);
  const removed=batch.apply([{type:'list-delete',field:'steps',id:'MA'}]);
  equal('P5 custom-key delete preserves the other item',rows(batch.read()),[{key:'MB',label:'B actualizado á',done:true}]);
  batch.undo(needReceipt(removed.receiptId));batch.undo(needReceipt(update.receiptId));
  equal('P5 inverse edits restore exact batch',rows(batch.read()),[{key:'MB',label:'Múltiple B',done:false},{key:'MA',label:'Múltiple A',done:false}]);
  batch.undo(needReceipt(insert.receiptId));
  equal('P5 Undo whole batch restores sparse raw and virtual default',[Object.hasOwn(batch.read(),'steps'),rows(batch.read())],[false,[]]);
  equal('P5 full reader accepts inactive retained births',listEffectsExport(batch.checkpoint()).pending,false);
  const invalidBefore=batch.checkpoint();
  reject('P5 missing anchor still rejects',()=>batch.apply([{type:'list-insert',field:'steps',item:{key:'invalid',label:'No anchor',done:false},afterId:'missing'}]));
  reject('P5 deleting absent ID is not converted to no-op',()=>batch.apply([{type:'list-delete',field:'steps',id:'missing'}]));
  equal('P5 rejected actions leave full checkpoint exact',batch.checkpoint(),invalidBefore);
  equal('P8 descriptor retains arbitrary valid key',two.codec!.fields.steps,{kind:'list',idKey:'key'});
  equal('P8 no Source storage writes in SDK-only functional cases',await counts(),{tables:89,total:0});
  console.log('SOURCE_LIST_FUNCTIONAL_RESULT '+JSON.stringify({concurrent:true,sequential:true,undoPreservesOther:true,multiMove:true,customKey:'key',checkCount:checks.length}));
  return checks;
 }finally{for(const replica of owned)replica.destroy();equal('P4/P5/P8 private cleanup89zero',await counts(),{tables:89,total:0});}
}

import {exportProjectData as listImportExportProject,importProjectData as listImportProject} from '@/db/operations';
import {convergenceBase64 as listImportBase64} from '@/engines/local/convergence/format';

/** F2 minimal full-import oracle. The only malformed bytes are in an in-memory
 * clone of a genuine public Source checkpoint. No private DB writer or mock.
 * Full reader must reject before JSON copying; JSON import must do the same
 * atomically rather than reseeding and thereby laundering the invalid history. */
export async function testSourceListAdditiveImportF2(){
 const checks:string[]=[],projects:string[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{
  if(convergenceCanonical(actual)!==convergenceCanonical(expected))throw Error(label);
  checks.push(label);Reflect.set(window,'__testStage',label);
 };
 const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 // IndexedDB records may contain own undefined (documentHistory is one normal

 // example). Encode every supported value with a disjoint type envelope; never

 // stringify raw records or erase fields to fit the product's JSON-only codec.

 let dbSnapshotNumber=0;

 const allRows=async(stage:string)=>{

  const snapshot=++dbSnapshotNumber;

  console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage,snapshot,event:'collect',completedChecks:checks.length}));

  const tables=await Promise.all(db.tables.map(async table=>({name:table.name,rows:await table.toArray()})));

  tables.sort((a,b)=>a.name.localeCompare(b.name));

  const seen=new WeakMap<object,number>();let serial=0;const ownUndefinedPaths:string[]=[];

  const unsupported=(path:string,reason:string):never=>{

   console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage,snapshot,event:'unsupported',path,reason}));

   throw Error('Source list IndexedDB comparator unsupported at '+path+': '+reason);

  };

  const encode=async(value:unknown,path:string):Promise<LocalToolJson>=>{

   if(value===undefined){ownUndefinedPaths.push(path);return ['undefined'];}

   if(value===null)return ['null'];

   if(typeof value==='string')return ['string',value];

   if(typeof value==='boolean')return ['boolean',value];

   if(typeof value==='number')return ['number',Object.is(value,-0)?'-0':String(value)];

   if(typeof value==='bigint')return ['bigint',String(value)];

   if(typeof value!=='object')return unsupported(path,typeof value);

   const previous=seen.get(value);if(previous!==undefined)return ['reference',previous];

   const id=++serial;seen.set(value,id);

   if(typeof File!=='undefined'&&value instanceof File)return ['file',id,value.name,value.lastModified,value.type,value.size,Array.from(new Uint8Array(await value.arrayBuffer()))];

   if(value instanceof Blob)return ['blob',id,value.type,value.size,Array.from(new Uint8Array(await value.arrayBuffer()))];

   if(value instanceof ArrayBuffer)return ['array-buffer',id,value.byteLength,Array.from(new Uint8Array(value))];

   if(ArrayBuffer.isView(value))return ['array-buffer-view',id,Object.prototype.toString.call(value),value.byteOffset,value.byteLength,await encode(value.buffer,path+'.buffer')];

   // Other structured-clone classes are rejected explicitly, not silently reduced.

   const prototype=Object.getPrototypeOf(value);

   if(!Array.isArray(value)&&prototype!==Object.prototype&&prototype!==null)return unsupported(path,Object.prototype.toString.call(value));

   const entries:LocalToolJson[]=[];

   const keys=Reflect.ownKeys(value);

   if(keys.some(key=>typeof key!=='string'))return unsupported(path,'symbol key');

   for(const key of Object.getOwnPropertyNames(value).sort()){

    if(Array.isArray(value)&&key==='length')continue;

    const property=Object.getOwnPropertyDescriptor(value,key);

    if(!property||!('value'in property))return unsupported(path+'['+JSON.stringify(key)+']','accessor');

    entries.push([key,!!property.enumerable,!!property.configurable,!!property.writable,await encode(property.value,path+'['+JSON.stringify(key)+']')]);

   }

   return Array.isArray(value)?['array',id,value.length,entries]:['object',id,prototype===null?'null-prototype':'Object',entries];

  };

  const encoded=await encode(tables,'$');

  console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage,snapshot,event:'encoded',tables:tables.length,objectCount:serial,ownUndefinedPaths}));

  return encoded;

 };

 const counts=async()=>{const values=await Promise.all(db.tables.map(table=>table.count()));return{tables:values.length,total:values.reduce((a,b)=>a+b,0)};};
 const namespace='tests.source-list-import-f2';
 const valid=(value:LocalToolJson):value is Record<string,LocalToolJson>=>{
  if(!record(value)||typeof value.name!=='string'||!value.name||!record(value.other)||!Array.isArray(value.prior))return false;
  return value.prior.every(item=>record(item)&&typeof item.id==='string'&&!!item.id&&typeof item.label==='string');
 };
 const one=defineLocalTool<Record<string,LocalToolJson>>({namespace,stateSchemaVersion:'1',
  name:{en:'Own review V1',es:'Revisión propia V1'},description:{en:'Own offline review',es:'Revisión propia local'},
  document:{defaultTitle:{en:'Own review',es:'Revisión propia'}},
  codec:{version:1,fields:{name:{kind:'scalar'},other:{kind:'map'},prior:{kind:'list',idKey:'id'}}},
  index:{version:1,fields:{name:{path:'$.name',type:'string'}}},
  initialState:{name:'Initial',other:{keep:'Conservar á/ñ/漢字/🧭'},prior:[{id:'old-row',label:'Anterior Ω'}]},validateState:valid,component:()=>null,
 });
 const from={namespace,codec:one.codec!,...localToolConvergenceContext(one)!};
 const two=defineLocalTool<Record<string,LocalToolJson>>({...one,stateSchemaVersion:'2',
  codec:{version:1,fields:{...one.codec!.fields,steps:{kind:'list',idKey:'id'}}},
  initialState:{...one.initialState,steps:[]},
  validateState:(value):value is Record<string,LocalToolJson>=>valid(value)&&Array.isArray(value.steps)&&value.steps.every(item=>record(item)&&typeof item.id==='string'&&!!item.id&&typeof item.label==='string'&&typeof item.done==='boolean'),
  sourceAdditive:{from,field:'steps',defaultValue:[]},
 });
 const sha=async(bytes:Uint8Array<ArrayBuffer>)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const sourceBytes=new TextEncoder().encode(fixtureSource),files=[{path:'module.tsx',sha256:await sha(sourceBytes),bytes:sourceBytes.length}];
 const manifest=async(version:string):Promise<LocalToolReleaseManifest>=>{
  const base={format:'writers-hoard-local-tool-source/1',apiVersion:1,namespace,version,files} as const;
  return{...base,contentHash:await sha(new TextEncoder().encode(localToolReleaseIdentity(base)))};
 };
 const v1=await manifest('1.0.0'),v2=await manifest('2.0.0');
 const root=(hash:string)=>'./installed/'+namespace+'/versions/'+hash;
 registerLocalToolModules({[root(v1.contentHash)+'/module.tsx']:{default:one},[root(v2.contentHash)+'/module.tsx']:{default:two}},{[root(v1.contentHash)+'/release.json']:v1,[root(v2.contentHash)+'/release.json']:v2});
 try{
  equal('F2 private library starts89zero',await counts(),{tables:89,total:0});
  const projectId='own-list-import-'+crypto.randomUUID(),now=Date.now();
  await createProject({id:projectId,title:'Own list import control',description:'Synthetic private library',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['local-tool-'+namespace],engineOrder:['local-tool-'+namespace],createdAt:now,updatedAt:now});projects.push(projectId);
  await pinLocalToolRelease(projectId,namespace,v2.contentHash,null);
  const scope={projectId},id=(await createSourceToolDocument(scope,namespace,'Own list import')).id;
  const client=createLocalToolClient(projectId,two,{documentId:id,releaseHash:v2.contentHash,requireSelectedRelease:true});
  await client.state!.apply(await client.read(),[{type:'list-insert',field:'steps',item:{id:'own-row',label:'Conservar á/ñ/漢字/🧭',done:false},afterId:null}]);
  const source=await readSourceToolDocument(scope,id,namespace);
  if(!source?.document.convergence)throw Error('F2 normal first effect did not persist checkpoint');
  const checkpoint=source.document.convergence.checkpoint;
  equal('F2 genuine origin8 complete reader',[checkpoint.engine.version,listEffectsExport(checkpoint).pending],['8',false]);
  const exported=await listImportExportProject(projectId);
  if(!exported.project)throw Error('F2 normal export missing project');
  const copyId=await listImportProject(JSON.parse(JSON.stringify(exported)));projects.push(copyId);
  const copied=await listImportExportProject(copyId);
  const copiedDocument=copied.project?.sourceToolDocuments?.find(item=>item.namespace===namespace);
  if(!copiedDocument?.convergence)throw Error('F2 valid normal JSON copy missing Source checkpoint');
  equal('F2 valid copy keeps exact data and complete reader',[copiedDocument.data,listEffectsExport(copiedDocument.convergence.checkpoint).pending],[source.document.data,false]);
  equal('F2 valid copy uses a new document identity',copiedDocument.id!==id,true);
  await deleteProject(copyId);projects.splice(projects.indexOf(copyId),1);
  equal('F2 valid copy leaves source exact',await readSourceToolDocument(scope,id,namespace),source);
  const malformed=structuredClone(checkpoint),wire=new listEffectsY.Doc({gc:false});
  try{
   listEffectsY.applyUpdate(wire,listEffectsBytes(checkpoint.checkpointBase64));
   // Correct Yjs bytes/vector and exact old state; one extra genuine Y.Array
   // placement with no required authority witness is the sole corruption.
   wire.getArray<string>('order:'+JSON.stringify('steps')).push([JSON.stringify({id:'unwitnessed-row',placementId:'unwitnessed-placement'})]);
   malformed.checkpointBase64=listImportBase64(listEffectsY.encodeStateAsUpdate(wire));
   malformed.stateVectorBase64=listImportBase64(listEffectsY.encodeStateVector(wire));
  }finally{wire.destroy();}
  let readerError:string|null=null;
  try{listEffectsExport(malformed);}catch(error){readerError=error instanceof Error?error.message:String(error);}
  equal('F2 independent full reader rejects unwitnessed placement',readerError,'local_tool_source_additive_history_invalid');
  const invalid:Awaited<ReturnType<typeof listImportExportProject>>=JSON.parse(JSON.stringify(exported)),target=invalid.project?.sourceToolDocuments?.find(item=>item.id===id);
  if(!target?.convergence)throw Error('F2 exported Source target missing');
  target.convergence.checkpoint=malformed;
  equal('F2 malformed payload preserves data and codec',[target.data,target.codec],[source.document.data,source.document.codec]);
  const before=await allRows('F2 before invalid normal JSON import');
  let accepted=false,errorCode:string|null=null,returnedId:string|null=null;
  try{
   returnedId=await listImportProject(invalid);
   projects.push(returnedId); // Register unexpected success BEFORE any assertion.
   accepted=true;
  }catch(error){errorCode=error instanceof Error?error.message:String(error);}
  const after=await allRows('F2 after invalid normal JSON import');
  const sourceAfter=await readSourceToolDocument(scope,id,namespace);
  const result={readerError,accepted,error:errorCode,returnedId,sourceUnchanged:convergenceCanonical(sourceAfter)===convergenceCanonical(source),fullDatabaseUnchanged:convergenceCanonical(before)===convergenceCanonical(after),validCopyControl:true,checkCount:checks.length};
  console.log('SOURCE_LIST_IMPORT_DB_SNAPSHOTS '+JSON.stringify({before,after}));
  console.log('SOURCE_LIST_IMPORT_F2_RESULT '+JSON.stringify(result));
  equal('F2 source/control stays exact',sourceAfter,source);
  equal('F2 invalid full history must reject before JSON fork',accepted,false);
  equal('F2 rejection leaves full89-table library exact',after,before);
  equal('F2 malformed reader and importer share history error',errorCode,readerError);
  return checks;
 }finally{
  for(const id of projects.reverse())await deleteProject(id);
  equal('F2 private cleanup89zero',await counts(),{tables:89,total:0});
 }
}

// APPEND only after Root reads this complete body. No edits to prior test exports.
// Existing preamble provides defineLocalTool, LocalToolDefinition, LocalToolJson,
// db, localToolConvergenceContext, convergenceCanonical and listEffectsExport.
// Producer and historical consumer were authored by the same preparer2568/2565;
// Root reviews/runs them. This is not an independent audit of either body.
import {createLocalToolGenesis as listP10Genesis,createLocalToolReplica as listP10Replica} from '@/engines/local/convergence/replica';

/** P10 inputs: public SDK definitions/genesis/replica, no registry or DB seeding.
 * This export reads the CURRENT definition-free reader, never the frozen reader.
 * The separate Node consumer2565 imports ONLY the frozen208e effective module.
 */
export async function testSourceListBaselineReaderInputs(){
 const checks:string[]=[],owned:{destroy():void}[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{
  if(convergenceCanonical(actual)!==convergenceCanonical(expected))throw Error(label);
  checks.push(label);Reflect.set(window,'__testStage',label);
 };
 const object=(value:unknown):value is Record<string,LocalToolJson>=>!!value&&typeof value==='object'&&!Array.isArray(value);
 const counts=async()=>{
  const rows=await Promise.all(db.tables.map(async table=>({name:table.name,count:await table.count()})));
  return {tables:rows.length,total:rows.reduce((n,row)=>n+row.count,0),rows:rows.sort((a,b)=>a.name.localeCompare(b.name))};
 };
 const shaJson=async(value:unknown)=>{
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 };
 type Definition=LocalToolDefinition<Record<string,LocalToolJson>>;
 type Checkpoint=Parameters<typeof listEffectsExport>[0];
 const contract=(definition:Definition)=>{
  const context=localToolConvergenceContext(definition);
  if(!definition.codec||!context)throw Error('P10 public definition must declare a codec/context');
  return {namespace:definition.namespace,codec:definition.codec,...context,validateState:definition.validateState};
 };
 type Identity=Pick<Checkpoint,'namespace'|'genesisId'|'engine'|'codecHash'|'validationId'|'schemaEpoch'>;
 const identity=(value:Identity)=>({namespace:value.namespace,genesisId:value.genesisId,engine:value.engine,codecHash:value.codecHash,validationId:value.validationId,schemaEpoch:value.schemaEpoch});
 const validOne=(value:LocalToolJson):value is Record<string,LocalToolJson>=>
  object(value)&&typeof value.name==='string'&&object(value.other)&&Array.isArray(value.prior)&&
  value.prior.every(row=>object(row)&&typeof row.id==='string'&&!!row.id&&typeof row.label==='string');
 const namespace='tests.source-list-reader-inputs';
 const initial:Record<string,LocalToolJson>={name:'Lectura propia Ω',other:{keep:'Literal á/ñ/漢字/🧭'},prior:[{id:'old-row',label:'Anterior Ω'}]};
 const one=defineLocalTool<Record<string,LocalToolJson>>({
  namespace,stateSchemaVersion:'1',name:{en:'Own reader V1',es:'Lector V1 propio'},
  description:{en:'Own historical reader inputs',es:'Entradas propias para lector histórico'},
  document:{defaultTitle:{en:'Own reader inputs',es:'Entradas propias del lector'}},
  codec:{version:1,fields:{name:{kind:'scalar'},other:{kind:'map'},prior:{kind:'list',idKey:'id'}}},
  initialState:initial,validateState:validOne,component:()=>null,
 });
 const prior=contract(one),from={namespace:prior.namespace,codec:prior.codec,validationId:prior.validationId,schemaEpoch:prior.schemaEpoch};
 const scalar=defineLocalTool<Record<string,LocalToolJson>>({...one,stateSchemaVersion:'2',
  codec:{version:1,fields:{...one.codec!.fields,habitat:{kind:'scalar'}}},
  initialState:{...initial,habitat:'Coast'},
  validateState:(value):value is Record<string,LocalToolJson>=>validOne(value)&&typeof value.habitat==='string',
  sourceAdditive:{from,field:'habitat',defaultValue:'Coast'},
 });
 const map=defineLocalTool<Record<string,LocalToolJson>>({...one,stateSchemaVersion:'2',
  codec:{version:1,fields:{...one.codec!.fields,flags:{kind:'map'}}},
  initialState:{...initial,flags:{}},
  validateState:(value):value is Record<string,LocalToolJson>=>validOne(value)&&object(value.flags),
  sourceAdditive:{from,field:'flags',defaultValue:{}},
 });
 const list=defineLocalTool<Record<string,LocalToolJson>>({...one,stateSchemaVersion:'2',
  codec:{version:1,fields:{...one.codec!.fields,steps:{kind:'list',idKey:'key'}}},
  initialState:{...initial,steps:[]},
  validateState:(value):value is Record<string,LocalToolJson>=>validOne(value)&&Array.isArray(value.steps)&&
   value.steps.every(row=>object(row)&&typeof row.key==='string'&&!!row.key&&typeof row.label==='string'&&typeof row.done==='boolean'),
  sourceAdditive:{from,field:'steps',defaultValue:[]},
 });
 type CapturedCase={id:string;codec:NonNullable<Definition['codec']>;checkpoint:Checkpoint;codecSha256:string;checkpointSha256:string;
  operation:string;currentReader:ReturnType<typeof listEffectsExport>};
 const cases:CapturedCase[]=[];
 const capture=async(id:string,definition:Definition,checkpoint:Checkpoint,operation:string)=>{
  // This reader has NO definition/callback argument: actual portable acceptance.
  const currentReader=listEffectsExport(checkpoint);
  equal('P10 current full reader complete '+id,currentReader.pending,false);
  equal('P10 current export identity exact '+id,identity(currentReader.update),identity(checkpoint));
  if(!currentReader.update.updateBase64)throw Error('P10 current full reader returned no update');
  const codec=structuredClone(definition.codec!),detached=structuredClone(checkpoint);
  cases.push({id,codec,checkpoint:detached,codecSha256:await shaJson(codec),checkpointSha256:await shaJson(detached),operation,currentReader});
 };
 let result:{format:string;sourceTask:number;preparationTask:number;cases:CapturedCase[];checks:string[];library:{tables:number;total:number};limits:string[]}|undefined;
 try{
  const before=await counts();equal('P10 private library begins89zero',[before.tables,before.total],[89,0]);
  const v1=listP10Genesis(one.initialState,contract(one));
  equal('P10 V1 auxiliary engine sanity',v1.engine.version,'1');
  await capture('v1',one,v1,'defineLocalTool V1 + genuine context + createLocalToolGenesis(initialState)');
  const scalar8=listP10Genesis(scalar.initialState,contract(scalar));
  equal('P10 scalar auxiliary engine sanity',scalar8.engine.version,'8');
  await capture('scalar8',scalar,scalar8,'public scalar sourceAdditive declaration/context + native createLocalToolGenesis');
  const map8=listP10Genesis(map.initialState,contract(map));
  equal('P10 map auxiliary engine sanity',map8.engine.version,'8');
  await capture('map8',map,map8,'public empty-map sourceAdditive declaration/context + native createLocalToolGenesis');
  const empty=listP10Genesis(list.initialState,contract(list));
  equal('P10 native list auxiliary engine sanity',empty.engine.version,'8');
  await capture('list-empty',list,empty,'public empty-list sourceAdditive declaration/context + native createLocalToolGenesis');
  const replica=listP10Replica(empty,{contract:contract(list),authorId:'own-historical-reader-author'});owned.push(replica);
  equal('P10 native empty read equals declared state',replica.read(),list.initialState);
  const edit=replica.apply([{type:'list-insert',field:'steps',item:{key:'first-own-step',label:'Comprobar el faro Ω',done:false},afterId:null}]);
  equal('P10 normal first insert changes data and causal history',[edit.changed,edit.causalChanged,edit.pending],[true,true,false]);
  if(typeof edit.receiptId!=='string'||!edit.receiptId)throw Error('P10 normal insert must create an actual receipt');
  equal('P10 first insert exact old/new values',replica.read(),{...initial,steps:[{key:'first-own-step',label:'Comprobar el faro Ω',done:false}]});
  const post=replica.checkpoint();equal('P10 native empty/post-insert same complete identity',identity(post),identity(empty));
  if(convergenceCanonical(post)===convergenceCanonical(empty))throw Error('P10 insert did not create a distinct checkpoint');
  await capture('list-post-insert',list,post,'createLocalToolReplica(native empty) + public apply(list-insert) + checkpoint');
  equal('P10 capture order',cases.map(item=>item.id),['v1','scalar8','map8','list-empty','list-post-insert']);
  equal('P10 raw codecs match for native empty/post-insert',cases[3].codec,cases[4].codec);
  equal('P10 public memory operations do not touch library',await counts(),before);
  result={format:'writers-hoard-baseline-reader-capture/1',sourceTask:2540,preparationTask:2568,cases,checks,library:{tables:before.tables,total:before.total},
   limits:['Current reader acceptance only; historical Node consumer2565 runs separately.',
    'No SourceHost, registry, CLI installation, UI, MCP, DB writer or Source-document flow exercised here.',
    'Source HEAD plus actual dirty Source-cut SHA and external runner evidence must be bound outside this marker after EOF; no self-referential evidence hash.']};
 }finally{
  for(const replica of owned.reverse())replica.destroy();
  const after=await counts();equal('P10 private cleanup89zero',[after.tables,after.total],[89,0]);
 }
 if(!result)throw Error('P10 capture missing after successful cleanup');
 // Marker is emitted only AFTER cleanup; the ordinary driver still must finish EOF0.
 console.log('SOURCE_LIST_BASELINE_CASES_RESULT '+JSON.stringify(result));
 Reflect.set(window,'__sourceListBaselineCapture',result);
 return checks;
}

import {prepareLocalToolReplacement as listP7Replace,prepareLocalToolReverse as listP7Reverse,prepareLocalToolFork as listP7Fork} from '@/engines/local/convergence/replica';

/** P7 legitimate presence and absence use the ordinary public replacement/Undo
 * APIs. No root/register mutation and no imported partial update in this export. */
export async function testSourceListAdditivePresence(){
 const checks:string[]=[],owned:{destroy():void}[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{if(convergenceCanonical(actual)!==convergenceCanonical(expected))throw Error(label);checks.push(label);Reflect.set(window,'__testStage',label);};
 const object=(v:unknown):v is Record<string,LocalToolJson>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const needReceipt=(value:string|null)=>{if(!value)throw Error('Normal SDK edit must provide its receipt');return value;};
 const reject=(label:string,run:()=>unknown)=>{let failed=false;try{run();}catch{failed=true;}equal(label,failed,true);};
 const counts=async()=>{const v=await Promise.all(db.tables.map(table=>table.count()));return{tables:v.length,total:v.reduce((a,b)=>a+b,0)};};
 const namespace='tests.source-list-presence';
 const valid=(v:LocalToolJson):v is Record<string,LocalToolJson>=>object(v)&&typeof v.name==='string'&&object(v.other)&&Array.isArray(v.prior)&&v.prior.every(row=>object(row)&&typeof row.id==='string'&&typeof row.label==='string');
 const initial={name:'Revisión á/ñ/漢字/🧭',other:{keep:'Conservar Ω'},prior:[{id:'old-row',label:'Anterior'}]};
 const one=defineLocalTool<Record<string,LocalToolJson>>({namespace,stateSchemaVersion:'1',name:{en:'Own V1',es:'V1 propio'},description:{en:'Own SDK list control',es:'Control propio de lista SDK'},document:{defaultTitle:{en:'Own list',es:'Lista propia'}},codec:{version:1,fields:{name:{kind:'scalar'},other:{kind:'map'},prior:{kind:'list',idKey:'id'}}},initialState:initial,validateState:valid,component:()=>null});
 const from={namespace,codec:one.codec!,...localToolConvergenceContext(one)!};
 const two=defineLocalTool<Record<string,LocalToolJson>>({...one,stateSchemaVersion:'2',codec:{version:1,fields:{...one.codec!.fields,steps:{kind:'list',idKey:'key'}}},initialState:{...initial,steps:[]},validateState:(v):v is Record<string,LocalToolJson>=>valid(v)&&Array.isArray(v.steps)&&v.steps.every(row=>object(row)&&typeof row.key==='string'&&!!row.key&&typeof row.label==='string'&&typeof row.done==='boolean'),sourceAdditive:{from,field:'steps',defaultValue:[]}});
 const contract={namespace,codec:two.codec!,...localToolConvergenceContext(two)!,validateState:two.validateState};
 const rows=(data:LocalToolJson)=>{const view=listFunctionalDefault(data,two.codec!.sourceDefault);if(!object(view)||!Array.isArray(view.steps))throw Error('Declared list projection must be an array');return view.steps;};
 const keys=(data:LocalToolJson)=>rows(data).map(row=>{if(!object(row)||typeof row.key!=='string')throw Error('Declared custom key missing');return row.key;});
 const oldFields=(data:Record<string,LocalToolJson>)=>({name:data.name,other:data.other,prior:data.prior});
 const make=(checkpoint:Parameters<typeof listFunctionalReplica>[0],authorId:string)=>{const value=listFunctionalReplica(checkpoint,{contract,authorId});owned.push(value);return value;};
 try{
  equal('P7 private library starts89zero',await counts(),{tables:89,total:0});
  const legacy=listFunctionalGenesis(initial,{...from,validateState:one.validateState});
  const promoted=listFunctionalPromote(legacy,initial,from,contract);
  const nativeSparse=listP7Fork(initial,{namespace,codec:contract.codec,validationId:contract.validationId,schemaEpoch:contract.schemaEpoch}).checkpoint;
  for(const [kind,checkpoint] of [['promoted',promoted],['native-sparse',nativeSparse]] as const){
   const options={contract,authorId:'presence-author-'+kind},a=make(checkpoint,'presence-A-'+kind);
   const added=listP7Replace(a.checkpoint(),options,{...initial,steps:[{key:'A',label:'Conservar A Ω',done:false}]});
   if(!added.receipt)throw Error('P7 effective public replacement must return its receipt');
   equal('P7 replacement materializes one row '+kind,keys(added.data),['A']);
   equal('P7 materialized replacement full reader '+kind,listEffectsExport(added.checkpoint).pending,false);
   const b=make(added.checkpoint,'presence-B-'+kind);
   b.apply([{type:'list-insert',field:'steps',item:{key:'B',label:'Conservar B ñ',done:true},afterId:'A'}]);
   const undoneA=listP7Reverse(b.checkpoint(),options,added.receipt);
   equal('P7 Undo A keeps B despite undone first presence '+kind,keys(undoneA.data),['B']);
   equal('P7 Undo A keeps literal old fields '+kind,oldFields(undoneA.data),initial);
   equal('P7 Undo A full reader '+kind,listEffectsExport(undoneA.checkpoint).pending,false);
   const removed=listP7Replace(undoneA.checkpoint,options,initial);
   if(!removed.receipt)throw Error('P7 normal removal must return its receipt');
   equal('P7 normal replacement writes legitimate false presence '+kind,removed.data,initial);
   equal('P7 complete false presence full reader '+kind,listEffectsExport(removed.checkpoint).pending,false);
   const hidden=make(removed.checkpoint,'presence-hidden-'+kind);
   equal('P7 normal replacement removes field and known rows '+kind,hidden.read(),initial);
   const restored=listP7Reverse(removed.checkpoint,options,removed.receipt);
   equal('P7 Undo false presence restores B alone '+kind,keys(restored.data),['B']);
   const concurrentC=make(undoneA.checkpoint,'presence-concurrent-C-'+kind);
   const ce=concurrentC.apply([{type:'list-insert',field:'steps',item:{key:'C',label:'Concurrent C remains active Ω',done:false},afterId:'B'}]);
   hidden.receive(ce.update);
   equal('P7 false presence hides concurrent active C '+kind,hidden.read(),initial);
   const restoredConcurrent=listP7Reverse(hidden.checkpoint(),options,removed.receipt);
   equal('P7 Undo false presence restores B and concurrent C '+kind,keys(restoredConcurrent.data),['B','C']);
   equal('P7 all normal replacements keep origin '+kind,[added.checkpoint.genesisId,undoneA.checkpoint.genesisId,removed.checkpoint.genesisId,restored.checkpoint.genesisId],[checkpoint.genesisId,checkpoint.genesisId,checkpoint.genesisId,checkpoint.genesisId]);
  }
  // An explicitly seeded native field has real seed presence. Do not infer the
  // no-seed rule from engine8 or from historical presence existing in a map.
  const seeded=listP7Fork({...initial,steps:[{key:'seed',label:'Fila inicial á',done:false}]},{namespace,codec:contract.codec,validationId:contract.validationId,schemaEpoch:contract.schemaEpoch}).checkpoint;
  equal('P7 nonempty native fork full reader',listEffectsExport(seeded).pending,false);
  const seedReader=make(seeded,'presence-seed-reader'),seedOptions={contract,authorId:'presence-seed-owner'};
  equal('P7 explicit native seed retains row',keys(seedReader.read()),['seed']);
  const removeSeed=listP7Replace(seeded,seedOptions,initial);
  if(!removeSeed.receipt)throw Error('P7 explicit seed removal must return receipt');
  equal('P7 explicit seed false presence stays absent',make(removeSeed.checkpoint,'presence-seed-hidden').read(),initial);
  const restoreSeed=listP7Reverse(removeSeed.checkpoint,seedOptions,removeSeed.receipt);
  equal('P7 explicit seed Undo restores exact row',restoreSeed.data,seedReader.read());
  equal('P7 explicit seed Undo full reader',listEffectsExport(restoreSeed.checkpoint).pending,false);
  equal('P7 public memory operations do not write Source DB',await counts(),{tables:89,total:0});
  console.log('SOURCE_LIST_PRESENCE_RESULT '+JSON.stringify({promoted:true,nativeSparse:true,explicitSeed:true,publicReplacement:true,undoPreservesOther:true,checkCount:checks.length}));
  return checks;
 }finally{for(const replica of owned)replica.destroy();equal('P7 private cleanup89zero',await counts(),{tables:89,total:0});}
}

import {renameSourceToolDocument as listP9Rename} from '@/engines/local/documents/store';

/** P9 normal Source CAS and outer-RW abort. No direct Source DB seeding. */
export async function testSourceListAdditiveAtomicity(){
 const checks:string[]=[],projects:string[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{if(convergenceCanonical(actual)!==convergenceCanonical(expected))throw Error(label);checks.push(label);Reflect.set(window,'__testStage',label);};
 const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const rejected=async(label:string,run:()=>Promise<unknown>)=>{let code:string|null=null;try{await run();}catch(error){code=error instanceof Error?error.message:String(error);}equal(label,typeof code,'string');return code;};
 // IndexedDB records may contain own undefined (documentHistory is one normal

 // example). Encode every supported value with a disjoint type envelope; never

 // stringify raw records or erase fields to fit the product's JSON-only codec.

 let dbSnapshotNumber=0;

 const allRows=async(stage:string)=>{

  const snapshot=++dbSnapshotNumber;

  console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage,snapshot,event:'collect',completedChecks:checks.length}));

  const tables=await Promise.all(db.tables.map(async table=>({name:table.name,rows:await table.toArray()})));

  tables.sort((a,b)=>a.name.localeCompare(b.name));

  const seen=new WeakMap<object,number>();let serial=0;const ownUndefinedPaths:string[]=[];

  const unsupported=(path:string,reason:string):never=>{

   console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage,snapshot,event:'unsupported',path,reason}));

   throw Error('Source list IndexedDB comparator unsupported at '+path+': '+reason);

  };

  const encode=async(value:unknown,path:string):Promise<LocalToolJson>=>{

   if(value===undefined){ownUndefinedPaths.push(path);return ['undefined'];}

   if(value===null)return ['null'];

   if(typeof value==='string')return ['string',value];

   if(typeof value==='boolean')return ['boolean',value];

   if(typeof value==='number')return ['number',Object.is(value,-0)?'-0':String(value)];

   if(typeof value==='bigint')return ['bigint',String(value)];

   if(typeof value!=='object')return unsupported(path,typeof value);

   const previous=seen.get(value);if(previous!==undefined)return ['reference',previous];

   const id=++serial;seen.set(value,id);

   if(typeof File!=='undefined'&&value instanceof File)return ['file',id,value.name,value.lastModified,value.type,value.size,Array.from(new Uint8Array(await value.arrayBuffer()))];

   if(value instanceof Blob)return ['blob',id,value.type,value.size,Array.from(new Uint8Array(await value.arrayBuffer()))];

   if(value instanceof ArrayBuffer)return ['array-buffer',id,value.byteLength,Array.from(new Uint8Array(value))];

   if(ArrayBuffer.isView(value))return ['array-buffer-view',id,Object.prototype.toString.call(value),value.byteOffset,value.byteLength,await encode(value.buffer,path+'.buffer')];

   // Other structured-clone classes are rejected explicitly, not silently reduced.

   const prototype=Object.getPrototypeOf(value);

   if(!Array.isArray(value)&&prototype!==Object.prototype&&prototype!==null)return unsupported(path,Object.prototype.toString.call(value));

   const entries:LocalToolJson[]=[];

   const keys=Reflect.ownKeys(value);

   if(keys.some(key=>typeof key!=='string'))return unsupported(path,'symbol key');

   for(const key of Object.getOwnPropertyNames(value).sort()){

    if(Array.isArray(value)&&key==='length')continue;

    const property=Object.getOwnPropertyDescriptor(value,key);

    if(!property||!('value'in property))return unsupported(path+'['+JSON.stringify(key)+']','accessor');

    entries.push([key,!!property.enumerable,!!property.configurable,!!property.writable,await encode(property.value,path+'['+JSON.stringify(key)+']')]);

   }

   return Array.isArray(value)?['array',id,value.length,entries]:['object',id,prototype===null?'null-prototype':'Object',entries];

  };

  const encoded=await encode(tables,'$');

  console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage,snapshot,event:'encoded',tables:tables.length,objectCount:serial,ownUndefinedPaths}));

  return encoded;

 };

 const counts=async()=>{const values=await Promise.all(db.tables.map(table=>table.count()));return{tables:values.length,total:values.reduce((a,b)=>a+b,0)};};
 const namespace='tests.source-list-atomicity';
 const valid=(value:LocalToolJson):value is Record<string,LocalToolJson>=>{
  if(!record(value)||typeof value.name!=='string'||!value.name||!record(value.other)||!Array.isArray(value.prior))return false;
  return value.prior.every(item=>record(item)&&typeof item.id==='string'&&!!item.id&&typeof item.label==='string');
 };
 const one=defineLocalTool<Record<string,LocalToolJson>>({namespace,stateSchemaVersion:'1',
  name:{en:'Own review V1',es:'Revisión propia V1'},description:{en:'Own offline review',es:'Revisión propia local'},
  document:{defaultTitle:{en:'Own review',es:'Revisión propia'}},
  codec:{version:1,fields:{name:{kind:'scalar'},other:{kind:'map'},prior:{kind:'list',idKey:'id'}}},
  index:{version:1,fields:{name:{path:'$.name',type:'string'}}},
  initialState:{name:'Initial',other:{keep:'Conservar á/ñ/漢字/🧭'},prior:[{id:'old-row',label:'Anterior Ω'}]},validateState:valid,component:()=>null,
 });
 const from={namespace,codec:one.codec!,...localToolConvergenceContext(one)!};
 const two=defineLocalTool<Record<string,LocalToolJson>>({...one,stateSchemaVersion:'2',
  codec:{version:1,fields:{...one.codec!.fields,steps:{kind:'list',idKey:'id'}}},
  initialState:{...one.initialState,steps:[]},
  validateState:(value):value is Record<string,LocalToolJson>=>valid(value)&&Array.isArray(value.steps)&&value.steps.every(item=>record(item)&&typeof item.id==='string'&&!!item.id&&typeof item.label==='string'&&typeof item.done==='boolean'),
  sourceAdditive:{from,field:'steps',defaultValue:[]},
 });
 const sha=async(bytes:Uint8Array<ArrayBuffer>)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const sourceBytes=new TextEncoder().encode(fixtureSource),files=[{path:'module.tsx',sha256:await sha(sourceBytes),bytes:sourceBytes.length}];
 const manifest=async(version:string):Promise<LocalToolReleaseManifest>=>{
  const base={format:'writers-hoard-local-tool-source/1',apiVersion:1,namespace,version,files} as const;
  return{...base,contentHash:await sha(new TextEncoder().encode(localToolReleaseIdentity(base)))};
 };
 const v1=await manifest('1.0.0'),v2=await manifest('2.0.0');
 const root=(hash:string)=>'./installed/'+namespace+'/versions/'+hash;
 registerLocalToolModules({[root(v1.contentHash)+'/module.tsx']:{default:one},[root(v2.contentHash)+'/module.tsx']:{default:two}},{[root(v1.contentHash)+'/release.json']:v1,[root(v2.contentHash)+'/release.json']:v2});
 try{
  equal('P9 private library begins89zero',await counts(),{tables:89,total:0});
  const projectId='own-list-atomicity-'+crypto.randomUUID(),now=Date.now(),scope={projectId};
  await createProject({id:projectId,title:'Own list atomicity',description:'Synthetic private library',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['local-tool-'+namespace],engineOrder:['local-tool-'+namespace],createdAt:now,updatedAt:now});projects.push(projectId);
  const firstPin=await pinLocalToolRelease(projectId,namespace,v1.contentHash,null);
  const legacy=(await createSourceToolDocument(scope,namespace,'Own unstarted V1')).id;
  await pinLocalToolRelease(projectId,namespace,v2.contentHash,firstPin.revision);
  const native=(await createSourceToolDocument(scope,namespace,'Own unstarted native V2')).id;
  for(const [kind,id] of [['predecessor',legacy],['native',native]] as const){
   const client=createLocalToolClient(projectId,two,{documentId:id,releaseHash:v2.contentHash,requireSelectedRelease:true});
   const initial=await readSourceToolDocument(scope,id,namespace);if(!initial)throw Error('P9 normal Source document missing');
   equal('P9 no initial checkpoint '+kind,initial.document.convergence??null,null);
   const stale=await client.read();
   // A normal title edit changes the actual Source CAS without creating history.
   await listP9Rename(scope,id,namespace,'Title changed independently '+kind,initial.document.revision,initial.version);
   const renamed=await readSourceToolDocument(scope,id,namespace);if(!renamed)throw Error('P9 rename lost Source document');
   equal('P9 independent rename has no checkpoint '+kind,renamed.document.convergence??null,null);
   const beforeCAS=await allRows('P9 before stale first insert '+kind);
   await rejected('P9 stale snapshot rejects before bootstrap '+kind,()=>client.state!.apply(stale,[{type:'list-insert',field:'steps',item:{id:'stale',label:'Must never persist',done:false},afterId:null}]));
   equal('P9 stale CAS keeps complete library exact '+kind,await allRows('P9 after stale first insert '+kind),beforeCAS);
   equal('P9 stale CAS keeps full document exact '+kind,await readSourceToolDocument(scope,id,namespace),renamed);
   const current=await client.read(),beforeAbort=await allRows('P9 before outer abort '+kind);
   let admitted=false,provisional:string|null=null;
   const code=await rejected('P9 outer transaction deliberately aborts '+kind,()=>db.transaction('rw',db.tables,async()=>{
    const edit=await client.state!.apply(current,[{type:'list-insert',field:'steps',item:{id:'abort',label:'Abort this provisional row Ω',done:false},afterId:null}]);
    admitted=true;provisional=edit.receiptId;
    if(!Array.isArray(edit.snapshot.data.steps)||edit.snapshot.data.steps.length!==1)throw Error('P9 provisional row missing before outer abort');
    throw Error('own-source-list-outer-abort');
   }));
   equal('P9 actual effect reached deliberate outer abort '+kind,[code,admitted,typeof provisional],['own-source-list-outer-abort',true,'string']);
   equal('P9 outer abort keeps complete library exact '+kind,await allRows('P9 after outer abort '+kind),beforeAbort);
   equal('P9 outer abort leaves identity lineage generation and no CP '+kind,await readSourceToolDocument(scope,id,namespace),renamed);
   if(!provisional)throw Error('P9 admitted provisional receipt missing');
   await rejected('P9 provisional receipt unavailable after abort '+kind,()=>client.state!.undo(provisional!));
   equal('P9 rejected provisional Undo writes nothing '+kind,await allRows('P9 after provisional Undo '+kind),beforeAbort);
   const good=await client.state!.apply(await client.read(),[{type:'list-insert',field:'steps',item:{id:'good',label:'Normal action after rollback ñ',done:true},afterId:null}]);
   if(!good.receiptId)throw Error('P9 fresh normal action must provide receipt');
   equal('P9 fresh normal action still works '+kind,good.snapshot.data.steps,[{id:'good',label:'Normal action after rollback ñ',done:true}]);
   const persisted=await readSourceToolDocument(scope,id,namespace);if(!persisted?.document.convergence)throw Error('P9 valid effect missing checkpoint');
   equal('P9 fresh action full reader completes '+kind,listEffectsExport(persisted.document.convergence.checkpoint).pending,false);
   await client.state!.undo(good.receiptId);
   const undone=await readSourceToolDocument(scope,id,namespace);if(!undone||!record(undone.document.data))throw Error('P9 Undo lost Source');
   equal('P9 valid receipt Undo restores raw absence '+kind,Object.hasOwn(undone.document.data,'steps'),false);
  }
  console.log('SOURCE_LIST_ATOMICITY_RESULT '+JSON.stringify({strictCASBeforeBootstrap:true,outerAbort:true,provisionalReceiptUnavailable:true,predecessor:true,native:true,checkCount:checks.length}));
  return checks;
 }finally{for(const id of projects.reverse())await deleteProject(id);equal('P9 private cleanup89zero',await counts(),{tables:89,total:0});}
}

// Text preparation2574: append ONLY after Root reads this body and author composes.
// Existing preamble: defineLocalTool/LocalToolDefinition/LocalToolJson, db,
// localToolConvergenceContext, convergenceCanonical, listEffectsExport,
// listEffectsY (Yjs13.6.33), listEffectsBytes and listImportBase64.
import {createLocalToolGenesis as listPartialGenesis,prepareSourceAdditiveCheckpoint as listPartialPromote,createLocalToolReplica as listPartialReplica} from '@/engines/local/convergence/replica';

/** Normal incremental network delivery. All authority/payload/IDs come from SDK
 * writers. Public Yjs snapshot/diff APIs select a real serialization boundary;
 * no new Item, content, transaction body, expected pending flag or DB row is seeded.
 */
export async function testSourceListPartialDelivery(){
 const checks:string[]=[],replicas:{destroy():void}[]=[],docs:listEffectsY.Doc[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{
  if(convergenceCanonical(actual)!==convergenceCanonical(expected))throw Error(label);
  checks.push(label);Reflect.set(window,'__testStage',label);
 };
 const need=(label:string,value:unknown)=>{if(!value)throw Error(label);checks.push(label);};
 const receipt=(label:string,value:string|null)=>{if(!value)throw Error(label);checks.push(label);return value;};
 const object=(value:unknown):value is Record<string,LocalToolJson>=>!!value&&typeof value==='object'&&!Array.isArray(value);
 const counts=async()=>{const counts=await Promise.all(db.tables.map(table=>table.count()));return {tables:counts.length,total:counts.reduce((a,b)=>a+b,0)};};
 const sha=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const point=(id:listEffectsY.ID|null)=>id?{client:id.client,clock:id.clock}:null;
 const authorityName='convergence-source-additive',orderName='order:'+JSON.stringify('steps'),transactionName='causal-transactions';
 type Checkpoint=Parameters<typeof listEffectsExport>[0];
 type Unit={client:number;clock:number;root:string;key:string|null;payload:unknown;origin:{client:number;clock:number}|null;deleted:boolean;itemStart:number;itemLength:number;offset:number;contentType:string};
 const load=(checkpoint:Checkpoint)=>{
  const doc=new listEffectsY.Doc({gc:false});docs.push(doc);
  listEffectsY.applyUpdate(doc,listEffectsBytes(checkpoint.checkpointBase64));
  doc.getArray(authorityName);doc.getArray(orderName);doc.getMap(transactionName);
  doc.getMap('register-versions');doc.getMap('register-activations');return doc;
 };
 const physical=(doc:listEffectsY.Doc):Unit[]=>{
  const roots=new Map([...doc.share].map(([name,type])=>[type,name] as const)),units:Unit[]=[];
  for(const structs of doc.store.clients.values())for(const item of structs){
   if(!(item instanceof listEffectsY.Item)||!(item.parent instanceof listEffectsY.AbstractType))throw Error('F1 fixture must retain physical Items/root parents');
   const root=roots.get(item.parent);if(root===undefined)throw Error('F1 fixture has an unexpected nested root');
   const values:unknown[]=item.content.getContent();if(values.length!==item.length)throw Error('F1 fixture content units do not match Item length');
   for(let offset=0;offset<item.length;offset++)units.push({client:item.id.client,clock:item.id.clock+offset,root,key:item.parentSub,
    payload:values[offset],origin:offset?{client:item.id.client,clock:item.id.clock+offset-1}:point(item.origin),deleted:item.deleted,
    itemStart:item.id.clock,itemLength:item.length,offset,contentType:item.content.constructor.name});
  }
  return units.sort((a,b)=>a.client-b.client||a.clock-b.clock);
 };
 // Snapshot may split/merge Items. Compare actual per-clock identity/origin/content,
 // preserving representation (itemStart/length/offset) separately in evidence.
 const semanticUnits=(units:Unit[])=>units.map(({itemStart,itemLength,offset,contentType,...unit})=>{
  void itemStart;void itemLength;void offset;void contentType;return unit;
 });
 const payload=(unit:Unit)=>{if(typeof unit.payload!=='string')throw Error('F1 selected root payload is not SDK JSON');const value:unknown=JSON.parse(unit.payload);if(!object(value))throw Error('F1 selected payload is not an object');return value;};
 const keys=(doc:listEffectsY.Doc,root:string)=>[...doc.getMap(root).keys()].sort();
 const identity=(value:Pick<Checkpoint,'namespace'|'genesisId'|'engine'|'codecHash'|'validationId'|'schemaEpoch'>)=>({namespace:value.namespace,genesisId:value.genesisId,engine:value.engine,codecHash:value.codecHash,validationId:value.validationId,schemaEpoch:value.schemaEpoch});
 const validOne=(value:LocalToolJson):value is Record<string,LocalToolJson>=>object(value)&&typeof value.name==='string'&&object(value.other)&&Array.isArray(value.prior)&&value.prior.every(row=>object(row)&&typeof row.id==='string'&&!!row.id&&typeof row.label==='string');
 const namespace='tests.source-list-partial-delivery',initial:Record<string,LocalToolJson>={name:'Nombre anterior Ω',other:{keep:'Literal á/ñ/漢字/🧭'},prior:[{id:'old-row',label:'Anterior Ω'}]};
 const one=defineLocalTool<Record<string,LocalToolJson>>({namespace,stateSchemaVersion:'1',name:{en:'Own partial V1',es:'V1 parcial propio'},description:{en:'Own incremental list delivery',es:'Entrega incremental de lista propia'},document:{defaultTitle:{en:'Own partial list',es:'Lista parcial propia'}},codec:{version:1,fields:{name:{kind:'scalar'},other:{kind:'map'},prior:{kind:'list',idKey:'id'}}},initialState:initial,validateState:validOne,component:()=>null});
 const from={namespace,codec:one.codec!,...localToolConvergenceContext(one)!};
 const two=defineLocalTool<Record<string,LocalToolJson>>({...one,stateSchemaVersion:'2',codec:{version:1,fields:{...one.codec!.fields,steps:{kind:'list',idKey:'key'}}},initialState:{...initial,steps:[]},validateState:(value):value is Record<string,LocalToolJson>=>validOne(value)&&Array.isArray(value.steps)&&value.steps.every(row=>object(row)&&typeof row.key==='string'&&!!row.key&&typeof row.label==='string'&&typeof row.done==='boolean'),sourceAdditive:{from,field:'steps',defaultValue:[]}});
 const contract={namespace,codec:two.codec!,...localToolConvergenceContext(two)!,validateState:two.validateState};
 const make=(checkpoint:Checkpoint,authorId:string)=>{const replica=listPartialReplica(checkpoint,{contract,authorId});replicas.push(replica);return replica;};
 type Replica=ReturnType<typeof make>;type Update=Parameters<Replica['receive']>[0];
 const observe=async(label:string,replica:Replica,update:Update,pending:boolean)=>{
  let stage='receive';
  try{
   const received=replica.receive(update),checkpoint=replica.checkpoint();stage='definition-free reader';
   const reader=listEffectsExport(checkpoint);
   console.log('SOURCE_LIST_PARTIAL_STAGE '+JSON.stringify({label,received,readerPending:reader.pending,checkpointSha256:await sha(new TextEncoder().encode(JSON.stringify(checkpoint)))}));
   equal(label+' receive pending',received.pending,pending);equal(label+' full reader pending',reader.pending,pending);
   equal(label+' receive grants no foreign Undo receipt',Object.hasOwn(received,'receiptId'),false);
   return {received,checkpoint,reader};
  }catch(error){console.log('SOURCE_LIST_PARTIAL_FAILURE '+JSON.stringify({label,stage,error:error instanceof Error?error.message:String(error)}));throw error;}
 };
 let finalEvidence:Record<string,unknown>|undefined;
 try{
  equal('F1 private library begins with 89 empty tables',await counts(),{tables:89,total:0});
  const legacy=listPartialGenesis(initial,{...from,validateState:one.validateState});
  const promoted=listPartialPromote(legacy,initial,from,contract);
  equal('F1 common genuine promotion is complete',listEffectsExport(promoted).pending,false);
  // Receiver A has its OWN live receipt before remote bytes arrive.
  const a=make(promoted,'partial-owner-A');
  const own=a.apply([{type:'set',field:'name',value:'Nombre propio A'}]),ownReceipt=receipt('F1 A owns a normal receipt before receiving',own.receiptId);
  const base=a.checkpoint(),baseData=a.read(),writer=make(base,'partial-writer-B'),reverse=make(base,'partial-receiver-C');
  const row={key:'partial-step-B',label:'Paso remoto B Ω',done:false};
  const edit=writer.apply([{type:'list-insert',field:'steps',item:row,afterId:null}]),remoteReceipt=receipt('F1 B owns a normal list receipt',edit.receiptId);
  equal('F1 B normal edit is changed and complete',[edit.changed,edit.causalChanged,edit.pending],[true,true,false]);
  const complete=writer.checkpoint(),expected={...initial,name:'Nombre propio A',steps:[row]};
  equal('F1 normal whole data before any split',writer.read(),expected);
  equal('F1 normal full reader before any split',listEffectsExport(complete).pending,false);
  const baseDoc=load(base),fullDoc=load(complete),beforeUnits=physical(fullDoc),wholeBytes=listEffectsBytes(complete.checkpointBase64);
  const fullSnapshot=listEffectsY.snapshot(fullDoc);equal('F1 real fixture DeleteSet is empty',fullSnapshot.ds.clients.size,0);
  const newTransactions=keys(fullDoc,transactionName).filter(id=>!baseDoc.getMap(transactionName).has(id));
  equal('F1 captured writer added exactly one flush transaction',newTransactions.length,1);
  const txId=newTransactions[0],transactions=beforeUnits.filter(unit=>unit.root===transactionName&&unit.key===txId);
  equal('F1 physical flush body exists once',transactions.length,1);const tx=transactions[0];
  equal('F1 physical flush payload has captured tx ID',payload(tx).id,txId);
  const witnesses=beforeUnits.filter(unit=>unit.root===authorityName&&payload(unit).format==='writers-hoard-source-list-placement/1'&&payload(unit).id===row.key);
  equal('F1 actual writer has one matching witness',witnesses.length,1);const witness=witnesses[0],w=payload(witness);
  equal('F1 witness names captured real flush',w.txId,txId);
  const placements=beforeUnits.filter(unit=>unit.root===orderName&&payload(unit).id===row.key&&payload(unit).placementId===w.placementId);
  equal('F1 actual writer has one matching placement',placements.length,1);const placement=placements[0];
  equal('F1 captured pair has adjacent physical clocks',[placement.client,placement.clock],[witness.client,witness.clock+1]);
  equal('F1 captured flush is same physical writer',tx.client,placement.client);
  need('F1 genuine pair is before its flush body',placement.clock<tx.clock);
  const cut=tx.clock,prefixVector=new Map(fullSnapshot.sv);prefixVector.set(tx.client,cut);
  // Select a time in REAL writer history. Reuse actual empty DS; fabricate no structs.
  const selectedSnapshot=listEffectsY.createSnapshot(fullSnapshot.ds,prefixVector),prefixDoc=new listEffectsY.Doc({gc:false});docs.push(prefixDoc);
  listEffectsY.createDocFromSnapshot(fullDoc,selectedSnapshot,prefixDoc);
  const prefixBytes=listEffectsY.encodeStateAsUpdate(prefixDoc,listEffectsY.encodeStateVector(baseDoc));
  const prefixStateVector=listEffectsY.encodeStateVector(prefixDoc),suffixBytes=listEffectsY.diffUpdate(wholeBytes,prefixStateVector);
  const afterUnits=physical(fullDoc);
  equal('F1 snapshot serialization preserves every physical unit',semanticUnits(afterUnits),semanticUnits(beforeUnits));
  equal('F1 snapshot uses exactly selected vector',[...listEffectsY.decodeStateVector(prefixStateVector)].sort((x,y)=>x[0]-y[0]),[...prefixVector].sort((x,y)=>x[0]-y[0]));
  equal('F1 prefix has no physical Yjs gaps',[prefixDoc.store.pendingStructs,prefixDoc.store.pendingDs],[null,null]);
  equal('F1 prefix retains baseline transactions only',keys(prefixDoc,transactionName),keys(baseDoc,transactionName));
  equal('F1 prefix retains baseline register versions only',keys(prefixDoc,'register-versions'),keys(baseDoc,'register-versions'));
  equal('F1 prefix retains baseline activations only',keys(prefixDoc,'register-activations'),keys(baseDoc,'register-activations'));
  const prefixUnits=physical(prefixDoc);
  equal('F1 prefix includes actual witness and placement',semanticUnits(prefixUnits.filter(unit=>unit.client===tx.client&&[witness.clock,placement.clock].includes(unit.clock))),semanticUnits(beforeUnits.filter(unit=>unit.client===tx.client&&[witness.clock,placement.clock].includes(unit.clock))));
  const packet=(bytes:Uint8Array)=>({...edit.update,updateBase64:listImportBase64(bytes)});
  const prefix=packet(prefixBytes),suffix=packet(suffixBytes);
  const input={method:'public snapshot/createSnapshot/createDocFromSnapshot + encodeStateAsUpdate/diffUpdate, actual SDK update only',base,complete,originalUpdate:edit.update,prefix,suffix,cut:{client:tx.client,clock:cut,witness,placement,transaction:tx},beforeUnits,afterUnits,prefixUnits,fullStateVector:[...fullSnapshot.sv],prefixStateVector:[...prefixVector],fullDeleteSetClients:fullSnapshot.ds.clients.size,byteHashes:{whole:await sha(wholeBytes),prefix:await sha(prefixBytes),suffix:await sha(suffixBytes)}};
  // Preserve real wire/units even if the first receive reveals a product defect.
  console.log('SOURCE_LIST_PARTIAL_INPUT '+JSON.stringify(input));
  const partial=await observe('F1 prefix first',a,prefix,true);
  equal('F1 prefix leaves visible rows and own prior edit intact',a.read(),baseData);
  const retained=load(partial.checkpoint);
  equal('F1 SDK retains all actual prefix units',semanticUnits(physical(retained)),semanticUnits(prefixUnits));
  const backwards=await observe('F1 suffix first',reverse,suffix,true);
  equal('F1 suffix-first leaves prior data intact',reverse.read(),baseData);
  const closed=await observe('F1 suffix closes prefix',a,suffix,false);
  const reverseClosed=await observe('F1 prefix closes suffix',reverse,prefix,false);
  equal('F1 both delivery orders reach exact normal capsule',[closed.checkpoint,reverseClosed.checkpoint],[complete,complete]);
  equal('F1 both delivery orders reach exact normal data',[a.read(),reverse.read()],[expected,expected]);
  const replayBefore=[a.checkpoint(),reverse.checkpoint()];
  for(const fragment of[prefix,suffix,prefix]){await observe('F1 forward replay',a,fragment,false);await observe('F1 reverse replay',reverse,fragment,false);}
  equal('F1 replay preserves exact complete capsules',[a.checkpoint(),reverse.checkpoint()],replayBefore);
  // A's genuine local receipt survives receive; undoing A cannot erase B's row.
  const undoA=a.undo(ownReceipt);writer.receive(undoA.update);reverse.receive(undoA.update);
  equal('F1 own Undo survives delivery and preserves remote row',[a.read(),writer.read(),reverse.read()],[{...initial,steps:[row]},{...initial,steps:[row]},{...initial,steps:[row]}]);
  equal('F1 own Undo converges exact capsules',[a.checkpoint(),reverse.checkpoint()],[writer.checkpoint(),writer.checkpoint()]);
  const undoB=writer.undo(remoteReceipt);a.receive(undoB.update);reverse.receive(undoB.update);
  equal('F1 remote own Undo restores original sparse RAW rows',[a.read(),writer.read(),reverse.read()],[initial,initial,initial]);
  equal('F1 remote own Undo restores RAW steps absence in all replicas',[Object.hasOwn(a.read(),'steps'),Object.hasOwn(writer.read(),'steps'),Object.hasOwn(reverse.read(),'steps')],[false,false,false]);
  equal('F1 final readers all complete',[listEffectsExport(a.checkpoint()).pending,listEffectsExport(writer.checkpoint()).pending,listEffectsExport(reverse.checkpoint()).pending],[false,false,false]);
  const finalUnits=physical(load(writer.checkpoint()));
  equal('F1 Undo retains every list authority/order unit',semanticUnits(finalUnits.filter(unit=>unit.root===authorityName||unit.root===orderName)),semanticUnits(beforeUnits.filter(unit=>unit.root===authorityName||unit.root===orderName)));
  finalEvidence={input,partialCheckpoint:partial.checkpoint,suffixFirstCheckpoint:backwards.checkpoint,closedCheckpoint:closed.checkpoint,finalCheckpoint:writer.checkpoint(),checks};
 }finally{
  for(const replica of replicas.reverse())replica.destroy();for(const doc of docs.reverse())doc.destroy();
  equal('F1 private cleanup leaves 89 tables empty',await counts(),{tables:89,total:0});
 }
 if(!finalEvidence)throw Error('F1 missing completed evidence');
 console.log('SOURCE_LIST_PARTIAL_RESULT '+JSON.stringify({complete:true,sourceTask:2540,preparationTask:2574,...finalEvidence}));
 return checks;
}

/** Final physical-history cases. SDK writers provide every baseline and control.
 * Adversarial edits affect only cloned in-memory wire docs, never Source DB rows.
 * Root must read this entire body and its runner before parse/build/execution. */
export async function testSourceListPhysicalHistory(){
 const checks:string[]=[],owned:{destroy():void}[]=[],docs:listEffectsY.Doc[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{if(convergenceCanonical(actual)!==convergenceCanonical(expected))throw Error(label);checks.push(label);Reflect.set(window,'__testStage',label);};
 const object=(v:unknown):v is Record<string,LocalToolJson>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 const counts=async()=>{const v=await Promise.all(db.tables.map(table=>table.count()));return {tables:v.length,total:v.reduce((a,b)=>a+b,0)};};
 const make=(cp:Parameters<typeof listFunctionalReplica>[0],authorId:string)=>{const value=listFunctionalReplica(cp,{contract,authorId});owned.push(value);return value;};
 const namespace='tests.source-list-history';
 const valid=(v:LocalToolJson):v is Record<string,LocalToolJson>=>object(v)&&typeof v.name==='string'&&object(v.other)&&Array.isArray(v.prior)&&v.prior.every(row=>object(row)&&typeof row.id==='string'&&typeof row.label==='string');
 const initial={name:'Revisión á/ñ/漢字/🧭',other:{keep:'Conservar Ω'},prior:[{id:'old-row',label:'Anterior'}]};
 const one=defineLocalTool<Record<string,LocalToolJson>>({namespace,stateSchemaVersion:'1',name:{en:'Own V1',es:'V1 propio'},description:{en:'Own SDK list control',es:'Control propio de lista SDK'},document:{defaultTitle:{en:'Own list',es:'Lista propia'}},codec:{version:1,fields:{name:{kind:'scalar'},other:{kind:'map'},prior:{kind:'list',idKey:'id'}}},initialState:initial,validateState:valid,component:()=>null});
 const from={namespace,codec:one.codec!,...localToolConvergenceContext(one)!};
 const two=defineLocalTool<Record<string,LocalToolJson>>({...one,stateSchemaVersion:'2',codec:{version:1,fields:{...one.codec!.fields,steps:{kind:'list',idKey:'key'}}},initialState:{...initial,steps:[]},validateState:(v):v is Record<string,LocalToolJson>=>valid(v)&&Array.isArray(v.steps)&&v.steps.every(row=>object(row)&&typeof row.key==='string'&&!!row.key&&typeof row.label==='string'&&typeof row.done==='boolean'),sourceAdditive:{from,field:'steps',defaultValue:[]}});
 const contract={namespace,codec:two.codec!,...localToolConvergenceContext(two)!,validateState:two.validateState};
 const authorityName='convergence-source-additive',orderName='order:'+JSON.stringify('steps');
 type Checkpoint=Parameters<typeof listEffectsExport>[0];
 const load=(cp:Checkpoint)=>{const doc=new listEffectsY.Doc({gc:false});docs.push(doc);listEffectsY.applyUpdate(doc,listEffectsBytes(cp.checkpointBase64));for(const name of[authorityName,orderName,'order:'+JSON.stringify('prior')])doc.getArray(name);for(const name of['causal-transactions','register-versions','register-activations','convergence-identity'])doc.getMap(name);return doc;};
 const capsule=(cp:Checkpoint,doc:listEffectsY.Doc):Checkpoint=>({...cp,checkpointBase64:listImportBase64(listEffectsY.encodeStateAsUpdate(doc)),stateVectorBase64:listImportBase64(listEffectsY.encodeStateVector(doc))});
 const parse=(value:unknown)=>{if(typeof value!=='string')throw Error('Physical fixture requires actual SDK JSON strings');const v:unknown=JSON.parse(value);if(!object(v))throw Error('Physical fixture requires object payload');return v;};
 type Unit={item:listEffectsY.Item;offset:number;root:string;key:string|null;client:number;clock:number;deleted:boolean;value:Record<string,LocalToolJson>};
 const units=(doc:listEffectsY.Doc):Unit[]=>{const names=new Map([...doc.share].map(([name,type])=>[type,name] as const)),out:Unit[]=[];for(const rows of doc.store.clients.values())for(const item of rows){if(!(item instanceof listEffectsY.Item)||!(item.parent instanceof listEffectsY.AbstractType))throw Error('Physical fixture lost an Item/root');const name=names.get(item.parent);if(name===undefined)throw Error('Unexpected nested root in physical fixture');const values=item.content.getContent();if(values.length!==item.length)throw Error('Physical content units mismatch');for(let offset=0;offset<item.length;offset++)out.push({item,offset,root:name,key:item.parentSub,client:item.id.client,clock:item.id.clock+offset,deleted:item.deleted,value:parse(values[offset])});}return out;};
 // Rewrite ONLY a cloned wire payload at the same ID/offset without delete/insert.
 // ContentAny is public pinned Yjs; replacement avoids its development-frozen array.
 // This is adversarial serialization, not an author operation or trusted DB writer.
 const rewrite=(unit:Unit,value:Record<string,LocalToolJson>)=>{if(!(unit.item.content instanceof listEffectsY.ContentAny))throw Error('Expected actual SDK ContentAny for adversarial fixture');const values=[...unit.item.content.getContent()];values[unit.offset]=JSON.stringify(value);unit.item.content=new listEffectsY.ContentAny(values);};
 const exactlyOne=(label:string,values:Unit[])=>{equal(label,values.length,1);return values[0];};
 const describe=(unit:Unit)=>({root:unit.root,key:unit.key,client:unit.client,clock:unit.clock,offset:unit.offset,itemStart:unit.item.id.clock,itemLength:unit.item.length,deleted:unit.deleted,value:unit.value});
 try{
  equal('History private library begins89zero',await counts(),{tables:89,total:0});
  const legacy=listFunctionalGenesis(initial,{...from,validateState:one.validateState}),promoted=listFunctionalPromote(legacy,initial,from,contract);
  const writer=make(promoted,'history-genuine-writer');
  const edit=writer.apply([{type:'list-insert',field:'steps',item:{key:'old-row',label:'Genuine post-D row Ω',done:false},afterId:null}]);
  if(!edit.receiptId)throw Error('Normal history control must supply receipt');
  const genuine=writer.checkpoint(),genuineData=writer.read();
  equal('History genuine public post-D insertion complete',listEffectsExport(genuine).pending,false);
  const receiver=make(promoted,'history-receiver-owner'),own=receiver.apply([{type:'set',field:'name',value:'Own receipt remains valid'}]);
  if(!own.receiptId)throw Error('History receiver must own a genuine local receipt');
  const receiverBefore=receiver.checkpoint();
  const negative=(label:string,bad:Checkpoint)=>{
   let readerError:string|null=null,receiveError:string|null=null;
   try{listEffectsExport(bad);}catch(error){readerError=error instanceof Error?error.message:String(error);}
   try{receiver.receive({...edit.update,updateBase64:bad.checkpointBase64});}catch(error){receiveError=error instanceof Error?error.message:String(error);}
   const unchanged=convergenceCanonical(receiver.checkpoint())===convergenceCanonical(receiverBefore);
   console.log('SOURCE_LIST_PHYSICAL_CASE '+JSON.stringify({label,checkpoint:bad,readerError,receiveError,unchanged}));
   equal(label+' independent reader rejects',readerError,'local_tool_source_additive_history_invalid');
   equal(label+' receive rejects',receiveError,'local_tool_source_additive_history_invalid');
   equal(label+' receive remains atomic',unchanged,true);
  };
  const oldDoc=load(legacy),oldVersions=[...oldDoc.getMap<string>('register-versions').values()].map(parse);
  // Five shapes, one field, no combinatorial matrix: each would otherwise be
  // invisible to winner-only inspection. The current old-format reader accepts
  // the deleted payload before promotion; the new history must inspect it.
  for(const kind of['content','membership','selected','presence','snapshot-binding'] as const){
   const original=oldVersions.find(v=>kind==='snapshot-binding'?v.root==='authored-valid-snapshot':kind==='presence'?v.root==='presence'&&v.key==='prior':v.root===kind+':prior');
   if(!original||typeof original.id!=='string')throw Error('Missing genuine old register control '+kind);
   const hiddenDoc=load(legacy),value=structuredClone(original),id=original.id+'-hidden-'+kind;
   value.id=id;
   if(kind==='snapshot-binding'){
    if(!object(value.value)||!object(value.value.bindings)||!Array.isArray(value.value.bindings.prior))throw Error('Genuine old snapshot bindings missing');
    value.value.bindings.steps=structuredClone(value.value.bindings.prior);
   }else if(kind==='presence')value.key='steps';else value.root=kind+':steps';
   hiddenDoc.getMap<string>('register-versions').set(id,JSON.stringify(value));hiddenDoc.getMap('register-versions').delete(id);
   equal('P11 old reader accepts hidden wire control '+kind,listEffectsExport(capsule(legacy,hiddenDoc)).pending,false);
   listEffectsY.applyUpdate(hiddenDoc,listEffectsBytes(genuine.checkpointBase64));
   equal('P11 target payload is retained but not winning '+kind,[hiddenDoc.getMap('register-versions').has(id),units(hiddenDoc).filter(u=>u.root==='register-versions'&&u.key===id&&u.deleted).length],[false,1]);
   negative('P11 pre-D retained '+kind,capsule(genuine,hiddenDoc));
  }
  // Preserve the complete header JSON in the visible array while replacing its
  // physical unit; this rejection is explicitly about retained header mutation.
  const replacedHeader=load(genuine),header=exactlyOne('P12 genuine header unique',units(replacedHeader).filter(u=>u.root===authorityName&&u.value.format==='writers-hoard-source-additive-list/1'));
  const headerText=JSON.stringify(header.value);replacedHeader.getArray<string>(authorityName).delete(0,1);replacedHeader.getArray<string>(authorityName).insert(0,[headerText]);
  equal('P12 replacement retains literal visible header',parse(replacedHeader.getArray<string>(authorityName).get(0)),header.value);
  negative('P12 retained replaced header',capsule(genuine,replacedHeader));
  const removedOrder=load(genuine);equal('P12 genuine target order one',removedOrder.getArray(orderName).length,1);removedOrder.getArray(orderName).delete(0,1);
  equal('P12 placement tombstone retains payload',units(removedOrder).filter(u=>u.root===orderName&&u.deleted).length,1);
  negative('P12 deleted genuine placement with retained witness',capsule(genuine,removedOrder));
  // Build an old target order before D, without a target register. The old engine
  // ignores this undeclared order root. After D, all nominal JSON links are retagged
  // consistently; the original physical placement cannot move after the header.
  const oldOrder=load(legacy),priorPlace=exactlyOne('P12 ordinary prior seed placement exists',units(oldOrder).filter(u=>u.root==='order:'+JSON.stringify('prior'))).value;
  oldOrder.getArray<string>(orderName).push([JSON.stringify(priorPlace)]);
  equal('P12 old reader accepts undeclared target order control',listEffectsExport(capsule(legacy,oldOrder)).pending,false);
  const oldPlace=exactlyOne('P12 old target placement captured before D',units(oldOrder).filter(u=>u.root===orderName));
  listEffectsY.applyUpdate(oldOrder,listEffectsBytes(genuine.checkpointBase64));
  const targetSelected=exactlyOne('P12 genuine selected postD exists',units(oldOrder).filter(u=>u.root==='register-versions'&&u.value.root==='selected:steps'&&u.value.key==='old-row'));
  rewrite(targetSelected,{...targetSelected.value,value:priorPlace.placementId});
  for(const u of units(oldOrder))if(u.root==='register-versions'&&u.value.root==='authored-valid-snapshot'&&u.value.txId===targetSelected.value.txId){const v=structuredClone(u.value);if(object(v.value)&&object(v.value.bindings)&&Array.isArray(v.value.bindings.steps)){v.value.bindings.steps=[{id:'old-row',placementId:priorPlace.placementId}];rewrite(u,v);}}
  oldOrder.getArray<string>(authorityName).push([JSON.stringify({format:'writers-hoard-source-list-placement/1',field:'steps',txId:targetSelected.value.txId,id:'old-row',placementId:priorPlace.placementId})]);
  const retagWitness=exactlyOne('P12 retagged nominal witness unique',units(oldOrder).filter(u=>u.root===authorityName&&u.value.placementId===priorPlace.placementId));
  equal('P12 nominal links consistently name the old placement',[retagWitness.value.id,retagWitness.value.txId,targetSelected.value.key],['old-row',targetSelected.value.txId,'old-row']);
  const retainedOldPlace=exactlyOne('P12 original placement retained',units(oldOrder).filter(u=>u.root===orderName&&u.value.placementId===priorPlace.placementId));
  equal('P12 original old physical placement identity is unchanged',[oldPlace.client,oldPlace.clock],[retainedOldPlace.client,retainedOldPlace.clock]);
  console.log('SOURCE_LIST_OLD_ORDER_RETAG '+JSON.stringify({placement:describe(oldPlace),witness:describe(retagWitness),selected:describe(targetSelected)}));
  negative('P12 coherent JSON cannot repair old physical placement',capsule(genuine,oldOrder));
  // Do not delete/reinsert a witness here: alter its cloned payload at the SAME
  // physical unit, isolating the requirement for the immediately following flush.
  const firstDoc=load(genuine),firstTxIds=new Set([...firstDoc.getMap('causal-transactions').keys()]);
  writer.apply([{type:'set',field:'name',value:'A later genuine flush'}]);const later=writer.checkpoint(),wrongFlush=load(later);
  const laterIds=[...wrongFlush.getMap('causal-transactions').keys()].filter(id=>!firstTxIds.has(id));equal('P12 one actual later flush',laterIds.length,1);
  const firstWitness=exactlyOne('P12 one actual first witness',units(wrongFlush).filter(u=>u.root===authorityName&&u.value.format==='writers-hoard-source-list-placement/1'));
  const beforeWitness=describe(firstWitness);rewrite(firstWitness,{...firstWitness.value,txId:laterIds[0]});
  equal('P12 retag keeps witness physically nondeleted',firstWitness.item.deleted,false);
  console.log('SOURCE_LIST_WRONG_FLUSH '+JSON.stringify({before:beforeWitness,after:{...beforeWitness,value:{...firstWitness.value,txId:laterIds[0]}}}));
  negative('P12 witness cannot name a later genuine flush',capsule(later,wrongFlush));
  const scalarWire=load(later),scalar=exactlyOne('P11 genuine scalar postD donor',units(scalarWire).filter(u=>u.root==='register-versions'&&u.value.root==='scalar'&&u.value.key==='name'&&u.value.value==='A later genuine flush'));
  rewrite(scalar,{...scalar.value,key:'steps'});negative('P11 scalar postD incompatible with declared list',capsule(later,scalarWire));
  const oldWriter=listFunctionalReplica(legacy,{contract:{...from,validateState:one.validateState},authorId:'history-late-V1'});owned.push(oldWriter);const late=oldWriter.apply([{type:'set',field:'name',value:'Late V1 own edit'}]);
  equal('P14 genuine V1 late writer itself valid',listEffectsExport(oldWriter.checkpoint()).pending,false);
  const lateDoc=load(genuine);listEffectsY.applyUpdate(lateDoc,listEffectsBytes(late.update.updateBase64));negative('P14 retagged-envelope late V1',capsule(genuine,lateDoc));
  const rival=listFunctionalPromote(legacy,initial,from,contract);equal('P14 rival promotion independently complete',listEffectsExport(rival).pending,false);
  const rivalDoc=load(genuine);listEffectsY.applyUpdate(rivalDoc,listEffectsBytes(rival.checkpointBase64));negative('P14 competing genuine promotion D',capsule(genuine,rivalDoc));
  receiver.undo(own.receiptId);equal('History invalid receives preserve own Undo',receiver.read(),initial);
  // Real native nonempty fork puts steps first, so header/first witness can occupy
  // two offsets of ONE ContentAny. Split its actual serialization inside that Item.
  const seededData={steps:[{key:'seed-A',label:'Seed A',done:false},{key:'seed-B',label:'Seed B',done:true}],...initial};
  const fork=listP7Fork(seededData,{namespace,codec:contract.codec,validationId:contract.validationId,schemaEpoch:contract.schemaEpoch}),seedDoc=load(fork.checkpoint);
  equal('P13 genuine nonempty fork full reader',listEffectsExport(fork.checkpoint).pending,false);
  const seedUnits=units(seedDoc),seedHeader=exactlyOne('P13 actual native header',seedUnits.filter(u=>u.root===authorityName&&u.value.format==='writers-hoard-source-additive-list/1')),seedWitness=exactlyOne('P13 actual first seed witness',seedUnits.filter(u=>u.root===authorityName&&u.value.id==='seed-A'));
  equal('P13 header and first seed witness share one physical Item',[seedHeader.item===seedWitness.item,seedHeader.offset,seedWitness.offset],[true,0,1]);
  const snapshot=listEffectsY.snapshot(seedDoc);equal('P13 native seed DeleteSet empty',snapshot.ds.clients.size,0);const sv=new Map(snapshot.sv);sv.set(seedWitness.client,seedWitness.clock);
  const partDoc=new listEffectsY.Doc({gc:false});docs.push(partDoc);listEffectsY.createDocFromSnapshot(seedDoc,listEffectsY.createSnapshot(snapshot.ds,sv),partDoc);
  const firstBytes=listEffectsY.encodeStateAsUpdate(partDoc),restBytes=listEffectsY.diffUpdate(listEffectsBytes(fork.checkpoint.checkpointBase64),listEffectsY.encodeStateVector(partDoc));
  const cold=new listEffectsY.Doc({gc:false});docs.push(cold);listEffectsY.applyUpdate(cold,restBytes);listEffectsY.applyUpdate(cold,firstBytes);
  const coldCheckpoint=capsule(fork.checkpoint,cold);equal('P13 split offset cold replay completes',listEffectsExport(coldCheckpoint).pending,false);
  const coldReplica=make(coldCheckpoint,'history-native-cold');equal('P13 split offset cold data exact',coldReplica.read(),seededData);
  coldReplica.apply([{type:'list-move',field:'steps',id:'seed-A',afterId:'seed-B'}]);equal('P13 ordinary move after offset replay',[coldReplica.read().steps,listEffectsExport(coldReplica.checkpoint()).pending],[[seededData.steps[1],seededData.steps[0]],false]);
  console.log('SOURCE_LIST_PHYSICAL_RESULT '+JSON.stringify({retained:true,physicalRetag:true,lateV1:true,rivalD:true,offsetSeed:true,checkCount:checks.length}));
  equal('History SDK-only operations leave DB empty',await counts(),{tables:89,total:0});return checks;
 }finally{for(const v of owned.reverse())v.destroy();for(const doc of docs.reverse())doc.destroy();equal('History cleanup89zero',await counts(),{tables:89,total:0});}
}

import HistoryJSZip from 'jszip';
import {createProjectZipArchive as historyCreateZip,previewProjectZipImport as historyPreviewZip,importProjectZip as historyImportZip,BackupOperationError as HistoryBackupError} from '@/services/zipBackup';

/** FULL consumers only. Actual Source writer produces the archive and baseline;
 * mutate only its exported in-memory checkpoint, never durable Source rows. */
export async function testSourceListFullHistoryArchives(){
 const checks:string[]=[],projects:string[]=[],owned:{destroy():void}[]=[],docs:listEffectsY.Doc[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{if(convergenceCanonical(actual)!==convergenceCanonical(expected))throw Error(label);checks.push(label);Reflect.set(window,'__testStage',label);};
 const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 // IndexedDB records may contain own undefined (documentHistory is one normal

 // example). Encode every supported value with a disjoint type envelope; never

 // stringify raw records or erase fields to fit the product's JSON-only codec.

 let dbSnapshotNumber=0;

 const allRows=async(stage:string)=>{

  const snapshot=++dbSnapshotNumber;

  console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage,snapshot,event:'collect',completedChecks:checks.length}));

  const tables=await Promise.all(db.tables.map(async table=>({name:table.name,rows:await table.toArray()})));

  tables.sort((a,b)=>a.name.localeCompare(b.name));

  const seen=new WeakMap<object,number>();let serial=0;const ownUndefinedPaths:string[]=[];

  const unsupported=(path:string,reason:string):never=>{

   console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage,snapshot,event:'unsupported',path,reason}));

   throw Error('Source list IndexedDB comparator unsupported at '+path+': '+reason);

  };

  const encode=async(value:unknown,path:string):Promise<LocalToolJson>=>{

   if(value===undefined){ownUndefinedPaths.push(path);return ['undefined'];}

   if(value===null)return ['null'];

   if(typeof value==='string')return ['string',value];

   if(typeof value==='boolean')return ['boolean',value];

   if(typeof value==='number')return ['number',Object.is(value,-0)?'-0':String(value)];

   if(typeof value==='bigint')return ['bigint',String(value)];

   if(typeof value!=='object')return unsupported(path,typeof value);

   const previous=seen.get(value);if(previous!==undefined)return ['reference',previous];

   const id=++serial;seen.set(value,id);

   if(typeof File!=='undefined'&&value instanceof File)return ['file',id,value.name,value.lastModified,value.type,value.size,Array.from(new Uint8Array(await value.arrayBuffer()))];

   if(value instanceof Blob)return ['blob',id,value.type,value.size,Array.from(new Uint8Array(await value.arrayBuffer()))];

   if(value instanceof ArrayBuffer)return ['array-buffer',id,value.byteLength,Array.from(new Uint8Array(value))];

   if(ArrayBuffer.isView(value))return ['array-buffer-view',id,Object.prototype.toString.call(value),value.byteOffset,value.byteLength,await encode(value.buffer,path+'.buffer')];

   // Other structured-clone classes are rejected explicitly, not silently reduced.

   const prototype=Object.getPrototypeOf(value);

   if(!Array.isArray(value)&&prototype!==Object.prototype&&prototype!==null)return unsupported(path,Object.prototype.toString.call(value));

   const entries:LocalToolJson[]=[];

   const keys=Reflect.ownKeys(value);

   if(keys.some(key=>typeof key!=='string'))return unsupported(path,'symbol key');

   for(const key of Object.getOwnPropertyNames(value).sort()){

    if(Array.isArray(value)&&key==='length')continue;

    const property=Object.getOwnPropertyDescriptor(value,key);

    if(!property||!('value'in property))return unsupported(path+'['+JSON.stringify(key)+']','accessor');

    entries.push([key,!!property.enumerable,!!property.configurable,!!property.writable,await encode(property.value,path+'['+JSON.stringify(key)+']')]);

   }

   return Array.isArray(value)?['array',id,value.length,entries]:['object',id,prototype===null?'null-prototype':'Object',entries];

  };

  const encoded=await encode(tables,'$');

  console.log('SOURCE_LIST_DB_COMPARISON '+JSON.stringify({stage,snapshot,event:'encoded',tables:tables.length,objectCount:serial,ownUndefinedPaths}));

  return encoded;

 };

 const counts=async()=>{const values=await Promise.all(db.tables.map(table=>table.count()));return{tables:values.length,total:values.reduce((a,b)=>a+b,0)};};
 const namespace='tests.source-list-full-history';
 const valid=(value:LocalToolJson):value is Record<string,LocalToolJson>=>{
  if(!record(value)||typeof value.name!=='string'||!value.name||!record(value.other)||!Array.isArray(value.prior))return false;
  return value.prior.every(item=>record(item)&&typeof item.id==='string'&&!!item.id&&typeof item.label==='string');
 };
 const one=defineLocalTool<Record<string,LocalToolJson>>({namespace,stateSchemaVersion:'1',
  name:{en:'Own review V1',es:'Revisión propia V1'},description:{en:'Own offline review',es:'Revisión propia local'},
  document:{defaultTitle:{en:'Own review',es:'Revisión propia'}},
  codec:{version:1,fields:{name:{kind:'scalar'},other:{kind:'map'},prior:{kind:'list',idKey:'id'}}},
  index:{version:1,fields:{name:{path:'$.name',type:'string'}}},
  initialState:{name:'Initial',other:{keep:'Conservar á/ñ/漢字/🧭'},prior:[{id:'old-row',label:'Anterior Ω'}]},validateState:valid,component:()=>null,
 });
 const from={namespace,codec:one.codec!,...localToolConvergenceContext(one)!};
 const two=defineLocalTool<Record<string,LocalToolJson>>({...one,stateSchemaVersion:'2',
  codec:{version:1,fields:{...one.codec!.fields,steps:{kind:'list',idKey:'id'}}},
  initialState:{...one.initialState,steps:[]},
  validateState:(value):value is Record<string,LocalToolJson>=>valid(value)&&Array.isArray(value.steps)&&value.steps.every(item=>record(item)&&typeof item.id==='string'&&!!item.id&&typeof item.label==='string'&&typeof item.done==='boolean'),
  sourceAdditive:{from,field:'steps',defaultValue:[]},
 });
 const sha=async(bytes:Uint8Array<ArrayBuffer>)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const sourceBytes=new TextEncoder().encode(fixtureSource),files=[{path:'module.tsx',sha256:await sha(sourceBytes),bytes:sourceBytes.length}];
 const manifest=async(version:string):Promise<LocalToolReleaseManifest>=>{
  const base={format:'writers-hoard-local-tool-source/1',apiVersion:1,namespace,version,files} as const;
  return{...base,contentHash:await sha(new TextEncoder().encode(localToolReleaseIdentity(base)))};
 };
 const v1=await manifest('1.0.0'),v2=await manifest('2.0.0');
 const root=(hash:string)=>'./installed/'+namespace+'/versions/'+hash;
 registerLocalToolModules({[root(v1.contentHash)+'/module.tsx']:{default:one},[root(v2.contentHash)+'/module.tsx']:{default:two}},{[root(v1.contentHash)+'/release.json']:v1,[root(v2.contentHash)+'/release.json']:v2});
 const contract={namespace,codec:two.codec!,...localToolConvergenceContext(two)!,validateState:two.validateState};
 type Checkpoint=Parameters<typeof listEffectsExport>[0];
 const load=(cp:Checkpoint)=>{const doc=new listEffectsY.Doc({gc:false});docs.push(doc);listEffectsY.applyUpdate(doc,listEffectsBytes(cp.checkpointBase64));doc.getArray('convergence-source-additive');doc.getArray('order:'+JSON.stringify('steps'));doc.getMap('causal-transactions');return doc;};
 const capsule=(cp:Checkpoint,doc:listEffectsY.Doc):Checkpoint=>({...cp,checkpointBase64:listImportBase64(listEffectsY.encodeStateAsUpdate(doc)),stateVectorBase64:listImportBase64(listEffectsY.encodeStateVector(doc))});
 try{
  equal('FULL private library begins89zero',await counts(),{tables:89,total:0});
  const projectId='own-list-full-'+crypto.randomUUID(),now=Date.now(),scope={projectId};
  await createProject({id:projectId,title:'Own full-history import control',description:'Synthetic private library',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['local-tool-'+namespace],engineOrder:['local-tool-'+namespace],createdAt:now,updatedAt:now});projects.push(projectId);
  await pinLocalToolRelease(projectId,namespace,v2.contentHash,null);
  const id=(await createSourceToolDocument(scope,namespace,'Own saved full-history control')).id;
  const client=createLocalToolClient(projectId,two,{documentId:id,releaseHash:v2.contentHash,requireSelectedRelease:true});
  const firstRow={id:'saved-row',label:'Saved row Ω',done:false};
  await client.state!.apply(await client.read(),[{type:'list-insert',field:'steps',item:firstRow,afterId:null}]);
  const source=await readSourceToolDocument(scope,id,namespace);if(!source?.document.convergence)throw Error('FULL normal first writer did not persist');
  const checkpoint=source.document.convergence.checkpoint;
  equal('FULL actual Source checkpoint complete',listEffectsExport(checkpoint).pending,false);
  const exported=await listImportExportProject(projectId),archive=await historyCreateZip(projectId),validFile=new File([archive.blob],'own-valid-full.zip',{type:'application/zip'});
  const validPreview=await historyPreviewZip(validFile);
  equal('FULL genuine ZIP preview accepts actual source',[validPreview.projects.map(row=>row.id),await readSourceToolDocument(scope,id,namespace)],[[projectId],source]);
  // Produce the missing-flush prefix from a REAL second SDK edit on this exact
  // Source checkpoint. Source data remains the admitted first-row snapshot.
  const replica=listFunctionalReplica(checkpoint,{contract,authorId:'full-source-second-writer'});owned.push(replica);
  const second=replica.apply([{type:'list-insert',field:'steps',item:{id:'pending-row',label:'Pending remote row ñ',done:true},afterId:'saved-row'}]);
  if(!second.receiptId)throw Error('FULL genuine second writer missing receipt');
  const complete=replica.checkpoint(),baseWire=load(checkpoint),fullWire=load(complete),txRoot=fullWire.getMap('causal-transactions');
  equal('FULL actual second edit complete',listEffectsExport(complete).pending,false);
  const newTx=[...txRoot.keys()].filter(key=>!baseWire.getMap('causal-transactions').has(key));equal('FULL one actual second flush',newTx.length,1);
  const bodies:listEffectsY.Item[]=[];for(const rows of fullWire.store.clients.values())for(const item of rows)if(item instanceof listEffectsY.Item&&item.parent===txRoot&&item.parentSub===newTx[0])bodies.push(item);
  equal('FULL observed second flush body unique',bodies.length,1);const body=bodies[0];
  const fullSnapshot=listEffectsY.snapshot(fullWire);equal('FULL actual second edit DeleteSet empty',fullSnapshot.ds.clients.size,0);
  const sv=new Map(fullSnapshot.sv);sv.set(body.id.client,body.id.clock);const prefixWire=new listEffectsY.Doc({gc:false});docs.push(prefixWire);
  listEffectsY.createDocFromSnapshot(fullWire,listEffectsY.createSnapshot(fullSnapshot.ds,sv),prefixWire);
  const pending=capsule(complete,prefixWire);
  equal('FULL prefix has no physical Yjs gaps',[prefixWire.store.pendingStructs,prefixWire.store.pendingDs],[null,null]);
  equal('FULL independent reader proves semantic pending',listEffectsExport(pending).pending,true);
  const invalidWire=load(checkpoint);invalidWire.getArray<string>('order:'+JSON.stringify('steps')).push([JSON.stringify({id:'unwitnessed',placementId:'unwitnessed'})]);
  const invalid=capsule(checkpoint,invalidWire);let invalidReader:string|null=null;try{listEffectsExport(invalid);}catch(error){invalidReader=error instanceof Error?error.message:String(error);}
  equal('FULL invalid order proof reader rejects',invalidReader,'local_tool_source_additive_history_invalid');
  const jsonPending:Awaited<ReturnType<typeof listImportExportProject>>=JSON.parse(JSON.stringify(exported));
  const pendingTarget=jsonPending.project?.sourceToolDocuments?.find(row=>row.id===id);if(!pendingTarget?.convergence)throw Error('FULL exported Source document missing');pendingTarget.convergence.checkpoint=pending;
  equal('FULL pending payload preserves actual data/codec',[pendingTarget.data,pendingTarget.codec],[source.document.data,source.document.codec]);
  const beforeJSON=await allRows('FULL before pending normal JSON');let accepted=false,code:string|null=null,returnedId:string|null=null;
  try{returnedId=await listImportProject(jsonPending);projects.push(returnedId);accepted=true;}catch(error){code=error instanceof Error?error.message:String(error);}
  const afterJSON=await allRows('FULL after pending normal JSON');
  console.log('SOURCE_LIST_FULL_JSON '+JSON.stringify({accepted,code,returnedId,before:beforeJSON,after:afterJSON,sourceUnchanged:convergenceCanonical(await readSourceToolDocument(scope,id,namespace))===convergenceCanonical(source)}));
  equal('FULL pending JSON rejects before fork',[accepted,code],[false,'local_tool_source_additive_history_invalid']);
  equal('FULL pending JSON keeps89tables exact',afterJSON,beforeJSON);
  const malformedZip=async(cp:Checkpoint,label:string)=>{
   const zip=await HistoryJSZip.loadAsync(await archive.blob.arrayBuffer()),paths=Object.keys(zip.files).filter(name=>name.endsWith('/project.json'));
   equal(label+' one actual metadata file',paths.length,1);const file=zip.file(paths[0]);if(!file)throw Error('FULL ZIP project.json missing');
   const project:NonNullable<Awaited<ReturnType<typeof listImportExportProject>>['project']>=JSON.parse(await file.async('string'));
   const target=project.sourceToolDocuments?.find(row=>row.id===id);if(!target?.convergence)throw Error('FULL genuine ZIP Source target missing');
   equal(label+' metadata before mutation exact',target,source.document);target.convergence.checkpoint=cp;
   zip.file(paths[0],JSON.stringify(project));return new File([await zip.generateAsync({type:'blob'})],label+'.zip',{type:'application/zip'});
  };
  const expectZipReject=async(label:string,file:File,run:()=>Promise<unknown>)=>{
   const before=await allRows(label+' before');let error:{phase:string;messages:string[]}|null=null;
   try{await run();}catch(value){error=value instanceof HistoryBackupError?{phase:value.phase,messages:value.failures.map(row=>row.message)}:{phase:'unexpected-error',messages:[value instanceof Error?value.message:String(value)]};}
   const after=await allRows(label+' after');
   console.log('SOURCE_LIST_FULL_ZIP '+JSON.stringify({label,fileBytes:file.size,error,before,after}));
   equal(label+' rejects exact full-history preflight',error,{phase:'preflight',messages:['local_tool_source_additive_history_invalid']});
   equal(label+' all89tables exact',after,before);
  };
  for(const [label,cp] of [['pending',pending],['invalid',invalid]] as const){
   const file=await malformedZip(cp,'FULL '+label);
   await expectZipReject('FULL '+label+' ZIP preview',file,()=>historyPreviewZip(file));
   await expectZipReject('FULL '+label+' ZIP normal replace import',file,()=>historyImportZip(file,{replaceProjectIds:[projectId]}));
  }
  equal('FULL all rejected imports preserve source exact',await readSourceToolDocument(scope,id,namespace),source);
  console.log('SOURCE_LIST_FULL_RESULT '+JSON.stringify({actualSource:true,pendingJSON:true,pendingZIP:true,invalidZIP:true,atomic:true,checkCount:checks.length}));return checks;
 }finally{for(const value of owned.reverse())value.destroy();for(const doc of docs.reverse())doc.destroy();for(const id of projects.reverse())await deleteProject(id);equal('FULL private cleanup89zero',await counts(),{tables:89,total:0});}
}
