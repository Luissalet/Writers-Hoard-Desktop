/**
 * Task2370 r2: prepared TEXT ONLY; not parsed, compiled, imported or executed.
 * All imports and TypeScript members below exist on main a47420a6.
 * Future inputs are plain ToolArgs data through the public renderer dispatcher.
 * This is NOT authenticated Native/MCP evidence or a mounted map-panel test.
 */
import '@/engines';
import {createProject,deleteProject} from '@/db/operations';
import {worldMapOps} from '@/engines/maps/operations';
import {defineLocalTool,type LocalToolJson,type LocalToolDocumentReference} from '@/engines/local/sdk';
import {registerLocalToolModules} from '@/engines/local/registry';
import {runBridgeTool,type BridgeReply} from '@/services/aiBridge/dispatch';
import {getBridgeTool} from '@/services/aiBridge/manifest';
import {validateToolArgs} from '@/services/aiRuntime/toolPolicy';
import {readProjectDuplicate} from '@/services/projectDuplicate/capture';

type Dict=Record<string,unknown>;
type SeedState={target:LocalToolDocumentReference|null;counter:number;note:string};
const isRecord=(value:unknown):value is Dict=>!!value&&typeof value==='object'&&!Array.isArray(value);
const need:(value:unknown,label:string)=>asserts value=(value,label)=>{if(!value)throw Error(label);};
function requireRecord(value:unknown,label:string):Dict{need(isRecord(value),label);return value;}
function requireString(value:unknown,label:string):string{need(typeof value==='string'&&!!value,label);return value;}
/** Sort OBJECT keys only; retain every field, undefined, nested value and array order. */
function canonical(value:unknown):string{
 if(value===undefined)return 'undefined';
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(isRecord(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
 throw Error('Unexpected non-JSON fixture snapshot');
}
const same=(left:unknown,right:unknown)=>canonical(left)===canonical(right);
const errorText=(error:unknown)=>error instanceof Error?error.stack??error.message:String(error);
const rejectedNote='AUTHOR_REJECT_THIS_NOTE';
function validSeed(value:LocalToolJson):value is SeedState{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const target=value.target;
 return typeof value.note==='string'&&value.note!==rejectedNote&&
  typeof value.counter==='number'&&Number.isSafeInteger(value.counter)&&
  (target===null||!!target&&typeof target==='object'&&!Array.isArray(target)&&
   (target.kind==='maps'||target.kind==='worldgen')&&typeof target.documentId==='string'&&!!target.documentId);
}

/** Execute ONLY after Root approves this exact text and a private normal renderer runner. */
export async function oraclePublicCreation(){
 const suffix=crypto.randomUUID(),namespace='tests.map-seed-'+suffix;
 const projectId='qa-map-seed-'+suffix,controlId='qa-map-control-'+suffix,mapId='qa-map-'+suffix;
 const literal='Own literal '+mapId+' | maps:not-a-reference | <b>text</b> | áé ñ 漢字 🧭\nsecond line';
 const definition=defineLocalTool<SeedState>({
  namespace,name:{en:'Map seed oracle',es:'Oráculo de creación'},
  description:{en:'Ordinary Source document creation control',es:'Control normal de creación Source'},
  document:{defaultTitle:{en:'Own document',es:'Documento propio'}},
  codec:{version:1,fields:{target:{kind:'reference'},counter:{kind:'scalar'},note:{kind:'prose'}}},
  initialState:{target:null,counter:0,note:literal},validateState:validSeed,component:()=>null,
 });
 // Deliberately an ordinary current Source tool: NO future descriptor/context/import.
 const checks:{label:string;ok:boolean;detail?:unknown}[]=[];
 const calls:{tool:string;args:Dict;reply:BridgeReply}[]=[];
 const snapshots:{label:string;source:string;control:string}[]=[];
 const observations:Dict={schema:null,mapCatalogueSchema:null};
 const cleanup:{projectId:string;deleted:boolean;absent:boolean;error?:string}[]=[];
 const created:string[]=[];
 const expect=(label:string,ok:boolean,detail?:unknown)=>{checks.push({label,ok,...(detail===undefined?{}:{detail})});};
 const call=async(tool:string,args:Dict)=>{
  const reply=await runBridgeTool(tool,args);
  calls.push({tool,args:structuredClone(args),reply:structuredClone(reply)});
  return reply;
 };
 const success=(reply:BridgeReply,label:string):Dict=>{need(reply.ok,label+': '+reply.error);return requireRecord(reply.result,label+' result');};
 const capture=async(label:string)=>{
  const snapshot={label,source:canonical(await readProjectDuplicate(projectId)),control:canonical(await readProjectDuplicate(controlId))};
  snapshots.push(snapshot);return snapshot;
 };
 const base={projectId,namespace};
 const target={kind:'maps',documentId:mapId};
 const goodArgs:Dict={...base,title:'Bound in one creation',initialActions:[
  {type:'set',field:'target',value:target},{type:'set',field:'counter',value:7},
 ]};
 let fatal:string|undefined;
 try{
  registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:definition}});
  for(const id of [projectId,controlId]){
   const now=Date.now();
   await createProject({id,title:id===projectId?'Own source fixture':'Own control fixture',description:'Synthetic own data',
    mode:'custom',type:'standalone',status:'draft',color:'#777777',
    enabledEngines:['maps','local-tool-'+namespace],engineOrder:['maps','local-tool-'+namespace],createdAt:now,updatedAt:now});
   created.push(id);
  }
  const now=Date.now();
  await worldMapOps.create({id:mapId,projectId,title:'Own map',createdAt:now,updatedAt:now});

  // Existing three-argument semantics are a mandatory baseline control.
  const ordinary=success(await call('wh_local_tool_document_create',{...base,title:'Ordinary current creator'}),'ordinary create');
  const ordinaryId=requireString(ordinary.id,'ordinary id');
  expect('ordinary creation is revision1 with exact defaults',ordinary.revision===1&&same(ordinary.data,definition.initialState),ordinary);
  const ordinaryRead=success(await call('wh_local_tool_read',{...base,documentId:ordinaryId}),'ordinary read');
  expect('ordinary public read retains exact defaults',same(ordinaryRead.data,definition.initialState),ordinaryRead);

  // A real pre-existing receipt in a second private project must remain usable.
  const controlBase={projectId:controlId,namespace};
  const control=success(await call('wh_local_tool_document_create',{...controlBase,title:'Receipt control'}),'control create');
  const controlDocumentId=requireString(control.id,'control document id');
  const controlArgs={...controlBase,documentId:controlDocumentId};
  const controlRead=success(await call('wh_local_tool_read',controlArgs),'control read');
  const applied=success(await call('wh_local_tool_state_apply',{...controlArgs,baseline:controlRead,actions:[{type:'set',field:'counter',value:1}]}),'control apply');
  const receiptId=requireString(applied.receiptId,'real normal receipt');
  expect('receipt control applied counter1',isRecord(applied.snapshot)&&isRecord(applied.snapshot.data)&&applied.snapshot.data.counter===1,applied);
  const controlBeforeInitial=canonical(await readProjectDuplicate(controlId));

  // Current normalizer drops unknown keys; declaring a schema is insufficient
  // unless its normalized output preserves the complete ordered actions.
  const createTool=getBridgeTool('wh_local_tool_document_create');
  need(createTool,'current create manifest entry');
  const normalized=validateToolArgs(createTool.schema,structuredClone(goodArgs));
  observations.schema={tool:createTool,normalized,input:structuredClone(goodArgs)};
  expect('create manifest exposes initialActions',Object.hasOwn(createTool.schema.properties,'initialActions'));
  expect('normalizer preserves initialActions exactly',normalized.ok&&same(normalized.args.initialActions,goodArgs.initialActions),normalized);

  // Dispatch the original input separately: schema loss must not hide a handler
  // which silently ignores actions. No claim of full MCP execution is made.
  const boundReply=await call('wh_local_tool_document_create',goodArgs);
  expect('initial-actions creation succeeds',boundReply.ok,boundReply);
  if(boundReply.ok){
   const bound=requireRecord(boundReply.result,'bound result');
   expect('initial creation remains revision1',bound.revision===1,bound);
   expect('initial set actions commit with exact literal note',same(bound.data,{target,counter:7,note:literal}),bound.data);
   expect('initial creation stores existing portable codec',same(bound.codec,definition.codec),bound.codec);
   const boundId=requireString(bound.id,'bound id');
   const read=success(await call('wh_local_tool_read',{...base,documentId:boundId}),'bound public read');
   expect('normal read agrees with initially committed data',same(read.data,{target,counter:7,note:literal})&&read.revision===1,read);
  }
  expect('successful initial creation leaves control project exact',canonical(await readProjectDuplicate(controlId))===controlBeforeInitial);

  const negatives:{label:string;actions:unknown[]}[]=[
   {label:'undeclared second field',actions:[{type:'set',field:'target',value:target},{type:'set',field:'notDeclared',value:1}]},
   {label:'codec-invalid reference after a valid set',actions:[{type:'set',field:'counter',value:9},{type:'set',field:'target',value:{kind:'maps',documentId:42}}]},
   {label:'author-validator rejection after a valid set',actions:[{type:'set',field:'target',value:target},{type:'set',field:'note',value:rejectedNote}]},
  ];
  for(const negative of negatives){
   const before=await capture('before '+negative.label);
   const reply=await call('wh_local_tool_document_create',{...base,title:'Must not remain: '+negative.label,initialActions:negative.actions});
   const after=await capture('after '+negative.label);
   expect(negative.label+': refusal',reply.ok===false&&typeof reply.error==='string',reply);
   expect(negative.label+': no public success result or receipt',!Object.hasOwn(reply,'result')&&!Object.hasOwn(reply,'receiptId'),reply);
   expect(negative.label+': complete source snapshot unchanged',before.source===after.source);
   expect(negative.label+': complete control snapshot unchanged',before.control===after.control);
  }

  const undone=success(await call('wh_local_tool_state_undo',{...controlArgs,receiptId}),'normal control Undo after failed creations');
  expect('pre-existing receipt survives failures and restores its own data',isRecord(undone.snapshot)&&same(undone.snapshot.data,definition.initialState),undone);
  const controlFinal=success(await call('wh_local_tool_read',controlArgs),'control final read');
  expect('normal control read after Undo retains literal',same(controlFinal.data,definition.initialState),controlFinal);

  // Future catalogue is queried by its string name, through today's dispatcher.
  // Baseline unknown-tool is an expected functional RED, not a compile failure.
  const catalogueBefore=await capture('before contextual catalogue');
  const catalogueTool=getBridgeTool('wh_local_tool_map_list');
  observations.mapCatalogueSchema=catalogueTool??null;
  expect('map catalogue has a real readonly manifest entry',!!catalogueTool&&catalogueTool.writes===false,catalogueTool??null);
  const catalogue=await call('wh_local_tool_map_list',{projectId,target});
  expect('map catalogue is implemented instead of unknown-tool',catalogue.ok,catalogue);
  if(catalogue.ok){
   const result=requireRecord(catalogue.result,'catalogue result');
   const tools=result.tools;
   expect('contextual catalogue returns tools array',Array.isArray(tools),tools);
   expect('ordinary non-opt-in tool is excluded',Array.isArray(tools)&&tools.every(item=>isRecord(item)&&item.namespace!==namespace),tools);
  }
  const catalogueAfter=await capture('after contextual catalogue');
  expect('readonly catalogue does not mutate source or control',catalogueBefore.source===catalogueAfter.source&&catalogueBefore.control===catalogueAfter.control);
 }catch(error){fatal=errorText(error);}
 finally{
  for(const id of [...created].reverse()){
   const row:{projectId:string;deleted:boolean;absent:boolean;error?:string}={projectId:id,deleted:false,absent:false};
   try{
    await deleteProject(id);row.deleted=true;
    try{await readProjectDuplicate(id);}catch(error){if(error instanceof Error&&error.message==='project_duplicate_source_missing')row.absent=true;else throw error;}
    if(!row.absent)throw Error('Own project remained after normal deletion');
   }catch(error){row.error=errorText(error);}
   cleanup.push(row);
  }
 }
 const receipt={format:'writers-map-seed-oracle/1',task:2370,preparationRevision:2,namespace,projectId,controlId,mapId,
  literal,checks,calls,snapshots,observations,cleanup,fatal:fatal??null,
  limits:['public renderer dispatcher, not authenticated MCP','ordinary current tool, no positive mapPanel mount','no private receipt-map or native audit inspection']};
 console.log('MAP_SEED_ORACLE_RECEIPT '+JSON.stringify(receipt));
 const failed=checks.filter(check=>!check.ok);
 if(fatal||failed.length||cleanup.some(row=>!row.deleted||!row.absent||row.error))throw Object.assign(Error('map seed oracle failed: '+failed.map(check=>check.label).join('; ')),{receipt});
 return receipt;
}

