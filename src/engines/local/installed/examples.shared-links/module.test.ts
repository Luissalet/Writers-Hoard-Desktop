import definition from './module';
import {createFakeLocalToolHost} from '@/engines/local/testing';
export async function testLocalToolScaffold(){
 const P='own-linked-notebook',D='own-linked-document',host=createFakeLocalToolHost(definition,{projects:[{id:P,updatedAt:1,sourceToolDocuments:[{id:D,namespace:definition.namespace,title:'Links',generation:'g',revision:1,createdAt:1,updatedAt:1,data:definition.initialState,codec:definition.codec}]}]}),client=host.createClient({projectId:P},false,D);
 const started=await client.convergence!.start(await client.read());if(started.checkpoint.engine.version!=='4')throw Error('Expected native link format');
 const {range}=await client.convergence!.richRange('body','P',0,2),before=await client.read(),edit=await client.state!.apply(before,[{type:'rich-link',field:'body',nodeId:'P',range,href:'https://example.org/notebook'}]);
 if(!JSON.stringify(edit.snapshot.data).includes('https://example.org/notebook'))throw Error('Normal author kit did not preserve link');
 await client.state!.undo(edit.receiptId!);if(JSON.stringify((await client.read()).data)!==JSON.stringify(before.data))throw Error('Author Undo failed');
 return ['Linked notebook Source definition uses native4 and normal author kit link/Undo; no UI claim'];
}
