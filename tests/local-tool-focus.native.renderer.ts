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

/** Opt-in scenario with the normal LinkedNotebook and ProjectWorkspace. */
export async function testLocalToolSourceBlockNative(){
 check(await db.projects.count()===0,'Private Source block profile must start empty');
 const pendingCounts=()=>{const {pending,failed,dirty}=getPendingWritesSnapshot();return {pending,failed,dirty};};
 const pendingBefore=pendingCounts();
 const {withSourceBlockFocusFixture}=await import('./local-tool-beside.browser');
 let completionTimer:ReturnType<typeof setTimeout>;
 const finished=new Promise<{ok:boolean;error?:string}>(resolve=>{
  completionTimer=setTimeout(()=>resolve({ok:false,error:'Source block Native driver did not finish'}),180000);
  Reflect.set(window,'__focusNativeFinish',resolve);
 });
 try{
  await withSourceBlockFocusFixture(async fixture=>{
   const scope={projectId:fixture.projectId};
   const primary=()=>document.querySelector('[data-testid="workspace-primary"]');
   const panel=()=>document.querySelector('[data-testid^="workspace-panel-"]:not([hidden])');
   const host=(root:ParentNode|null)=>Array.from(root?.querySelectorAll<HTMLElement>('[data-source-document-host]')??[]).find(node=>node.dataset.sourceDocumentHost===fixture.documentId);
   const primaryRoute=()=>document.querySelector('[data-testid="beside-main-location"]')?.textContent;
   const primaryHost=host(primary()),routeBefore=primaryRoute();
   check(primaryHost&&routeBefore,'Actual primary Source host/route missing');
   const snapshot=async()=>{
    const project=await db.projects.get(fixture.projectId);
    const source=await readSourceToolDocument(scope,fixture.documentId,fixture.namespace);
    check(project&&source,'Own Source document vanished');
    const variants=await db.worldEraVariants.where('projectId').equals(fixture.projectId).toArray();
    return {project,source,variants,pending:getPendingWritesSnapshot(),location:location.href};
   };
   const initial=await snapshot(),data=initial.source.document.data as {notes?:string;items?:{text:string}[]};
   const marker=data.items?.[0]?.text;
   check(data.notes&&marker&&marker!==data.notes,'Fixture needs distinct persisted Notes and Items markers');
   const noteIn=(root:ParentNode|null)=>host(root)?.querySelector<HTMLTextAreaElement>('textarea');
   const control=(labels:string[])=>Array.from(host(panel())?.querySelectorAll<HTMLButtonElement>('button')??[]).find(node=>labels.includes(node.textContent?.trim()??''));
   const samePrimary=()=>{
    check(host(primary())===primaryHost&&primaryRoute()===routeBefore,'Block opening replaced the primary host or route');
   };
   Reflect.set(window,'__focusNativeBlockSnapshot',snapshot);
   Reflect.set(window,'__focusNativeBlockObserve',async(block:'notes'|'items')=>{
    await until(()=>{
     const {main,companion}=fixture.observe();
     if(!main?.notes||!main.items||!companion||!host(panel()))return false;
     return block==='notes'
      ? companion.notes&&!companion.items&&companion.noteValue===data.notes&&noteIn(panel())?.disabled===false
      : companion.items&&!companion.notes&&companion.text.includes(marker);
    },'Selected block did not render in the actual companion');
    samePrimary();
    const view=fixture.observe();
    check(view.main?.text.includes(marker)&&noteIn(primary())?.value===data.notes,'Primary did not keep both persisted fields');
    check(view.companion?.paneId,'Missing actual companion ID');
    return {main:view.main,companion:view.companion,primaryRoute:routeBefore,documentId:host(panel())?.dataset.sourceDocumentHost};
   });
   Reflect.set(window,'__focusNativeBlockEdit',async(notes:string)=>{
    const input=noteIn(panel());
    check(input&&!input.disabled,'Active Notes block not editable');
    await act(async()=>{
     Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,notes);
     input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    const save=control(['Save notes','Guardar notas']);
    check(save&&!save.disabled,'Normal Save notes control unavailable');
    await act(async()=>{save.click();});
    await until(()=>noteIn(primary())?.value===notes&&control(['Undo','Deshacer'])?.disabled===false,'Saved edit not observed by the full document and focused Undo');
    samePrimary();
    return snapshot();
   });
   Reflect.set(window,'__focusNativeBlockUndo',async(notes:string)=>{
    const undo=control(['Undo','Deshacer']);
    check(undo&&!undo.disabled,'Focused Undo unavailable');
    await act(async()=>{undo.click();});
    await until(()=>noteIn(primary())?.value===notes&&noteIn(panel())?.value===notes&&control(['Redo','Rehacer'])?.disabled===false,'Undo did not restore both views');
    samePrimary();
    return snapshot();
   });
   Reflect.set(window,'__focusNativeBlockUnmount',async()=>{
    await fixture.unmountWorkspace();
    const view=fixture.observe();
    check(view.main===null&&view.companion===null&&!primary(),'Workspace port must be unmounted before the no-shell call');
   });
   Reflect.set(window,'__focusNativeReady',{...scope,documentId:fixture.documentId,namespace:fixture.namespace,sourceHostMounted:true});
   const completion=await finished;
   check(completion.ok,completion.error??'Source block Native driver failed');
  });
  const cleanup={projects:await db.projects.count(),sourceHosts:document.querySelectorAll('[data-source-document-host]').length,pendingExact:JSON.stringify(pendingCounts())===JSON.stringify(pendingBefore)};
  check(cleanup.projects===0&&cleanup.sourceHosts===0&&cleanup.pendingExact,'Source block fixture cleanup failed');
  Reflect.set(window,'__focusNativeBlockCleanupReceipt',cleanup);
  return ['actual ProjectWorkspace Source block opened with two keys, same document saved and undone, unavailable without workspace'];
 }finally{clearTimeout(completionTimer!);}
}
