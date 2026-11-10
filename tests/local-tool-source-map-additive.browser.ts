import JSZip from 'jszip';
import {mergeUpdates} from 'yjs';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {defineLocalTool,type LocalToolJson} from '@/engines/local/sdk';
import {registerLocalToolModules} from '@/engines/local/registry';
import {localToolReleaseIdentity,type LocalToolReleaseManifest} from '@/engines/local/releaseFormat.mjs';
import {pinLocalToolRelease,resolveProjectLocalTool} from '@/engines/local/releases';
import {createSourceToolDocument,readSourceToolDocument} from '@/engines/local/documents/store';
import {createLocalToolClient} from '@/engines/local/storage';
import {queryLocalToolDocuments} from '@/engines/local/queryDocuments';
import {localToolConvergenceContext} from '@/engines/local/convergence/context';
import {convergenceBase64,convergenceBytes,convergenceCanonical,convergenceIdentityOf} from '@/engines/local/convergence/format';
import {createLocalToolGenesis,createLocalToolReplica,exportLocalToolConvergenceCheckpoint,prepareLocalToolReplacement,prepareSourceAdditiveCheckpoint} from '@/engines/local/convergence/replica';
import {readWorldDocument,saveEraDocument,saveWorldEra} from '@/services/worldEras/store';
import fixtureSource from './local-tool-source-additive.browser.ts?raw';

export async function testSourceAdditivePinAndRead(){return scenario(false);}
export async function testSourceAdditivePromotion(){return scenario(true);}