/**
 * Source2382 FUTURE SOURCE TEST APPEND BODY. TEXT ONLY: not parsed/executed.
 * Append AFTER the immutable public r2 prefix in local-tool-map-context.browser.tsx.
 * All identifiers/imports are mh2382-prefixed; the raw import deliberately names
 * the FINAL test module, following local-tool-source-additive.browser.ts.
 *
 * Focal DOM surface is the REAL MapToolWorkspace -> LocalToolDocumentHost tree.
 * The author below only receives clients/context from that tree. No authority,
 * client lifetime predicate, SourceDoc, pin row or fake content hash is injected.
 * Parent handles initialActions/portability and full-engine regression oracles.
 * These tests do not claim Browser/Native, geometry, paint or shell-era retention.
 *
 * Visible DOM contract for the future panel: [data-map-tool-workspace],
 * select[data-map-tool-namespace], input[data-map-tool-create-title],
 * button[data-map-tool-create], button[data-map-tool-document=<real id>].
 * Recovery/Fullscreen use their actual visible labels, not private handlers.
 */
import Mh2382Dexie from 'dexie';
import {StrictMode as Mh2382StrictMode,act as mh2382Act,useEffect as mh2382UseEffect,useLayoutEffect as mh2382UseLayoutEffect,useRef as mh2382UseRef,useState as mh2382UseState} from 'react';
import {createRoot as mh2382CreateRoot} from 'react-dom/client';
import {flushSync as mh2382FlushSync} from 'react-dom';
import {MemoryRouter as Mh2382MemoryRouter} from 'react-router-dom';
import {useLiveQuery as mh2382UseLiveQuery} from 'dexie-react-hooks';
import {db as mh2382Db} from '@/db';
import {createProject as mh2382CreateProject,deleteProject as mh2382DeleteProject} from '@/db/operations';
import {worldMapOps as mh2382MapOps,captureMapVersion as mh2382CaptureVersion} from '@/engines/maps/operations';
import {readWorldDocument as mh2382ReadWorld,saveWorldEra as mh2382SaveEra,hideEraDocument as mh2382HideEra,saveEraDocument as mh2382SaveEraDocument} from '@/services/worldEras/store';
import type {WorldEraScope as Mh2382Scope} from '@/services/worldEras/types';
import {readProjectDuplicate as mh2382ReadProject} from '@/services/projectDuplicate/capture';
import {defineLocalTool as mh2382Define,type LocalToolJson as Mh2382Json,type LocalToolProps as Mh2382Props,type LocalToolClient as Mh2382Client,type LocalToolHostContext as Mh2382Context} from '@/engines/local/sdk';
import {registerLocalToolModules as mh2382Register} from '@/engines/local/registry';
import {pinLocalToolRelease as mh2382Pin,resolveProjectLocalTool as mh2382Resolve} from '@/engines/local/releases';
import {localToolReleaseIdentity as mh2382ReleaseIdentity,type LocalToolReleaseManifest as Mh2382Manifest} from '@/engines/local/releaseFormat.mjs';
import {createSourceToolDocument as mh2382CreateDocument,readSourceToolDocument as mh2382ReadDocument,listSourceToolDocuments as mh2382ListDocuments} from '@/engines/local/documents/store';
import Mh2382DocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import Mh2382MapWorkspace from '@/engines/local/mapTools/MapToolWorkspace';
import {listLocalMapTools as mh2382ListTools} from '@/engines/local/mapTools/catalog';
import type {LocalToolMapTarget as Mh2382Target} from '@/engines/local/mapTools/contracts';
import {useLocalToolAtomPending as mh2382UsePending} from '@/engines/local/blocks/pending';
import {getPendingWritesSnapshot as mh2382Pending,flushPendingWrites as mh2382Flush} from '@/services/pendingWrites';
import {PendingWriteStatus as Mh2382PendingStatus} from '@/components/common/PendingWritesHost';
import mh2382FixtureSource from './local-tool-map-context.browser.tsx?raw';

type Mh2382State={target:Mh2382Target|null;nextTarget:Mh2382Target|null;note:string;reviewedVersion:string|null;counter:number};
type Mh2382Emission={client:Mh2382Client<Mh2382State>;context:Mh2382Context;instance:string};
const mh2382Emitted=new Map<string,Mh2382Emission>();
const mh2382Need:(value:unknown,message:string)=>asserts value=(value,message)=>{if(!value)throw Error(message);};
function mh2382Canonical(value:unknown):string{
 if(value===undefined)return 'undefined';
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(mh2382Canonical).join(',')+']';
 mh2382Need(typeof value==='object','Non-JSON domain snapshot');
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+mh2382Canonical((value as Record<string,unknown>)[key])).join(',')+'}';
}
const mh2382Tick=()=>new Promise(resolve=>setTimeout(resolve,20));
async function mh2382Wait(check:()=>boolean,label:string){
 for(let attempt=0;attempt<200;attempt++){if(check())return;await mh2382Act(async()=>{await mh2382Tick();});}
 throw Error(label+'; live DOM: '+document.body.innerHTML);
}
async function mh2382Refused(action:()=>Promise<unknown>,label:string){
 let error:unknown;try{await action();}catch(reason){error=reason;}
 mh2382Need(error!==undefined,label+' unexpectedly succeeded');
 // Exact error spelling is not the authority oracle: full durable equality and
 // a fresh normal-client success below distinguish refusal from broken storage.
 return String(error);
}
let mh2382ObservedBlocker:typeof Mh2382Dexie.currentTransaction;
async function mh2382Click(button:HTMLButtonElement){
 mh2382Need(!button.disabled,'Attempted disabled UI control: '+button.textContent);
 await mh2382Act(async()=>{Mh2382Dexie.ignoreTransaction(()=>{if(mh2382ObservedBlocker)console.info('MAP_CONTEXT_QUEUE_OBSERVATION '+JSON.stringify({phase:'dom-click',label:button.textContent,ambient:!!Mh2382Dexie.currentTransaction,sameBlocker:Mh2382Dexie.currentTransaction===mh2382ObservedBlocker,parentIsBlocker:Mh2382Dexie.currentTransaction?.parent===mh2382ObservedBlocker}));button.click();});await mh2382Tick();});
}
async function mh2382Input(input:HTMLInputElement|HTMLTextAreaElement,value:string){
 await mh2382Act(async()=>{
  const prototype=input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(input,value);
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
 });
}
function mh2382Button(root:ParentNode,pattern:RegExp):HTMLButtonElement{
 const button=[...root.querySelectorAll<HTMLButtonElement>('button')].find(item=>pattern.test(item.textContent?.trim()??''));
 mh2382Need(button,'Visible button missing: '+pattern);return button;
}
function mh2382Element<T extends Element>(root:ParentNode,selector:string):T{
 const element=root.querySelector<T>(selector);mh2382Need(element,'DOM control absent: '+selector);return element;
}
const mh2382Key=(documentId:string,view:string)=>documentId+':'+view;

/** Ordinary author editor with real SDK pending reporting and author recovery.
 * Draft state is component state, never copied into a test flusher or a store.
 */
function Mh2382Author({client,context}:Mh2382Props<Mh2382State>){
 mh2382Need(context?.document,'Author did not receive the real host context');
 const [instance]=mh2382UseState(()=>crypto.randomUUID()),[draft,setDraft]=mh2382UseState(''),[dirty,setDirty]=mh2382UseState(false),[error,setError]=mh2382UseState('');
 const dirtyNow=mh2382UseRef(false),key=mh2382Key(context.document.id,context.view);
 mh2382UsePending(dirty);
 mh2382UseLayoutEffect(()=>{
  const emitted={client,context,instance};mh2382Emitted.set(key,emitted);
  return()=>{if(mh2382Emitted.get(key)===emitted)mh2382Emitted.delete(key);};
 },[client,context,key,instance]);
 mh2382UseEffect(()=>{
  let alive=true;
  const refresh=()=>void client.read().then(saved=>{if(alive&&!dirtyNow.current)setDraft(saved.data.note);}).catch(()=>{});
  refresh();const off=client.subscribe?.(refresh);return()=>{alive=false;off?.();};
 },[client]);
 const discard=async()=>{const saved=await client.read();dirtyNow.current=false;setDirty(false);setDraft(saved.data.note);setError('');};
 const save=async()=>{try{await client.state!.apply(await client.read(),[{type:'set',field:'note',value:draft}]);dirtyNow.current=false;setDirty(false);setError('');}catch(reason){setError(String(reason));}};
 return <section data-mh-author={key} data-mh-instance={instance}>
  <label>Author note<textarea aria-label="Author note" value={draft} readOnly={!context.canEdit} onChange={event=>{dirtyNow.current=true;setDirty(true);setDraft(event.target.value);}}/></label>
  <button type="button" disabled={!context.canEdit||!dirty} onClick={()=>void save()}>Save author note</button>
  <button type="button" disabled={!dirty} onClick={()=>void discard()}>Discard author draft</button>
  <output data-mh-pending={dirty?'yes':'no'}>{error}</output>
 </section>;
}

async function mh2382Releases(namespace:string){
 const valid=(value:Mh2382Json):value is Mh2382State=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const target=(entry:Mh2382Json|undefined)=>entry===null||!!entry&&typeof entry==='object'&&!Array.isArray(entry)&&(entry.kind==='maps'||entry.kind==='worldgen')&&typeof entry.documentId==='string';
  return target(value.target)&&target(value.nextTarget)&&typeof value.note==='string'&&typeof value.counter==='number'&&(value.reviewedVersion===null||typeof value.reviewedVersion==='string');
 };
 const definition=(targetField:'target'|'nextTarget')=>mh2382Define<Mh2382State>({
  namespace,name:{en:'Host review fixture',es:'Prueba de revisión'},description:{en:'Normal compiled map author',es:'Autor de mapa compilado normal'},
  document:{defaultTitle:{en:'Review',es:'Revisión'},embed:'interactive'},
  initialState:{target:null,nextTarget:null,note:'Saved own note Ω',reviewedVersion:null,counter:0},
  codec:{version:1,fields:{target:{kind:'reference'},nextTarget:{kind:'reference'},note:{kind:'prose'},reviewedVersion:{kind:'scalar'},counter:{kind:'scalar'}}},
  preview:{version:1,fields:[{key:'note',label:{en:'Note',es:'Nota'}}]},
  mapPanel:{version:1,targetField,kinds:['maps','worldgen']},validateState:valid,component:Mh2382Author,
 });
 const bytes=new TextEncoder().encode(mh2382FixtureSource);
 const sha=async(value:Uint8Array<ArrayBuffer>)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',value))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 const files=[{path:'module.tsx',sha256:await sha(bytes),bytes:bytes.length}];
 const manifest=async(version:string):Promise<Mh2382Manifest>=>{
  const identity={format:'writers-hoard-local-tool-source/1',apiVersion:1,namespace,version,files} as const;
  return {...identity,contentHash:await sha(new TextEncoder().encode(mh2382ReleaseIdentity(identity)))};
 };
 const [a,b]=await Promise.all([manifest('2382.1'),manifest('2382.2')]);
 const path=(release:Mh2382Manifest)=>'./installed/'+namespace+'/versions/'+release.contentHash;
 mh2382Register({[path(a)+'/module.tsx']:{default:definition('target')},[path(b)+'/module.tsx']:{default:definition('nextTarget')}},{[path(a)+'/release.json']:a,[path(b)+'/release.json']:b});
 return {a,b};
}

type Mh2382HarnessProps={scope:Mh2382Scope;mapId:string;otherMapId:string;foreignId:string;foreignScope:Mh2382Scope;namespace:string;previewId?:string;closed?:boolean};
/** Actual selection + real effective reads; wrapper itself emits authority.
 * The parent-controlled previewId is resolved against a real captured version,
 * just as MapsEngine computes previewVersion/readOnly. No fake mapContext.
 */
