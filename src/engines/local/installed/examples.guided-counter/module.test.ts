import definition from './module';
import {createFakeLocalToolHost} from '@/engines/local/testing';
export async function testLocalToolScaffold(){
 const host=createFakeLocalToolHost(definition,{projects:[{id:'tutorial-author',updatedAt:1,worldEras:[{id:'past'}]}]}),client=host.createClient({projectId:'tutorial-author'}),before=await client.read();
 const shown=await host.tutorial.show('first-count');if(shown.shown||shown.reason!=='unavailable')throw Error('Fake claimed an overlay');
 if(JSON.stringify(await client.read())!==JSON.stringify(before))throw Error('Tutorial wrote content');
 await client.state!.apply(before,[{type:'set',field:'count',value:1}]);host.tutorial.signal('incremented');
 if((await client.read()).data.count!==1||host.tutorialCommands.length!==2)throw Error('Normal action or recording failed');
 return ['Actual author module and inert tutorial port preserve content until a normal confirmed state action'];
}
