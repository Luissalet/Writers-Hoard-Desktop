import '@/services/aiBridge/dispatch';
import {act} from 'react';
import {mountLocalToolFocusFixture} from './local-tool-focus.browser';
import {db} from '@/db';
import {readSourceToolDocument} from '@/engines/local/documents/store';
import {getPendingWritesSnapshot,registerPendingFlusher} from '@/services/pendingWrites';

function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,30));
async function until(test:()=>boolean,message:string,attempts=180){for(let i=0;i<attempts;i++){if(test())return;await act(async()=>{await pause();});}throw Error(message);}

/** The normal CSS harness supplies the actual MainLayout and registered Source hosts. */
export async function testLocalToolFocusNative(){
 check(await db.projects.count()===0,'Private focus profile must begin without projects');
 const fixture=await mountLocalToolFocusFixture(),ids=[fixture.aId,fixture.bId],drafts=['Native own draft A','Native own draft B'];let flushes=0,closed=false;
 const nodes=ids.map(fixture.notes),canvases=ids.map(id=>fixture.host(id).querySelector('canvas'));
 for(let i=0;i<nodes.length;i++)await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(nodes[i],drafts[i]);nodes[i].dispatchEvent(new Event('input',{bubbles:true}));await pause();});
 const off=registerPendingFlusher('focus-native-no-flush',async()=>{flushes++;return false;});
 const snapshot=async()=>{
  const projects=await db.projects.bulkGet([fixture.projectId,fixture.controlId]);
  const source=async(scope:{projectId:string;eraId?:string},id:string)=>{
   if(!projects[0])check(closed,'Own project vanished before explicit fixture cleanup');
   try{
    const value=await readSourceToolDocument(scope,id);check(!!projects[0],'Deleted project unexpectedly accepted Source read');return value;
   }catch(error){
    if(projects[0])throw error;
    // Cleanup deletes our projects. Source's real contract rejects that scope rather
    // than returning a missing document; assert that rejection before snapshotting absence.
    check(closed&&error instanceof Error&&error.message==='project_missing','Deleted project must reject Source read with project_missing');return undefined;
   }
  };
  return{projects,sourceA:await source({projectId:fixture.projectId},fixture.aId),sourceB:await source({projectId:fixture.projectId,eraId:'past'},fixture.bId),pending:getPendingWritesSnapshot(),location:location.href};
 };
 Reflect.set(window,'__focusNativeSnapshot',snapshot);
 Reflect.set(window,'__focusNativeCheck',async(input:{active:boolean})=>{
  await until(()=>ids.every(id=>fixture.host(id).querySelector('[data-focus-logical]')?.textContent==='true:'+String(input.active)),'Real Source hooks did not observe Native state');
  await act(async()=>{await pause();await pause();});
  const chrome=[...fixture.container.querySelectorAll<HTMLElement>('[data-workspace-chrome]')];check(chrome.length>=7,'Real shell chrome coverage missing');
  for(const node of chrome)check(node.hidden===input.active&&node.inert===input.active&&(getComputedStyle(node).display==='none')===input.active,'Logical state differs from actual chrome');
  for(let i=0;i<ids.length;i++){check(fixture.notes(ids[i])===nodes[i]&&nodes[i].value===drafts[i],'Native focus changed textarea identity/draft');check(fixture.host(ids[i]).querySelector('canvas')===canvases[i],'Native focus remounted Canvas');check(fixture.host(ids[i]).dataset.sourceDocumentView==='editor','Native focus changed Source view');}
  check(flushes===0,'Native focus flushed authored draft');return{actualChrome:input.active,chromeRoots:chrome.length,sameNodes:true,draftsExact:true,flushes};
 });
 Reflect.set(window,'__focusNativeCleanup',async()=>{if(!closed){off();await fixture.cleanup();closed=true;}return{projects:await db.projects.count(),sourceHosts:document.querySelectorAll('[data-source-document-host]').length,flushes};});
 // The main driver owns each UI check's act scope. Waiting for its completion must not
 // open a concurrent polling act scope across incoming real IPC changes.
 let completionTimer:ReturnType<typeof setTimeout>;
 const finished=new Promise<{ok:boolean;error?:string}>((resolve,reject)=>{
  completionTimer=setTimeout(()=>reject(Error('Native transport driver did not finish')),180000);
  Reflect.set(window,'__focusNativeFinish',(completion:{ok:boolean;error?:string})=>{Reflect.set(window,'__focusNativeComplete',completion);resolve(completion);});
 });
 Reflect.set(window,'__focusNativeReady',{projectId:fixture.projectId,controlId:fixture.controlId,a:fixture.aId,b:fixture.bId,namespace:'tests.focus-source',eraId:'past',sourceHostMounted:true});
 try{
  const completion=await finished;check(completion.ok,completion.error??'Native transport driver failed');check(closed,'Native driver did not clean own UI/projects');
  return['actual MainLayout Source UI retained drafts/nodes during two-key stdio/HTTP/executor/IPC focus get/set; unmounted hosts unavailable'];
 }finally{clearTimeout(completionTimer!);off();if(!closed)await fixture.cleanup();}
}