function Mh2382Harness(props:Mh2382HarnessProps){
 const [selected,setSelected]=mh2382UseState<Mh2382Target>({kind:'maps',documentId:props.mapId});
 const effective=mh2382UseLiveQuery(()=>mh2382ReadWorld(props.scope,'maps',selected.documentId),[props.scope.projectId,props.scope.eraId,selected.documentId]);
 const versions=effective?.document.root.versions as {id:string}[]|undefined;
 const preview=versions?.find(version=>version.id===props.previewId);
 return <><Mh2382PendingStatus/>
  {!props.closed&&<Mh2382MapWorkspace scope={props.scope} kind="maps" target={effective?selected:null} readOnly={!!preview} presentation={preview?{kind:'map-version',versionId:preview.id}:{kind:'current'}} onSelectTarget={setSelected}>
   {({requestChange})=><section data-mh-canvas-selection={selected.documentId}>
    <button type="button" data-mh-select-a onClick={()=>void requestChange(()=>setSelected({kind:'maps',documentId:props.mapId}))}>Select A</button>
    <button type="button" data-mh-select-b onClick={()=>void requestChange(()=>setSelected({kind:'maps',documentId:props.otherMapId}))}>Select B</button>
   </section>}
  </Mh2382MapWorkspace>}
  <aside data-mh-foreign><Mh2382DocumentHost projectId={props.foreignScope.projectId} eraId={props.foreignScope.eraId} documentId={props.foreignId} namespace={props.namespace}/></aside>
 </>;
}

/** Three bounded cases, each repeated in Base and actual era E.
 * Invocation is the future runner's responsibility, AFTER source GO.
 */
export async function oracleMapWorkspaceHosts(){return mh2382Scenario('lifetime');}
export async function oracleMapWorkspaceRecovery(){return mh2382Scenario('recovery');}
export async function oracleMapWorkspacePins(){return mh2382Scenario('pins');}

