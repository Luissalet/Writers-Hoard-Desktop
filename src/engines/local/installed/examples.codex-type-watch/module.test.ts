import assert from 'node:assert/strict';
import type {CodexTemplate} from '@/engines/codex/templateTypes';
import {createLocalToolCodexTypes} from '../../codexTypes';
import {createFakeLocalToolHost} from '../../testing';
import definition from './module';

const turn=()=>new Promise<void>(resolve=>setImmediate(resolve));
export async function testLocalToolScaffold(){
 const checks:string[]=[];
 const importedProperty={id:'rank',key:'Rank',label:'Rank',kind:'number' as const,required:true,defaultValue:'IMPORTED SECRET'};
 const reference={key:'Leader',label:'Leader',targetType:'character' as const};
 const importedReference={...reference,body:'IMPORTED SECRET'};
 const parent:CodexTemplate={id:'lineage',name:'Guild',category:'faction',color:'#441177',icon:'Shield',
  fields:{Rank:'DEFAULT SECRET'},content:'<p>Not part of the schema</p>',revision:0,createdAt:1,updatedAt:1,
  propertyDefinitions:[importedProperty]};
 const child:CodexTemplate={id:'branch',name:'Branch',category:'faction',parentTemplateId:parent.id,
  fields:{},content:'',revision:0,createdAt:1,updatedAt:1,hiddenFromPickers:true,
  referenceFieldDefinitions:[importedReference]};
 const foreign={...parent,id:'foreign',name:'Foreign guild'};
 const fake=createFakeLocalToolHost(definition,{projects:[
  {id:'p',updatedAt:1,worldEras:[{id:'past'}],codexTemplates:[child,parent]},
  {id:'q',updatedAt:1,codexTemplates:[foreign]},
 ]});
 const base=fake.createClient({projectId:'p'},true).codexTypes!;
 const past=fake.createClient({projectId:'p',eraId:'past'}).codexTypes!;
 const other=fake.createClient({projectId:'q'}).codexTypes!;
 const before=fake.inspect(),catalogue=await base.list(),branch=await past.read(child.id);
 assert.deepEqual(await past.list(),catalogue);
 assert.deepEqual(catalogue.map(row=>row.id),[parent.id,child.id]);
 assert.equal(branch?.path,'Guild / Branch');assert.equal(branch?.color,parent.color);
 assert.equal(branch?.icon,'Shield');assert.equal(branch?.hiddenFromPickers,true);
 assert.deepEqual(branch?.properties,[{id:'rank',key:'Rank',label:'Rank',kind:'number',required:true}]);
 assert.deepEqual(branch?.references,[reference]);
 assert(!JSON.stringify(catalogue).includes('DEFAULT SECRET'));assert(!JSON.stringify(catalogue).includes('Not part of the schema'));
 assert(!JSON.stringify(catalogue).includes('IMPORTED SECRET'));
 assert.equal(await base.read(foreign.id),undefined);
 assert.deepEqual((await other.list()).map(row=>row.name),[foreign.name]);
 assert.deepEqual(fake.inspect(),before);
 checks.push('Reads share inherited schema and appearance across eras without returning defaults or foreign rows');

 const events:(readonly string[])[]=[],errors:unknown[]=[];
 const stop=base.watch(rows=>events.push(rows.map(row=>row.path+':'+row.color)),error=>errors.push(error));
 try{
  await turn();assert.deepEqual(events,[['Guild:#441177','Guild / Branch:#441177']]);
  await fake.replaceCodexTemplateFixtures('q',[{...foreign,color:'#113355'}]);await turn();assert.equal(events.length,1);
  await fake.replaceCodexTemplateFixtures('p',[child,{...parent,revision:1,content:'<p>Body only</p>'}]);await turn();
  assert.equal(events.length,1);
  const renamed={...parent,name:'Guild Δ',color:'#113355',revision:2};
  await fake.replaceCodexTemplateFixtures('p',[child,renamed]);await turn();
  assert.deepEqual(events[1],['Guild Δ:#113355','Guild Δ / Branch:#113355']);
  assert.equal(events.length,2);assert.deepEqual(errors,[]);
 }finally{stop();}
 await fake.replaceCodexTemplateFixtures('p',[child,parent]);await turn();assert.equal(events.length,2);
 checks.push('Watch emits initial and effective committed changes and stops after unsubscribe');

 const split=createLocalToolCodexTypes(async()=>[{...parent,name:'Pending'}],()=>()=>{},()=>true,async()=>[parent]);
 const committed:string[]=[];
 const stopSplit=split.watch(rows=>committed.push(...rows.map(row=>row.name)));
 try{
  assert.equal((await split.read(parent.id))?.name,'Pending');
  await turn();assert.deepEqual(committed,['Guild']);
 }finally{stopSplit();}
 checks.push('Watch uses the committed reader even when direct reads see a pending change');

 let resolve:((rows:readonly CodexTemplate[])=>void)|undefined,alive=true,calls=0,unsubscriptions=0;
 const pending=createLocalToolCodexTypes(()=>new Promise(done=>{resolve=done;}),()=>()=>{unsubscriptions++;},()=>alive);
 const close=pending.watch(()=>{calls++;},()=>{calls++;});
 assert(resolve);alive=false;resolve([parent]);
 await turn();
 assert.equal(calls,0);assert.equal(unsubscriptions,1);
 close();assert.equal(unsubscriptions,1);
 await assert.rejects(()=>pending.list(),/context_expired/);
 checks.push('Revoking a host while its read is pending suppresses both result and error');
 return checks;
}
