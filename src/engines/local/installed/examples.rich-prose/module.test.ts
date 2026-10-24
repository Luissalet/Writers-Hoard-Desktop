import definition from './module';
import {createFakeLocalToolHost} from '@/engines/local/testing';
export async function testLocalToolScaffold(){
 const projectId='author-rich-prose',host=createFakeLocalToolHost(definition,{projects:[{id:projectId,updatedAt:1,localToolContracts:{[definition.namespace]:definition.codec!},worldEras:[{id:'past'}]}]}),client=host.createClient({projectId}),original=await client.read();
 const html='<h2>Harbour briefing</h2><ul><li>Ask Nora</li><li>Read chart</li></ul>';
 const result=await client.state!.apply(original,[{type:'set',field:'briefing',value:html}]);
 if(result.snapshot.data.briefing!==html)throw Error('Rich briefing was not saved');
 await client.state!.undo(result.receiptId!);if((await client.read()).data.briefing!==original.data.briefing)throw Error('Rich briefing Undo failed');
 const era=host.createClient({projectId,eraId:'past'}),before=await era.read();await era.state!.apply(before,[{type:'set',field:'briefing',value:html}]);if((await client.read()).data.briefing!==original.data.briefing)throw Error('Era edit wrote Base');
 return ['Real public rich-prose module validates/saves/Undo through the author host; era briefing remains isolated from Base (no DOM rendered by fake host)'];
}
