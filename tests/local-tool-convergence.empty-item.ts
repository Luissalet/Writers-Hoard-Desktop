import assert from 'node:assert/strict';
import {defineLocalTool,createLocalToolReplica,type LocalToolJson,type LocalToolReplica,type RichBlock,type RichBlockDocument,type LocalToolConvergenceCheckpoint} from '@/engines/local/sdk';
import {createFakeLocalToolHost} from '@/engines/local/testing';
type Data=Record<string,LocalToolJson>;type Actor=LocalToolReplica<Data>;type Position='only'|'first'|'middle'|'last';
const p=(id:string,text:string,parentId:string|null,afterId:string|null=null):RichBlock=>({id,type:'paragraph',attrs:{},parentId,slot:'body',afterId,content:text?[{type:'text',text}]:[]});
const item=(id:string,parentId:string,afterId:string|null):RichBlock=>({id,type:'list-item',attrs:{},parentId,slot:'body',afterId});
const list=(id:string,kind:'bullet-list'|'ordered-list',parentId:string|null,afterId:string|null):RichBlock=>({id,type:kind,attrs:kind==='ordered-list'?{start:2}:{},parentId,slot:'body',afterId});
export async function runEmptyItemCausals(){
 const actors:Actor[]=[],groups:string[]=[],checks:string[]=[];let destroyed=0,failure:unknown=null;
 const eq=(name:string,a:unknown,b:unknown)=>{assert.deepStrictEqual(a,b,name);checks.push(name);},body=(a:Actor)=>a.read().body as unknown as RichBlockDocument,node=(a:Actor,id:string)=>body(a).blocks.find(n=>n.id===id)!;
 const units=(a:Actor)=>Object.fromEntries(body(a).blocks.filter(n=>n.content).map(n=>[n.id,a.richRange('body',n.id,0,n.content!.reduce((sum,t)=>sum+t.text.length,0)).deleteIds]));
 const order=(a:Actor,parentId:string|null)=>{const children=body(a).blocks.filter(n=>n.parentId===parentId&&n.slot==='body'),out:string[]=[];let afterId:string|null=null;while(out.length<children.length){const next=children.filter(n=>n.afterId===afterId);assert.equal(next.length,1,'fixture must retain one linear sibling chain');out.push(next[0].id);afterId=next[0].id;}return out;};
 const healthy=(label:string,r:ReturnType<Actor['apply']>)=>{eq(label+' receipt',typeof r.receiptId,'string');eq(label+' resolved',[r.pending,r.conflict],[false,null]);return r;};
 async function setup(label:string,kind:'bullet-list'|'ordered-list'='bullet-list',nested=false,position:Position='middle'){
  const itemIds=position==='only'?['Iq']:position==='first'?['Iq','Ia','Iz']:position==='middle'?['Iz','Iq','Ia']:['Iz','Ia','Iq'];
  const blocks:RichBlock[]=[p('RootBefore','front',null),list('L',kind,nested?'Owner':null,nested?'U':'RootBefore'),p('RootAfter','back',null,nested?'W':'L')];let previous:string|null=null;
  for(const id of itemIds){blocks.push(item(id,'L',previous),p(id==='Iq'?'Q':id==='Iz'?'Z':'A',id==='Iq'?'':id==='Iz'?'ab':'cd',id));previous=id;}
  if(nested)blocks.push(list('W','bullet-list',null,'RootBefore'),item('Owner','W',null),item('After','W','Owner'),p('U','before-inner','Owner'),p('S','after-inner','Owner','L'),p('T','outer-tail','After'));
  blocks.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);const data:Data={opaque:'Élodie你🙂',body:{type:'block-doc',schema:'writers-blocks/1',blocks} as unknown as LocalToolJson};
  const definition=defineLocalTool<Data>({namespace:'tests.empty-item1895.'+label,name:{en:'Empty item causal',es:'Causal item vacío'},description:{en:'Public structural exit test',es:'Prueba pública de salida'},initialState:data,codec:{version:2,fields:{body:{kind:'rich',profile:'blocks-tree/1',schema:'writers-blocks/1'}}},validateState:(v:LocalToolJson):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v)&&v.opaque==='Élodie你🙂',component:()=>null});
  const host=createFakeLocalToolHost(definition,{projects:[{id:label,updatedAt:1,sourceToolDocuments:[{id:'D',namespace:definition.namespace,title:label,generation:label,revision:1,createdAt:1,updatedAt:1,data,codec:definition.codec}]}]}),client=host.createClient({projectId:label},false,'D'),G=(await client.convergence!.start(await client.read())).checkpoint;
  const make=(authorId:string,checkpoint:LocalToolConvergenceCheckpoint=G)=>{const a=createLocalToolReplica(checkpoint,{authorId,contract:{namespace:definition.namespace,codec:definition.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch,validateState:definition.validateState}});actors.push(a);return a;};return{a:make('A'),b:make('B'),make,itemIds,host,client};
 }
 const reject=(label:string,a:Actor,actions:Parameters<Actor['apply']>[0])=>{const before={read:a.read(),checkpoint:a.checkpoint(),units:units(a)};assert.throws(()=>a.apply(actions),/local_tool_block_empty_item_invalid|local_tool_blocks_capture_invalid/);checks.push(label+' rejected');eq(label+' read',a.read(),before.read);eq(label+' checkpoint',a.checkpoint(),before.checkpoint);eq(label+' units',units(a),before.units);};
 try{
  for(const kind of ['bullet-list','ordered-list'] as const)for(const nested of [false,true])for(const position of ['only','first','middle','last'] as const){
   const label=(kind==='ordered-list'?'ol':'ul')+'-'+(nested?'nested':'root')+'-'+position,f=await setup(label,kind,nested,position),capture=f.a.richBlockEmptyItemCapture('body','Q'),target=f.itemIds.includes('Iz')?'Z':'RootAfter';
   const remote=healthy(label+' B',f.b.apply([{type:'rich-text-splice',field:'body',nodeId:target,range:f.b.richRange('body',target,1,1),text:'你🙂',marks:['italic']},...(kind==='ordered-list'?[{type:'rich-block-transform' as const,field:'body',capture:f.b.richBlockEditCapture('body',['L']),kind:'ordered-list' as const,attrs:{start:10}}]:[])]));f.a.receive(remote.update);
   const before=f.a.read(),beforeUnits=units(f.a),result=healthy(label+' A',f.a.apply([{type:'rich-block-exit-empty-item',field:'body',capture,...(position==='middle'?{continuationListId:'N'}:{})}]));eq(label+' changed',result.changed,true);eq(label+' text identities',units(f.a),beforeUnits);eq(label+' leaf count',body(f.a).blocks.filter(n=>n.content).length,Object.keys(beforeUnits).length);
   const at=f.itemIds.indexOf('Iq'),prefix=f.itemIds.slice(0,at),suffix=f.itemIds.slice(at+1),tail=prefix.length?'N':'L';
   if(!nested){eq(label+' root order',order(f.a,null),['RootBefore',...(prefix.length?['L']:[]),'Q',...(suffix.length?[tail]:[]),'RootAfter']);eq(label+' leaf root',node(f.a,'Q').parentId,null);eq(label+' empty item retired',!!node(f.a,'Iq'),false);}
   else{eq(label+' root order',order(f.a,null),['RootBefore','W','RootAfter']);eq(label+' outer items',order(f.a,'W'),['Owner','Iq','After']);eq(label+' original item kept',node(f.a,'Q').parentId,'Iq');eq(label+' owner prefix',order(f.a,'Owner'),['U',...(prefix.length?['L']:[])]);eq(label+' lifted item order',order(f.a,'Iq'),['Q',...(suffix.length?[tail]:[]),'S']);}
   if(prefix.length)eq(label+' prefix list',order(f.a,'L'),prefix);
   if(suffix.length){eq(label+' suffix list',order(f.a,tail),suffix);eq(label+' continuation attrs',node(f.a,tail).attrs,kind==='ordered-list'?{start:10+at+1}:{});}
   if(prefix.length&&kind==='ordered-list')eq(label+' remote prefix start retained',node(f.a,'L').attrs,{start:10});
   const after=f.a.read();f.b.receive(result.update);eq(label+' both delivery views',f.b.read(),after);const undo=healthy(label+' UndoA',f.a.undo(result.receiptId!));eq(label+' Undo exact B',f.a.read(),before);f.b.receive(undo.update);eq(label+' Undo converges',f.b.read(),before);healthy(label+' RedoA',f.a.redo(undo.receiptId!));eq(label+' Redo exact',f.a.read(),after);eq(label+' cold exact',f.make('cold',f.a.checkpoint()).read(),after);groups.push(label);
  }
  {
   const f=await setup('hidden-tail'),capture=f.a.richBlockEmptyItemCapture('body','Q'),born=healthy('B tail child',f.b.apply([{type:'rich-block-insert',field:'body',capture:f.b.richBlockEditCapture('body',[],{parentId:'Ia',slot:'body',afterId:'A'}),block:{id:'Hidden',type:'paragraph',attrs:{}},text:'retained你🙂',marks:['bold']}])),visible=f.b.read(),bornUnits=units(f.b).Hidden,hidden=healthy('B hides tail child',f.b.apply([{type:'rich-block-hide',field:'body',capture:f.b.richBlockEditCapture('body',['Hidden'])}]));f.a.receive(born.update);f.a.receive(hidden.update);
   const exit=healthy('A moves captured tail with hidden child',f.a.apply([{type:'rich-block-exit-empty-item',field:'body',capture,continuationListId:'N'}]));f.b.receive(exit.update);eq('hidden child remains hidden',!!node(f.a,'Hidden'),false);const reveal=healthy('B restores hidden child',f.b.undo(hidden.receiptId!));f.a.receive(reveal.update);eq('revealed child keeps own parent',node(f.a,'Hidden').parentId,'Ia');eq('revealed child follows moved item',node(f.a,'Ia').parentId,'N');eq('hidden text IDs exact',units(f.a).Hidden,bornUnits);healthy('UndoA preserves revealed B child',f.a.undo(exit.receiptId!));eq('UndoA exact B with revealed child',f.a.read(),visible);groups.push('hidden-retained-tail-child');
  }
  {
   const f=await setup('reject-text'),capture=f.a.richBlockEmptyItemCapture('body','Q'),remote=healthy('fill Q',f.b.apply([{type:'rich-text-splice',field:'body',nodeId:'Q',range:f.b.richRange('body','Q',0,0),text:'new你🙂'}]));f.a.receive(remote.update);reject('filled Q',f.a,[{type:'rich-block-exit-empty-item',field:'body',capture,continuationListId:'N'}]);groups.push('current-empty-precondition');
  }
  {
   const f=await setup('reject-overlay'),capture=f.a.richBlockEmptyItemCapture('body','Q');reject('text overlay atomic',f.a,[{type:'rich-text-splice',field:'body',nodeId:'Q',range:f.a.richRange('body','Q',0,0),text:'future'}, {type:'rich-block-exit-empty-item',field:'body',capture,continuationListId:'N'}]);reject('missing continuation',f.a,[{type:'rich-block-exit-empty-item',field:'body',capture}]);reject('reused continuation',f.a,[{type:'rich-block-exit-empty-item',field:'body',capture,continuationListId:'L'}]);groups.push('atomic-overlay-and-IDs');
  }
  for(const replacement of ['leaf-parent','list-owner','new-item'] as const){
   const f=await setup('reject-'+replacement,'bullet-list',replacement==='list-owner'),capture=f.a.richBlockEmptyItemCapture('body','Q');
   if(replacement==='list-owner'){const moved=healthy('B new owner',f.b.apply([{type:'rich-block-move',field:'body',capture:f.b.richBlockMoveCapture('body','L',{parentId:'After',slot:'body',afterId:'T'})}]));f.a.receive(moved.update);}
   else{const split=healthy('B new item',f.b.apply([{type:'rich-block-split',field:'body',capture:f.b.richBlockSplitCapture('body','Z',1),newNodeId:'R',newItemId:'J'}]));f.a.receive(split.update);if(replacement==='leaf-parent'){const moved=healthy('B moves Q',f.b.apply([{type:'rich-block-move',field:'body',capture:f.b.richBlockMoveCapture('body','Q',{parentId:'J',slot:'body',afterId:'R'})}]));f.a.receive(moved.update);}}
   reject(replacement,f.a,[{type:'rich-block-exit-empty-item',field:'body',capture,continuationListId:'N'}]);groups.push(replacement);
  }
 }catch(error){failure={message:String(error),stack:(error as Error).stack};}
 finally{for(const a of actors){a.destroy();destroyed++;}}
 return{ok:failure===null,groups,checks,failure,cleanup:{created:actors.length,destroyed}};
}
