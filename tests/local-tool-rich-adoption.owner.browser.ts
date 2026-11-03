import {convergenceCanonical} from '@/engines/local/convergence/format';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {defineLocalTool,type LocalToolJson} from '@/engines/local/sdk';
import {createLocalToolClient} from '@/engines/local/storage';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {registerLocalToolModules} from '@/engines/local/registry';

/** Real Source RW and original state ports. No forged recipes, tokens or host. */
export async function testRichAdoptionOwner(){
 const checks:string[]=[],projectId='own-adoption-owner-'+crypto.randomUUID(),namespace='tests.rich-adoption-owner';
 Reflect.set(window,'__linksProgress',checks);
 const eq=(name:string,a:unknown,b:unknown)=>{if(convergenceCanonical(a)!==convergenceCanonical(b))throw Error(name+': '+JSON.stringify([a,b]));checks.push(name);};
 const reject=async(name:string,work:()=>Promise<unknown>)=>{let error='';try{await work();}catch(e){error=e instanceof Error?e.message:String(e);}eq(name,error,'local_tool_state_receipt_unavailable');};
 const data={plain:'plain',flag:0,body:{type:'doc',content:[{id:'P',type:'paragraph',content:[{type:'text',text:'base'}]}]}} as LocalToolJson;
 const common={namespace,name:{en:'Owner adoption',es:'Adopción del propietario'},description:{en:'Own Source receipts',es:'Recibos Source propios'},document:{defaultTitle:{en:'Owner',es:'Propietario'}},initialState:data,validateState:(v:LocalToolJson):v is LocalToolJson=>!!v&&typeof v==='object'&&!Array.isArray(v)&&!!v.body,component:()=>null};
 const old=defineLocalTool({...common,codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/1'},plain:{kind:'prose',collaboration:'plain-utf16/1'},flag:{kind:'scalar'}}}}),install=(definition:typeof old)=>registerLocalToolModules({['./installed/'+namespace+'/module.tsx']:{default:definition}});
 try{
  eq('health89zero',db.tables.length===89&&(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);
  await db.projects.add({id:projectId,title:projectId,description:'Own owner adoption',mode:'custom',type:'standalone',status:'draft',color:'#777',enabledEngines:[],createdAt:1,updatedAt:1});install(old);
  const first=await createSourceToolDocument({projectId},namespace,'Origin'),oldClient=createLocalToolClient(projectId,old,{documentId:first.id}),G=(await oldClient.convergence!.start(await oldClient.read())).checkpoint;
  const target=defineLocalTool({...common,stateSchemaVersion:'2',richAdoption:{transition:'rich-links-3-to-4/1',from:{namespace,codec:old.codec!,validationId:G.validationId,schemaEpoch:G.schemaEpoch}},codec:{version:2,fields:{body:{kind:'rich',profile:'paragraphs-inline/2'},plain:{kind:'prose',collaboration:'plain-utf16/1'},flag:{kind:'scalar'}}}});install(target);
  for(const mode of['commit','abort','explicit-abort','revoked'] as const){
   // Every case starts from an independent normal Source3, never a copied checkpoint.
   install(old);const document=await createSourceToolDocument({projectId},namespace,mode),seed=createLocalToolClient(projectId,old,{documentId:document.id});await seed.convergence!.start(await seed.read());install(target);
   let live=true;const client=createLocalToolClient(projectId,target,{documentId:document.id,isCurrent:()=>live}),other=createLocalToolClient(projectId,target,{documentId:document.id});
   const range=(await client.convergence!.richRange('body','P',0,2)).range,edit=await client.state!.apply(await client.read(),[{type:'rich-mark',field:'body',nodeId:'P',range,mark:'bold',enabled:true}]);
   eq(mode+' receipt created on Source3',typeof edit.receiptId,'string');eq(mode+' edit remains3',edit.snapshot.convergence!.engine.version,'3');
   const plainBefore=(await client.convergence!.textRange('plain',0,1)).range,before=await client.convergence!.export();let successor='';
   if(mode==='abort'||mode==='explicit-abort'){
    let aborted='';try{await db.transaction('rw',db.tables,async()=>{const result=await client.convergence!.adopt(await client.read());successor=result.receipts?.find(r=>r.previous===edit.receiptId)?.successor??'';eq(mode+' successor allocated',!!successor,true);if(mode==='explicit-abort')throw Error('own_outer_abort');await client.state!.undo(successor);throw Error('unexpected_premature_successor');});}catch(error){aborted=String(error);}
    eq(mode+' outer aborted with expected cause',aborted.includes(mode==='explicit-abort'?'own_outer_abort':'local_tool_state_receipt_unavailable'),true);eq('abort restores Source exact',(await client.convergence!.export()).checkpoint,before.checkpoint);await reject('aborted successor unavailable',()=>client.state!.undo(successor));const undone=await client.state!.undo(edit.receiptId!);eq('original receipt survives abort',undone.snapshot.data,data);
   }else{
    await db.transaction('rw',db.tables,async()=>{const result=await client.convergence!.adopt(await client.read());successor=result.receipts?.find(r=>r.previous===edit.receiptId)?.successor??'';eq(mode+' successor allocated',!!successor,true);if(mode==='revoked')live=false;});
    await reject(mode+' other port cannot use successor',()=>other.state!.undo(successor));
    if(mode==='revoked'){let expired='';try{await client.state!.undo(successor);}catch(error){expired=error instanceof Error?error.message:String(error);}eq('revoked lease remains expired',expired,'local_tool_context_expired');await reject('retired original unavailable from current reader',()=>other.state!.undo(edit.receiptId!));eq('current reader observes revoked commit preserves edit',JSON.stringify((await other.read()).data).includes('bold'),true);}
    else{
     const again=await client.convergence!.adopt(await client.read());eq('repeat adoption issues no replacement authority',again.receipts??[],[]);await reject('old token retired after commit',()=>client.state!.undo(edit.receiptId!));const cold=createLocalToolClient(projectId,target,{documentId:document.id});await reject('cold port has no successor authority',()=>cold.state!.undo(successor));
     const undone=await client.state!.undo(successor);eq('live owner successor Undo',undone.snapshot.data,data);eq('Undo remains active4',undone.snapshot.convergence!.engine.version,'4');
     await reject('other port cannot use successor Redo',()=>other.state!.redo(undone.receiptId!));const redone=await client.state!.redo(undone.receiptId!);eq('same owner Redo preserved',redone.snapshot.data,edit.snapshot.data);eq('same owner Redo active4',redone.snapshot.convergence!.engine.version,'4');const plainEdit=await client.state!.apply(await client.read(),[{type:'text-splice',field:'plain',range:plainBefore,text:'P'}]);eq('unchanged plain field accepts retained3 capture',(plainEdit.snapshot.data as {plain:string}).plain,'Plain');const plainUndo=await client.state!.undo(plainEdit.receiptId!);eq('plain edit Undo preserves active4',plainUndo.snapshot.data,redone.snapshot.data);
    }
   }
  }
 }finally{if(await db.projects.get(projectId))await deleteProject(projectId);eq('cleanup89zero',(await Promise.all(db.tables.map(t=>t.count()))).every(n=>n===0),true);}
 return checks;
}