async function mh2382Scenario(mode:'lifetime'|'recovery'|'pins'|'dispatch'|'admission'){
 const checks:string[]=[];
 for(const inEra of [false,true]){
  const suffix=crypto.randomUUID(),projectId='mh2382-'+suffix,controlId='mh2382-control-'+suffix,namespace='tests.mh2382-'+suffix;
  const scope:Mh2382Scope={projectId,...(inEra?{eraId:'own-e'}:{})},mapId='mh-A-'+suffix,otherMapId='mh-B-'+suffix;
  const mount=document.createElement('div');document.body.append(mount);const root=mh2382CreateRoot(mount);
  const check=(value:unknown,label:string)=>{mh2382Need(value,(inEra?'E: ':'Base: ')+label);checks.push((inEra?'E: ':'Base: ')+label);};
  const snapshot=async()=>mh2382Canonical({source:await mh2382ReadProject(projectId),control:await mh2382ReadProject(controlId)});
  const settled=async()=>{const result=await mh2382Flush();check(result.ok,'normal pending ledger settles');};
  let releaseHeld:(()=>void)|undefined,unobserveQueue:(()=>void)|undefined;
  try{
   const releases=await mh2382Releases(namespace),now=Date.now();
   for(const id of [projectId,controlId])await mh2382CreateProject({id,title:id,description:'Private synthetic host oracle',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['maps','local-tool-'+namespace],engineOrder:['maps','local-tool-'+namespace],createdAt:now,updatedAt:now});
   for(const id of [mapId,otherMapId])await mh2382MapOps.create({id,projectId,title:id===mapId?'Map A':'Map B',createdAt:now,updatedAt:now});
   if(inEra)await mh2382SaveEra(projectId,{id:scope.eraId!,name:'Own E',description:'Own era',revision:0,createdAt:now,updatedAt:now},null);
   const versionId=await mh2382CaptureVersion(mapId,{name:'Actual saved preview',date:''},scope);
   let pin=await mh2382Pin(projectId,namespace,releases.a.contentHash,null);
   const foreignScope={projectId:controlId};await mh2382Pin(controlId,namespace,releases.a.contentHash,null);
   const foreign=await mh2382CreateDocument(foreignScope,namespace,'Independent ordinary Source');
   // Control data/receipt is authored through its normal client emitted below,
   // never a fabricated state or insertion. Control project is also snapshotted.
   let props:Mh2382HarnessProps={scope,mapId,otherMapId,foreignId:foreign.id,foreignScope,namespace};
   const tree=()=> <Mh2382StrictMode><Mh2382MemoryRouter><Mh2382Harness {...props}/></Mh2382MemoryRouter></Mh2382StrictMode>;
   const render=async(change:Partial<Mh2382HarnessProps>={})=>{props={...props,...change};await mh2382Act(async()=>{root.render(tree());});};
   const previewNow=()=>{props={...props,previewId:versionId};mh2382FlushSync(()=>root.render(tree()));};
   const panel=()=>mh2382Element<HTMLElement>(mount,'[data-map-tool-workspace]');
   const title=()=>mh2382Element<HTMLInputElement>(panel(),'input[data-map-tool-create-title]');
   const create=()=>mh2382Element<HTMLButtonElement>(panel(),'button[data-map-tool-create]');
   const emit=(id:string,view='editor')=>mh2382Emitted.get(mh2382Key(id,view));
   const author=(id:string,view='editor')=>mh2382Element<HTMLElement>(document,`[data-mh-author="${mh2382Key(id,view)}"]`);
   const note=(id:string,view='editor')=>mh2382Element<HTMLTextAreaElement>(author(id,view),'textarea');
   const boundDocs=async()=> (await mh2382ListDocuments(scope,namespace)).filter(row=>(row.data as Mh2382State).target?.documentId===mapId);
   await render();
   await mh2382Wait(()=>[...mount.querySelectorAll<HTMLOptionElement>('select[data-map-tool-namespace] option')].some(option=>option.value===namespace&&!option.disabled)&&!!emit(foreign.id),'Real panel and ordinary author did not mount');
   const select=mh2382Element<HTMLSelectElement>(panel(),'select[data-map-tool-namespace]');
   await mh2382Act(async()=>{select.value=namespace;select.dispatchEvent(new Event('change',{bubbles:true}));});
   await mh2382Wait(()=>!!panel().querySelector('input[data-map-tool-create-title]'),'Selected namespace create form absent');await mh2382Input(title(),'First map review');await mh2382Wait(()=>!create().disabled,'Actual map binding not ready for Create');await mh2382Wait(()=>!create().disabled,'Current real binding did not enable Create');await mh2382Click(create());
   await mh2382Wait(()=>[...mh2382Emitted.values()].some(entry=>entry.context.map?.target.documentId===mapId),'Create did not mount normal contextual author');
   const documents=await boundDocs();check(documents.length===1&&documents[0].revision===1,'visible Create produces one bound revision1');
   const documentId=documents[0].id;
   await mh2382Wait(()=>!!emit(documentId)?.context.canEdit,'Real map author is not editable');
   const read=async()=> (await mh2382ReadDocument(scope,documentId,namespace))!;
   const initial=emit(documentId)!;
   check(initial.context.map?.target.kind==='maps'&&initial.context.map.target.documentId===mapId&&initial.context.scope.eraId===scope.eraId,'wrapper emits effective target and actual scope');
   const effectiveMap=(await mh2382ReadWorld(scope,'maps',mapId))!;
   check(initial.context.map?.targetVersion===effectiveMap.version&&initial.context.map.title===effectiveMap.document.root.title&&initial.context.map.provenance===effectiveMap.provenance,'map metadata comes from the real effective root/version/provenance');
   check(mh2382Resolve(namespace,(await mh2382Db.projects.get(projectId))!).mapPanel?.targetField==='target','actual project pin resolves descriptor A');
   const foreignClient=emit(foreign.id)!.client;
   const prior=await foreignClient.state!.apply(await foreignClient.read(),[{type:'set',field:'counter',value:7}]);
   check(!!prior.receiptId,'independent editor has a real prior Undo receipt');
   await settled();

   if(mode==='lifetime'){
    await mh2382Click(mh2382Button(panel(),/^(Fullscreen|Pantalla completa)$/));
    await mh2382Wait(()=>!!emit(documentId,'fullscreen'),'Real Fullscreen button did not emit modal client');
    const full=emit(documentId,'fullscreen')!;
    check(full.context.map?.target.documentId===mapId&&full.context.scope.eraId===scope.eraId&&full.context.canEdit,'actual modal inherits contextual authority');
    const beforeRetarget=await snapshot();
    await mh2382Refused(async()=>full.client.state!.apply(await full.client.read(),[{type:'set',field:'target',value:{kind:'maps',documentId:otherMapId}}]),'fullscreen retarget');
    check(await snapshot()===beforeRetarget,'fullscreen contextual retarget preserves complete source/control snapshots');
    await mh2382Input(note(documentId,'fullscreen'),'Full note exact Ω\nsecond line');
    await mh2382Click(mh2382Button(author(documentId,'fullscreen'),/^Save author note$/));
    await mh2382Wait(()=>author(documentId,'fullscreen').querySelector('[data-mh-pending="no"]')!==null,'Normal author save did not clear its token');
    check(((await read()).document.data as Mh2382State).note==='Full note exact Ω\nsecond line','fullscreen normal state writer saves exact note');
    await mh2382Click(mh2382Button(document,/^(Save and return|Guardar y volver)$/));
    await mh2382Wait(()=>!emit(documentId,'fullscreen'),'Fullscreen local lease did not close');
    const afterClose=await snapshot();
    await mh2382Refused(async()=>full.client.state!.apply(await full.client.read(),[{type:'set',field:'counter',value:99}]),'closed fullscreen callback');
    check(await snapshot()===afterClose,'closed fullscreen callback leaves complete durable snapshot intact');
    const exterior=emit(documentId)!.client;
    const edit=await exterior.state!.apply(await exterior.read(),[{type:'set',field:'counter',value:3}]);
    await exterior.state!.undo(edit.receiptId!);
    check(((await read()).document.data as Mh2382State).counter===0,'independent exterior lease still applies and Undoes');

    await mh2382Click(mh2382Button(panel(),/^(Fullscreen|Pantalla completa)$/));
    await mh2382Wait(()=>!!emit(documentId,'fullscreen'),'Fullscreen did not reopen normally');
    const reopened=emit(documentId,'fullscreen')!;
    check(reopened.client!==full.client,'reopening emits a new local modal lease');
    await mh2382Input(note(documentId,'fullscreen'),'Retained unsaved full draft 漢字');
    const instance=reopened.instance,dirtyBefore=mh2382Pending().dirty;
    await render({previewId:versionId});
    await mh2382Wait(()=>emit(documentId,'fullscreen')?.context.canEdit===false,'actual map-version preview failed to revoke modal authority');
    check(emit(documentId,'fullscreen')?.context.map?.presentation.kind==='map-version'&&emit(documentId,'fullscreen')?.context.map?.readOnly===true,'preview context names the captured version and readonly');
    const readonlyBefore=await snapshot();
    await mh2382Refused(async()=>reopened.client.state!.apply(await reopened.client.read(),[{type:'set',field:'counter',value:99}]),'pre-preview modal callback');
    check(await snapshot()===readonlyBefore,'readonly preview stale callback cannot write');
    check(note(documentId,'fullscreen').value==='Retained unsaved full draft 漢字'&&author(documentId,'fullscreen').dataset.mhInstance===instance,'preview retains same author instance and exact draft');
    await mh2382Click(mh2382Button(document,/^(Save and return|Guardar y volver)$/));
    check(!!emit(documentId,'fullscreen')&&!(await mh2382Flush()).ok&&mh2382Pending().dirty>=dirtyBefore,'actual close guard keeps fullscreen and pending draft');

    // Remove the effective target through the normal domain API. The component
    // reads the loss, supplies target=null, and never constructs mapAuthority.
    const mapBeforeLoss=(await mh2382ReadWorld(scope,'maps',mapId))!;
    if(inEra)await mh2382HideEra(scope,'maps',mapId,mapBeforeLoss.version);
    else await mh2382MapOps.delete(mapId);
    await mh2382Wait(()=>emit(documentId,'fullscreen')?.context.canEdit===false&&!emit(documentId,'fullscreen')?.context.map,'lost target did not pause retained host / omitted stale effective metadata');
    check(note(documentId,'fullscreen').value==='Retained unsaved full draft 漢字'&&author(documentId,'fullscreen').dataset.mhInstance===instance,'real target loss retains modal draft without moving it to B');
    const missingBefore=await snapshot();
    await mh2382Refused(async()=>reopened.client.state!.apply(await reopened.client.read(),[{type:'set',field:'note',value:'wrong target'}]),'target-loss callback');
    check(await snapshot()===missingBefore,'target loss does not turn paused fullscreen into ordinary client');
    await mh2382Click(mh2382Button(author(documentId,'fullscreen'),/^Discard author draft$/));
    await mh2382Click(mh2382Button(document,/^(Save and return|Guardar y volver)$/));
    await mh2382Wait(()=>!emit(documentId,'fullscreen'),'deliberate author discard did not release close guard');
    if(inEra)await mh2382SaveEraDocument(scope,'maps',mapBeforeLoss.document,null);
    else await mh2382MapOps.create(mapBeforeLoss.document.root as unknown as Parameters<typeof mh2382MapOps.create>[0]);
    await render({previewId:undefined});await mh2382Wait(()=>emit(documentId)?.context.canEdit===true,'restored target did not issue a fresh writable client');
    await mh2382Refused(async()=>reopened.client.state!.apply(await reopened.client.read(),[{type:'set',field:'counter',value:99}]),'restored target old callback');

    // Queued Source writes, then actual domain-update revocation before commit.
    const queuedClient=emit(documentId)!.client,queuedBaseline=await queuedClient.read(),queuedBefore=await snapshot();
    let entered!:()=>void,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),atGate=new Promise<void>(resolve=>{entered=resolve;});releaseHeld=release;
    const blocker=mh2382Db.transaction('rw',mh2382Db.tables,()=>{entered();return Mh2382Dexie.waitFor(gate);});await atGate;
    const queued=queuedClient.state!.apply(queuedBaseline,[{type:'set',field:'counter',value:99}]).then(()=>false,()=>true);
    await render({previewId:versionId});release();await blocker;releaseHeld=undefined;
    check(await queued&&await snapshot()===queuedBefore,'actual queued RW refuses after preview revocation with complete rollback');
    await render({previewId:undefined});await mh2382Wait(()=>emit(documentId)?.context.canEdit===true&&emit(documentId)?.client!==queuedClient,'fresh client missing after queued rejection');
    const beforeCommitClient=emit(documentId)!.client,beforeCommit=await snapshot();let observed=false;
    const revokeBase=(changes:Record<string,unknown>,key:unknown)=>{if(key===projectId&&Object.hasOwn(changes,'sourceToolDocuments')){observed=true;mh2382Db.projects.hook('updating').unsubscribe(revokeBase);previewNow();}};
    const revokeEra=(changes:Record<string,unknown>,_key:unknown,row:{projectId?:string;kind?:string})=>{if(row.projectId===projectId&&row.kind==='local-tool'){observed=true;mh2382Db.worldEraVariants.hook('updating').unsubscribe(revokeEra);previewNow();}};
    if(inEra)mh2382Db.worldEraVariants.hook('updating',revokeEra);else mh2382Db.projects.hook('updating',revokeBase);
    try{await mh2382Refused(async()=>beforeCommitClient.state!.apply(await beforeCommitClient.read(),[{type:'set',field:'counter',value:99}]),'domain update before commit');}
    finally{mh2382Db.projects.hook('updating').unsubscribe(revokeBase);mh2382Db.worldEraVariants.hook('updating').unsubscribe(revokeEra);}
    check(observed&&await snapshot()===beforeCommit,'real updating hook revokes tree before writer commit, without residual history/variant');
    await render({previewId:undefined});await mh2382Wait(()=>emit(documentId)?.context.canEdit===true,'fresh author missing after beforecommit rollback');
    const unmounted=emit(documentId)!.client,unmountBefore=await snapshot();await render({closed:true});await render({closed:false});
    await mh2382Refused(async()=>unmounted.state!.apply(await unmounted.read(),[{type:'set',field:'counter',value:99}]),'whole wrapper unmount');
    check(await snapshot()===unmountBefore,'genuine wrapper destruction revokes old clients; no cross-shell recovery claim');
   }

   if(mode==='recovery'){
    // Normal navigation must observe OTHER editor drafts; no synthetic boolean
    // or private flusher is substituted for its actual afterWrites token.
    await mh2382Input(note(foreign.id),'Other independent draft Ω');
    const dirty=mh2382Pending().dirty;
    await mh2382Click(mh2382Element<HTMLButtonElement>(mount,'button[data-mh-select-b]'));
    check(mount.querySelector('[data-mh-canvas-selection]')?.getAttribute('data-mh-canvas-selection')===mapId&&note(foreign.id).value==='Other independent draft Ω'&&mh2382Pending().dirty===dirty,'normal selector retains A and genuine foreign draft when flush refuses');
    await mh2382Click(mh2382Button(author(foreign.id),/^Discard author draft$/));await settled();
    await mh2382Click(mh2382Element<HTMLButtonElement>(mount,'button[data-mh-select-b]'));
    await mh2382Wait(()=>mount.querySelector('[data-mh-canvas-selection]')?.getAttribute('data-mh-canvas-selection')===otherMapId,'normal selector failed after author recovered its draft');
    check((await boundDocs()).length===1,'accepted switch to B does not create or retarget the A document');
    await mh2382Click(mh2382Element<HTMLButtonElement>(mount,'button[data-mh-select-a]'));
    await mh2382Wait(()=>!!panel().querySelector(`button[data-map-tool-document="${documentId}"]`),'A document absent from its real target list');
    await mh2382Click(mh2382Element<HTMLButtonElement>(panel(),`button[data-map-tool-document="${documentId}"]`));
    await mh2382Wait(()=>emit(documentId)?.context.canEdit===true,'explicitly reopened A did not mount its author');
    let retiredRecovery:HTMLButtonElement|undefined;
    for(const revokeDuringUpdate of [false,true]){
     const requestTitle='Rejected request '+(revokeDuringUpdate?'during update':'queued')+' Ω';
     await mh2382Input(title(),requestTitle);const before=await snapshot(),pendingBefore=mh2382Pending();
     let entered!:()=>void,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),atGate=new Promise<void>(resolve=>{entered=resolve;});releaseHeld=release;
     const blocker=mh2382Db.transaction('rw',mh2382Db.tables,()=>{entered();return Mh2382Dexie.waitFor(gate);});await atGate;
     await mh2382Wait(()=>!create().disabled,'Current real binding did not enable Create');await mh2382Click(create());await mh2382Wait(()=>mh2382Pending().pending>pendingBefore.pending,'Create outer RW was not tracked while queued');
     const recoveryWhileActive=[...panel().querySelectorAll<HTMLButtonElement>('button')].find(button=>/^(Discard failed attempt|Descartar intento fallido)$/.test(button.textContent?.trim()??''));
     check(!recoveryWhileActive||recoveryWhileActive.disabled,'active creation cannot be discarded');
     const activeCount=mh2382Pending().pending;create().click();await mh2382Act(async()=>{await mh2382Tick();});
     check(mh2382Pending().pending===activeCount,'second Create while pending does not enqueue another owner');
     await mh2382Input(note(foreign.id),'Retain other draft during failed create 漢字');
     const foreignDirty=mh2382Pending().dirty;
     let observed=false;
     const revokeBase=(changes:Record<string,unknown>,key:unknown)=>{if(key===projectId&&Object.hasOwn(changes,'sourceToolDocuments')){observed=true;mh2382Db.projects.hook('updating').unsubscribe(revokeBase);previewNow();}};
     const revokeEra=(_key:unknown,row:{projectId?:string;kind?:string;document?:{root?:{title?:string}}})=>{if(row.projectId===projectId&&row.kind==='local-tool'&&row.document?.root?.title===requestTitle){observed=true;mh2382Db.worldEraVariants.hook('creating').unsubscribe(revokeEra);previewNow();}};
     if(revokeDuringUpdate){if(inEra)mh2382Db.worldEraVariants.hook('creating',revokeEra);else mh2382Db.projects.hook('updating',revokeBase);}else await render({previewId:versionId});
     try{release();await blocker;releaseHeld=undefined;await mh2382Wait(()=>mh2382Pending().pending===pendingBefore.pending&&mh2382Pending().failed===pendingBefore.failed+1,'rejected outer RW did not settle as a visible owned failure');}
     finally{mh2382Db.projects.hook('updating').unsubscribe(revokeBase);mh2382Db.worldEraVariants.hook('creating').unsubscribe(revokeEra);}
     check(!revokeDuringUpdate||observed,'creation reached the actual domain update before forced preview');
     check(await snapshot()===before,'rejected contextual creation leaves full project/control/history/asset snapshots identical');
     check(title().value===requestTitle&&note(foreign.id).value==='Retain other draft during failed create 漢字','failed attempt retains title and foreign editor text');
     const failed=mh2382Pending();
     if(retiredRecovery){retiredRecovery.click();await mh2382Act(async()=>{await mh2382Tick();});check(mh2382Pending().failed===failed.failed,'retired recovery control cannot clear the next independently failed owner');}
     create().click();await mh2382Act(async()=>{await mh2382Tick();});
     check(mh2382Pending().pending===pendingBefore.pending&&mh2382Pending().failed===failed.failed,'unresolved failed request does not enqueue a second Create');
     const retry=[...mount.querySelectorAll<HTMLButtonElement>('button')].find(button=>!panel().contains(button)&&/Retry now|Reintentar ahora/i.test(button.getAttribute('aria-label')??''));mh2382Need(retry,'Real global PendingWriteStatus retry control missing');await mh2382Click(retry);
     check(mh2382Pending().failed===failed.failed&&mh2382Pending().dirty===foreignDirty&&title().value===requestTitle,'real global Reintentar cannot discard owned no-retry failure or another draft');
     const oldRecovery=mh2382Button(panel(),/^(Discard failed attempt|Descartar intento fallido)$/);
     await mh2382Click(oldRecovery);
     check(mh2382Pending().failed===pendingBefore.failed&&mh2382Pending().dirty===foreignDirty&&title().value===requestTitle&&note(foreign.id).value==='Retain other draft during failed create 漢字','deliberate local recovery clears only settled own attempt, preserving title/foreign token');
     check(await snapshot()===before,'Discard failed attempt does not create/archive/delete Source data');
     await render({previewId:undefined});await mh2382Wait(()=>emit(documentId)?.context.canEdit===true,'recovering target did not issue new authority');
     await mh2382Wait(()=>!create().disabled,'Current real binding did not enable Create');await mh2382Click(create());
     check(!(await mh2382Flush()).ok&&(await boundDocs()).length===1,'foreign draft still refuses a new creation after own failure recovery');
     await mh2382Click(mh2382Button(author(foreign.id),/^Discard author draft$/));await settled();
     // The next iteration clicks this old DOM control while a NEW owner fails;
     // it never calls a private React handler or discardPendingOwner directly.
     retiredRecovery=oldRecovery;
    }
    await mh2382Input(title(),'Reviewed new intention after recovery');await mh2382Wait(()=>!create().disabled,'Current real binding did not enable Create');await mh2382Click(create());
    await mh2382Wait(()=>[...mh2382Emitted.values()].some(entry=>entry.context.document?.title==='Reviewed new intention after recovery'&&entry.context.map?.target.documentId===mapId),'new deliberate Create failed after other draft recovered');
    const after=await boundDocs(),fresh=after.find(row=>row.title==='Reviewed new intention after recovery');
    check(after.length===2&&fresh?.revision===1&&(fresh.data as Mh2382State).target?.documentId===mapId,'fresh click creates exactly one new revision1 under current A');
    check((fresh!.data as Mh2382State).note==='Saved own note Ω'&&fresh!.codec?.fields.target.kind==='reference','fresh document retains exact default note and saved reference codec');
   }

   if(mode==='pins'){
    const beforePin=emit(documentId)!.client;
    pin=await mh2382Pin(projectId,namespace,releases.b.contentHash,pin.revision);
    await mh2382Wait(()=>emit(documentId)?.context.canEdit===false,'actual nextTarget pin did not pause incompatible contextual binding');
    const bSnapshot=await snapshot(),catalogue=await mh2382ListTools(scope,{kind:'maps',documentId:mapId});
    check(catalogue.tools.some(tool=>tool.namespace===namespace&&tool.contentHash===releases.b.contentHash&&tool.mapPanel.targetField==='nextTarget'&&!tool.documents.some(row=>row.id===documentId)),'catalogue resolves actual B descriptor and excludes A-only saved binding');
    await mh2382Refused(async()=>beforePin.state!.apply(await beforePin.read(),[{type:'set',field:'counter',value:99}]),'pin-changed callback');
    check(await snapshot()===bSnapshot,'pin-changed callback preserves admitted B pin and all domain data');
    pin=await mh2382Pin(projectId,namespace,releases.a.contentHash,pin.revision);
    await mh2382Wait(()=>emit(documentId)?.context.canEdit===true,'pin A restoration failed to issue new normal authority');
    const restoredBefore=await snapshot();
    await mh2382Refused(async()=>beforePin.state!.apply(await beforePin.read(),[{type:'set',field:'counter',value:99}]),'ABA callback');
    check(await snapshot()===restoredBefore,'A→B→A does not revive old emitted callback');

    // A queued creation captures pin revision A. An earlier normal RW changes
    // B then A using the public pin API; final equal hash still has a new CAS.
    await mh2382Input(title(),'Pin ABA queued request');
    let entered!:()=>void,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),atGate=new Promise<void>(resolve=>{entered=resolve;});releaseHeld=release;
    let queueSequence=0;
    const observeRoot=(phase:string,transaction:typeof Mh2382Dexie.currentTransaction,details:unknown)=>{if(!transaction)return;let root=transaction;while(root.parent)root=root.parent;console.info('MAP_CONTEXT_QUEUE_OBSERVATION '+JSON.stringify({phase,sequence:++queueSequence,rootSame:root===mh2382ObservedBlocker,idbSame:!!mh2382ObservedBlocker&&root.idbtrans===mh2382ObservedBlocker.idbtrans,parent:!!transaction.parent,details}));};
    const observeUpdate=(mods:Record<string,unknown>,key:unknown,_row:unknown,transaction:import('dexie').Transaction)=>{if(key===projectId&&(Object.hasOwn(mods,'sourceToolDocuments')||Object.hasOwn(mods,'localToolInstallations')))observeRoot('projects-updating',transaction,mods);};
    const observeRead=(row:import('@/types').Project)=>{const transaction=Mh2382Dexie.currentTransaction;if(row.id===projectId&&transaction?.mode==='readwrite')observeRoot('projects-reading',transaction,{pinRevision:row.localToolInstallations?.[namespace]?.revision,titles:row.sourceToolDocuments?.map(d=>d.title)});return row;};
    mh2382Db.projects.hook('updating',observeUpdate);mh2382Db.projects.hook('reading',observeRead);unobserveQueue=()=>{mh2382Db.projects.hook('updating').unsubscribe(observeUpdate);mh2382Db.projects.hook('reading').unsubscribe(observeRead);};
    const pinBlocker=mh2382Db.transaction('rw',mh2382Db.tables,async()=>{
     mh2382ObservedBlocker=Mh2382Dexie.currentTransaction;entered();await Mh2382Dexie.waitFor(gate);
     console.info('MAP_CONTEXT_QUEUE_OBSERVATION '+JSON.stringify({phase:'pin-before-ABA',documents:(await mh2382Db.projects.get(projectId))?.sourceToolDocuments?.map(d=>({title:d.title,revision:d.revision}))}));
     const next=await mh2382Pin(projectId,namespace,releases.b.contentHash,pin.revision);
     pin=await mh2382Pin(projectId,namespace,releases.a.contentHash,next.revision);
     // Snapshot inside this actual earlier RW: the queued creator cannot run
     // yet, so this is an independent expected state including admitted pins.
     return snapshot();
    });await atGate;
    const beforePending=mh2382Pending();await mh2382Wait(()=>!create().disabled,'Current real binding did not enable Create');await mh2382Click(create());
    await mh2382Wait(()=>mh2382Pending().pending>beforePending.pending,'ABA creation not queued behind actual normal pin RW');
    release();const admittedPinSnapshot=await pinBlocker;releaseHeld=undefined;
    await mh2382Wait(()=>mh2382Pending().pending===beforePending.pending&&mh2382Pending().failed===beforePending.failed+1,'stale ABA creation did not reject');
    check(await snapshot()===admittedPinSnapshot&&(await boundDocs()).length===1,'stale create preserves committed ABA pin without creating any Source revision/history/asset');
    check((await mh2382Db.projects.get(projectId))!.localToolInstallations![namespace].revision===pin.revision&&pin.contentHash===releases.a.contentHash,'ABA uses genuine normal pin revision and original final hash');
    await mh2382Click(mh2382Button(panel(),/^(Discard failed attempt|Descartar intento fallido)$/));
    await mh2382Wait(()=>emit(documentId)?.context.canEdit===true,'new pin-generation context absent after recovery');
    await mh2382Input(title(),'Fresh post-pin intention');await mh2382Wait(()=>!create().disabled,'Current real binding did not enable Create');await mh2382Click(create());
    await mh2382Wait(()=>[...mh2382Emitted.values()].some(entry=>entry.context.document?.title==='Fresh post-pin intention'),'fresh post-pin Create did not succeed');
    check((await boundDocs()).length===2,'fresh actual pin generation admits one normal subsequent Create');
   }

   if(mode==='dispatch'||mode==='admission'){
    const extra:Mh2382ExtraContext={projectId,namespace,scope,mapId,otherMapId,documentId,releases,pinRevision:pin.revision,check,snapshot,emit,panel,title,create,render,mount,setRelease:value=>{releaseHeld=value;}};
    await (mode==='dispatch'?mh2382ExtraDispatch(extra):mh2382ExtraAdmission(extra));
   }

   // Every rejection scenario leaves a genuinely prior, unrelated receipt usable.
   await foreignClient.state!.undo(prior.receiptId!);
   check(((await mh2382ReadDocument(foreignScope,foreign.id,namespace))!.document.data as Mh2382State).counter===0,'unrelated prior normal Undo receipt remains consumable');
   await settled();
  }finally{
   releaseHeld?.();unobserveQueue?.();mh2382ObservedBlocker=undefined;await mh2382Act(async()=>root.unmount());mount.remove();mh2382Emitted.clear();
   // Never clear pending owners, replace DB contents or retarget fixtures to
   // obtain green status. A failure remains an honest isolated-runner failure.
   for(const id of [projectId,controlId])if(await mh2382Db.projects.get(id))await mh2382DeleteProject(id);
  }
 }
 return checks;
}

