import {db} from '@/db';
import type {Project} from '@/types';
import type {EraDocumentKind} from '@/services/worldEras/types';
import {readWorldDocument,saveEraDocument,hideEraDocument} from '@/services/worldEras/store';
import {createLocalToolClient} from '@/engines/local/storage';
import type {LocalToolClientOptions} from '@/engines/local/storage';
import notebook from '@/engines/local/examples/documentNotebookDefinition';
import type {SourceToolDocument} from '@/engines/local/documents/types';
import {DEFAULT_PARAMS} from '@/engines/worldgen/core/types';
import {getAnchorAdapter} from '@/engines/_shared/anchoring';
import '@/engines/codex';

function assert(condition:unknown,message:string):asserts condition {if(!condition)throw Error(message);}
async function reject(run:Promise<unknown>,message:string){
  try{await run;}catch(reason){assert(reason instanceof Error&&reason.message===message,`Unexpected rejection: ${String(reason)}`);return;}
  throw Error(`Expected rejection ${message}`);
}
interface Dispatch {port:'navigate'|'beside';path:string}
const databaseSnapshot=async()=>JSON.stringify(await Promise.all(db.tables.map(async table=>({table:table.name,rows:await table.toArray()}))));

/** Resolution/dispatch only: these recorders never create panels or acknowledge a workspace guard. */
export async function testReviewLocalToolBesideDispatch():Promise<string[]>{
  const P=`beside-review-${crypto.randomUUID()}`,foreignP=`${P}-foreign`,eraId=`${P}-era`,cardId=`${P}-card`,hiddenId=`${P}-hidden`,sourceId=`${P}-source`,worldId=`${P}-world`;
  const scope={projectId:P,eraId},passed:string[]=[],calls:Dispatch[]=[];
  const record=(port:Dispatch['port'])=>(path:string)=>{calls.push({port,path});};
  const makeClient=(options:LocalToolClientOptions={})=>createLocalToolClient(P,notebook,{navigate:record('navigate'),openBeside:record('beside'),...options});
  const base=makeClient(),era=makeClient({eraId});
  const card=(id:string,projectId=P)=>({id,projectId,type:'place' as const,title:`Own ${id}`,content:'<p>Independent dispatch fixture.</p>',fields:{},tags:[],relations:[],createdAt:1,updatedAt:1});
  const source:SourceToolDocument={id:sourceId,namespace:notebook.namespace,title:'Own dispatch Source',revision:1,createdAt:1,updatedAt:1,data:structuredClone(notebook.initialState)};
  const project:Project={id:P,title:'Independent beside dispatch',type:'standalone',mode:'custom',color:'#d5b575',description:'',status:'draft',enabledEngines:['codex','worldgen',`local-tool-${notebook.namespace}`],engineOrder:['codex','worldgen',`local-tool-${notebook.namespace}`],createdAt:1,updatedAt:1,sourceToolDocuments:[source],worldEras:[{id:eraId,name:'Own era',description:'',revision:1,createdAt:1,updatedAt:1}]};
  const inspect=(entry:Dispatch,port:Dispatch['port'],engine:string,key:string,id:string,wantedEra?:string)=>{
    assert(entry?.port===port,`Wrong dispatch port for ${engine}: ${JSON.stringify(entry)}`);
    const route=new URL(entry.path,'https://independent.invalid');
    assert(route.pathname===`/project/${P}/${engine}`,`Wrong engine/project route: ${entry.path}`);
    assert(route.searchParams.get(key)===id,`Wrong logical target: ${entry.path}`);
    assert(route.searchParams.get('era')===(wantedEra??null),`Wrong captured era: ${entry.path}`);
  };
  try{
    await db.projects.put(project);
    await db.codexEntries.bulkPut([card(cardId),card(hiddenId),card(`${P}-foreign-card`,foreignP)]);
    await db.generatedWorlds.put({id:worldId,projectId:P,title:'Own dispatch world',params:structuredClone(DEFAULT_PARAMS),createdAt:1,updatedAt:1});
    for(const [kind,id,title]of [['codex',cardId,'Era card'],['local-tool',sourceId,'Era source'],['worldgen',worldId,'Era world']]as const){
      const before=await readWorldDocument(scope,kind,id);assert(before,`Missing own setup ${kind}`);
      await saveEraDocument(scope,kind,{...before.document,root:{...before.document.root,title}},before.version);
    }
    const hidden=await readWorldDocument(scope,'codex',hiddenId);assert(hidden,'Missing own hidden setup');
    await hideEraDocument(scope,'codex',hiddenId,hidden.version);
    const frozen=await databaseSnapshot();

    assert(getAnchorAdapter('codex'),'Real Codex anchor adapter was not registered');
    await base.openDocument('codex',cardId);
    await base.openDocument('codex',cardId,{});
    await base.refs.open({kind:'codex',documentId:cardId});
    await base.openDocument('codex',cardId,{placement:'beside'});
    await makeClient({openBeside:undefined}).openDocument('codex',cardId,{placement:'beside'});
    assert(calls.length===5,'Old/options/refs/fallback dispatched more than once');
    for(let i=0;i<5;i++)inspect(calls[i],i===3?'beside':'navigate','codex','entry',cardId);
    assert(calls[0].path===calls[1].path&&calls[1].path===calls[2].path&&calls[2].path===calls[3].path&&calls[3].path===calls[4].path,'Placement changed the resolved route');
    assert(await databaseSnapshot()===frozen,'Base dispatch changed database contents');
    passed.push('Independent real client: old omitted/empty options and refs.open keep navigate; explicit beside and missing-port fallback each dispatch the same route once without database writes');

    calls.length=0;
    for(const [kind,id,engine,key]of [['codex',cardId,'codex','entry'],['local-tool',sourceId,`local-tool-${notebook.namespace}`,'document'],['worldgen',worldId,'worldgen','world']]as const){
      const actualBase=await readWorldDocument({projectId:P},kind,id),actualEra=await readWorldDocument(scope,kind,id);
      assert(actualBase?.provenance==='base'&&actualEra?.provenance==='variant',`Scope did not resolve real Base/era ${kind}`);
      assert(actualBase.document.root.title!==actualEra.document.root.title,`Era title fixture is not distinct for ${kind}`);
      const start=calls.length;
      await base.openDocument(kind,id,{placement:'beside'});
      await era.openDocument(kind,id,{placement:'beside'});
      assert(calls.length===start+2,`Unexpected Source/worldgen/anchor dispatch count ${kind}`);
      inspect(calls[start],'beside',engine,key,id);
      inspect(calls[start+1],'beside',engine,key,id,eraId);
    }
    assert(await databaseSnapshot()===frozen,'Scoped dispatch changed database contents');
    passed.push('Independent effective scope: real Source namespace, worldgen resolver and Codex anchor routes retain logical IDs and distinguish Base from captured era without writes');

    calls.length=0;
    await reject(base.openDocument('codex',`${P}-missing`,{placement:'beside'}),'world_document_missing');
    await reject(base.openDocument('codex',`${P}-foreign-card`,{placement:'beside'}),'world_document_missing');
    assert(!await readWorldDocument(scope,'codex',hiddenId),'Hidden era target still resolved');
    await reject(era.openDocument('codex',hiddenId,{placement:'beside'}),'world_document_missing');
    assert(calls.length===0,'Unavailable target dispatched a callback');
    await base.openDocument('codex',hiddenId,{placement:'beside'});
    assert(calls.length===1,'Hidden variant incorrectly removed the Base target');
    inspect(calls[0],'beside','codex','entry',hiddenId);
    assert(await databaseSnapshot()===frozen,'Unavailable target checks changed database contents');
    passed.push('Independent unavailable targets: missing, foreign-project and hidden-era references reject before dispatch while the same hidden logical ID remains available in Base');

    calls.length=0;
    for(const [kind,id]of [['codex',cardId],['local-tool',sourceId],['worldgen',worldId]]as [EraDocumentKind,string][]){
      let live=true,currentChecks=0;
      const revoked=makeClient({eraId,isCurrent:()=>{currentChecks++;return live;}});
      const pending=revoked.openDocument(kind,id,{placement:'beside'});
      assert(currentChecks===1&&calls.length===0,`Call did not start live before its real asynchronous read: ${kind}`);
      live=false;
      await reject(pending,'local_tool_context_expired');
      assert(currentChecks>1&&calls.length===0,`Revoked ${kind} client dispatched after its real await`);
    }
    await era.openDocument('codex',cardId,{placement:'beside'});
    assert(calls.length===1,'Live control failed after revoked requests');
    inspect(calls[0],'beside','codex','entry',cardId,eraId);
    assert(await databaseSnapshot()===frozen,'Lease checks changed database contents');
    passed.push('Independent lifetime: three real asynchronous resolution branches reject clients revoked after entry but before completion; a current scoped client still dispatches once');
    return passed;
  }finally{
    await db.worldEraVariants.where('projectId').equals(P).delete();
    await db.generatedWorlds.where('projectId').equals(P).delete();
    await db.codexEntries.where('projectId').anyOf(P,foreignP).delete();
    await db.projects.delete(P);
  }
}
