import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {createOwnedBlockClient,type LocalToolBlockPort} from '@/engines/local/blocks/client';
import {createLocalToolClient} from '@/engines/local/storage';
import {defineLocalToolBlock,createLocalToolBlockEnvelope,type LocalToolOwnedBlockDefinition} from '@/engines/local/blocks/definitions';
import {findLocalToolBlocksInHtml,serializeLocalToolBlock,type LocalToolOwnedBlockEnvelope} from '@/engines/local/blocks/types';
import {localToolSemanticPreview} from '@/engines/local/previewTypes';
import {renderRichProsePreview} from '@/engines/local/richProseHtml';
import type {LocalToolJson} from '@/engines/local/sdk';
import first from './fixtures/local-tools/evolving-owned/v1/module';
import second from './fixtures/local-tools/evolving-owned/v2/module';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const bytes=(value:unknown)=>JSON.stringify(value);
const copy=<T,>(value:T):T=>structuredClone(value);
function record(value:LocalToolJson):Record<string,LocalToolJson>{assert(value&&typeof value==='object'&&!Array.isArray(value),'Expected object fixture state');return value as Record<string,LocalToolJson>;}
function body(value:LocalToolOwnedBlockEnvelope){const{revision:_,...rest}=value;return rest;}
function same(actual:unknown,expected:unknown,label:string){assert(bytes(actual)===bytes(expected),label+'\nactual='+bytes(actual)+'\nexpected='+bytes(expected));}
async function rejects(run:()=>Promise<unknown>,label:string){let rejected=false;try{await run();}catch{rejected=true;}assert(rejected,label);}
const nextDefinition=()=>second.blocks![0] as LocalToolOwnedBlockDefinition;

/** Public host dependency with exact RAW CAS and lease, but NO projection/default/receipt logic. */
async function fixture(options:{raw?:(raw:LocalToolOwnedBlockEnvelope)=>void;definition?:LocalToolOwnedBlockDefinition}={}){
 const projectId='review-owned-evolution-'+crypto.randomUUID(),owner={kind:'codex' as const,documentId:'review-parent'};
 await db.projects.put({id:projectId,title:'Independent Owned evolution',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['codex','writings','local-tool-'+second.namespace],createdAt:1,updatedAt:1});
 const created=createLocalToolBlockEnvelope(first.namespace,first.blocks![0],'same-reviewed-atom');assert(created.scope==='host','Fixture must be Owned');
 let raw=copy(created),live=true,commits=0,failNext=false,gate:Promise<void>|undefined;
 options.raw?.(raw);
 const requireLive=()=>{if(!live)throw Error('review_owner_retargeted');};
 const port:LocalToolBlockPort={identity:projectId+'/codex/review-parent',read:()=>{requireLive();return copy(raw);},subscribe:()=>()=>{},commit:async(before,next)=>{requireLive();if(gate)await gate;requireLive();same(raw,before,'Host RAW CAS before commit');if(failNext){failNext=false;throw Error('review_port_abort_before_write');}raw=copy(next);commits++;}};
 const definition=options.definition??nextDefinition(),client=createOwnedBlockClient({projectId},second,definition,owner,port);
 assert(client.state,'Real Owned client lacks state actions');
 const initial=copy(raw),project=bytes(await db.projects.get(projectId));
 return{projectId,owner,client,state:client.state,definition,initial,port,get raw(){return copy(raw);},get commits(){return commits;},setRaw:(value:LocalToolOwnedBlockEnvelope)=>{raw=copy(value);},abortNext:()=>{failNext=true;},hold:(value:Promise<void>)=>{gate=value;},retarget:(value:LocalToolOwnedBlockEnvelope)=>{raw=copy(value);live=false;},assertProjectUnchanged:async()=>same(bytes(await db.projects.get(projectId)),project,'Owned operations fell back to namespace/project storage'),close:()=>deleteProject(projectId)};
}