/** Coverage intentionally left to the parent's other frozen bodies / Root:
 * full MapsEngine/WorldgenEngine deep-link/selector/dashboard/era regressions;
 * worldgen target repetition, current map-version changing content semantics;
 * authenticated Native MCP/cold/ZIP and real Browser paint; admitted C6/C7/C8
 * ordering (no invented late-abort hook); external ordinary retarget scenario.
 */

/** Source2382 extra normal dispatcher/admission/worldgen wrapper oracles, frozen before product. */
import {worldgenScopeOperations as mh2382WorldOps} from '@/engines/worldgen/era';
import {DEFAULT_PARAMS as mh2382WorldDefaults} from '@/engines/worldgen/core/types';
import {freshWorldEdits as mh2382FreshWorldEdits} from '@/engines/worldgen/recipe';

type Mh2382ExtraContext={
 projectId:string;namespace:string;scope:Mh2382Scope;mapId:string;otherMapId:string;documentId:string;
 releases:Awaited<ReturnType<typeof mh2382Releases>>;pinRevision:number;
 check:(value:unknown,label:string)=>void;snapshot:()=>Promise<string>;
 emit:(id:string,view?:string)=>Mh2382Emission|undefined;
 panel:()=>HTMLElement;title:()=>HTMLInputElement;create:()=>HTMLButtonElement;
 render:(change?:Partial<Mh2382HarnessProps>)=>Promise<void>;
 mount:HTMLElement;setRelease:(release:(()=>void)|undefined)=>void;
};
function mh2382BridgeObject(reply:BridgeReply){mh2382Need(reply.ok&&isRecord(reply.result),'Normal dispatcher refusal: '+reply.error);return reply.result;}
export async function oracleMapWorkspaceDispatch(){return mh2382Scenario('dispatch');}
export async function oracleMapWorkspaceAdmission(){return mh2382Scenario('admission');}

async function mh2382ExtraDispatch(x:Mh2382ExtraContext){
 const {scope,projectId,namespace,mapId,otherMapId,documentId,releases,check,snapshot,emit,panel,render,mount}=x;
 const listed=mh2382BridgeObject(await runBridgeTool('wh_local_tool_map_list',{...scope,target:{kind:'maps',documentId:mapId}}));
 mh2382Need(Array.isArray(listed.hosts),'Real map_list missing live host summaries');
 const host=listed.hosts.find(value=>isRecord(value)&&isRecord(value.scope)&&value.scope.projectId===projectId&&value.scope.eraId===scope.eraId);
 mh2382Need(isRecord(host)&&typeof host.hostId==='string','No actual mounted map host');
 const hostId=host.hostId,old=emit(documentId)!.client;
 const other=await mh2382CreateDocument(scope,namespace,'Own B dispatcher review',{initialActions:[{type:'set',field:'target',value:{kind:'maps',documentId:otherMapId}}]});
 const args={...scope,hostId,target:{kind:'maps',documentId:otherMapId},namespace,documentId:other.id,expectedContentHash:releases.a.contentHash};
 const wrongBefore=await snapshot();const wrong=await runBridgeTool('wh_local_tool_map_open',{...args,expectedContentHash:releases.b.contentHash});
 check(!wrong.ok&&await snapshot()===wrongBefore,'real host open rejects stale expected compiled hash without domain mutation');
 const result=mh2382BridgeObject(await runBridgeTool('wh_local_tool_map_open',args));
 check(result.available===true&&result.applied===true,'normal dispatcher opens only the actual live host selection');
 await mh2382Wait(()=>mount.querySelector('[data-mh-canvas-selection]')?.getAttribute('data-mh-canvas-selection')===otherMapId&&emit(other.id)?.context.map?.target.documentId===otherMapId,'accepted host command did not render the actual B author afterward');
 const bBefore=await snapshot();await mh2382Refused(async()=>old.state!.apply(await old.read(),[{type:'set',field:'counter',value:99}]),'pre-host-open A callback');
 check(await snapshot()===bBefore,'host selection permanently revokes the prior contextual client');
 const back=mh2382BridgeObject(await runBridgeTool('wh_local_tool_map_open',{...scope,hostId,target:{kind:'maps',documentId:mapId},namespace,documentId,expectedContentHash:releases.a.contentHash}));
 check(back.applied===true,'normal map_open accepts deliberate return to A');await mh2382Wait(()=>emit(documentId)?.context.map?.target.documentId===mapId&&emit(documentId)?.context.canEdit===true,'A not really mounted after accepted return');
 const data=(await mh2382ReadDocument(scope,documentId,namespace))!.document.data as Mh2382State;
 check(data.target?.documentId===mapId,'host navigation never retargets the Source document');
 await render({closed:true});const beforeClosed=await snapshot();const closed=mh2382BridgeObject(await runBridgeTool('wh_local_tool_map_open',args));
 check(closed.available===false&&closed.applied===false&&await snapshot()===beforeClosed,'closed real host returns unavailable with no headless queue or data write');
 const afterList=mh2382BridgeObject(await runBridgeTool('wh_local_tool_map_list',{...scope}));
 check(Array.isArray(afterList.hosts)&&!afterList.hosts.some(value=>isRecord(value)&&value.hostId===hostId),'closed host unregisters from actual renderer catalogue');
 // Deliberate ordinary Source route is a different allowed host, not the modal
 // dropping mapAuthority. Mount it normally and use the emitted ordinary client.
 const ordinary=document.createElement('div');document.body.append(ordinary);const root=mh2382CreateRoot(ordinary);
 try{
  await mh2382Act(async()=>root.render(<Mh2382StrictMode><Mh2382MemoryRouter><Mh2382DocumentHost projectId={projectId} eraId={scope.eraId} documentId={documentId} namespace={namespace}/></Mh2382MemoryRouter></Mh2382StrictMode>));
  await mh2382Wait(()=>!!emit(documentId)?.context.canEdit&&!emit(documentId)?.context.map,'ordinary Source route did not emit independent context');
  const client=emit(documentId)!.client;await client.state!.apply(await client.read(),[{type:'set',field:'target',value:{kind:'maps',documentId:otherMapId}}]);
  check(((await mh2382ReadDocument(scope,documentId,namespace))!.document.data as Mh2382State).target?.documentId===otherMapId,'ordinary independent editor retains permitted reference editing');
 }finally{await mh2382Act(async()=>root.unmount());ordinary.remove();}
}

