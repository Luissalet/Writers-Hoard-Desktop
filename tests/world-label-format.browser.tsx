import {act,useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import LabelEditor from '@/engines/worldgen/components/LabelEditor';
import {generateWorld} from '@/engines/worldgen/core/pipeline';
import {DEFAULT_PARAMS} from '@/engines/worldgen/core/types';
import {saveSnapshot} from '@/engines/worldgen/snapshots';
import {paramsKey} from '@/engines/worldgen/useWorldGeneration';
import type {PaintedLabel} from '@/engines/worldgen/core/edits';

type Row={key:string;text:string;style:string;x:number;y:number;size?:number;angleDegrees?:number;spacing?:number;curve?:number;bold?:boolean;italic?:boolean;caps?:boolean;color?:string;font?:string};
type Format={bold?:boolean|null;italic?:boolean|null;caps?:boolean|null;color?:string|null;font?:string|null};
const fields=['bold','italic','caps','color','font'] as const;
const marker='Own disposable PaintedLabel format oracle r1';
const trace:{checks:string[];events:unknown[];cleanup?:unknown}={checks:[],events:[]};
function check(value:unknown,name:string):asserts value{if(!value)throw Error(name);trace.checks.push(name);}
const exact=(a:unknown,b:unknown,name:string)=>check(JSON.stringify(a)===JSON.stringify(b),name);
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
async function wait<T>(read:()=>T|Promise<T>,ready:(value:T)=>boolean,name:string):Promise<T>{const end=performance.now()+30000;while(performance.now()<end){let value!:T;await act(async()=>{value=await read();await pause();});if(ready(value))return value;}throw Error(name);}
async function call<T=Record<string,unknown>>(tool:string,args:Record<string,unknown>):Promise<T>{const reply=await runBridgeTool(tool,args);if(!reply.ok)throw Error(`Public ${tool}: ${reply.code??''} ${reply.error??''}`);return reply.result as T;}
const copy=(value:unknown)=>JSON.parse(JSON.stringify(value));
const format=(row:Row)=>Object.fromEntries(fields.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
const identity=(row:Row)=>Object.fromEntries(Object.entries(row).filter(([key])=>!fields.includes(key as never)));
async function undo(tool:string,result:Record<string,unknown>){const audit=result.__audit as Record<string,unknown>;check(audit&&typeof audit.entityId==='string'&&typeof audit.projectId==='string'&&audit.before&&typeof audit.before==='object','Normal label mutation exposes existing scoped audit');await call('__undo',{entry:{...audit,tool,kind:'update'}});}

async function runLabelFormat(mode:'bridge'|'ui'){
 trace.checks=[];trace.events=[];delete trace.cleanup;
 const projectId=crypto.randomUUID(),controlId=crypto.randomUUID(),roots=new Set<ReturnType<typeof createRoot>>();let selectedKey='',worldId='';let firstFailure:unknown;
 const now=Date.now();for(const id of [projectId,controlId])await db.projects.add({id,title:marker,description:marker,mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['worldgen'],createdAt:now,updatedAt:now});
 const control=copy(await db.projects.get(controlId));
 try{
  worldId=crypto.randomUUID();const params={...DEFAULT_PARAMS,width:128,seed:'own-permanent-label-format-r1'};await db.generatedWorlds.add({id:worldId,projectId,title:'Own format baseline',params,edits:'[]',createdAt:now,updatedAt:now});await saveSnapshot(worldId,paramsKey(params),generateWorld(params));const scope={projectId,worldId};
  const added=await call<Row>('wh_add_label',{...scope,x:10,y:12,text:'Mar Élodie 李明',style:'water',size:18,angleDegrees:20,spacing:.3,curve:.25});selectedKey=added.key;
  const list=async()=>call<{labels:Row[];pending?:boolean}>('wh_list_labels',scope);
  const row=async()=>{const result=await list();return result.labels?.find(item=>item.key===selectedKey);};
  let initial=await wait(row,value=>!!value,'Existing public label did not load');check(initial&&initial.text==='Mar Élodie 李明'&&initial.style==='water'&&initial.size===18&&initial.angleDegrees===20&&initial.spacing===.3&&initial.curve===.25,'Baseline public shape and Unicode are already functional');
  const baselineChange=await call('wh_update_label',{...scope,key:selectedKey,curve:-.2});await wait(row,value=>value?.curve===-.2,'Existing public shape update failed');await undo('wh_update_label',baselineChange);initial=await wait(row,value=>value?.curve===.25,'Existing public shape Undo failed');check(initial,'Baseline label exists after Undo');
  if(mode==='bridge'){
   const values={bold:false,italic:true,caps:false,color:'#a1b2c3',font:'serif'};
   const explicit=await call<Row>('wh_add_label',{...scope,x:20,y:20,text:'Own explicit add',...values,color:'#A1B2C3'});exact(format(explicit),values,'Public add returns normalized five overrides');
   const addedRow=(await list()).labels.find(item=>item.key===explicit.key);check(addedRow,'Public explicit add key remains usable');exact(format(addedRow),values,'Public add persists five sparse overrides');
   const inherited=await call<Row>('wh_add_label',{...scope,x:21,y:20,text:'Own null add',bold:null,italic:null,caps:null,color:null,font:null});const inheritedRow=(await list()).labels.find(item=>item.key===inherited.key);check(inheritedRow,'Public null add key remains usable');exact(format(inheritedRow),{},'Public null add materializes absence');
   for(const invalid of[{bold:'false'},{color:'red'},{font:'unavailable-face'}]){const journal=(await db.generatedWorlds.get(worldId))!.edits;const refused=await runBridgeTool('wh_add_label',{...scope,x:22,y:20,text:'Own invalid add',...invalid});check(!refused.ok&&refused.code==='bad-args','Public add refuses invalid format');exact((await db.generatedWorlds.get(worldId))!.edits,journal,'Invalid add leaves journal exact');}
  }
  const beforeIdentity=identity(initial),beforeJournal=(await db.generatedWorlds.get(worldId))!.edits;exact(format(initial),{},'Baseline legacy label has no fabricated overrides');trace.events.push({phase:'healthy-existing-shape-and-undo',worldId,key:selectedKey,label:copy(initial)});
  const update=async(change:Format|{style:string})=>call('wh_update_label',{...scope,key:selectedKey,...change});
  const currentRow=async()=>{const value=await wait(row,Boolean,'Current public label did not become readable');check(value,'Current public label exists');return value;};
  if(mode==='bridge'){
   const overrides:Format={bold:false,italic:true,caps:false,color:'#a1b2c3',font:'serif'};
   const reply=await runBridgeTool('wh_update_label',{...scope,key:selectedKey,...overrides});trace.events.push({phase:'new-public-format-attempt',ok:reply.ok,code:reply.code,error:reply.error});check(reply.ok,'LABEL_FORMAT_PUBLIC_UPDATE_REJECTED');
   let current=await currentRow();check(current,'Updated label missing');exact(format(current),overrides,'LABEL_FORMAT_PUBLIC_FIELDS_MISSING');exact(identity(current),beforeIdentity,'Format changed label identity/text/geometry');
   const styledJournal=(await db.generatedWorlds.get(worldId))!.edits;check(styledJournal!==beforeJournal,'Overrides did not reach durable existing journal');
   await update({style:'region'});current=await currentRow();check(current,'Preset label missing');exact(format(current),overrides,'Changing preset discarded explicit overrides');check(current.text===initial.text,'Caps override mutated authored Unicode text');
   const oneReset=await update({italic:null});current=await currentRow();check(current,'Single-reset label missing');exact(format(current),{bold:false,caps:false,color:'#a1b2c3',font:'serif'},'Single null reset lost another override or retained null');await undo('wh_update_label',oneReset);current=await currentRow();check(current,'Undo-reset label missing');exact(format(current),overrides,'Single reset Undo did not restore override');
   const allReset=await update({bold:null,italic:null,caps:null,color:null,font:null});current=await currentRow();check(current,'All-reset label missing');exact(format(current),{},'All null reset did not restore absence');check(current.text===initial.text&&current.size===18&&current.spacing===.3&&current.curve===.25&&current.x===10&&current.y===12,'Reset changed text/shape/anchor');await undo('wh_update_label',allReset);current=await currentRow();check(current,'Undo-all-reset label missing');exact(format(current),overrides,'All reset Undo did not restore explicit false/color/font');
   const invalids=[{bold:'false'},{italic:[]},{caps:1},{color:'red'},{font:'foreign-unavailable-face'}];for(const invalid of invalids){const before=(await db.generatedWorlds.get(worldId))!.edits;const refused=await runBridgeTool('wh_update_label',{...scope,key:selectedKey,...invalid});check(!refused.ok&&refused.code==='bad-args','Invalid format must be rejected at the existing public boundary');exact((await db.generatedWorlds.get(worldId))!.edits,before,'Invalid format changed durable journal');}
  }else{
   let failure:unknown;function Inspector(){const [label,setLabel]=useState<PaintedLabel|null>(null);useEffect(()=>{void row().then(value=>{if(value)setLabel({...value,angle:(value.angleDegrees??0)*Math.PI/180} as PaintedLabel);});},[]);return <LabelEditor label={label} onChange={(change,key)=>{void call('wh_update_label',{...scope,key,...change,...(change.angle!==undefined?{angleDegrees:change.angle*180/Math.PI}:{}) }).then(async()=>{const value=await row();if(value)setLabel({...value,angle:(value.angleDegrees??0)*Math.PI/180} as PaintedLabel);}).catch(error=>{failure=error;});}} onRemove={()=>{throw Error('Remove is outside format oracle');}}/>;}
   const root=createRoot(document.getElementById('root')!);roots.add(root);await act(async()=>root.render(<Inspector/>));await wait(()=>document.querySelector('[data-testid=label-text]'),Boolean,'Actual LabelEditor baseline did not load');for(const id of ['label-size','label-angle','label-spacing','label-curve'])check(document.querySelector(`[data-testid=${id}]`),'Existing normal inspector control missing: '+id);
   const bold=document.querySelector<HTMLSelectElement>('[data-testid=label-bold]'),italic=document.querySelector<HTMLSelectElement>('[data-testid=label-italic]'),caps=document.querySelector<HTMLSelectElement>('[data-testid=label-caps]'),font=document.querySelector<HTMLSelectElement>('[data-testid=label-font]'),color=document.querySelector<HTMLInputElement>('[data-testid=label-color]');check(bold&&italic&&caps&&font&&color&&document.querySelector('[data-testid=label-reset-format]'),'LABEL_FORMAT_UI_CONTROLS_MISSING');
   const choose=async(select:HTMLSelectElement,value:string)=>{await act(async()=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));await pause();});if(failure)throw failure;};
   await choose(bold,'false');await wait(row,value=>value?.bold===false,'Normal UI did not save explicit bold false');await choose(italic,'true');await choose(caps,'false');await choose(font,'serif');await wait(row,value=>value?.italic===true&&value.caps===false&&value.font==='serif','Normal UI format did not reach public state');
   await act(async()=>{document.querySelector<HTMLButtonElement>('[data-testid=label-reset-format]')!.click();await pause();});await wait(row,value=>!!value&&Object.keys(format(value)).length===0,'Normal reset control did not restore inherited format');if(failure)throw failure;
  }
  exact(await db.projects.get(controlId),control,'Own control project changed');return {ok:true,mode,checks:trace.checks,attribution:'Permanent normal dispatcher/LabelEditor contract; real CPU-generated legacy snapshot fixture, no Worker/public-create/Native/Brave/era/portable/renderpixel claim'};
 }catch(error){firstFailure=error;throw error;}finally{try{
  for(const root of roots)await act(async()=>root.unmount());for(const id of [projectId,controlId]){check((await db.projects.get(id))?.description===marker,'Cleanup owns exact disposable fixture');await deleteProject(id);}
  const counts:Record<string,number>={};for(const table of db.tables)if(table.schema.idxByName.projectId||table.schema.primKey.name==='projectId')for(const id of [projectId,controlId])counts[table.name+':'+id]=await table.where('projectId').equals(id).count();check(!await db.projects.get(projectId)&&!await db.projects.get(controlId)&&Object.values(counts).every(count=>count===0),'Own label projects/indexed rows cleanup zero');trace.cleanup={ownOnly:true,projects:[projectId,controlId],counts,empty:true};
 }catch(cleanupError){trace.cleanup={error:String(cleanupError)};if(!firstFailure)throw cleanupError;}}
}

export async function testWorldLabelFormatBridge():Promise<string[]>{return (await runLabelFormat('bridge')).checks;}
export async function testWorldLabelFormatUI():Promise<string[]>{return (await runLabelFormat('ui')).checks;}
