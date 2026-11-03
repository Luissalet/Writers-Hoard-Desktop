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
