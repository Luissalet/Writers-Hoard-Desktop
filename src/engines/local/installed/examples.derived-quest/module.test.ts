import assert from 'node:assert/strict';
import {defineLocalTool,type LocalToolJson} from '@/engines/local/sdk';
import {createFakeLocalToolHost} from '@/engines/local/testing';
import {evaluateLocalToolIndex} from '@/engines/local/documentIndex';
import quest from './module';

export async function testLocalToolScaffold(){
 const checks:string[]=[];
 const group=(name:string)=>checks.push(name);
 const P='derived-agent-test',Q='derived-agent-other',D='quest-a',E='quest-b',eraId='future';
 const document=(id:string)=>({id,namespace:quest.namespace,title:'Quest fixture',generation:'generation-'+id,revision:1,createdAt:1,updatedAt:1,
  data:{...quest.initialState,briefing:'Prosa Ω de control'},codec:quest.codec,index:quest.index});
 const fake=createFakeLocalToolHost(quest,{projects:[{id:P,updatedAt:1,worldEras:[{id:eraId}],sourceToolDocuments:[document(D),document(E)]},{id:Q,updatedAt:1}]});
 const base={projectId:P},future={...base,eraId};
 const client=fake.createClient(base,false,D),neighbor=fake.createClient(base,false,E),variant=fake.createClient(future,false,D);
 const named=quest.operations?.map(op=>op.id).sort();
 assert.deepEqual(named,['add_objectives_item','remove_objectives_item','remove_rewards_key','set_ready','set_rewards_key','set_score','set_title','update_objectives_item']);
 assert.deepEqual(quest.codec?.fields.briefing,{kind:'prose'});
 assert.equal(Object.hasOwn(quest,'stateFields'),false);
 assert.deepEqual(quest.index?.fields,{title:{path:'$.title',type:'string'},score:{path:'$.score',type:'number'},ready:{path:'$.ready',type:'boolean'}});
 assert.deepEqual(defineLocalTool({...quest}).operations?.map(op=>op.id),quest.operations?.map(op=>op.id));
 group('Derived eight precise operations; prose excluded, compiled definition has original codec and no author-only branch');

 const tags={en:'Title',es:'Título'},meta={namespace:'tests.derived-conflicts',name:tags,description:tags,initialState:{title:''},validateState:(value:LocalToolJson):value is {title:string}=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.title==='string',component:()=>null};
 const stateFields={version:1 as const,fields:{title:{codec:{kind:'scalar' as const},agent:{description:tags,schema:{type:'string'},index:true as const}}}};
 const manual=defineLocalTool({...meta,stateFields,index:{version:1,fields:{manual:{path:'$.title',type:'string'}}}});
 assert.deepEqual(Object.keys(manual.index!.fields),['manual']);
 assert.deepEqual(defineLocalTool({...meta,codec:{version:1,fields:{title:{kind:'scalar'}}}}).operations,[]);
 assert.throws(()=>defineLocalTool({...meta,stateFields,operations:[{id:'set_title',description:tags,writes:true,inputSchema:{type:'object',properties:{}},run:async()=>null}]}),/invalid_local_tool_operation/);
 const withBadSchema={version:1 as const,fields:{title:{...stateFields.fields.title,agent:{...stateFields.fields.title.agent,schema:{type:'string',$ref:'#/missing'}}}}};
 assert.throws(()=>defineLocalTool({...meta,stateFields:withBadSchema}),/unsupported_local_tool_schema_keyword/);
 group('Manual index wins; no implicit catalogue, collisions and unsupported assertions reject');

 const snapshot=await client.read(),priorNeighbor=await neighbor.read();
 const args=(s:typeof snapshot,extra:Record<string,LocalToolJson>={})=>({expectedRevision:s.revision,expectedDocumentVersion:s.document!.version,...extra});
 const invoke=async(operation:string,extra:Record<string,LocalToolJson>,scope=base,id=D)=>{
  const c=fake.createClient(scope,false,id),old=await c.read();
  const value=await fake.runOperation(scope,operation,args(old,extra),true,id) as {revision:number;documentVersion:string;receiptId:string|null};
  const after=await c.read();
  assert.deepEqual([value.revision,value.documentVersion],[after.revision,after.document!.version]);
  return {value,old,after};
 };
 await assert.rejects(fake.runOperation(base,'set_title',args(snapshot,{value:'No target'}),true),/exact local tool document/);
 await assert.rejects(fake.runOperation(base,'set_title',args(snapshot,{value:'Wrong call'}),false,D),/writing operation/);
 await assert.rejects(fake.runOperation(base,'set_score',args(snapshot,{value:'string'}),true,D),/integer/);
 await assert.rejects(fake.runOperation(base,'set_title',args(snapshot,{value:'Wrong scope',field:'briefing'}),true,D),/does not accept field/);
 await assert.rejects(fake.runOperation(base,'set_title',args(snapshot,{value:'Extra key',toString:'not declared'}),true,D),/does not accept toString/);
 await assert.rejects(fake.runOperation(base,'set_briefing',args(snapshot,{value:'No'}),true,D),/Operation is absent/);
 await assert.rejects(fake.runOperation({projectId:Q},'set_title',args(snapshot,{value:'Wrong project'}),true,D));
 assert.deepEqual(await client.read(),snapshot);
 group('Schema, read-only mode, explicit document/project and absent prose operation refuse without writes');

 const title=await invoke('set_title',{value:'Quest Ω'});
 assert.equal(title.after.data.title,'Quest Ω');assert(title.value.receiptId);
 assert.equal(title.after.revision,snapshot.revision!+1);
 await assert.rejects(fake.runOperation(base,'set_title',args(snapshot,{value:'Stale'}),true,D),/conflict/);
 await assert.rejects(fake.runOperation(base,'set_title',args(title.after,{value:'Stale token',expectedDocumentVersion:'stale'}),true,D),/conflict/);
 const unchanged=await invoke('set_title',{value:'Quest Ω'});assert.equal(unchanged.value.receiptId,null);
 assert.deepEqual(unchanged.after,title.after);
 const index=evaluateLocalToolIndex(quest.index!,title.after.data);assert.deepEqual(index.fields,{title:'Quest Ω',score:0,ready:false});
 await assert.rejects(neighbor.state!.undo(title.value.receiptId),/receipt_unavailable/);
 const undo=await client.state!.undo(title.value.receiptId);assert.equal(undo.snapshot.data.title,snapshot.data.title);assert(undo.receiptId);
 assert.equal((await client.state!.redo(undo.receiptId)).snapshot.data.title,'Quest Ω');
 group('Exact version/revision, generated index, no-op, isolated normal Undo/Redo receipt');

 const list=await invoke('add_objectives_item',{afterId:null,item:{id:'obj-a',text:'First Ω',done:false}});
 assert.equal(list.after.data.objectives[0].id,'obj-a');
 await assert.rejects(invoke('update_objectives_item',{id:'obj-a',item:{id:'obj-b',text:'Illegal',done:true}}));
 const changed=await invoke('update_objectives_item',{id:'obj-a',item:{id:'obj-a',text:'First Ω',done:true}});
 assert.equal(changed.after.data.objectives[0].done,true);
 const removed=await invoke('remove_objectives_item',{id:'obj-a'});assert.deepEqual(removed.after.data.objectives,[]);
 const missingReward=await invoke('remove_rewards_key',{key:'toString'});
 assert.equal(missingReward.value.receiptId,null);assert.deepEqual(missingReward.after,missingReward.old);
 const ownReward=await invoke('set_rewards_key',{key:'toString',value:1});
 assert.equal(Object.hasOwn(ownReward.after.data.rewards,'toString'),true);assert(ownReward.value.receiptId);
 const removeOwnReward=await invoke('remove_rewards_key',{key:'toString'});
 assert.deepEqual(removeOwnReward.after.data.rewards,{});assert(removeOwnReward.value.receiptId);
 const restoreOwnReward=await client.state!.undo(removeOwnReward.value.receiptId);
 assert.deepEqual(restoreOwnReward.snapshot.data.rewards,{toString:1});
 await invoke('remove_rewards_key',{key:'toString'});
 const gold=await invoke('set_rewards_key',{key:'gold',value:3});assert.deepEqual(gold.after.data.rewards,{gold:3});
 await invoke('set_rewards_key',{key:'cloth',value:2});
 const removeGold=await invoke('remove_rewards_key',{key:'gold'});assert.deepEqual(removeGold.after.data.rewards,{cloth:2});
 const baseBefore=await client.read();
 const futureScore=await invoke('set_score',{value:7},future);
 assert.equal(futureScore.after.data.score,7);
 assert.equal((await variant.read()).provenance,'variant');
 assert.deepEqual(await client.read(),baseBefore);
 assert.deepEqual(await neighbor.read(),priorNeighbor);
 assert.equal((await client.read()).data.briefing,'Prosa Ω de control');
 assert.equal((await variant.read()).data.briefing,'Prosa Ω de control');
 group('Lists/maps affect only the exact identity; era variant preserves Base, neighbor and prose');

 return checks;
}
