import assert from 'node:assert/strict';
import {createFakeLocalToolHost} from '@/engines/local/testing';
import {defineLocalTool,type LocalToolJson} from '@/engines/local/sdk';
export async function assertMemoryStartFlags(){
 const definition=defineLocalTool({namespace:'own.memory-start-flags',name:{en:'Start flags',es:'Inicio'},description:{en:'Own flag fixture',es:'Prueba propia'},initialState:{value:1},codec:{version:1,fields:{value:{kind:'scalar'}}},validateState:(value:LocalToolJson):value is {value:number}=>!!value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.value==='number',component:()=>null});
 const host=createFakeLocalToolHost(definition,{projects:[{id:'own-flags',updatedAt:1,sourceToolDocuments:[{id:'doc',namespace:definition.namespace,title:'Own',revision:1,createdAt:1,updatedAt:1,data:{value:1},codec:definition.codec}]}]}),client=host.createClient({projectId:'own-flags'},false,'doc');
 assert.equal((await client.convergence!.start(await client.read())).changed,true,'MEMORY_INITIAL_START_FLAG_DIFFERS_FROM_SHIPPING_HOST');
 assert.equal((await client.convergence!.start(await client.read())).changed,false,'MEMORY_REPEATED_START_FLAG_DIFFERS_FROM_SHIPPING_HOST');
 const noCodecHost=createFakeLocalToolHost({...definition,codec:undefined},host.inspect()),noCodecClient=noCodecHost.createClient({projectId:'own-flags'},false,'doc'),beforeExport=noCodecHost.inspect();
 assert.equal(noCodecClient.state,undefined,'MEMORY_EXPOSED_ACTIONS_WITHOUT_CURRENT_DEFINITION_CODEC');
 assert.ok((await noCodecClient.convergence!.export()).checkpoint,'DURABLE_CODEC_EXPORT_UNAVAILABLE_WITHOUT_CURRENT_CODEC');
 assert.deepEqual(noCodecHost.inspect(),beforeExport,'DURABLE_CODEC_EXPORT_MUTATED_MEMORY');
 return 'Memory start flags and declared-codec action surface match the shipping Source client';
}