async function mh2382ExtraAdmission(x:Mh2382ExtraContext){
 const {scope,projectId,namespace,mapId,otherMapId,releases,check,snapshot,emit,panel,title,create,render,mount,setRelease}=x;
 // C6: a normal navigation is requested while the real creation RW is queued.
 await mh2382Input(title(),'Admitted A before normal B');await mh2382Wait(()=>!create().disabled,'C6 binding not ready before blocker');let enter!:()=>void,release!:()=>void;
 let gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{enter=resolve;});setRelease(release);
 let blocker=mh2382Db.transaction('rw',mh2382Db.tables,()=>{enter();return Mh2382Dexie.waitFor(gate);});await entered;
 await mh2382Wait(()=>!create().disabled,'Current real binding did not enable Create');await mh2382Click(create());await mh2382Wait(()=>mh2382Pending().pending>0,'C6 real creation not queued');
 await mh2382Click(mh2382Element<HTMLButtonElement>(mount,'button[data-mh-select-b]'));
 check(mount.querySelector('[data-mh-canvas-selection]')?.getAttribute('data-mh-canvas-selection')===mapId,'normal B selection is not admitted before pending A creation settles');
 release();await blocker;setRelease(undefined);
 await mh2382Wait(()=>mh2382Pending().pending===0&&mount.querySelector('[data-mh-canvas-selection]')?.getAttribute('data-mh-canvas-selection')===otherMapId,'normal B selection did not follow committed A creation');
 let docs=await mh2382ListDocuments(scope,namespace),admitted=docs.find(doc=>doc.title==='Admitted A before normal B');
 check(admitted?.revision===1&&(admitted.data as Mh2382State).target?.documentId===mapId,'C6 creation committed one valid A document and navigation did not bind it to B');
 await mh2382Click(mh2382Element<HTMLButtonElement>(mount,'button[data-mh-select-a]'));await mh2382Wait(()=>!!panel().querySelector(`button[data-map-tool-document="${admitted!.id}"]`),'A list missing admitted document');
 await mh2382Click(mh2382Element<HTMLButtonElement>(panel(),`button[data-map-tool-document="${admitted!.id}"]`));await mh2382Wait(()=>emit(admitted!.id)?.context.canEdit===true,'admitted document could not be opened normally');
 // C7 is the observable AFTER-result ordering, not a pretend native commit pause.
 const callback=emit(admitted!.id)!.client,beforeClosed=await snapshot(),failed=mh2382Pending().failed;
 await render({closed:true});
 check(await snapshot()===beforeClosed&&mh2382Pending().failed===failed,'loss after admitted creation preserves whole durable result without a false failed-write receipt');
 await mh2382Refused(async()=>callback.state!.apply(await callback.read(),[{type:'set',field:'counter',value:99}]),'post-admission closed client');
 check(!!await mh2382ReadDocument(scope,admitted!.id,namespace),'post-admission loss never deletes a complete user-requested document');
 await render({closed:false});await mh2382Wait(()=>[...panel().querySelectorAll<HTMLOptionElement>('select[data-map-tool-namespace] option')].some(option=>option.value===namespace&&!option.disabled),'new wrapper absent');
 const select=mh2382Element<HTMLSelectElement>(panel(),'select[data-map-tool-namespace]');await mh2382Act(async()=>{select.value=namespace;select.dispatchEvent(new Event('change',{bubbles:true}));});
 // C8: queue an ordinary pin RW behind a queued creation, with no fake concurrent
 // in-transaction project overwrite. IDB must serialize them in this order.
 await mh2382Wait(()=>!!panel().querySelector('input[data-map-tool-create-title]'),'C8 remounted form absent');await mh2382Input(title(),'Creation before queued compatible pin');await mh2382Wait(()=>!create().disabled,'C8 binding not ready before blocker');gate=new Promise<void>(resolve=>{release=resolve;});entered=new Promise<void>(resolve=>{enter=resolve;});setRelease(release);
 blocker=mh2382Db.transaction('rw',mh2382Db.tables,()=>{enter();return Mh2382Dexie.waitFor(gate);});await entered;
 const pendingBefore=mh2382Pending().pending;await mh2382Wait(()=>!create().disabled,'Current real binding did not enable Create');await mh2382Click(create());await mh2382Wait(()=>mh2382Pending().pending>pendingBefore,'C8 creation not enqueued first');
 const pin=mh2382Pin(projectId,namespace,releases.b.contentHash,x.pinRevision);
 release();await blocker;setRelease(undefined);const switched=await pin;
 await mh2382Wait(()=>mh2382Pending().pending===pendingBefore,'C8 creation never settled');docs=await mh2382ListDocuments(scope,namespace);const first=docs.find(doc=>doc.title==='Creation before queued compatible pin');
 check(first?.revision===1&&(first.data as Mh2382State).target?.documentId===mapId&&(first.data as Mh2382State).nextTarget===null,'serialized later pin does not retroactively cancel creation admitted under A');
 check(switched.contentHash===releases.b.contentHash&&switched.revision>x.pinRevision,'actual normal pin then commits afterward');
 check(mh2382Pending().failed===failed,'legitimate admitted ordering does not manufacture a cancellation failure');
}

function Mh2382WorldHarness({scope,worldId}:{scope:Mh2382Scope;worldId:string}){
 const [selected,setSelected]=mh2382UseState<Mh2382Target>({kind:'worldgen',documentId:worldId});
 const read=mh2382UseLiveQuery(()=>mh2382ReadWorld(scope,'worldgen',selected.documentId),[scope.projectId,scope.eraId,selected.documentId]);
 return <Mh2382MapWorkspace scope={scope} kind="worldgen" target={read?selected:null} onSelectTarget={setSelected}>{()=> <p>Own world metadata control; no geometry witness.</p>}</Mh2382MapWorkspace>;
}
export async function oracleMapWorkspaceWorldgen(){
 const checks:string[]=[];
 for(const ownEra of [false,true]){
  const projectId='own-world-context-'+crypto.randomUUID(),namespace='tests.world-context-'+crypto.randomUUID(),scope:Mh2382Scope={projectId,...(ownEra?{eraId:'own-e'}:{})},worldId=projectId+'-world',otherId=projectId+'-other',mount=document.createElement('div');document.body.append(mount);const root=mh2382CreateRoot(mount);
  try{
   const release=await mh2382Releases(namespace);
   await mh2382CreateProject({id:projectId,title:'Own world context',description:'Synthetic normal API data',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['worldgen','local-tool-'+namespace],engineOrder:['worldgen','local-tool-'+namespace],createdAt:1,updatedAt:1});
   for(const id of [worldId,otherId])await mh2382WorldOps({projectId}).worlds.create({id,projectId,title:id===worldId?'Actual World A':'Actual World B',params:{...mh2382WorldDefaults,seed:'own-context',width:128},edits:mh2382FreshWorldEdits(),createdAt:1,updatedAt:1});
   if(ownEra)await mh2382SaveEra(projectId,{id:'own-e',name:'Own E',description:'',revision:0,createdAt:1,updatedAt:1},null);
   await mh2382Pin(projectId,namespace,release.a.contentHash,null);
   await mh2382Act(async()=>root.render(<Mh2382StrictMode><Mh2382MemoryRouter><Mh2382WorldHarness scope={scope} worldId={worldId}/></Mh2382MemoryRouter></Mh2382StrictMode>));
   await mh2382Wait(()=>[...mount.querySelectorAll<HTMLOptionElement>('select[data-map-tool-namespace] option')].some(option=>option.value===namespace&&!option.disabled),'World wrapper absent');const select=mh2382Element<HTMLSelectElement>(mount,'select[data-map-tool-namespace]');await mh2382Act(async()=>{select.value=namespace;select.dispatchEvent(new Event('change',{bubbles:true}));});
   await mh2382Wait(()=>!!mount.querySelector('input[data-map-tool-create-title]'),'World create form absent');await mh2382Input(mh2382Element<HTMLInputElement>(mount,'input[data-map-tool-create-title]'),'Own World review');await mh2382Wait(()=>mount.querySelector<HTMLButtonElement>('button[data-map-tool-create]')?.disabled===false,'World actual binding not ready');await mh2382Click(mh2382Element<HTMLButtonElement>(mount,'button[data-map-tool-create]'));
   await mh2382Wait(()=>[...mh2382Emitted.values()].some(e=>e.context.map?.target.documentId===worldId),'World positive author not mounted');const e=[...mh2382Emitted.values()].find(e=>e.context.map?.target.documentId===worldId)!;const actual=(await mh2382ReadWorld(scope,'worldgen',worldId))!;
   mh2382Need(e.context.map?.target.kind==='worldgen'&&e.context.map.title===actual.document.root.title&&e.context.map.targetVersion===actual.version&&e.context.map.provenance===actual.provenance&&e.context.scope.eraId===scope.eraId,'World wrapper supplied fabricated map context');
   const stamp=await e.client.world.read('worldgen',worldId);mh2382Need(stamp,'Actual world read absent');const saved=await e.client.state!.apply(await e.client.read(),[{type:'set',field:'reviewedVersion',value:stamp.version}]);await e.client.state!.undo(saved.receiptId!);
   const before=mh2382Canonical(await mh2382ReadProject(projectId));await mh2382Refused(async()=>e.client.state!.apply(await e.client.read(),[{type:'set',field:'target',value:{kind:'worldgen',documentId:otherId}}]),'world panel retarget');mh2382Need(mh2382Canonical(await mh2382ReadProject(projectId))===before,'World contextual retarget left partial state');
   checks.push((ownEra?'E':'Base')+': real worldgen target metadata/selected pin, normal stamp+Undo and guarded Source binding; no WorldView geometry claim');
  }finally{await mh2382Act(async()=>root.unmount());mount.remove();mh2382Emitted.clear();if(await mh2382Db.projects.get(projectId))await mh2382DeleteProject(projectId);}
 }
 return checks;
}

/**
 * Source2382 FUTURE SOURCE TEST APPEND BODY, TEXT ONLY; not parsed/executed.
 * Append after immutable public prefix + frozen HOST-TEST-BODY. Reuses its
 * mh2382* assertion/DOM/compiled-release/author-client helpers, unchanged.
 * New identifiers/imports are mhe2382-prefixed.
 *
 * REAL MapsEngine / WorldgenEngine, MemoryRouter and EnginePaneContext. Local
 * router buttons are explicit user navigation controls. Normal era navigation
 * awaits the real pending ledger; forced-era navigation intentionally models
 * destruction by the shell's pane:era key and proves ONLY client revocation.
 * No constructed authority, fabricated client, DB Source/pin/hash insertion,
 * worker replacement, cached terrain fixture, target geometry or paint claim.
 *
 * WorldView's ordinary worker is allowed to fail under file://. Its real
 * controls/host/collection are still tested. Place and region cases prove the
 * actual receiving engine's selection and parameter admission; geometry/fly
 * completion must be verified by Root's real Browser/Native phase. They never
 * report focus/terrain success merely because a route was consumed.
 */