export async function reviewOwnedEvolutionReadAndNoops(){
 const f=await fixture();try{
  const baseline=await f.client.read(),data=baseline.data as Record<string,LocalToolJson>;
  same(data.objectives,[],'Missing list must be usable before first write');same(data.labels,{},'Missing map must be usable before first write');same(data.briefing,record(nextDefinition().initialState).briefing,'Rich must show declared value before first write');
  same(f.raw,f.initial,'Reading materialized the projected defaults');assert(f.commits===0,'Reading committed');
  const cases=[
   [{type:'set' as const,field:'briefing',value:data.briefing}],
   [{type:'set' as const,field:'notes',value:'temporary'},{type:'set' as const,field:'notes',value:data.notes}],
   [{type:'list-insert' as const,field:'objectives',item:{id:'transient',text:'Transient'},afterId:null},{type:'list-delete' as const,field:'objectives',id:'transient'}],
   [{type:'map-set' as const,field:'labels',key:'transient',value:'Transient'},{type:'map-delete' as const,field:'labels',key:'transient'}],
   [{type:'map-delete' as const,field:'labels',key:'absent'}]
  ];
  for(const actions of cases){const result=await f.state.apply(baseline,actions);assert(result.receiptId===null,'Net-zero action published a receipt');same(result.snapshot.data,baseline.data,'No-op returned RAW instead of coherent view');same(f.raw,f.initial,'No-op adopted RAW descriptor/data/preview');assert(f.commits===0,'No-op committed');}
  const saved=await f.client.save(copy(baseline.data),baseline.revision,baseline.block!.version);
  same(body(f.raw),body(f.initial),'save(snapshot.data) adopted projected defaults/metadata');assert(f.raw.revision>f.initial.revision&&f.commits===1,'Explicit save lost its existing revision/write contract');same(saved.data,baseline.data,'Save no-op changed the shown logical view');
  await f.assertProjectUnchanged();return['Real Owned client reads one coherent view; rich/netzero list/map no-ops preserve RAW and publish no receipt; explicit equal save advances revision without adoption'];
 }finally{await f.close();}
}

export async function reviewOwnedEvolutionReceiptChain(){
 const f=await fixture();try{
  const before=f.raw,evolved=await f.state.apply(await f.client.read(),[{type:'set',field:'notes',value:'First meaningful edit'}]);assert(evolved.receiptId,'Evolution did not publish a receipt');const after=f.raw;
  same(after.codec,nextDefinition().codec,'First effect did not adopt codec');same(after.preview,nextDefinition().preview,'First effect did not adopt preview');same(record(after.data).objectives,[],'First effect injected fresh list rows');same(record(after.data).labels,{},'First effect injected fresh map keys');
  const normal=await f.state.apply(evolved.snapshot,[{type:'set',field:'priority',value:'Urgent'}]);assert(normal.receiptId,'Normal edit lacks receipt');const revisionAfterNormal=f.raw.revision;
  const normalUndo=await f.state.undo(normal.receiptId);same(body(f.raw),body(after),'Normal Undo did not restore evolved body');assert(f.raw.revision>revisionAfterNormal,'Normal Undo failed to advance revision');
  const revisionBeforeEvolutionUndo=f.raw.revision,evolutionUndo=await f.state.undo(evolved.receiptId);assert(evolutionUndo.receiptId,'Evolution Undo did not publish Redo');same(body(f.raw),body(before),'Evolution Undo failed exact RAW restore after a normal edit/Undo');assert(f.raw.revision>revisionBeforeEvolutionUndo,'Evolution Undo reverted revision');same(record(evolutionUndo.snapshot.data).briefing,record(nextDefinition().initialState).briefing,'Undo snapshot computed before restore/projection');
  const restoredRevision=f.raw.revision;await f.state.redo(evolutionUndo.receiptId);same(body(f.raw),body(after),'Redo failed exact evolved body');assert(f.raw.revision>restoredRevision,'Redo reverted revision');
  assert(normalUndo.snapshot.block!.id===before.id&&f.raw.id===before.id,'Chain recreated the block');await f.assertProjectUnchanged();return['Public receipt chain evolves once, preserves normal Undo, then restores exact RAW metadata/absence and redoes with increasing revisions'];
 }finally{await f.close();}
}

