import '@/services/aiBridge/dispatch';
import {act,createElement} from 'react';
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
export async function testLocalToolSourceBlockNative(sourceCommand=false,sourceProvider=false,sourcePushed=false){
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
   const control=(labels:string[],root:ParentNode|null=panel())=>Array.from(host(root)?.querySelectorAll<HTMLButtonElement>('button')??[]).find(node=>labels.includes(node.textContent?.trim()??''));
   const samePrimary=()=>{
    check(host(primary())===primaryHost&&primaryRoute()===routeBefore,'Block opening replaced the primary host or route');
   };
   if(sourceCommand){
    const itemTexts=(root:ParentNode|null)=>Array.from(host(root)?.querySelectorAll('section[aria-label="Linked notebook"] ul > li > span')??[],node=>node.textContent);
    const matches=(root:ParentNode|null,texts:string[])=>JSON.stringify(itemTexts(root))===JSON.stringify(texts);
    const commandLabels=['Add review checklist','Añadir pauta de revisión'];
    const undoLabels=['Undo','Deshacer'],redoLabels=['Redo','Rehacer'];
    const checkPrincipal=()=>{
     samePrimary();
     check(control(undoLabels,primary())?.disabled===true&&control(redoLabels,primary())?.disabled===true,'Principal acquired the companion Undo or Redo step');
    };
    const observeCommand=async(input:{texts:string[];applied:boolean})=>{
     await until(()=>{
      const {main,companion}=fixture.observe();
      if(!main?.items||!companion?.items||!control(commandLabels))return false;
      return matches(primary(),input.texts)&&matches(panel(),input.texts)
       && (input.applied?control(undoLabels):control(redoLabels))?.disabled===false;
     },'Persisted command data and its actual Undo/Redo did not settle in both views');
     checkPrincipal();
     return {view:fixture.observe(),principalItems:itemTexts(primary()),companionItems:itemTexts(panel())};
    };
    Reflect.set(window,'__focusNativeCommandOpen',async()=>{
     checkPrincipal();
     const open=control(['Open items beside','Abrir apuntes al lado'],primary());
     check(open&&!open.disabled,'Normal Items companion action unavailable');
     await act(async()=>{open.click();});
     await until(()=>!!fixture.observe().companion?.items&&control(commandLabels)?.disabled===false,'Real command companion did not mount');
     checkPrincipal();
     const paneId=fixture.observe().companion?.paneId,documentId=host(panel())?.dataset.sourceDocumentHost;
     check(paneId&&documentId===fixture.documentId&&control(undoLabels)?.disabled===true,'Companion identity or initial Undo stack differs');
     return {paneId,documentId};
    });
    Reflect.set(window,'__focusNativeCommandObserve',observeCommand);
    Reflect.set(window,'__focusNativeCommandUndo',async(texts:string[])=>{
     const undo=control(undoLabels);
     check(undo&&!undo.disabled,'Companion Undo unavailable');
     await act(async()=>{undo.click();});
     return observeCommand({texts,applied:false});
    });
    Reflect.set(window,'__focusNativeCommandClose',async()=>{
     const paneId=fixture.observe().companion?.paneId;
     check(paneId,'Companion pane missing before close');
     const close=document.querySelector<HTMLButtonElement>(`[data-testid="workspace-close-tab-${paneId}"]`);
     check(close&&!close.disabled,'Normal companion close control unavailable');
     await act(async()=>{close.click();});
     await until(()=>!panel()&&fixture.observe().companion===null,'Companion did not unmount');
     checkPrincipal();
     return {paneId};
    });
    Reflect.set(window,'__focusNativeCommandCheckPrincipal',()=>{checkPrincipal();return true;});
   }
   if(sourceProvider){
    const region=(root:ParentNode|null)=>host(root)?.querySelector('section[aria-label="Rehearsal order"]');
    const texts=(root:ParentNode|null|undefined,selector:string)=>Array.from(root?.querySelectorAll(selector)??[],node=>node.textContent??'');
    const saved=(root:ParentNode|null)=>texts(host(root),'section[aria-label="Linked notebook"] ul > li > span');
    const order=(root:ParentNode|null)=>texts(region(root),'ol[aria-label="Rehearsal items"] > li > span');
    const equals=(actual:string[],expected:string[])=>JSON.stringify(actual)===JSON.stringify(expected);
    const rehearsalControl=(label:string,root:ParentNode|null=panel())=>Array.from(region(root)?.querySelectorAll<HTMLButtonElement>('button')??[]).find(button=>button.textContent?.trim()===label);
    const directions=(root:ParentNode|null,undo:boolean,redo:boolean)=>rehearsalControl('Undo rehearsal',root)?.disabled===!undo&&rehearsalControl('Redo rehearsal',root)?.disabled===!redo;
    const clickControl=async(button:HTMLButtonElement|undefined|null,label:string)=>{
     check(button&&!button.disabled,label+' unavailable');
     await act(async()=>{button.click();});
    };
    const principalClean=(expected:string[])=>equals(saved(primary()),expected)&&equals(order(primary()),expected)&&directions(primary(),false,false);
    Reflect.set(window,'__focusNativeProviderPrepare',async()=>{
     await until(()=>!!region(primary())&&control(['Add review checklist'],primary())?.disabled===false,'Principal rehearsal and setup command unavailable');
     await clickControl(control(['Add review checklist'],primary()),'Add review checklist');
     await until(()=>saved(primary()).length===3&&principalClean(saved(primary()))&&control(['Undo'],primary())?.disabled===false,'Prepared rows did not settle in the real principal');
     samePrimary();
     return saved(primary());
    });
    Reflect.set(window,'__focusNativeProviderOpen',async()=>{
     await clickControl(control(['Open items beside'],primary()),'Open items beside');
     await until(()=>!!fixture.observe().companion?.items&&!!region(panel()),'Companion rehearsal did not mount');
     samePrimary();
     return {paneId:fixture.observe().companion?.paneId,documentId:host(panel())?.dataset.sourceDocumentHost};
    });
    Reflect.set(window,'__focusNativeProviderObserve',async(input:{saved:string[];rehearsal:string[];canUndo:boolean;canRedo:boolean;writerUndo:boolean})=>{
     await until(()=>principalClean(input.saved)&&equals(saved(panel()),input.saved)&&equals(order(panel()),input.rehearsal)
      &&directions(panel(),input.canUndo,input.canRedo)&&(!input.writerUndo||control(['Undo'])?.disabled===false),
     'Saved order, rehearsal order or their real Undo/Redo controls did not settle');
     samePrimary();
     return {primarySaved:saved(primary()),primaryRehearsal:order(primary()),companionSaved:saved(panel()),companionRehearsal:order(panel()),canUndo:rehearsalControl('Undo rehearsal')?.disabled===false,canRedo:rehearsalControl('Redo rehearsal')?.disabled===false};
    });
    Reflect.set(window,'__focusNativeProviderMove',async(text:string)=>{
     const button=Array.from(region(panel())?.querySelectorAll<HTMLButtonElement>('button[aria-label]')??[]).find(item=>item.getAttribute('aria-label')==='Move '+text+' down');
     await clickControl(button,'Move first rehearsal row down');
    });
    Reflect.set(window,'__focusNativeProviderApply',()=>clickControl(rehearsalControl('Apply order'),'Apply order'));
    Reflect.set(window,'__focusNativeProviderWriterUndo',()=>clickControl(control(['Undo']),'Normal Writer Undo'));
    Reflect.set(window,'__focusNativeProviderClose',async()=>{
     const paneId=fixture.observe().companion?.paneId;
     check(paneId,'Companion pane missing before close');
     await clickControl(document.querySelector<HTMLButtonElement>(`[data-testid="workspace-close-tab-${paneId}"]`),'Close companion');
     await until(()=>!panel()&&fixture.observe().companion===null,'Companion rehearsal did not unmount');
     samePrimary();
     return paneId;
    });
    Reflect.set(window,'__focusNativeProviderPrincipal',(expected:string[])=>{
     samePrimary();
     check(principalClean(expected),'Stale companion provider affected the principal');
     return {saved:saved(primary()),rehearsal:order(primary())};
    });
   }
   if(sourcePushed){
    const section=(root:ParentNode|null)=>host(root)?.querySelector('section[aria-label="Review shortlist"]');
    const marks=(root:ParentNode|null)=>Array.from(section(root)?.querySelectorAll<HTMLButtonElement>('button[aria-pressed][aria-label^="Review "]')??[]);
    const text=(button:HTMLButtonElement)=>button.getAttribute('aria-label')!.slice('Review '.length);
    const read=(root:ParentNode|null)=>{
     const rows=marks(root);
     const buttons=Array.from(section(root)?.querySelectorAll<HTMLButtonElement>('button')??[]);
     const direction=(label:string)=>buttons.find(button=>button.textContent?.trim()===label);
     const undo=direction('Undo selection'),redo=direction('Redo selection');
     if(!undo||!redo)return;
     return {items:rows.map(text),selected:rows.filter(button=>button.getAttribute('aria-pressed')==='true').map(text),canUndo:!undo.disabled,canRedo:!redo.disabled};
    };
    const equals=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
    const principalClean=(items:string[])=>equals(read(primary()),{items,selected:[],canUndo:false,canRedo:false});
    const click=async(button:HTMLButtonElement|null|undefined,label:string)=>{
     check(button&&!button.disabled,label+' unavailable');
     await act(async()=>{button.click();});
    };
    Reflect.set(window,'__focusNativePushedPrepare',async()=>{
     await until(()=>!!read(primary())&&control(['Add review checklist'],primary())?.disabled===false,'Principal shortlist and setup command did not mount');
     await click(control(['Add review checklist'],primary()),'Add review checklist');
     await until(()=>{const model=read(primary());return model?.items.length===3&&principalClean(model.items);},'Three saved items did not reach the shortlist');
     samePrimary();
     return read(primary())!.items;
    });
    Reflect.set(window,'__focusNativePushedOpen',async()=>{
     await click(control(['Open items beside'],primary()),'Open items beside');
     await until(()=>!!fixture.observe().companion?.items&&!!read(panel()),'Companion shortlist did not mount');
     samePrimary();
     return {paneId:fixture.observe().companion?.paneId,documentId:host(panel())?.dataset.sourceDocumentHost};
    });
    Reflect.set(window,'__focusNativePushedObserve',async(expected:{items:string[];selected:string[];canUndo:boolean;canRedo:boolean})=>{
     await until(()=>principalClean(expected.items)&&equals(read(panel()),expected),'Shortlist marks or grouped Undo/Redo did not settle in both views');
     samePrimary();
     return {principal:read(primary()),companion:read(panel())};
    });
    Reflect.set(window,'__focusNativePushedMark',async(items:string[])=>{
     for(const item of items){
      const button=marks(panel()).find(button=>text(button)===item);
      check(button?.getAttribute('aria-pressed')==='false','Expected an unmarked shortlist row');
      await click(button,'Review '+item);
      await until(()=>marks(panel()).find(button=>text(button)===item)?.getAttribute('aria-pressed')==='true','Real shortlist click did not mark the row');
     }
    });
    Reflect.set(window,'__focusNativePushedClose',async()=>{
     const paneId=fixture.observe().companion?.paneId;
     check(paneId,'Companion pane missing before close');
     await click(document.querySelector<HTMLButtonElement>(`[data-testid="workspace-close-tab-${paneId}"]`),'Close companion');
     await until(()=>!panel()&&fixture.observe().companion===null,'Companion shortlist did not unmount');
     return paneId;
    });
    Reflect.set(window,'__focusNativePushedPrincipal',(items:string[])=>{
     samePrimary();
     check(principalClean(items),'Retired companion token affected the principal');
     return read(primary());
    });
   }
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
  if(sourcePushed)return ['two keys undo and redo the same grouped shortlist, saved data exact and retired provider unavailable'];
  if(sourceProvider)return ['two keys used the same rehearsal provider, Apply and normal Undo changed saved order, and closing retired its token'];
  return sourceCommand
   ? ['two keys ran the same Source command instance, real companion Undo reversed it and closing retired it']
   : ['actual ProjectWorkspace Source block opened with two keys, same document saved and undone, unavailable without workspace'];
 }finally{clearTimeout(completionTimer!);}
}