import {useLocation as mhe2382UseLocation,useNavigate as mhe2382UseNavigate} from 'react-router-dom';
import {EnginePaneContext as Mhe2382Pane} from '@/engines/_shared/EnginePaneContext';
import Mhe2382MapsEngine from '@/engines/maps/MapsEngine';
import Mhe2382WorldgenEngine from '@/engines/worldgen/components/WorldgenEngine';
import {mapPinOps as mhe2382MapPins} from '@/engines/maps/operations';
import {generatedWorldOps as mhe2382Worlds,worldWaypointOps as mhe2382Waypoints,deleteWorldCascade as mhe2382DeleteWorld} from '@/engines/worldgen/operations';
import {DEFAULT_PARAMS as mhe2382WorldParams} from '@/engines/worldgen/core/types';
import {DEFAULT_REGION_PARAMS as mhe2382RegionParams} from '@/engines/worldgen/region/types';
import {serializeEdits as mhe2382SerializeEdits,editKey as mhe2382EditKey} from '@/engines/worldgen/core/edits';
import {saveWorldRegionChanges as mhe2382SaveRegions} from '@/engines/worldgen/sheets/store';
import {notifyDataChanged as mhe2382Notify} from '@/engines/_shared/dataChanged';

type Mhe2382Kind='maps'|'worldgen';
type Mhe2382Links={map:string;pin:string;world:string;waypoint:string;place:string;region:string};
type Mhe2382ShellProps={projectId:string;kind:Mhe2382Kind;links:Mhe2382Links;paneId:string};
const mhe2382Picture='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZWsAAAAASUVORK5CYII=';

function Mhe2382Shell({projectId,kind,links,paneId}:Mhe2382ShellProps){
 const location=mhe2382UseLocation(),navigate=mhe2382UseNavigate();
 const eraId=new URLSearchParams(location.search).get('era')||undefined;
 const path=(parameter?:string,value?:string,era=eraId)=>{
  const query=new URLSearchParams({keep:'own-engine-oracle'});
  if(era)query.set('era',era);if(parameter&&value)query.set(parameter,value);
  return '/project/'+encodeURIComponent(projectId)+'/'+kind+'?'+query;
 };
 const changeEra=async()=>{if((await mh2382Flush()).ok)navigate(path(undefined,undefined,eraId?'':'own-e'));};
 const pane={instanceId:paneId,projectId,eraId,visible:true,primary:true,navigate:(to:string)=>navigate(to)};
 return <Mhe2382Pane.Provider value={pane}>
  <nav aria-label="Own engine navigation controls">
   {Object.entries(links).filter(([name])=>kind==='maps'?name==='map'||name==='pin':name!=='map'&&name!=='pin').map(([name,value])=><button key={name} type="button" data-mhe-link={name} onClick={()=>navigate(path(name,value))}>Open real {name} link</button>)}
   <button type="button" data-mhe-clear-link onClick={()=>navigate(path())}>Open ordinary engine route</button>
   <button type="button" data-mhe-era onClick={()=>void changeEra()}>Change era through save guard</button>
   <button type="button" data-mhe-force-era onClick={()=>navigate(path(undefined,undefined,eraId?'':'own-e'))}>Force outside era transition</button>
  </nav>
  <output data-mhe-route={location.pathname+location.search}/>
  {/* Same real destruction boundary as ProjectWorkspace primary/secondary.
      This does not claim to mount the rest of ProjectWorkspace's chrome. */}
  <main key={paneId+':'+(eraId??'base')} data-mhe-era-surface={eraId??'base'}>
   {kind==='maps'?<Mhe2382MapsEngine projectId={projectId}/>:<Mhe2382WorldgenEngine projectId={projectId}/>}
  </main>
 </Mhe2382Pane.Provider>;
}

function mhe2382DashboardButton(root:ParentNode,title:string){
 const button=[...root.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.classList.contains('w-full')&&item.classList.contains('text-left')&&[...item.querySelectorAll('span')].some(span=>span.textContent===title));
 mh2382Need(button,'Actual CollectionDashboard row absent: '+title);return button;
}
function mhe2382Active(root:ParentNode,title:string){
 try{return mhe2382DashboardButton(root,title).parentElement!.classList.contains('border-accent-gold');}catch{return false;}
}
function mhe2382WorldSelector(root:ParentNode,firstId:string,secondId:string){
 const select=[...root.querySelectorAll<HTMLSelectElement>('select')].find(item=>[...item.options].some(option=>option.value===firstId)&&[...item.options].some(option=>option.value===secondId));
 mh2382Need(select,'Actual WorldgenEngine selector absent');return select;
}
async function mhe2382Choose(select:HTMLSelectElement,value:string){
 await mh2382Act(async()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));await mh2382Tick();});
}

export async function oracleMapsEngineConsumers(){return mhe2382EngineScenario('maps');}
export async function oracleWorldgenEngineConsumers(){return mhe2382EngineScenario('worldgen');}