export async function reviewOwnedEvolutionMetadataCas(){
 for(const field of ['preview','codec','name'] as const){
  const f=await fixture();try{
   const evolution=await f.state.apply(await f.client.read(),[{type:'set',field:'notes',value:'Metadata CAS fixture'}]);assert(evolution.receiptId,'Missing evolution receipt');const good=f.raw,stale=await f.client.read(),changed=copy(good);
   if(field==='preview')changed.preview={version:1,fields:[{key:'notes',label:{en:'Changed label',es:'Otra etiqueta'}}]};
   else if(field==='codec')changed.codec=copy((first.blocks![0] as LocalToolOwnedBlockDefinition).codec);
   else changed.name={en:'Changed name',es:'Otro nombre'};
   same(changed.data,good.data,'Metadata case changed data');assert(changed.revision===good.revision,'Metadata case changed revision');f.setRaw(changed);
   const actual=await f.client.read();assert(actual.block!.version!==stale.block!.version,'Version token ignores '+field);
   const commits=f.commits;await rejects(()=>f.client.save(copy(stale.data),stale.revision,stale.block!.version),'Stale metadata save succeeded: '+field);same(f.raw,changed,'Rejected save changed RAW');assert(f.commits===commits,'Rejected save committed');
   await rejects(()=>f.state.undo(evolution.receiptId!),'Undo ignored RAW metadata change: '+field);same(f.raw,changed,'Rejected Undo changed RAW');
   // Restore the exact logical after-body: same receipt must remain usable after rejection.
   f.setRaw(good);await f.state.undo(evolution.receiptId);same(body(f.raw),body(f.initial),'Stale failure consumed evolution receipt: '+field);
  }finally{await f.close();}
 }
 return['RAW codec/preview/name changes with identical data and revision invalidate save tokens and full-envelope Undo; rejection preserves receipt for a valid retry'];
}

export async function reviewOwnedEvolutionAbortAndRetarget(){
 const f=await fixture();try{
  const baseline=await f.client.read();f.abortNext();await rejects(()=>f.state.apply(baseline,[{type:'set',field:'notes',value:'Retried edit'}]),'Port abort did not reject apply');same(f.raw,f.initial,'Aborted apply changed RAW');assert(f.commits===0,'Aborted apply committed');
  const evolution=await f.state.apply(baseline,[{type:'set',field:'notes',value:'Retried edit'}]);assert(evolution.receiptId,'Retry lacks receipt');const after=f.raw;
  f.abortNext();await rejects(()=>f.state.undo(evolution.receiptId!),'Port abort did not reject Undo');same(f.raw,after,'Aborted Undo changed RAW');
  const other=createOwnedBlockClient({projectId:f.projectId},second,f.definition,{kind:'codex',documentId:'another-owner'},{...f.port,identity:f.projectId+'/codex/another-owner'});await rejects(()=>other.state!.undo(evolution.receiptId!),'Receipt crossed owner/client binding');
  await f.state.undo(evolution.receiptId);same(body(f.raw),body(f.initial),'Aborted/cross-owner Undo consumed receipt');
  let release!:()=>void,signalEntered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{signalEntered=resolve;});
  const retargeted={...f.raw,id:'new-owner-atom',data:{notes:'New owner exact'}} as LocalToolOwnedBlockEnvelope;
  const originalCommit=f.port.commit;f.port.commit=async(before,next)=>{signalEntered();await originalCommit(before,next);};f.hold(gate);
  const pending=f.state.apply(await f.client.read(),[{type:'set',field:'notes',value:'Late old-owner value'}]);
  void pending.catch(()=>{});await entered;f.retarget(retargeted);release();await rejects(()=>pending,'Retargeted pending commit succeeded');same(f.raw,retargeted,'Late old-owner write contaminated new target');
  return['Commit abort leaves RAW unchanged and the same Undo receipt retryable; owner binding/lease rejects cross-owner and late commits'];
 }finally{await f.close();}
}

