import {act,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {useLocalToolCollabPresence} from '@/engines/local/sdk';
import type {LocalToolClient,LocalToolHostContext,LocalToolJson,LocalToolDocumentPresence,LocalToolPresenceSnapshot} from '@/engines/local/sdk';
import {cloneLocalToolJson} from '@/engines/local/stateTypes';
function check(value:unknown,name:string):asserts value{if(!value)throw Error(name);}
/** Controlled public ports isolate the real hook's publication ownership, not Source or transport. */
function controlled(instanceId:string){let value:LocalToolJson|null=null,owner:object|undefined;const events:string[]=[],snapshot:LocalToolPresenceSnapshot={status:'ready',peers:[]},port:LocalToolDocumentPresence={instanceId,getSnapshot:()=>snapshot,subscribe:()=>()=>{},clear:()=>{value=null;owner=undefined;},setLocal:next=>{value=next===null?null:cloneLocalToolJson(next);},publish:next=>{const cloned=cloneLocalToolJson(next),token={};value=cloned;owner=token;events.push('publish');return()=>{events.push('revoke');if(owner===token){owner=undefined;value=null;}};}};return{port,events,read:()=>value};}
export async function testLocalPresenceHookOwnership(){
 const root=createRoot(document.getElementById('root')!),A=controlled('source-A'),B=controlled('source-B');let latest:ReturnType<typeof useLocalToolCollabPresence>|undefined;
 const client=(id:string)=>({projectId:'own-presence-hooks',namespace:'tests.presence-hooks',documentId:id}) as LocalToolClient<LocalToolJson>;
 const a=client('A'),b=client('B');function View({client,port}:{client:LocalToolClient<LocalToolJson>;port:LocalToolDocumentPresence}){const context:LocalToolHostContext={view:'editor',canEdit:true,scope:{projectId:client.projectId},document:{id:client.documentId!,namespace:client.namespace,title:'Own'},presence:port};latest=useLocalToolCollabPresence(client,context);return null;}
 try{
  await act(async()=>root.render(<StrictMode><View client={a} port={A.port}/></StrictMode>));const callbackA=latest!.setLocal;await act(async()=>callbackA({value:9}));check((A.read() as {value:number})?.value===9,'Initial9 missing');const priorEvents=A.events.length;let failed=false;try{callbackA({value:Number.NaN});}catch{failed=true;}check(failed&&A.events.length===priorEvents&&(A.read() as {value:number})?.value===9,'Invalid JSON retired the prior valid publication');
  await act(async()=>root.render(<StrictMode><View client={b} port={B.port}/></StrictMode>));await act(async()=>latest!.setLocal({value:11}));const beforeB=JSON.stringify(B.read()),eventsB=B.events.length;await act(async()=>{callbackA({value:99});callbackA(null);});check(JSON.stringify(B.read())===beforeB&&B.events.length===eventsB,'Old callback withdrew or changed new B');check(A.read()===null,'Retarget left A published');
  await act(async()=>latest!.setLocal({value:13}));check((B.read() as {value:number})?.value===13,'Replacing publication revoked its successor');await act(async()=>root.unmount());check(B.read()===null,'Unmount left latest producer');
  return['Invalid JSON leaves previous valid payload9 intact','Old A callback after same-hook retarget cannot withdraw B11','Replacement and StrictMode cleanup retire only their own publication token'];
 }finally{await act(async()=>root.unmount());}
}