async function mhe2382EngineScenario(kind:Mhe2382Kind){
 const checks:string[]=[],limitations:string[]=[];
 for(const inEra of [false,true]){
  const suffix=crypto.randomUUID(),projectId='mhe2382-'+suffix,controlId='mhe2382-control-'+suffix,namespace='tests.mhe2382-'+suffix;
  const a='mhe-A-'+suffix,b='mhe-B-'+suffix,pinId='mhe-pin-'+suffix,waypointId='mhe-waypoint-'+suffix,regionId='mhe-region-'+suffix;
  const titleA=kind+' own A',titleB=kind+' own B',scope:Mh2382Scope={projectId,...(inEra?{eraId:'own-e'}:{})};
  const mount=document.createElement('div');mount.style.cssText='width:1200px;min-height:900px';document.body.append(mount);const root=mh2382CreateRoot(mount);
  const check=(value:unknown,label:string)=>{mh2382Need(value,kind+' '+(inEra?'E: ':'Base: ')+label);checks.push(kind+' '+(inEra?'E: ':'Base: ')+label);};
  const route=()=>mh2382Element<HTMLOutputElement>(mount,'[data-mhe-route]').dataset.mheRoute!;
  const query=()=>new URLSearchParams(route().split('?')[1]??'');
  const panel=()=>mh2382Element<HTMLElement>(mount,'[data-map-tool-workspace]');
  const emission=(id:string)=>mh2382Emitted.get(mh2382Key(id,'editor'));
  const author=(id:string)=>mh2382Element<HTMLElement>(mount,`[data-mh-author="${mh2382Key(id,'editor')}"]`);
  const textarea=(id:string)=>mh2382Element<HTMLTextAreaElement>(author(id),'textarea');
  const active=(title:string)=>mhe2382Active(mount,title);
  let documentId='';
  // Compare all saved Source state in Base/E and the complete other project.
  // WorldView may legitimately save its generated thumbnail in parallel: this
  // consumer oracle does not mislabel that unrelated normal write as a retarget.
  const sourceSnapshot=async()=>mh2382Canonical({base:documentId?await mh2382ReadDocument({projectId},documentId,namespace):undefined,era:documentId?await mh2382ReadDocument({projectId,eraId:'own-e'},documentId,namespace):undefined,control:await mh2382ReadProject(controlId)});
  try{
   const now=Date.now(),releases=await mh2382Releases(namespace);
   for(const id of [projectId,controlId])await mh2382CreateProject({id,title:id,description:'Own real-engine context fixture',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:[kind,'local-tool-'+namespace],engineOrder:[kind,'local-tool-'+namespace],createdAt:now,updatedAt:now});
   await mh2382SaveEra(projectId,{id:'own-e',name:'Own E',description:'Own real era',revision:0,createdAt:now,updatedAt:now},null);
   let versionId:string|undefined;
   if(kind==='maps'){
    for(const [id,title,offset]of [[a,titleA,0],[b,titleB,1]] as const)await mh2382MapOps.create({id,projectId,title,backgroundImage:mhe2382Picture,createdAt:now+offset,updatedAt:now+offset});
    await mhe2382MapPins.create({id:pinId,projectId,mapId:b,name:'Own B pin',icon:'city',position:{x:40,y:35},description:'Own linked pin'});
    versionId=await mh2382CaptureVersion(a,{name:'Own actual historical preview',date:''},scope);
   }else{
    for(const [id,title,offset]of [[a,titleA,0],[b,titleB,1]] as const)await mhe2382Worlds.create({id,projectId,title,params:{...mhe2382WorldParams,width:64,erosion:0,starter:'land',seed:'mhe2382-own-'+offset},edits:mhe2382SerializeEdits([{kind:'placesEverywhere',enabled:false},{kind:'marker',marker:'settlement',x:16,y:12,rank:'village',name:'Own authored place'}]),coverImage:mhe2382Picture,coverRevision:0,createdAt:now+offset,updatedAt:now+offset});
    await mhe2382Waypoints.create({id:waypointId,projectId,worldId:b,name:'Own B waypoint',description:'Ordinary owner link',color:'#e4a853',u:.25,v:.4,createdAt:now,updatedAt:now});
    await mhe2382SaveRegions(projectId,b,[],[{id:regionId,title:'Own B saved region',x:16,y:12,spanKm:120,params:{...mhe2382RegionParams,res:64},createdAt:now,updatedAt:now}]);
   }
   await mh2382Pin(projectId,namespace,releases.a.contentHash,null);
   const links:Mhe2382Links={map:b,pin:pinId,world:b,waypoint:waypointId,place:b+'::'+mhe2382EditKey('settlement',16,12),region:regionId};
   const initial='/project/'+projectId+'/'+kind+'?'+new URLSearchParams({...(inEra?{era:'own-e'}:{}),keep:'own-engine-oracle'});
   await mh2382Act(async()=>root.render(<Mh2382StrictMode><Mh2382MemoryRouter initialEntries={[initial]}><Mhe2382Shell projectId={projectId} kind={kind} links={links} paneId={'mhe-pane-'+suffix}/></Mh2382MemoryRouter></Mh2382StrictMode>));
   await mh2382Wait(()=>active(titleA)&&[...mount.querySelectorAll<HTMLOptionElement>('select[data-map-tool-namespace] option')].some(option=>option.value===namespace&&!option.disabled),'real engine did not load its first ordinary root and map tools');
   await mhe2382Choose(mh2382Element<HTMLSelectElement>(panel(),'select[data-map-tool-namespace]'),namespace);
   await mh2382Wait(()=>!!panel().querySelector('input[data-map-tool-create-title]'),'Engine create form absent');await mh2382Input(mh2382Element<HTMLInputElement>(panel(),'input[data-map-tool-create-title]'),'Own real-engine review');await mh2382Wait(()=>panel().querySelector<HTMLButtonElement>('button[data-map-tool-create]')?.disabled===false,'Engine actual map binding not ready');
   await mh2382Click(mh2382Element<HTMLButtonElement>(panel(),'button[data-map-tool-create]'));
   await mh2382Wait(()=>[...mh2382Emitted.values()].some(entry=>entry.context.document?.title==='Own real-engine review'&&entry.context.map?.target.documentId===a),'real engine did not emit contextual author after visible Create');
   const documents=(await mh2382ListDocuments(scope,namespace)).filter(row=>row.title==='Own real-engine review');
   check(documents.length===1&&documents[0].revision===1,'engine wrapper creates exactly one ordinary bound revision1');documentId=documents[0].id;
   check(emission(documentId)?.context.map?.target.kind===kind&&emission(documentId)?.context.scope.eraId===scope.eraId,'engine supplies actual root kind and pane era');
   const openA=async()=>{
    await mh2382Click(mh2382Element<HTMLButtonElement>(mount,'button[data-mhe-clear-link]'));
    await mh2382Wait(()=>{try{return !!mhe2382DashboardButton(mount,titleA);}catch{return false;}},'Actual A dashboard row did not load');
    await mh2382Click(mhe2382DashboardButton(mount,titleA));
    await mh2382Wait(()=>active(titleA),'normal dashboard did not select A');
    await mh2382Wait(()=>!!panel().querySelector(`button[data-map-tool-document="${documentId}"]`),'actual A Source document not listed');
    await mh2382Click(mh2382Element<HTMLButtonElement>(panel(),`button[data-map-tool-document="${documentId}"]`));
    await mh2382Wait(()=>emission(documentId)?.context.canEdit===true&&emission(documentId)?.context.map?.target.documentId===a,'explicit A author did not resume with fresh current binding');
   };
   const dirty=async(label:string)=>{await mh2382Input(textarea(documentId),label);check(mh2382Pending().dirty>0&&!(await mh2382Flush()).ok,'author reports a real draft to afterWrites');};
   const discard=async()=>{await mh2382Click(mh2382Button(author(documentId),/^Discard author draft$/));check((await mh2382Flush()).ok,'author own recovery releases real navigation guard');};

   if(kind==='worldgen'){
    check(!!mount.querySelector('[data-testid="world-cover-panel"]')&&!!mount.querySelector(`[data-testid="collection-preview"][data-item-id="${a}"]`),'21bffd cover editor and real collection preview remain available');
    check(mh2382Element<HTMLImageElement>(mount,`[data-testid="collection-preview"][data-item-id="${a}"]`).getAttribute('src')===mhe2382Picture,'collection preserves the actual chosen cover');
    const tabs=[...mount.querySelectorAll<HTMLButtonElement>('#worldgen-tools > div:first-child > button')];
    check(tabs.length===9&&tabs.some(button=>/^(Journey|Viaje)$/.test(button.textContent?.trim()??''))&&tabs.some(button=>/^(Trade|Comercio)$/.test(button.textContent?.trim()??'')),'all nine builtin world tools, including Journey and Trade, remain in their real toolbar');
    // readerView controls narrative fog; it never grants Source readonly.
    const reader=mh2382Element<HTMLButtonElement>(mount,'[data-testid="worldgen-reader-toggle"]');
    if(!reader.disabled&&!reader.closest('[inert]')){
     await mh2382Click(reader);check(emission(documentId)?.context.canEdit===true&&emission(documentId)?.context.map?.readOnly===false,'reader fog leaves author map host editable');await mh2382Click(reader);
    }else limitations.push((inEra?'E':'Base')+': reader fog interaction waits for real generation; no substitute event or readonly inference');
    await dirty('World selector blocked own draft Ω');const before=await sourceSnapshot(),instance=emission(documentId)!.instance;
    await mhe2382Choose(mhe2382WorldSelector(mount,a,b),b);
    check(active(titleA)&&textarea(documentId).value==='World selector blocked own draft Ω'&&emission(documentId)?.instance===instance&&await sourceSnapshot()===before,'actual world selector preserves A and author draft when pending check refuses');
    await discard();await mhe2382Choose(mhe2382WorldSelector(mount,a,b),b);await mh2382Wait(()=>active(titleB),'world selector refused after recovery');await openA();
    limitations.push((inEra?'E':'Base')+': WorldView worker/terrain, place fly-to and regional map opening require Root Browser/Native; this body asserts engine admission only');
   }

   // Real CollectionDashboard exists in both engines, with a positive control.
   await dirty('Dashboard blocked own draft 漢字');const beforeDashboard=await sourceSnapshot();
   await mh2382Click(mhe2382DashboardButton(mount,titleB));
   check(active(titleA)&&textarea(documentId).value==='Dashboard blocked own draft 漢字'&&await sourceSnapshot()===beforeDashboard,'actual dashboard respects pending Source draft');
   await discard();await mh2382Click(mhe2382DashboardButton(mount,titleB));await mh2382Wait(()=>active(titleB),'actual dashboard failed after normal recovery');await openA();

   // Each receiving effect is exercised independently against the real router.
   // Worldgen consumes only its accepted parameter; Maps intentionally retains
   // map/pin links according to the existing useDeepLinkParam contract.
   const linkNames=kind==='maps'?['map','pin'] as const:['world','waypoint','place','region'] as const;
   for(const name of linkNames){
    await dirty('Own blocked '+name+' draft');const before=await sourceSnapshot(),instance=emission(documentId)!.instance;
    await mh2382Click(mh2382Element<HTMLButtonElement>(mount,`button[data-mhe-link="${name}"]`));
    await mh2382Wait(()=>query().get(name)===links[name],'public router control did not deliver '+name+' query');
    await mh2382Wait(()=>!!panel().querySelector('[role="alert"]'),'real '+name+' pending guard did not report its refusal');
    check(active(titleA)&&query().get(name)===links[name]&&textarea(documentId).value==='Own blocked '+name+' draft'&&emission(documentId)?.instance===instance&&await sourceSnapshot()===before,'pending real '+name+' effect keeps A/draft/query without consuming or retargeting');
    await discard();
    // Explicit user retry clears the ordinary route then reopens the same link.
    // It does not modify private effect tokens or force a component remount.
    await mh2382Click(mh2382Element<HTMLButtonElement>(mount,'button[data-mhe-clear-link]'));
    await mh2382Click(mh2382Element<HTMLButtonElement>(mount,`button[data-mhe-link="${name}"]`));
    await mh2382Wait(()=>active(titleB)&&(kind==='maps'||!query().has(name)),'recovered '+name+' request was not admitted by real receiving effect');
    check(query().get('keep')==='own-engine-oracle'&&(query().get('era')||undefined)===scope.eraId,'accepted '+name+' preserves era and unrelated query');
    if(kind==='maps'){
     check(query().get(name)===links[name],'Maps retains its ordinary '+name+' deep link after admission');
     if(name==='pin')await mh2382Wait(()=>[...mount.querySelectorAll<HTMLInputElement>('input')].some(input=>input.value==='Own B pin'),'real MapView did not receive selected pin focus');
    }else if(name==='waypoint')await mh2382Wait(()=>[...mount.querySelectorAll<HTMLInputElement>('input')].some(input=>input.value==='Own B waypoint'),'real WorldView did not receive waypoint focus');
    check(await sourceSnapshot()===before,'accepted '+name+' navigation does not change Source binding/data or the control project');
    await openA();
   }

   if(kind==='maps'){
    const versionSelect=()=>mh2382Element<HTMLSelectElement>(mount,'[data-testid="map-version-select"]');
    await dirty('Draft before real historical preview');const before=await sourceSnapshot(),old=emission(documentId)!.client;
    await mhe2382Choose(versionSelect(),versionId!);
    check(emission(documentId)?.context.canEdit===true&&emission(documentId)?.context.map?.presentation.kind==='current'&&textarea(documentId).value==='Draft before real historical preview','real historical selector waits for author draft');
    await discard();await mhe2382Choose(versionSelect(),versionId!);
    await mh2382Wait(()=>emission(documentId)?.context.map?.presentation.kind==='map-version'&&emission(documentId)?.context.canEdit===false,'MapsEngine preview did not deliver actual readonly presentation');
    const previewContext=emission(documentId)!.context.map!;
    check(previewContext.presentation.kind==='map-version'&&previewContext.presentation.versionId===versionId&&previewContext.readOnly,'historical presentation identifies real captured version');
    await mh2382Refused(async()=>old.state!.apply(await old.read(),[{type:'set',field:'counter',value:99}]),'actual engine pre-preview client');
    check(await sourceSnapshot()===before,'real preview revokes previous client without modifying Source/Base/E/control');
    await mh2382Click(mh2382Element<HTMLButtonElement>(mount,'[data-testid="map-version-current"]'));
    await mh2382Wait(()=>emission(documentId)?.context.canEdit===true,'normal Current control did not issue fresh author client');
   }

   // Forcible real root loss is NOT a normal click. useAutoSelect may select B;
   // wrapper must survive and hold A's own author/draft under paused authority.
   await dirty('Retained real-engine lost-root draft Ω');
   const lostClient=emission(documentId)!.client,lostInstance=emission(documentId)!.instance,rootBeforeLoss=(await mh2382ReadWorld(scope,kind,a))!;
   if(inEra)await mh2382HideEra(scope,kind,a,rootBeforeLoss.version);
   else if(kind==='maps')await mh2382MapOps.delete(a);else await mhe2382DeleteWorld(a);
   mhe2382Notify({source:'other',projectId,table:kind==='maps'?'worldMaps':'generatedWorlds',entityId:a});
   await mh2382Wait(()=>emission(documentId)?.context.canEdit===false&&!emission(documentId)?.context.map,'actual engine target loss did not pause retained author');
   check(textarea(documentId).value==='Retained real-engine lost-root draft Ω'&&emission(documentId)?.instance===lostInstance&&!(await mh2382Flush()).ok,'actual engine useAutoSelect/root loss preserves exact A draft and pending guard');
   const afterLoss=await sourceSnapshot();
   await mh2382Refused(async()=>lostClient.state!.apply(await lostClient.read(),[{type:'set',field:'note',value:'Must not reach B'}]),'engine lost-root callback');
   check(await sourceSnapshot()===afterLoss,'lost root cannot revive ordinary authority or retarget saved Source into B');
   await discard();
   if(inEra)await mh2382SaveEraDocument(scope,kind,rootBeforeLoss.document,null);
   else if(kind==='maps')await mh2382MapOps.create(rootBeforeLoss.document.root as unknown as Parameters<typeof mh2382MapOps.create>[0]);
   else await mhe2382Worlds.create(rootBeforeLoss.document.root as unknown as Parameters<typeof mhe2382Worlds.create>[0]);
   mhe2382Notify({source:'other',projectId});await mh2382Wait(()=>!!mount.querySelector('button')&&(()=>{try{mhe2382DashboardButton(mount,titleA);return true;}catch{return false;}})(),'restored root did not return to actual engine list');await openA();
   await mh2382Refused(async()=>lostClient.state!.apply(await lostClient.read(),[{type:'set',field:'counter',value:99}]),'restored engine previous generation');

   // Normal shell-style era change waits the real ledger. Accepted era change
   // crosses the actual keyed React boundary, so the old emitted lease dies.
   await dirty('Own era navigation draft');const priorEra=scope.eraId??'base',beforeEra=await sourceSnapshot(),eraClient=emission(documentId)!.client;
   await mh2382Click(mh2382Element<HTMLButtonElement>(mount,'button[data-mhe-era]'));
   check(mount.querySelector('[data-mhe-era-surface]')?.getAttribute('data-mhe-era-surface')===priorEra&&textarea(documentId).value==='Own era navigation draft','normal era control retains current engine while real author draft is pending');
   await discard();await mh2382Click(mh2382Element<HTMLButtonElement>(mount,'button[data-mhe-era]'));
   await mh2382Wait(()=>mount.querySelector('[data-mhe-era-surface]')?.getAttribute('data-mhe-era-surface')!==priorEra,'normal era change did not cross actual keyed boundary after recovery');
   await mh2382Refused(async()=>eraClient.state!.apply(await eraClient.read(),[{type:'set',field:'counter',value:99}]),'old era engine callback');
   check(await sourceSnapshot()===beforeEra,'accepted keyed era transition revokes old callback without modifying saved Source/Base/E/control');

   // Return through normal controls, explicitly reopen, then trigger genuine
   // outside destruction while dirty. Do not assert draft continuation or call
   // cleanup/discard helpers to pretend the old in-memory editor survived.
   await mh2382Click(mh2382Element<HTMLButtonElement>(mount,'button[data-mhe-era]'));
   await mh2382Wait(()=>mount.querySelector('[data-mhe-era-surface]')?.getAttribute('data-mhe-era-surface')===priorEra,'return to original actual era failed');await openA();
   await dirty('Draft destroyed only by forced whole-era boundary');const forcedClient=emission(documentId)!.client,beforeForced=await sourceSnapshot();
   await mh2382Click(mh2382Element<HTMLButtonElement>(mount,'button[data-mhe-force-era]'));
   await mh2382Wait(()=>mount.querySelector('[data-mhe-era-surface]')?.getAttribute('data-mhe-era-surface')!==priorEra,'forced era transition did not destroy actual engine');
   await mh2382Refused(async()=>forcedClient.state!.apply(await forcedClient.read(),[{type:'set',field:'counter',value:99}]),'forced era destruction callback');
   check(await sourceSnapshot()===beforeForced,'forced whole-era destruction proves revocation only; no false retained-form claim');
  }finally{
   await mh2382Act(async()=>root.unmount());mount.remove();mh2382Emitted.clear();
   for(const id of [projectId,controlId])if(await mh2382Db.projects.get(id))await mh2382DeleteProject(id);
  }
 }
 return {checks,limitations};
}

/** Executes the unchanged host/engine oracle bodies sequentially in one private renderer. */
export async function testLocalMapContextHosts(){
 const checks:string[]=[];
 for(const [name,run]of Object.entries({oracleMapWorkspaceHosts,oracleMapWorkspaceRecovery,oracleMapWorkspacePins,oracleMapWorkspaceDispatch,oracleMapWorkspaceAdmission,oracleMapWorkspaceWorldgen,oracleMapsEngineConsumers,oracleWorldgenEngineConsumers})){
  console.info('MAP_CONTEXT_FOCAL_START '+name);const result=await run();console.info('MAP_CONTEXT_FOCAL_PASS '+name+' '+JSON.stringify(result));checks.push(name);
 }
 return checks;
}