export async function reviewOwnedEvolutionUnsetOpaqueAndViewGuard(){
 const unset=await fixture();try{const result=await unset.state.apply(await unset.client.read(),[{type:'unset',field:'briefing'}]);assert(result.receiptId,'Explicit unset was treated as no-op');assert(!Object.hasOwn(record(unset.raw.data),'briefing'),'Unset result was reseeded');assert(!Object.hasOwn(record((await unset.client.read()).data),'briefing'),'Already-adopted missing rich was projected again');}finally{await unset.close();}
 const valid=await fixture({raw:raw=>{raw.data={...record(raw.data),objectives:[{id:'opaque-row',text:'Existing'}],labels:{opaque:'Existing'},briefing:'<p>Existing opaque prose</p>',priority:'Existing'};}});try{const view=await valid.client.read();same(view.data,valid.initial.data,'Existing opaque keys were replaced');await valid.state.apply(view,[{type:'set',field:'notes',value:'New note'}]);for(const key of ['objectives','labels','briefing','priority'])same(record(valid.raw.data)[key],record(valid.initial.data)[key],'Adoption replaced opaque '+key);}finally{await valid.close();}
 const invalid=await fixture({raw:raw=>{raw.data={...record(raw.data),objectives:'Invalid pre-existing value'};}});try{await rejects(()=>invalid.client.read(),'Invalid opaque value was hidden by projection');same(invalid.raw,invalid.initial,'Invalid opaque rejection wrote RAW');}finally{await invalid.close();}
 const base=nextDefinition(),guarded=defineLocalToolBlock({...base,validateState:(value:LocalToolJson):value is LocalToolJson=>{if(!base.validateState(value))return false;const row=record(value);return!Object.hasOwn(row,'labels')||!!row.labels&&typeof row.labels==='object'&&!Array.isArray(row.labels)&&Object.hasOwn(row.labels,'fresh');}});
 const guard=await fixture({definition:guarded});try{await rejects(()=>guard.client.read(),'RAW-compatible but projected-view-incompatible guard was ignored');same(guard.raw,guard.initial,'View-guard rejection wrote RAW');}finally{await guard.close();}
 return['Unset stays absent after adoption; opaque values are retained or rejected; both RAW and projected view must satisfy the real author guard'];
}

export async function reviewOwnedEvolutionCapturedRaw(){
 const f=await fixture();try{
  const capture=(raw:LocalToolOwnedBlockEnvelope)=>{const html=serializeLocalToolBlock(f.projectId,raw),decoded=findLocalToolBlocksInHtml(html)[0].envelope;assert(decoded.scope==='host','Capture lost Owned');return{html,decoded,preview:renderRichProsePreview(localToolSemanticPreview(decoded.name.en,decoded.data,decoded.preview,'en',decoded.codec))};};
  const before=capture(f.raw);await f.client.read();same(capture(f.raw),before,'Read rewrote saved capture/readonly projection');assert(!before.preview.includes('Declared initial briefing'),'Readonly used the live definition default');
  const evolution=await f.state.apply(await f.client.read(),[{type:'set',field:'notes',value:'Captured evolved notes'}]);assert(evolution.receiptId,'Evolution lacks receipt');const after=capture(f.raw);assert(after.preview.includes('Declared initial briefing'),'Evolved capture lost saved rich codec/preview');
  await f.state.undo(evolution.receiptId);same(body(capture(f.raw).decoded),body(before.decoded),'Undo capture did not restore raw descriptor/absence');same(capture(f.raw).preview,before.preview,'Undo readonly preview did not restore exact old output');assert(!before.html.includes('Declared initial briefing'),'Frozen old capture changed');
  const source=await createLocalToolClient(f.projectId,second).read();same(source.data,first.initialState,'Owned evolution leaked into Source namespace');await f.assertProjectUnchanged();
  return['Readonly/captured HTML and preview use only saved RAW codec/data/spec before/after/Undo; Source storage never receives Owned fallback defaults'];
 }finally{await f.close();}
}
