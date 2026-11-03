import JSZip from 'jszip';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {createProjectZipArchive} from '@/services/zipBackup';
import {defineLocalTool,type LocalToolJson} from '@/engines/local/sdk';
import {registerLocalToolModules} from '@/engines/local/registry';
import {localToolReleaseIdentity,type LocalToolReleaseManifest} from '@/engines/local/releaseFormat.mjs';
import {pinLocalToolRelease,resolveProjectLocalTool} from '@/engines/local/releases';
import {createSourceToolDocument,readSourceToolDocument} from '@/engines/local/documents/store';
import {createLocalToolClient} from '@/engines/local/storage';
import {queryLocalToolDocuments} from '@/engines/local/queryDocuments';
import {localToolConvergenceContext} from '@/engines/local/convergence/context';
import {convergenceCanonical} from '@/engines/local/convergence/format';
import fixtureSource from './local-tool-source-additive.browser.ts?raw';

export async function testSourceAdditivePinAndRead(){
 const checks:string[]=[],projectId='own-additive-'+crypto.randomUUID(),scope={projectId},namespace='tests.source-additive';
 const equal=(label:string,actual:unknown,expected:unknown)=>{
  if(convergenceCanonical(actual)!==convergenceCanonical(expected))throw Error(label);
  checks.push(label);Reflect.set(window,'__testStage',label);
 };
 const empty=async()=>{const counts=await Promise.all(db.tables.map(table=>table.count()));return counts.length===89&&counts.every(count=>count===0);};
 const text=(value:LocalToolJson):value is Record<string,LocalToolJson>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.name==='string';
 const one=defineLocalTool({
  namespace,stateSchemaVersion:'1',name:{en:'Additive V1',es:'Aditivo V1'},description:{en:'Own V1',es:'V1 propio'},
  document:{defaultTitle:{en:'Own Source',es:'Source propio'}},codec:{version:1,fields:{name:{kind:'scalar'}}},
  index:{version:1,fields:{name:{path:'$.name',type:'string'}}},initialState:{name:'Initial name'},
  validateState:(value):value is Record<string,LocalToolJson>=>text(value)&&!!value.name,component:()=>null,
 });
 const sourceAdditive={from:{namespace,codec:one.codec!,...localToolConvergenceContext(one)!},field:'habitat',defaultValue:'Coast'};
 const two=defineLocalTool({
  ...one,stateSchemaVersion:'2',name:{en:'Additive V2',es:'Aditivo V2'},
  codec:{version:1,fields:{name:{kind:'scalar'},habitat:{kind:'scalar'}}},
  index:{version:1,fields:{name:{path:'$.name',type:'string'},habitat:{path:'$.habitat',type:'string'}}},
  initialState:{name:'Initial name',habitat:'Coast'},...{sourceAdditive},
  validateState:(value):value is Record<string,LocalToolJson>=>text(value)&&typeof value.habitat==='string',
 });
 const bytes=new TextEncoder().encode(fixtureSource);
 const sha=async(data:Uint8Array<ArrayBuffer>)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(value=>value.toString(16).padStart(2,'0')).join('');
 const files=[{path:'module.tsx',sha256:await sha(bytes),bytes:bytes.length}];
 const manifest=async(version:string):Promise<LocalToolReleaseManifest>=>{
  const identity={format:'writers-hoard-local-tool-source/1',apiVersion:1,namespace,version,files} as const;
  return {...identity,contentHash:await sha(new TextEncoder().encode(localToolReleaseIdentity(identity)))};
 };
 const [v1,v2]=await Promise.all([manifest('1.0.0'),manifest('2.0.0')]);
 const release=(item:LocalToolReleaseManifest)=>'./installed/'+namespace+'/versions/'+item.contentHash;
 registerLocalToolModules({[release(v1)+'/module.tsx']:{default:one},[release(v2)+'/module.tsx']:{default:two}},{[release(v1)+'/release.json']:v1,[release(v2)+'/release.json']:v2});
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
  const read=()=>readSourceToolDocument(scope,documentId,namespace);
  const history=async()=>JSON.stringify(await db.documentHistory.where('projectId').equals(projectId).toArray(),(_key,value)=>value===undefined?{testUndefined:true}:value);
  const before=await read(),historyBefore=await history(),rawExport=await old.convergence!.export();
  equal('V1 durable export is engine1 and sparse',[rawExport.checkpoint?.engine.version,rawExport.snapshot.data],['1',{name:'Saved Ω🙂'}]);
  equal('V1 created real history',JSON.parse(historyBefore).length>0,true);
  const durableIndex=await queryLocalToolDocuments(scope,{namespace});
  equal('V1 index observes saved name',durableIndex[0].fields,{name:'Saved Ω🙂'});
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
 }finally{
  if(await db.projects.get(projectId))await deleteProject(projectId);
  equal('private library cleanup89zero',await empty(),true);
 }
 return checks;
}
