import definition from './module';
import {createFakeLocalToolHost} from '@/engines/local/testing';

function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function rejects(run:()=>Promise<unknown>,message:string){let rejected=false;try{await run();}catch{rejected=true;}check(rejected,message);}
export async function testLocalToolScaffold(){
 const projectId='context-author',scope={projectId},host=createFakeLocalToolHost(definition,{projects:[{id:projectId,updatedAt:1,localToolContracts:{[definition.namespace]:definition.codec!},worldEras:[{id:'past'}]}]}),client=host.createClient(scope);
 const initial=JSON.stringify(host.inspect());
 const increment=await host.runOperation(scope,'increment',{},true) as {count:number;receiptId:string};
 check(increment.count===1&&!!increment.receiptId,'Named increment did not save a receipt');
 const undone=await client.state!.undo(increment.receiptId);check(undone.snapshot.data.count===0&&!!undone.receiptId,'Undo did not restore zero');
 const redone=await client.state!.redo(undone.receiptId!);check(redone.snapshot.data.count===1&&!!redone.receiptId,'Redo did not restore one');
 await rejects(()=>client.state!.undo(increment.receiptId),'Consumed receipt was reused');
 const reset=await host.runOperation(scope,'reset',{},true) as {count:number;receiptId:string};check(reset.count===0&&!!reset.receiptId,'Reset did not save a real change');
 await client.state!.undo(reset.receiptId);check((await client.read()).data.count===1,'Reset Undo failed');
 const eraScope={projectId,eraId:'past'},era=host.createClient(eraScope),eraChange=await host.runOperation(eraScope,'increment',{},true) as {count:number;receiptId:string};
 check(eraChange.count===2&&(await client.read()).data.count===1,'Era operation changed Base');
 await era.state!.undo(eraChange.receiptId);check((await era.read()).data.count===1&&(await client.read()).data.count===1,'Era Undo escaped scope');
 await rejects(()=>client.state!.undo(eraChange.receiptId),'Base adopted an era receipt');
 const beforeReadOnly=JSON.stringify(host.inspect());await rejects(()=>host.runOperation(scope,'increment',{},false),'Read-only operation wrote');check(beforeReadOnly===JSON.stringify(host.inspect()),'Rejected read-only call changed data');
 const original=await client.read(),first=await client.state!.apply(original,[{type:'set',field:'count',value:5}]);
 await client.state!.apply(await client.read(),[{type:'set',field:'count',value:9}]);
 await rejects(()=>client.state!.undo(first.receiptId!),'Conflicting Undo overwrote the latest value');check((await client.read()).data.count===9,'Conflicting Undo changed count');
 check(JSON.stringify(host.inspect())!==initial,'Normal operations did not persist');
 return ['Actual counter operations save receipts; Undo/Redo and reset use the public state API','Base/era receipts remain scoped; consumed, read-only and conflicting actions preserve current data'];
}