export async function testLocalToolSourceCommandNative(){
 return testLocalToolSourceBlockNative(true);
}


export async function testLocalToolSourceProviderNative(){
 return testLocalToolSourceBlockNative(false,true);
}


export async function testLocalToolSourcePushedNative(){
 return testLocalToolSourceBlockNative(false,false,true);
}

/** Opt-in scenario with the normal Owned editor and ProjectWorkspace. */
export async function testLocalToolSourceOwnedNative(){
 check(await db.projects.count()===0,'Private Owned profile must start empty');
 const pending=()=>{const {pending,failed,dirty}=getPendingWritesSnapshot();return {pending,failed,dirty};};
 const pendingBefore=pending();
 const {withOwnedBlockPanelFixture}=await import('./local-tool-beside.browser');
 let completionTimer:ReturnType<typeof setTimeout>;
 const finished=new Promise<{ok:boolean;error?:string}>(resolve=>{
  completionTimer=setTimeout(()=>resolve({ok:false,error:'Owned panel Native driver did not finish'}),180000);
  Reflect.set(window,'__focusNativeFinish',resolve);
 });
 const panels=()=>Array.from(document.querySelectorAll<HTMLElement>('[data-owned-block-panel]'));
 const unavailable=()=>Array.from(document.querySelectorAll<HTMLElement>('[data-owned-block-panel-unavailable]'));
 try{
  await withOwnedBlockPanelFixture(async fixture=>{
   const {projectId,ownerKind,ownerId,blockId,otherOwnerId,otherEraId}=fixture;
   const inline=()=>Array.from(document.querySelectorAll<HTMLElement>('[data-wh-source-live-view][data-source-block-id]')).filter(node=>node.dataset.sourceBlockId===blockId&&!node.closest('[data-owned-block-panel]'));
   await until(()=>inline().length===1,'Actual Owned inline editor did not mount');
   const original=inline()[0],primary=document.querySelector('[data-testid="workspace-primary"]');
   check(primary&&panels().length===0&&unavailable().length===0,'Owned Native fixture must start without a focal panel');
   const saved=async()=>{
    const project=await db.projects.get(projectId);
    const codex=await db.codexEntries.where('projectId').equals(projectId).toArray();
    const variants=await db.worldEraVariants.where('projectId').equals(projectId).toArray();
    const eras=project?.worldEras??[];
    check(project&&codex.some(row=>row.id===ownerId)&&codex.some(row=>row.id===otherOwnerId)&&eras.some(row=>row.id===otherEraId),'Owned fixture lost a durable control');
    return {project,codex:codex.sort((a,b)=>a.id.localeCompare(b.id)),variants:variants.sort((a,b)=>a.id.localeCompare(b.id)),namedEraIds:eras.map(row=>row.id),pending:pending()};
   };
   const paneId=(node:HTMLElement|undefined)=>node?.closest<HTMLElement>('[data-engine-pane-id]')?.dataset.enginePaneId;
   Reflect.set(window,'__focusNativeOwnedSnapshot',saved);
   Reflect.set(window,'__focusNativeOwnedObserve',async(expected:{phase:'initial'|'open'|'retired';paneId?:string})=>{
    await until(()=>{
     if(expected.phase==='initial')return inline().length===1&&inline()[0]===original&&!panels().length&&!unavailable().length;
     if(expected.phase==='retired')return inline().length===0&&unavailable().length===1&&paneId(unavailable()[0])===expected.paneId;
     const rows=panels(),panel=rows[0],id=paneId(panel);
     return inline().length===1&&inline()[0]===original&&rows.length===1&&panel.dataset.ownedBlockPanel===blockId&&
      !panel.closest('[hidden]')&&!!id&&(!expected.paneId||id===expected.paneId)&&!unavailable().length;
    },'Owned panel DOM did not settle in phase '+expected.phase);
    await act(async()=>{await pause();});
    check(document.querySelector('[data-testid="workspace-primary"]')===primary,'Focal open replaced the primary workspace');
    const shown=expected.phase==='retired'?unavailable()[0]:panels()[0];
    return {phase:expected.phase,paneId:paneId(shown)??null,inlineCount:inline().length,sameInline:inline()[0]===original,
     panelCount:panels().length,unavailableCount:unavailable().length,blockId:shown?.dataset.ownedBlockPanel??null,
     title:shown?.querySelector('h2,h3')?.textContent?.trim()??null};
   });
   Reflect.set(window,'__focusNativeOwnedRetire',fixture.retireOwner);
   Reflect.set(window,'__focusNativeReady',{projectId,ownerKind,ownerId,blockId,otherOwnerId,otherEraId,ownedHostMounted:true});
   const completion=await finished;
   check(completion.ok,completion.error??'Owned panel Native driver failed');
  });
  const cleanup={projects:await db.projects.count(),ownedInline:document.querySelectorAll('[data-wh-source-live-view][data-source-block-id]').length,
   ownedPanels:panels().length,unavailablePanels:unavailable().length,pendingExact:JSON.stringify(pending())===JSON.stringify(pendingBefore)};
  check(cleanup.projects===0&&cleanup.ownedInline===0&&cleanup.ownedPanels===0&&cleanup.unavailablePanels===0&&cleanup.pendingExact,'Owned Native fixture cleanup failed');
  Reflect.set(window,'__focusNativeOwnedCleanupReceipt',cleanup);
  return ['two authenticated keys used the same exact Owned companion without writing or retargeting'];
 }finally{clearTimeout(completionTimer!);}
}