async function scenario(promote:boolean){
 const checks:string[]=[],projectId='own-additive-'+crypto.randomUUID(),scope={projectId},namespace='tests.source-additive';
 const equal=(label:string,actual:unknown,expected:unknown)=>{
  if(convergenceCanonical(actual)!==convergenceCanonical(expected))throw Error(label);
  checks.push(label);Reflect.set(window,'__testStage',label);
 };
 const empty=async()=>{const counts=await Promise.all(db.tables.map(table=>table.count()));return counts.length===89&&counts.every(count=>count===0);};
 const reject=async(label:string,run:()=>unknown)=>{
  let rejected=false;try{await run();}catch{rejected=true;}
  equal(label,rejected,true);
 };
 const text=(value:LocalToolJson):value is Record<string,LocalToolJson>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.name==='string';
 const one=defineLocalTool({
  namespace,stateSchemaVersion:'1',name:{en:'Additive V1',es:'Aditivo V1'},description:{en:'Own V1',es:'V1 propio'},
  document:{defaultTitle:{en:'Own Source',es:'Source propio'}},codec:{version:1,fields:{name:{kind:'scalar'}}},
  index:{version:1,fields:{name:{path:'$.name',type:'string'}}},initialState:{name:'Initial name'},
  validateState:(value):value is Record<string,LocalToolJson>=>text(value)&&!!value.name,component:()=>null,
 });
 const sourceAdditive={from:{namespace,codec:one.codec!,...localToolConvergenceContext(one)!},field:'habitat',defaultValue:'Coast'};
 const secondDefinition={
  ...one,stateSchemaVersion:'2',name:{en:'Additive V2',es:'Aditivo V2'},
  codec:{version:1,fields:{name:{kind:'scalar'},habitat:{kind:'scalar'}}} as const,
  index:{version:1,fields:{name:{path:'$.name',type:'string'},habitat:{path:'$.habitat',type:'string'}}} as const,
  initialState:{name:'Initial name',habitat:'Coast'},
  validateState:(value):value is Record<string,LocalToolJson>=>text(value)&&typeof value.habitat==='string',
 } satisfies Parameters<typeof defineLocalTool<Record<string,LocalToolJson>>>[0];
 const two=defineLocalTool({...secondDefinition,sourceAdditive});
 const unopted=defineLocalTool(secondDefinition);
 const bytes=new TextEncoder().encode(fixtureSource);
 const sha=async(data:Uint8Array<ArrayBuffer>)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(value=>value.toString(16).padStart(2,'0')).join('');
 const files=[{path:'module.tsx',sha256:await sha(bytes),bytes:bytes.length}];
 const manifest=async(version:string):Promise<LocalToolReleaseManifest>=>{
  const identity={format:'writers-hoard-local-tool-source/1',apiVersion:1,namespace,version,files} as const;
  return {...identity,contentHash:await sha(new TextEncoder().encode(localToolReleaseIdentity(identity)))};
 };
 const [v1,v2,v2Unopted]=await Promise.all([manifest('1.0.0'),manifest('2.0.0'),manifest('2.0.1')]);
 const release=(item:LocalToolReleaseManifest)=>'./installed/'+namespace+'/versions/'+item.contentHash;
 registerLocalToolModules({[release(v1)+'/module.tsx']:{default:one},[release(v2)+'/module.tsx']:{default:two},[release(v2Unopted)+'/module.tsx']:{default:unopted}},{[release(v1)+'/release.json']:v1,[release(v2)+'/release.json']:v2,[release(v2Unopted)+'/release.json']:v2Unopted});
 try{
  equal('private library starts with 89 empty tables',await empty(),true);
  await db.projects.add({id:projectId,title:'Own additive',description:projectId,mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:['local-tool-'+namespace],createdAt:1,updatedAt:1});
  const pin1=await pinLocalToolRelease(projectId,namespace,v1.contentHash,null);
  const documentId=(await createSourceToolDocument(scope,namespace,'Own durable Source')).id;
  const client=(definition:typeof one,releaseHash:string)=>createLocalToolClient(projectId,definition,{documentId,releaseHash,requireSelectedRelease:true});
  const old=client(one,v1.contentHash);
  await old.convergence!.start(await old.read());
  const authored=await old.state!.apply(await old.read(),[{type:'set',field:'name',value:'Saved Ω🙂'}]);
  equal('V1 writer stores the exact name with a receipt',[authored.snapshot.data,typeof authored.receiptId],[{name:'Saved Ω🙂'},'string']);
  let race: {id:string;policyId:string;view:Awaited<ReturnType<typeof old.read>>;latest:Awaited<ReturnType<typeof old.read>>}|undefined;
  if(promote){
   const id=(await createSourceToolDocument(scope,namespace,'Own concurrent V1')).id;
   const writer=createLocalToolClient(projectId,one,{documentId:id,releaseHash:v1.contentHash,requireSelectedRelease:true});
   await writer.convergence!.start(await writer.read());
   const prospective=createLocalToolClient(projectId,two,{documentId:id,readOnly:true});
   const view=await prospective.read();
   await reject('V1 executable rejects empty name',async()=>writer.state!.apply(await writer.read(),[{type:'set',field:'name',value:''}]));
   const {snapshot:latest}=await writer.state!.apply(await writer.read(),[{type:'set',field:'name',value:'Last V1 Ω'}]);
   const policyId=(await createSourceToolDocument(scope,namespace,'Own policy transition')).id;
   const policyOld=createLocalToolClient(projectId,one,{documentId:policyId,releaseHash:v1.contentHash,requireSelectedRelease:true});
   await policyOld.convergence!.start(await policyOld.read());
   race={id,policyId,view,latest};
   await reject('strict V2 release without opt-in cannot pin',()=>pinLocalToolRelease(projectId,namespace,v2Unopted.contentHash,pin1.revision));
   await reject('unopted Source writer cannot reset the existing causal origin',()=>createLocalToolClient(projectId,unopted,{documentId:id}).convergence!.start(latest));
   const legacyEra=await saveWorldEra(projectId,{id:'legacy-additive-era',name:'Own V1 era',description:'',revision:0,createdAt:1,updatedAt:1},null);
   const legacyScope={projectId,eraId:legacyEra.id},legacyView=(await readWorldDocument(legacyScope,'local-tool',id))!;
   const variant=structuredClone(legacyView.document);
   variant.root.data={name:'V1 era edit'};
   const saved=await saveEraDocument(legacyScope,'local-tool',variant,legacyView.version);
   equal('generic Era replacement works under the selected V1 even with V2 installed',[saved.provenance,saved.document.root.data,(await writer.read()).data],['variant',{name:'V1 era edit'},{name:'Last V1 Ω'}]);
  }
  const read=()=>readSourceToolDocument(scope,documentId,namespace);
  const history=async()=>JSON.stringify(await db.documentHistory.where('projectId').equals(projectId).toArray(),(_key,value)=>value===undefined?{testUndefined:true}:value);
  const before=await read(),historyBefore=await history(),rawExport=await old.convergence!.export();
  equal('V1 durable export is engine1 and sparse',[rawExport.checkpoint?.engine.version,rawExport.snapshot.data],['1',{name:'Saved Ω🙂'}]);
  equal('V1 created real history',JSON.parse(historyBefore).length>0,true);
  const durableIndex=await queryLocalToolDocuments(scope,{namespace});
  equal('V1 index observes saved name',durableIndex.find(row=>row.id===documentId)?.fields,{name:'Saved Ω🙂'});
  const pin2=await pinLocalToolRelease(projectId,namespace,v2.contentHash,pin1.revision);
  equal('normal V2 pin increments only its own revision',[pin2.contentHash,pin2.revision],[v2.contentHash,pin1.revision+1]);
  const current=client(resolveProjectLocalTool(namespace,(await db.projects.get(projectId))!),v2.contentHash);
  const projected=await current.read();
  equal('strict V2 read projects default and keeps edited name',projected.data,{name:'Saved Ω🙂',habitat:'Coast'});
  equal('second read remains literal',await current.read(),projected);
  const opened=await current.convergence!.start(projected);
  equal('V2 open/start does not write or activate another genesis',[opened.changed,opened.checkpoint],[false,rawExport.checkpoint]);
  equal('V2 validated view retains V1 lineage and revision',[projected.document?.lineage,projected.revision],[rawExport.snapshot.document?.lineage,rawExport.snapshot.revision]);
  equal('pin and read leave durable root and history exact',[await read(),await history()],[before,historyBefore]);
  equal('readonly export is still the exact V1 checkpoint and raw data',await current.convergence!.export(),rawExport);
  equal('index leaves projected default absent',await queryLocalToolDocuments(scope,{namespace}),durableIndex);
  const archive=await createProjectZipArchive(projectId),zip=await JSZip.loadAsync(await archive.blob.arrayBuffer());
  const metadata=Object.keys(zip.files).find(path=>path.endsWith('/project.json'))!;
  const project=JSON.parse(await zip.file(metadata)!.async('string'));
  equal('normal ZIP holds the exact original Source document',project.sourceToolDocuments.find((row:{id:string})=>row.id===documentId),before!.document);
  db.close();await db.open();
  equal('cold V2 read projects the same default without writing',[await current.read(),await read(),await history()],[projected,before,historyBefore]);
  if(promote){
   const rawBefore=rawExport.checkpoint!;
   const oldAuthor=createLocalToolReplica(rawBefore,{authorId:'old-disconnected',contract:{namespace,codec:one.codec!,...localToolConvergenceContext(one)!,validateState:one.validateState}});
   let late;
   try{late=oldAuthor.apply([{type:'set',field:'name',value:'Late V1'}]).update;}
   finally{oldAuthor.destroy();}
   const oldNoop=await current.state!.apply(projected,[{type:'set',field:'name',value:'Saved Ω🙂'}]);
   const absent=await current.state!.apply(projected,[{type:'unset',field:'habitat'}]);
   equal('no-op and unset absent leave V1 untouched',[oldNoop.receiptId,absent.receiptId,await current.convergence!.export(),await history()],[null,null,rawExport,historyBefore]);
   await reject('outer transaction aborts first effective write',()=>db.transaction('rw',db.tables,async()=>{
    await current.state!.apply(projected,[{type:'set',field:'habitat',value:'Harbour'}]);
    throw Error('own-abort');
   }));
   equal('aborted promotion leaves V1 root and history exact',[await read(),await history()],[before,historyBefore]);
   await reject('V2 port cannot use the original V1 receipt',()=>current.state!.undo(authored.receiptId!));
   const era=await saveWorldEra(projectId,{id:'additive-era',name:'Own era',description:'',revision:0,createdAt:1,updatedAt:1},null);
   const eraScope={projectId,eraId:era.id},eraView=(await readWorldDocument(eraScope,'local-tool',documentId))!;
   const attempted=structuredClone(eraView.document);
   attempted.root.data={name:'Generic era replacement',habitat:'Harbour'};
   await reject('generic Era replacement cannot fork past the pending promotion',()=>saveEraDocument(eraScope,'local-tool',attempted,eraView.version));
   equal('rejected Era replacement retains the inherited V1 view',await readWorldDocument(eraScope,'local-tool',documentId),eraView);
   const explicit=await current.state!.apply(projected,[{type:'set',field:'habitat',value:'Coast'}]);
   const durable=await read(),active=(await current.convergence!.export()).checkpoint!;
   equal('explicit default promotes and creates one normal receipt',[active.engine.version,explicit.snapshot.revision,typeof explicit.receiptId],['8',projected.revision!+1,'string']);
   equal('promotion preserves genesis, generation and lineage',[active.genesisId,durable!.document.generation,durable!.lineage],[rawBefore.genesisId,before!.document.generation,before!.lineage]);
   equal('explicit default has a real sparse slot',durable!.document.data,{name:'Saved Ω🙂',habitat:'Coast'});
   const historyAfter=JSON.parse(await history()) as {document?:{root?:{id?:string;revision?:number}}}[];
   equal('one new history entry retains the previous V1 revision',historyAfter.filter(row=>row.document?.root?.id===documentId&&row.document.root.revision===projected.revision).length,1);
   const undone=await current.state!.undo(explicit.receiptId!);
   equal('same-port Undo returns absence with default visible',[undone.snapshot.data,(await read())!.document.data,undone.snapshot.convergence?.engine.version],[{name:'Saved Ω🙂',habitat:'Coast'},{name:'Saved Ω🙂'},'8']);
   const absentActive=(await current.convergence!.export()).checkpoint!;
   const noPinChange=await db.projects.get(projectId);
   await reject('permissive old release cannot pin after promotion',()=>pinLocalToolRelease(projectId,namespace,v1.contentHash,pin2.revision));
   equal('rejected old pin retains the selected release',(await db.projects.get(projectId))!.localToolInstallations,noPinChange!.localToolInstallations);
   const stale=createLocalToolClient(projectId,one,{documentId});
   await reject('V1 definition cannot read the promoted document',()=>stale.read());
   await reject('V1 definition cannot start the promoted document',()=>stale.convergence!.start(undone.snapshot));
   await reject('V1 definition cannot replace promoted data',()=>stale.save({name:'V1 replacement'},undone.snapshot.revision,undone.snapshot.document?.version));

   const contract={namespace,codec:two.codec!,...localToolConvergenceContext(two)!,validateState:two.validateState};
   const from=sourceAdditive.from;
   const otherEpoch={...from,schemaEpoch:from.schemaEpoch+'-other'};
   const sameCodecOtherPolicy=createLocalToolGenesis({name:'Same fields'}, {...otherEpoch,validateState:one.validateState});
   await reject('the exact codec alone cannot authorize a different V1 epoch',()=>prepareSourceAdditiveCheckpoint(sameCodecOtherPolicy,{name:'Same fields'},otherEpoch,contract));
   const oldContract={...from,validateState:one.validateState};
   const historicallyPresent=createLocalToolGenesis({name:'Old extra',habitat:'Legacy habitat'},oldContract);
   const removed=prepareLocalToolReplacement(historicallyPresent,{authorId:'legacy-extra',contract:oldContract},{name:'Old extra'});
   equal('legacy state can have hidden history of an absent extra field',removed.data,{name:'Old extra'});
   await reject('removing an old slot does not make that same slot eligible',()=>prepareSourceAdditiveCheckpoint(removed.checkpoint,removed.data,from,contract));
   const a=createLocalToolReplica(absentActive,{authorId:'A',contract}),b=createLocalToolReplica(absentActive,{authorId:'B',contract});
   try{
    const clean=a.checkpoint();
    await reject('old V1 packet cannot be received after D',()=>a.receive(late));
    await reject('retagged V1 packet is outside the D frontier',()=>a.receive({...late,...convergenceIdentityOf(absentActive)}));
    const rival=prepareSourceAdditiveCheckpoint(rawBefore,rawExport.snapshot.data,sourceAdditive.from,contract);
    await reject('a rival D cannot join the selected promotion',()=>a.receive(exportLocalToolConvergenceCheckpoint(rival).update));
    equal('rejected updates preserve the V2 checkpoint',a.checkpoint(),clean);
    const aa=a.apply([{type:'set',field:'habitat',value:'Harbour'}]),bb=b.apply([{type:'set',field:'habitat',value:'River'}]);
    a.receive(bb.update);b.receive(aa.update);
    equal('two independent V2 authors converge from D',a.read(),b.read());
    const aWins=(a.read() as Record<string,LocalToolJson>).habitat==='Harbour';
    const winner=aWins?a:b,loser=aWins?b:a;
    loser.receive(winner.undo((aWins?aa:bb).receiptId!).update);
    equal('Undo exposes the other author contribution',(winner.read() as Record<string,LocalToolJson>).habitat,aWins?'River':'Harbour');
    winner.receive(loser.undo((aWins?bb:aa).receiptId!).update);
    equal('both Undo return to sparse absence with D intact',[a.read(),b.read(),exportLocalToolConvergenceCheckpoint(a.checkpoint()).pending],[{name:'Saved Ω🙂'},{name:'Saved Ω🙂'},false]);
   }finally{a.destroy();b.destroy();}
   const sender=createLocalToolReplica(absentActive,{authorId:'sender',contract});
   const receiver=createLocalToolReplica(absentActive,{authorId:'receiver',contract});
   try{
    const first=sender.apply([{type:'set',field:'habitat',value:'Harbour'}]);
    const tail=sender.apply([{type:'set',field:'habitat',value:'Ridge'}]);
    const clean=receiver.checkpoint();
    const mixed={...tail.update,updateBase64:convergenceBase64(mergeUpdates([convergenceBytes(late.updateBase64),convergenceBytes(tail.update.updateBase64)]))};
    await reject('a pending V2 tail cannot mask a complete incompatible V1 transaction',()=>receiver.receive(mixed));
    equal('mixed rejection preserves exact bytes',receiver.checkpoint(),clean);
    equal('a legitimate V2 tail may wait for its predecessor',receiver.receive(tail.update).pending,true);
    equal('the predecessor completes the accepted V2 tail',[receiver.receive(first.update).pending,receiver.read()],[false,{name:'Saved Ω🙂',habitat:'Ridge'}]);
   }finally{sender.destroy();receiver.destroy();}
   const redone=await current.state!.redo(undone.receiptId!);
   equal('same-port Redo restores explicit default',(await read())!.document.data,redone.snapshot.data);
   await reject('a stale effective default cannot replace changed sparse presence',()=>current.state!.apply(undone.snapshot,[{type:'unset',field:'habitat'}]));
   const raceClient=createLocalToolClient(projectId,two,{documentId:race!.id,releaseHash:v2.contentHash,requireSelectedRelease:true});
   const raceRaw=(await raceClient.convergence!.export()).checkpoint!;
   await reject('old-field collision after the last V1 write rejects atomically',()=>raceClient.state!.apply(race!.view,[{type:'set',field:'name',value:''}]));
   equal('rejected stale baseline retains the latest V1 checkpoint',(await raceClient.convergence!.export()).checkpoint,raceRaw);
   const afterRace=await raceClient.state!.apply(race!.view,[{type:'set',field:'habitat',value:'Harbour'}]);
   equal('promotion incorporates the last legitimate V1 write',[afterRace.snapshot.data,afterRace.snapshot.convergence?.engine.version,afterRace.snapshot.revision],[{name:'Last V1 Ω',habitat:'Harbour'},'8',race!.latest.revision!+1]);
   const policyClient=createLocalToolClient(projectId,two,{documentId:race!.policyId,releaseHash:v2.contentHash,requireSelectedRelease:true});
   const beforePolicy=await policyClient.read();
   const policy=await policyClient.state!.apply(beforePolicy,[{type:'set',field:'name',value:''}]);
   const policyRaw=await policyClient.convergence!.export();
   equal('a V2-only old-field value promotes in one revision with no materialized default',[beforePolicy.convergence?.engine.version,policy.snapshot.data,policyRaw.snapshot.data,policyRaw.checkpoint?.engine.version,policy.snapshot.revision],['1',{name:'',habitat:'Coast'},{name:''},'8',beforePolicy.revision!+1]);
   const final=await current.convergence!.export(),v2Archive=await createProjectZipArchive(projectId);
   await importProjectZip(new File([v2Archive.blob],'own-promoted.zip',{type:'application/zip'}),{replaceProjectIds:[projectId]});
   db.close();await db.open();
   equal('V2 same-ID ZIP and cold preserve the exact promoted export',await current.convergence!.export(),final);
   const nativeId=(await createSourceToolDocument(scope,namespace,'Own V2 native')).id;
   const native=createLocalToolClient(projectId,two,{documentId:nativeId,releaseHash:v2.contentHash,requireSelectedRelease:true});
   const nativeStart=await native.convergence!.start(await native.read());
   equal('V2 native starts with its own engine8 origin',[nativeStart.checkpoint.engine.version,nativeStart.checkpoint.genesisId!==active.genesisId],['8',true]);
   const nativeWrite=await native.state!.apply(nativeStart.snapshot,[{type:'set',field:'habitat',value:'Hills'}]);
   equal('V2 native edits without legacy history',[nativeWrite.snapshot.data,typeof nativeWrite.receiptId],[{name:'Initial name',habitat:'Hills'},'string']);
  }
 }finally{
  if(await db.projects.get(projectId))await deleteProject(projectId);
  equal('private library cleanup89zero',await empty(),true);
 }
 return checks;
}

// New2455 body. The complete2088 source above remains an exact frozen prefix.
// This is the renderer dispatcher and public SDK, NOT authenticated Native MCP.
import {createProject as mapCreateProject,exportProjectData as mapExportProjectData,importProjectData as mapImportProjectData} from '@/db/operations';
import {runBridgeTool as mapRunBridgeTool} from '@/services/aiBridge/dispatch';
import type {LocalToolConvergenceCheckpoint as MapCheckpoint} from '@/engines/local/convergence/types';
import {Doc as MapYDoc,applyUpdate as mapYApply,encodeStateAsUpdate as mapYEncode,encodeStateVector as mapYVector} from 'yjs';
import mapFixtureSource from './local-tool-source-map-additive.browser.ts?raw';
import {previewProjectDuplicate as mapPreviewDuplicate,duplicateProject as mapDuplicateProject} from '@/services/projectDuplicate/service';

function mapNeed(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
function mapRecord(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function mapData(value:LocalToolJson):Record<string,LocalToolJson>{mapNeed(value&&typeof value==='object'&&!Array.isArray(value),'Map oracle expects object data');return value;}

export async function testSourceMapAdditiveRed(){
 const checks=[...await testSourceAdditivePinAndRead(),...await testSourceAdditivePromotion()];
 checks.push('Exact2088 positive controls completed before any map declaration');
 Reflect.set(window,'__testStage','2455 scalar2088 controls passed');
 return [...checks,...await mapScenario()];
}

async function mapScenario(){
 const checks:string[]=[],projectId='own-map-additive-'+crypto.randomUUID(),controlId='own-map-control-'+crypto.randomUUID(),scope={projectId},namespace='tests.source-map-additive2455';
 const clones:string[]=[],operations:string[]=[];
 const equal=(label:string,actual:unknown,expected:unknown)=>{mapNeed(convergenceCanonical(actual)===convergenceCanonical(expected),label);checks.push(label);Reflect.set(window,'__testStage',label);};
 const snapshot=async()=>JSON.stringify(await Promise.all(db.tables.map(async table=>({name:table.name,rows:await table.toArray()}))),(_key,value)=>value===undefined?{ownUndefined:true}:value);
 const reject=async(label:string,run:()=>unknown)=>{const before=await snapshot();let error:unknown;try{await run();}catch(value){error=value;}mapNeed(error,label+' must reject');equal(label+' leaves all durable rows exact',await snapshot(),before);return error instanceof Error?error.message:String(error);};
 const isOne=(value:LocalToolJson):value is Record<string,LocalToolJson>=>mapRecord(value)&&typeof value.name==='string'&&!!value.name&&(value.other===undefined||mapRecord(value.other));
 const one=defineLocalTool<Record<string,LocalToolJson>>({namespace,stateSchemaVersion:'1',name:{en:'Research notebook V1',es:'Cuaderno V1'},description:{en:'Own map evolution fixture',es:'Prueba propia de evolución'},document:{defaultTitle:{en:'Research notebook',es:'Cuaderno'}},codec:{version:1,fields:{name:{kind:'scalar'},other:{kind:'map'}}},initialState:{name:'Initial',other:{keep:'Other map Ω'}},validateState:isOne,component:()=>null});
 const context=localToolConvergenceContext(one);mapNeed(context&&one.codec,'Existing V1 metadata unavailable');
 const addition={from:{namespace,codec:one.codec,...context},field:'checks',defaultValue:{}};
 const second={...one,stateSchemaVersion:'2',name:{en:'Research notebook V2',es:'Cuaderno V2'},codec:{version:1,fields:{name:{kind:'scalar'},other:{kind:'map'},checks:{kind:'map'}}},initialState:{name:'Initial',other:{keep:'Other map Ω'},checks:{}},validateState:(value:LocalToolJson):value is Record<string,LocalToolJson>=>isOne(value)&&mapRecord(value.checks)&&Object.values(value.checks).every(entry=>mapRecord(entry)&&typeof entry.label==='string'&&typeof entry.done==='boolean')} satisfies Parameters<typeof defineLocalTool<Record<string,LocalToolJson>>>[0];
 const sourceBytes=new TextEncoder().encode(mapFixtureSource);
 const hash=async(bytes:Uint8Array<ArrayBuffer>)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const manifest=async(version:string):Promise<LocalToolReleaseManifest>=>{const identity={format:'writers-hoard-local-tool-source/1',apiVersion:1,namespace,version,files:[{path:'module.tsx',sha256:await hash(sourceBytes),bytes:sourceBytes.length}]} satisfies Omit<LocalToolReleaseManifest,'contentHash'>;return{...identity,contentHash:await hash(new TextEncoder().encode(localToolReleaseIdentity(identity)))};};
 const v1=await manifest('1.0.0'),v2=await manifest('2.0.0'),path=(release:LocalToolReleaseManifest)=>'./installed/'+namespace+'/versions/'+release.contentHash;
 registerLocalToolModules({[path(v1)+'/module.tsx']:{default:one}},{[path(v1)+'/release.json']:v1});
 try{
  equal('Private map library begins with89empty tables',(await Promise.all(db.tables.map(t=>t.count()))).every(x=>x===0)&&db.tables.length===89,true);
  await mapCreateProject({id:projectId,title:'Own map evolution',description:'Synthetic2455',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['local-tool-'+namespace],createdAt:1,updatedAt:1});
  await mapCreateProject({id:controlId,title:'Own independent control',description:'Synthetic control',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['codex'],createdAt:1,updatedAt:1});
  const controlBefore=JSON.stringify(await db.projects.get(controlId));
  const pin=await pinLocalToolRelease(projectId,namespace,v1.contentHash,null);
  const created=await mapRunBridgeTool('wh_local_tool_document_create',{projectId,namespace,title:'Existing notebook'});
  mapNeed(created.ok&&mapRecord(created.result)&&typeof created.result.id==='string','Normal Source create setup failed: '+JSON.stringify(created));
  const documentId=created.result.id,old=createLocalToolClient(projectId,one,{documentId,releaseHash:v1.contentHash,requireSelectedRelease:true});
  mapNeed(old.convergence&&old.state,'Existing public V1 client unavailable');
  await old.convergence.start(await old.read());
  await old.state.apply(await old.read(),[{type:'set',field:'name',value:'Saved Ω 漢字 🧭'}]);
  const read=()=>readSourceToolDocument(scope,documentId,namespace),before=await read(),exported=await old.convergence.export(),historyBefore=await snapshot();
  mapNeed(before&&exported.checkpoint,'V1 durable Source checkpoint absent');
  equal('V1 is engine1 with no checks slot',[exported.checkpoint.engine.version,Object.hasOwn(mapData(before.document.data),'checks')],['1',false]);
  let two:typeof one|undefined;
  try{two=defineLocalTool({...second,sourceAdditive:addition});}
  catch(error){
   const code=error instanceof Error?error.message:String(error);
   Reflect.set(window,'__sourceMapAdditiveRed',{stage:'publicV2Declaration',error:code,scalarControlsPassed:true,sourceId:documentId});
   console.log('SOURCE_MAP_ADDITIVE_DECLARATION '+JSON.stringify({error:code,scalarControlsPassed:true}));
   mapNeed(code==='local_tool_source_additive_invalid','Unexpected setup/declaration error is not the intended map RED: '+code);
   equal('Rejected baseline V2 declaration leaves complete V1 library exact',await snapshot(),historyBefore);
   throw Error('REQUIRED_CAPABILITY: public V2 map addition must be accepted; baseline rejected local_tool_source_additive_invalid');
  }
  mapNeed(two&&two.codec,'Required V2 map addition was not accepted');
  registerLocalToolModules({[path(v2)+'/module.tsx']:{default:two}},{[path(v2)+'/release.json']:v2});
  const selected=await mapRunBridgeTool('wh_local_tool_pin',{projectId,namespace,contentHash:v2.contentHash,expectedRevision:pin.revision});mapNeed(selected.ok,'Normal V2 pin failed: '+JSON.stringify(selected));
  const current=createLocalToolClient(projectId,two,{documentId,releaseHash:v2.contentHash,requireSelectedRelease:true});mapNeed(current.convergence&&current.state,'Current public V2 client unavailable');
  const afterPin=await snapshot(),effective=await current.read();
  equal('Read projects exactly empty map with old data intact',effective.data,{name:'Saved Ω 漢字 🧭',other:{keep:'Other map Ω'},checks:{}});
  await current.read();await current.convergence.start(effective);
  equal('Pin/read/start/export do not materialize default or replace lineage',await current.convergence.export(),exported);
  equal('Quiet reads leave every durable row exact',await snapshot(),afterPin);
  equal('Sparse Source root remains exactly V1',await read(),before);
  const deleteAbsent=await current.state.apply(effective,[{type:'map-delete',field:'checks',key:'absent'}]);
  equal('Absent map-delete is no-op, no promotion, no new history',[deleteAbsent.receiptId,await read(),await current.convergence.export(),await snapshot()],[null,before,exported,afterPin]);
  await reject('Invalid entry validator',async()=>current.state!.apply(await current.read(),[{type:'map-set',field:'checks',key:'invalid',value:{label:'bad',done:'wrong'}}]));
  await reject('Atomic first map write outer abort',()=>db.transaction('rw',db.tables,async()=>{await current.state!.apply(effective,[{type:'map-set',field:'checks',key:'first',value:{label:'First',done:false}}]);throw Error('own-abort');}));
  const first=await current.state.apply(effective,[{type:'map-set',field:'checks',key:'first',value:{label:'First',done:false}}]);
  mapNeed(first.receiptId,'First map mutation missing normal receipt');
  const durable=await read(),active=(await current.convergence.export()).checkpoint;mapNeed(durable&&active,'Active Source absent');
  equal('Single first write keeps genesis/generation/lineage and bumps one revision',[active.genesisId,durable.document.generation,durable.lineage,durable.document.revision],[exported.checkpoint.genesisId,before.document.generation,before.lineage,before.document.revision+1]);
  equal('First map key is present without changing other map',first.snapshot.data,{name:'Saved Ω 漢字 🧭',other:{keep:'Other map Ω'},checks:{first:{label:'First',done:false}}});
  equal('Independent no-package reader accepts promoted frontier',exportLocalToolConvergenceCheckpoint(active).pending,false);
  const undone=await current.state.undo(first.receiptId);
  equal('Undo first write restores sparse raw default, retaining promotion',[Object.hasOwn(mapData((await read())!.document.data),'checks'),mapData(undone.snapshot.data).checks,undone.snapshot.convergence?.genesisId],[false,{},active.genesisId]);
  const sparse=(await current.convergence.export()).checkpoint;mapNeed(sparse,'Sparse promoted checkpoint absent');
  const nextContext=localToolConvergenceContext(two);mapNeed(nextContext,'V2 context unavailable');
  const contract={namespace,codec:two.codec,...nextContext,validateState:two.validateState};
  const lateWriter=createLocalToolReplica(exported.checkpoint,{authorId:'map-late-V1',contract:{...addition.from,validateState:one.validateState}});
  let lateUpdate:ReturnType<typeof lateWriter.export>;
  try{lateUpdate=lateWriter.apply([{type:'map-set',field:'other',key:'late',value:'V1 after its old frontier'}]).update;}finally{lateWriter.destroy();}
  const a=createLocalToolReplica(sparse,{authorId:'map-author-A',contract}),b=createLocalToolReplica(sparse,{authorId:'map-author-B',contract}),left=createLocalToolReplica(sparse,{authorId:'map-sink-L',contract}),right=createLocalToolReplica(sparse,{authorId:'map-sink-R',contract});
  try{
   const clean=a.checkpoint();
   await reject('Old V1 packet after selected map frontier',()=>a.receive(lateUpdate));
   await reject('Retagged V1 map packet cannot bypass selected frontier',()=>a.receive({...lateUpdate,...convergenceIdentityOf(sparse)}));
   const rival=prepareSourceAdditiveCheckpoint(exported.checkpoint,exported.snapshot.data,addition.from,contract);
   await reject('Rival map promotion cannot replace the one admitted frontier',()=>a.receive(exportLocalToolConvergenceCheckpoint(rival).update));
   equal('All malformed/late/rival receives leave exact replica bytes',a.checkpoint(),clean);
   const aa=a.apply([{type:'map-set',field:'checks',key:'alpha',value:{label:'A Ω',done:false}}]),bb=b.apply([{type:'map-set',field:'checks',key:'beta',value:{label:'B 漢字 🧭',done:true}}]);
   mapNeed(aa.receiptId&&bb.receiptId,'Two distinct public authors require own receipts');
   a.receive(bb.update);b.receive(aa.update);left.receive(aa.update);left.receive(bb.update);right.receive(bb.update);right.receive(aa.update);right.receive(aa.update);
   const mergedExpected={name:'Saved Ω 漢字 🧭',other:{keep:'Other map Ω'},checks:{alpha:{label:'A Ω',done:false},beta:{label:'B 漢字 🧭',done:true}}};
   equal('Both arrival orders/replay retain both map keys and original other map',[a.read(),b.read(),left.read(),right.read()],[mergedExpected,mergedExpected,mergedExpected,mergedExpected]);
   equal('Merged map contains both complete authored values',mapData(a.read()).checks,{alpha:{label:'A Ω',done:false},beta:{label:'B 漢字 🧭',done:true}});
   b.receive(a.undo(aa.receiptId).update);
   equal('UndoA preserves B even when A created field support',mapData(b.read()).checks,{beta:{label:'B 漢字 🧭',done:true}});
   a.receive(b.undo(bb.receiptId).update);
   equal('Undo both returns raw sparse absence with same causal origin',[Object.hasOwn(a.read(),'checks'),a.checkpoint().genesisId],[false,sparse.genesisId]);
   const durableBeforeImport=await read();
   await current.convergence.import(left.export());
   const imported=await read();mapNeed(imported,'Source after public import absent');
   equal('Normal Source import retains disjoint authored map',mapData((await current.read()).data).checks,{alpha:{label:'A Ω',done:false},beta:{label:'B 漢字 🧭',done:true}});
   const stable=await snapshot();await current.convergence.import(left.export());equal('Import replay changes no Source/history rows',await snapshot(),stable);
   mapNeed(durableBeforeImport,'Prior durable checkpoint absent');
  }finally{a.destroy();b.destroy();left.destroy();right.destroy();}
  const chainA=createLocalToolReplica(sparse,{authorId:'map-chain-A',contract}),chainB=createLocalToolReplica(sparse,{authorId:'map-chain-B',contract});
  try{
   const firstA=chainA.apply([{type:'map-set',field:'checks',key:'supportA',value:{label:'First support',done:false}}]);mapNeed(firstA.receiptId,'A support receipt absent');chainB.receive(firstA.update);
   const laterB=chainB.apply([{type:'map-set',field:'checks',key:'supportB',value:{label:'B sees existing map',done:true}}]);chainA.receive(laterB.update);chainB.receive(chainA.undo(firstA.receiptId).update);
   equal('Sequential B key survives Undo of first A support',mapData(chainB.read()).checks,{supportB:{label:'B sees existing map',done:true}});
  }finally{chainA.destroy();chainB.destroy();}
  await reject('Existing new-field stale baseline CAS stays strict',()=>current.state!.apply(effective,[{type:'map-set',field:'checks',key:'stale',value:{label:'Not admitted',done:false}}]));
  await reject('Nonempty map default',()=>defineLocalTool({...second,sourceAdditive:{...addition,defaultValue:{forbidden:true}}}));
  await reject('Old release cannot replace promoted Source',()=>pinLocalToolRelease(projectId,namespace,v1.contentHash,2));
  const contractOne={...addition.from,validateState:one.validateState};
  const legacy=createLocalToolReplica(createLocalToolGenesis({name:'Legacy',other:{ghost:'hidden'}},contractOne),{authorId:'legacy-negative',contract:contractOne});
  try{
   legacy.apply([{type:'map-delete',field:'other',key:'ghost'}]);
   const oldCheckpoint=legacy.checkpoint(),doc=new MapYDoc({gc:false});
   try{
    mapYApply(doc,convergenceBytes(oldCheckpoint.checkpointBase64));
    const versions=doc.getMap<string>('register-versions');let changed=0;
    for(const [key,encoded]of versions){const value:unknown=JSON.parse(encoded);mapNeed(mapRecord(value),'Negative wire register malformed');if(value.root==='map:other'){versions.set(key,JSON.stringify({...value,root:'map:checks'}));changed++;}}
    mapNeed(changed>=2,'Negative sparse-map witness must retain authored key and tombstone');
    const forged:MapCheckpoint={...oldCheckpoint,checkpointBase64:convergenceBase64(mapYEncode(doc)),stateVectorBase64:convergenceBase64(mapYVector(doc))};
    equal('Negative witness remains a complete old-format packet',exportLocalToolConvergenceCheckpoint(forged).pending,false);
    await reject('Hidden ancestral map entries cannot become new field',()=>prepareSourceAdditiveCheckpoint(forged,legacy.read(),addition.from,contract));
   }finally{doc.destroy();}
  }finally{legacy.destroy();}
  const nativeId=(await createSourceToolDocument(scope,namespace,'Own native V2')).id;
  const native=createLocalToolClient(projectId,two,{documentId:nativeId,releaseHash:v2.contentHash,requireSelectedRelease:true});mapNeed(native.convergence&&native.state,'Native V2 Source client missing');
  equal('Normal V2 creator removes equal default into sparse raw state',Object.hasOwn(mapData((await readSourceToolDocument(scope,nativeId,namespace))!.document.data),'checks'),false);
  await native.convergence.start(await native.read());
  const nativeEdit=await native.state.apply(await native.read(),[{type:'map-set',field:'checks',key:'native',value:{label:'Native sparse',done:false}}]);mapNeed(nativeEdit.receiptId,'Native sparse map edit has no receipt');
  equal('Native engine8 sparse default accepts first map key',mapData(nativeEdit.snapshot.data).checks,{native:{label:'Native sparse',done:false}});
  await native.state.undo(nativeEdit.receiptId);
  equal('Native Source Undo returns raw sparse absence',Object.hasOwn(mapData((await readSourceToolDocument(scope,nativeId,namespace))!.document.data),'checks'),false);
  const explicitSeed=createLocalToolGenesis({name:'Explicit native',other:{},checks:{seed:{label:'Explicit seed',done:false}}},contract);
  const concurrent=createLocalToolReplica(explicitSeed,{authorId:'native-concurrent',contract});
  try{
   const fresh=concurrent.apply([{type:'map-set',field:'checks',key:'concurrent',value:{label:'Concurrent key',done:true}}]);
   const removed=prepareLocalToolReplacement(explicitSeed,{authorId:'native-field-remove',contract},{name:'Explicit native',other:{}}),reader=createLocalToolReplica(removed.checkpoint,{authorId:'native-false-reader',contract});
   try{reader.receive(fresh.update);equal('Native explicit presence false is not replaced by keys OR truthiness',Object.hasOwn(reader.read(),'checks'),false);}finally{reader.destroy();}
  }finally{concurrent.destroy();}
  const mcpOriginal=await current.read(),mcpRead=await mapRunBridgeTool('wh_local_tool_read',{projectId,namespace,documentId});mapNeed(mcpRead.ok&&mapRecord(mcpRead.result),'Normal map dispatcher read failed');
  const mcpApplied=await mapRunBridgeTool('wh_local_tool_state_apply',{projectId,namespace,documentId,baseline:mcpRead.result,actions:[{type:'map-set',field:'checks',key:'dispatcher',value:{label:'Normal dispatcher',done:true}}]});
  mapNeed(mcpApplied.ok&&mapRecord(mcpApplied.result)&&typeof mcpApplied.result.receiptId==='string','Normal map dispatcher apply/receipt failed: '+JSON.stringify(mcpApplied));
  const mcpUndone=await mapRunBridgeTool('wh_local_tool_state_undo',{projectId,namespace,documentId,receiptId:mcpApplied.result.receiptId});mapNeed(mcpUndone.ok&&mapRecord(mcpUndone.result)&&mapRecord(mcpUndone.result.snapshot),'Normal map dispatcher Undo failed');
  equal('Existing dispatcher map apply and receipt-specific Undo use Source writer',mcpUndone.result.snapshot.data,mcpOriginal.data);
  const baseBeforeEra=await current.convergence.export();
  const era=await saveWorldEra(projectId,{id:'map-era-'+crypto.randomUUID(),name:'Own map era',description:'',revision:0,createdAt:1,updatedAt:1},null);
  const eraClient=createLocalToolClient(projectId,two,{documentId,eraId:era.id,releaseHash:v2.contentHash,requireSelectedRelease:true});mapNeed(eraClient.convergence&&eraClient.state,'Normal era client absent');
  const inherited=await eraClient.read();equal('New era inherits admitted Base map',inherited.data,baseBeforeEra.snapshot.data);
  await eraClient.convergence.start(inherited);
  const ownEraBefore=await eraClient.read();const eraWrite=await eraClient.state.apply(ownEraBefore,[{type:'map-set',field:'checks',key:'eraOnly',value:{label:'Sólo época',done:false}}]);mapNeed(eraWrite.receiptId,'Era write missing receipt');
  equal('Normal era COW leaves Base export exact',await current.convergence.export(),baseBeforeEra);
  await eraClient.state.undo(eraWrite.receiptId);equal('Era own Undo restores its admitted map',mapData((await eraClient.read()).data).checks,mapData(inherited.data).checks);
  const archiveView=await eraClient.read(),hide=await mapRunBridgeTool('wh_local_tool_document_archive',{projectId,eraId:era.id,namespace,documentId,expectedRevision:archiveView.revision,expectedVersion:archiveView.document?.version});mapNeed(hide.ok,'Normal era archive/hide failed: '+JSON.stringify(hide));
  equal('Era hidden Source has no fallback to Base',(await readWorldDocument({projectId,eraId:era.id},'local-tool',documentId))===undefined,true);
  equal('Era hide still preserves Base checkpoint',await current.convergence.export(),baseBeforeEra);
  const final=await current.convergence.export(),zip=await createProjectZipArchive(projectId);
  await importProjectZip(new File([zip.blob],'own-map-sameid.zip',{type:'application/zip'}),{replaceProjectIds:[projectId]});db.close();await db.open();
  equal('SameID normal ZIP plus DB reopen preserves exact checkpoint/export',await current.convergence.export(),final);
  const sourceRows=async()=>JSON.stringify(await Promise.all(db.tables.map(async table=>({name:table.name,rows:(await table.toArray()).filter(row=>mapRecord(row)&&(table.name==='projects'?row.id===projectId:row.projectId===projectId))}))),(_key,value)=>value===undefined?{ownUndefined:true}:value);
  const sourceBeforeCopies=await sourceRows(),project=await mapExportProjectData(projectId),copyId=await mapImportProjectData(JSON.parse(JSON.stringify(project)));clones.push(copyId);
  const copied=await db.projects.get(copyId),row=copied?.sourceToolDocuments?.find(item=>item.namespace===namespace&&item.title==='Existing notebook');mapNeed(row&&row.convergence&&row.codec,'Normal JSON copy Source missing');
  equal('NewID normal copy forks admitted map with own genesis',[row.data,row.codec,row.convergence.checkpoint.genesisId===final.checkpoint?.genesisId],[final.snapshot.data,two.codec,false]);
  mapNeed(row.id!==documentId,'NewID JSON copy reused source ID');
  equal('Copy snapshot shape has normal forked checkpoint',exportLocalToolConvergenceCheckpoint(row.convergence.checkpoint).pending,false);
  const copiedNative=copied?.sourceToolDocuments?.find(item=>item.namespace===namespace&&item.title==='Own native V2');mapNeed(copiedNative,'Normal sparse fork Source absent');
  const forkClient=createLocalToolClient(copyId,two,{documentId:copiedNative.id,releaseHash:v2.contentHash,requireSelectedRelease:true});mapNeed(forkClient.state,'Fork state client unavailable');
  const forkEdit=await forkClient.state.apply(await forkClient.read(),[{type:'map-set',field:'checks',key:'fork',value:{label:'Empty fork first key',done:true}}]);
  equal('Normal empty semantic fork can author its first map key',mapData(forkEdit.snapshot.data).checks,{fork:{label:'Empty fork first key',done:true}});
  equal('JSON copy leaves all source-project domain rows exact',await sourceRows(),sourceBeforeCopies);
  equal('Source checkpoint remains exact after JSON copy',await current.convergence.export(),final);
  const preview=await mapPreviewDuplicate({projectId,title:'Own map duplicate'}),operationId='map-duplicate-'+crypto.randomUUID();operations.push(operationId);
  const duplicate=await mapDuplicateProject({projectId,title:'Own map duplicate',operationId,expectedSourceVersion:preview.sourceVersion});clones.push(duplicate.projectId);
  const duplicateProject=await db.projects.get(duplicate.projectId),duplicateRow=duplicateProject?.sourceToolDocuments?.find(item=>item.namespace===namespace&&item.title==='Existing notebook');mapNeed(duplicateRow?.convergence&&duplicateRow.codec,'Normal duplicate Source absent');
  equal('Duplicate uses admitted map/codec and a new causal fork',[duplicateRow.data,duplicateRow.codec,duplicateRow.convergence.checkpoint.genesisId===final.checkpoint?.genesisId],[final.snapshot.data,two.codec,false]);
  equal('Duplicate and JSON copy leave source/control unchanged',await current.convergence.export(),final);
  equal('Duplicate leaves complete source-project rows exact',await sourceRows(),sourceBeforeCopies);
  equal('All normal operations leave the independent control exact',JSON.stringify(await db.projects.get(controlId)),controlBefore);
  return checks;
 }finally{
  for(const id of clones)if(await db.projects.get(id))await deleteProject(id);
  for(const operation of operations){const key='projectDuplicate.operation.'+operation,row=await db.settings.get(key);if(row){const value:unknown=JSON.parse(row.value);mapNeed(mapRecord(value)&&value.sourceProjectId===projectId&&typeof value.projectId==='string'&&clones.includes(value.projectId),'Cleanup receipt is not owned by this fixture');await db.settings.delete(key);}}
  if(await db.projects.get(projectId))await deleteProject(projectId);
  if(await db.projects.get(controlId))await deleteProject(controlId);
  equal('Own map oracle cleanup89zero',(await Promise.all(db.tables.map(table=>table.count()))).every(x=>x===0)&&db.tables.length===89,true);
 }
}

// Additional public roots oracle after the immutable46931-byte e397 original.
import {prepareLocalToolReverse as mapReverse} from '@/engines/local/convergence/replica';

export async function testSourceMapAdditiveRoots(){
 const checks:string[]=[],namespace='tests.source-map-roots2455';
 const equal=(label:string,actual:unknown,expected:unknown)=>{mapNeed(convergenceCanonical(actual)===convergenceCanonical(expected),label+': '+JSON.stringify(actual));checks.push(label);};
 const one=defineLocalTool<Record<string,LocalToolJson>>({namespace,stateSchemaVersion:'1',name:{en:'Roots V1',es:'Raíces V1'},description:{en:'Own public roots fixture',es:'Prueba propia de raíces'},document:{defaultTitle:{en:'Own roots',es:'Raíces propias'}},codec:{version:1,fields:{name:{kind:'scalar'},other:{kind:'map'}}},initialState:{name:'Own roots',other:{}},validateState:(value):value is Record<string,LocalToolJson>=>mapRecord(value)&&typeof value.name==='string'&&mapRecord(value.other),component:()=>null});
 const from={namespace,codec:one.codec!,...localToolConvergenceContext(one)!};
 const two=defineLocalTool<Record<string,LocalToolJson>>({...one,stateSchemaVersion:'2',codec:{version:1,fields:{name:{kind:'scalar'},other:{kind:'map'},checks:{kind:'map'}}},sourceAdditive:{from,field:'checks',defaultValue:{}},initialState:{name:'Own roots',other:{},checks:{}},validateState:(value):value is Record<string,LocalToolJson>=>mapRecord(value)&&typeof value.name==='string'&&mapRecord(value.other)&&mapRecord(value.checks)});
 const contract={namespace,codec:two.codec!,...localToolConvergenceContext(two)!,validateState:two.validateState};
 const data={name:'Own roots',other:{}},legacy=createLocalToolGenesis(data,{...from,validateState:one.validateState});
 const promoted=prepareSourceAdditiveCheckpoint(legacy,data,from,contract),author=createLocalToolReplica(promoted,{authorId:'roots-author',contract});
 try{
  author.apply([{type:'map-set',field:'checks',key:'A',value:{label:'Preserve me',done:false}}]);
  const original=author.checkpoint(),originalData=author.read(),options={authorId:'normal-replacement',contract};
  const replacement=prepareLocalToolReplacement(original,options,data);mapNeed(replacement.receipt,'Normal replacement must provide receipt');
  equal('Public replacement of promoted map writes legitimate absence',replacement.data,data);
  equal('Definition-free reader accepts normal post-D presence',exportLocalToolConvergenceCheckpoint(replacement.checkpoint).pending,false);
  const removed=createLocalToolReplica(replacement.checkpoint,{authorId:'removed-reader',contract});
  try{equal('Normal post-D false presence keeps map absent',removed.read(),data);}finally{removed.destroy();}
  const undone=mapReverse(replacement.checkpoint,options,replacement.receipt);
  equal('Receipt Undo restores exact map after public replacement',undone.data,originalData);
  equal('Replacement and Undo preserve promoted causal origin',[replacement.checkpoint.genesisId,undone.checkpoint.genesisId],[promoted.genesisId,promoted.genesisId]);
  const hidden=createLocalToolReplica(original,{authorId:'scalar-wire-donor',contract});
  const receiver=createLocalToolReplica(original,{authorId:'scalar-wire-receiver',contract});
  const wire=new MapYDoc({gc:false});
  try{
   // Build one malformed wire witness from an ordinary public scalar edit. Never seed Source rows.
   hidden.apply([{type:'set',field:'name',value:'Post-D scalar witness'}]);
   const clean=hidden.checkpoint();mapYApply(wire,convergenceBytes(clean.checkpointBase64));
   const versions=wire.getMap<string>('register-versions');let changed=0;
   for(const [id,encoded]of versions){const version:unknown=JSON.parse(encoded);if(mapRecord(version)&&version.root==='scalar'&&version.key==='name'&&version.value==='Post-D scalar witness'){versions.set(id,JSON.stringify({...version,key:'checks'}));changed++;}}
   equal('Negative wire contains exactly one descriptor-incompatible post-D scalar',changed,1);
   const invalid={...clean,checkpointBase64:convergenceBase64(mapYEncode(wire)),stateVectorBase64:convergenceBase64(mapYVector(wire))};
   let readerRejected=false,importRejected=false;
   try{exportLocalToolConvergenceCheckpoint(invalid);}catch{readerRejected=true;}
   const before=receiver.checkpoint();
   try{receiver.receive({format:'writers-hoard-local-convergence-update/1',...convergenceIdentityOf(original),updateBase64:invalid.checkpointBase64});}catch{importRejected=true;}
   const exact=receiver.checkpoint().checkpointBase64===before.checkpointBase64;
   equal('Post-D scalar wire is rejected by definition-free export and atomic import',[readerRejected,importRejected,exact],[true,true,true]);
  }finally{wire.destroy();hidden.destroy();receiver.destroy();}
 }finally{author.destroy();}
 return checks;
}