/** Opt-in with the real compiled Quest log module and Source editor. */
export async function testLocalToolSourceDerivedNative(){
 check(await db.projects.count()===0,'Private derived-agent profile must start empty');
 const pending=()=>{const {pending,failed,dirty}=getPendingWritesSnapshot();return {pending,failed,dirty};};
 const pendingBefore=pending();
 const [
  {default:definition},{registerLocalToolModules},{getEngine},{createSourceToolDocument},{createLocalToolClient},
  {saveWorldEra},{deleteProject},{createRoot},{MemoryRouter,Route,Routes,useParams},
  {default:MainLayout},{default:ProjectWorkspace},{useLocaleStore},{tabsStorageKey},
 ]=await Promise.all([
  import('@/engines/local/installed/examples.derived-quest/module'),import('@/engines/local/registry'),
  import('@/engines/_registry'),import('@/engines/local/documents/store'),import('@/engines/local/storage'),
  import('@/services/worldEras/store'),import('@/db/operations'),import('react-dom/client'),import('react-router-dom'),
  import('@/components/layout/MainLayout'),import('@/components/project/workspace/ProjectWorkspace'),
  import('@/stores/localeStore'),import('@/components/project/workspace/workspaceTabs'),
 ]);
 const namespace=definition.namespace;
 check(namespace==='examples.derived-quest','Compiled Quest log module differs');
 registerLocalToolModules({'./installed/examples.derived-quest/module.tsx':{default:definition}});
 const engine=getEngine('local-tool-'+namespace);
 check(engine,'Normal Quest log engine absent');
 const projectId='native-derived-'+crypto.randomUUID(),eraId='derived-control-era';
 const container=document.createElement('div');
 container.style.height='100vh';
 document.body.append(container);
 const root=createRoot(container);
 let created=false,completionTimer:ReturnType<typeof setTimeout>|undefined;
 const {locale:previousLocale,loaded:previousLocaleLoaded}=useLocaleStore.getState();
 try{
  await db.projects.add({id:projectId,title:'Derived operation fixture',description:'Local Native QA',mode:'custom',type:'standalone',status:'draft',color:'#777777',
   enabledEngines:[engine.id],engineOrder:[engine.id],createdAt:1,updatedAt:1});
  created=true;
  await saveWorldEra(projectId,{id:eraId,name:'Named control era',description:'Keep its own Quest state',revision:0,createdAt:1,updatedAt:1},null);
  const own=await createSourceToolDocument({projectId},namespace,'Native quest document',{initialActions:[
   {type:'set',field:'title',value:'Native quest Ω'},{type:'set',field:'briefing',value:'Unexposed briefing β'},
  ]});
  const sibling=await createSourceToolDocument({projectId},namespace,'Independent control quest',{initialActions:[
   {type:'set',field:'title',value:'Independent control'},{type:'set',field:'score',value:3},
  ]});
  const eraClient=createLocalToolClient(projectId,definition,{documentId:own.id,eraId});
  const inherited=await eraClient.read();
  check(inherited.provenance==='base'&&inherited.document,'Named era did not begin from the real Source document');
  await eraClient.save({...inherited.data,score:19},inherited.revision,inherited.document.version);
  check((await eraClient.read()).provenance==='variant','Named control has no real era variant');
  const Engine=engine.component;
  function Workspace(){
   const {id}=useParams();
   return createElement(ProjectWorkspace,{projectId:id!,engines:[engine!],children:createElement(Engine,{projectId:id!})});
  }
  const url='/project/'+encodeURIComponent(projectId)+'/'+engine.id+'?document='+encodeURIComponent(own.id);
  useLocaleStore.setState({locale:'en',loaded:true});
  await act(async()=>{
   root.render(createElement(MemoryRouter,{initialEntries:[url]},createElement(Routes,null,
    createElement(Route,{element:createElement(MainLayout)},createElement(Route,{path:'/project/:id/:tab',element:createElement(Workspace)})))));
   await pause();
  });
  const host=()=>container.querySelector<HTMLElement>('[data-source-document-host="'+own.id+'"]');
  const state=()=>{
   const view=host()?.querySelector<HTMLElement>('section[aria-label="Quest log"]'),title=view?.querySelector<HTMLInputElement>('form input');
   if(!view||!title||title.disabled)return undefined;
   const objectives=Array.from(view.querySelectorAll<HTMLLabelElement>('ul li label'),label=>({text:label.textContent?.trim(),done:label.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked}));
   return {title:title.value,score:view.querySelector('[aria-live="polite"]')?.textContent?.trim(),objectives};
  };
  await until(()=>state()?.title==='Native quest Ω','The normal Quest log Source editor did not become ready');
  const mounted=host();
  check(mounted?.dataset.sourceDocumentView==='editor','Expected the normal Source editor surface');
  Reflect.set(window,'__focusNativeDerivedObserve',async(expected:{title:string;score:number;objectives:{text:string;done:boolean}[]})=>{
   const wanted={title:expected.title,score:'Score: '+expected.score+' · Not ready',objectives:expected.objectives.map(({text,done})=>({text,done}))};
   await until(()=>JSON.stringify(state())===JSON.stringify(wanted),'Quest log UI did not observe the exact persisted edit');
   check(host()===mounted,'Quest log Source host remounted during the MCP operation');
   return state();
  });
  Reflect.set(window,'__focusNativeDerivedControls',async()=>{
   const project=await db.projects.get(projectId);
   check(project,'Native fixture project disappeared');
   const {updatedAt,sourceToolDocuments,...projectMetadata}=project;
   const variants=await db.worldEraVariants.where('projectId').equals(projectId).toArray();
   const documents=sourceToolDocuments??[];
   return {projectMetadata,documentIds:documents.map(row=>row.id).sort(),otherDocuments:documents.filter(row=>row.id!==own.id),variants:variants.sort((a,b)=>a.id.localeCompare(b.id)),pending:pending()};
  });
  const finished=new Promise<{ok:boolean;error?:string}>(resolve=>{
   completionTimer=setTimeout(()=>resolve({ok:false,error:'Derived operation Native driver did not finish'}),180000);
   Reflect.set(window,'__focusNativeFinish',resolve);
  });
  Reflect.set(window,'__focusNativeReady',{projectId,namespace,documentId:own.id,controlId:sibling.id,eraId,sourceHostMounted:true});
  const completion=await finished;
  check(completion.ok,completion.error??'Derived operation Native driver failed');
 }finally{
  clearTimeout(completionTimer);
  await act(async()=>root.unmount());
  container.remove();
  if(created)await deleteProject(projectId);
  localStorage.removeItem(tabsStorageKey(projectId));
  useLocaleStore.setState({locale:previousLocale,loaded:previousLocaleLoaded});
 }
 const cleanup={projects:await db.projects.count(),sourceHosts:document.querySelectorAll('[data-source-document-host]').length,pendingExact:JSON.stringify(pending())===JSON.stringify(pendingBefore)};
 check(cleanup.projects===0&&cleanup.sourceHosts===0&&cleanup.pendingExact&&await db.worldEraVariants.where('projectId').equals(projectId).count()===0,'Derived Native fixture cleanup failed');
 Reflect.set(window,'__focusNativeBlockCleanupReceipt',cleanup);
 return ['two Native keys described and used compiled Quest log operations with exact baselines, scoped Undo, and protected controls'];
}
