import {act,useEffect} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {EnginePaneContext} from '@/engines/_shared/EnginePaneContext';
import LocalToolContextMenuHost from '@/engines/local/LocalToolContextMenuHost';
import type {LocalToolContextMenuPort,LocalToolHostContext,LocalToolMenuEntry} from '@/engines/local/sdk';

// Independent public-port fixture; the presenter and its listeners remain product code.
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,40));
async function until(checker:()=>boolean,label:string){const end=Date.now()+10000;while(Date.now()<end){if(checker())return;await act(async()=>{await pause();});}throw Error(label);}
type RealmWindow=Window&typeof globalThis;
type Handle={id:string;port?:LocalToolContextMenuPort;admitted?:boolean;invoked:number;identity:object;context:LocalToolHostContext;entries:LocalToolMenuEntry[]};
function handle(id:string):Handle{
 const result:Handle={id,invoked:0,identity:{},context:{view:'editor',canEdit:true,scope:{projectId:'review-menu-realm'},document:{id,namespace:'review.menu-realm',title:id}},entries:[]};
 result.entries=[{kind:'item',id:'act',label:'Act '+id,onSelect:()=>{result.invoked++;}}];return result;
}
function Trigger({owner,context}:{owner:Handle;context:LocalToolHostContext}){
 useEffect(()=>{owner.port=context.contextMenu;return()=>{if(owner.port===context.contextMenu)owner.port=undefined;};},[owner,context.contextMenu]);
 return <button type="button" data-review-trigger={owner.id} onContextMenu={event=>{owner.admitted=context.contextMenu?.open(event,owner.entries,{label:'Review '+owner.id});}}>Actions {owner.id}</button>;
}
function Host({owner}:{owner:Handle}){return <EnginePaneContext.Provider value={{instanceId:'pane-'+owner.id,projectId:owner.context.scope.projectId,visible:true}}><LocalToolContextMenuHost context={owner.context} identity={owner.identity} releaseHash="review-release">{context=><Trigger owner={owner} context={context}/>}</LocalToolContextMenuHost></EnginePaneContext.Provider>;}
async function withRealm(work:(main:Handle,frameOwner:Handle,frameDocument:Document,frameWindow:RealmWindow)=>Promise<void>){
 const container=document.createElement('div'),iframe=document.createElement('iframe');let mainRoot:Root|undefined,frameRoot:Root|undefined;
 container.dataset.reviewRealmFixture='';document.getElementById('root')!.append(container);
 iframe.title='Independent SDK menu realm';iframe.width='640';iframe.height='360';container.append(iframe);
 try{
  const frameDocument=iframe.contentDocument!,frameWindow=iframe.contentWindow as RealmWindow;
  check(frameDocument&&frameWindow,'Fixture iframe must have a real same-origin document/window');
  frameDocument.open();frameDocument.write('<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body class="bg-deep text-text-primary"><div id="frame-root"></div><button id="frame-outside">Outside owner root</button><div id="css-control" class="fixed z-[90] w-60" style="visibility:hidden;top:-1000px">CSS control</div></body></html>');frameDocument.close();
  const sheets=[...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')];
  check(sheets.length>0,'CSS-normal runner must supply actual product stylesheets');
  await Promise.all(sheets.map(source=>new Promise<void>((resolve,reject)=>{const link=frameDocument.createElement('link');link.rel='stylesheet';link.href=source.href;link.onload=()=>resolve();link.onerror=()=>reject(Error('Actual product stylesheet failed inside frame: '+source.href));frameDocument.head.append(link);})));
  const control=frameDocument.getElementById('css-control')!,computed=frameWindow.getComputedStyle(control);
  check(computed.position==='fixed'&&computed.zIndex==='90'&&control.getBoundingClientRect().width>0,'Product CSS must be effective inside the real iframe');
  const main=handle('main'),frameOwner=handle('frame'),mainMount=document.createElement('div');container.prepend(mainMount);
  mainRoot=createRoot(mainMount);frameRoot=createRoot(frameDocument.getElementById('frame-root')!);
  await act(async()=>{mainRoot!.render(<Host owner={main}/>);frameRoot!.render(<Host owner={frameOwner}/>);await pause();});
  await until(()=>!!main.port&&!!frameOwner.port,'Product menu ports must commit in both actual ownerDocuments');
  await work(main,frameOwner,frameDocument,frameWindow);
 }finally{await act(async()=>{mainRoot?.unmount();frameRoot?.unmount();await pause();});container.remove();}
}
async function open(owner:Handle,doc:Document,realm:RealmWindow){
 const trigger=doc.querySelector<HTMLElement>('[data-review-trigger="'+owner.id+'"]');check(trigger,'Real trigger missing: '+owner.id);
 const event=new realm.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:60,clientY:80});
 await act(async()=>{trigger.dispatchEvent(event);await pause();});return{trigger,event};
}

/** Preliminary export: only the real cross-realm admission/Node seam, before fix. */
export async function testReviewLocalToolContextMenuRealm(){
 await withRealm(async(main,frameOwner,frameDocument,frameWindow)=>{
  const first=await open(main,document,window as RealmWindow),mainMenu=document.querySelector<HTMLElement>('[data-local-tool-context-menu]');
  check(main.admitted===true&&first.event.defaultPrevented&&mainMenu?.ownerDocument===document,'Positive control: ordinary same-realm product menu must be admitted and consume its event');
  check(mainMenu.dataset.enginePaneId==='pane-main'&&mainMenu.contains(document.activeElement),'Positive control: real presenter must carry its pane and focus');
  await act(async()=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Escape'}));await pause();});
  check(!document.querySelector('[data-local-tool-context-menu]')&&document.activeElement===first.trigger,'Positive control: ordinary menu closes and restores trigger');

  const target=frameDocument.querySelector<HTMLElement>('[data-review-trigger="frame"]')!;
  check(target instanceof frameWindow.HTMLElement&&!(target instanceof HTMLElement),'Fixture must use a genuine iframe HTMLElement from a distinct realm');
  check(target.ownerDocument===frameDocument&&frameDocument!==document&&target.isConnected,'Fixture trigger must be connected to its actual foreign document');
  const second=await open(frameOwner,frameDocument,frameWindow);
  check(frameOwner.admitted===true,'REVIEW_REALM_F1: live ownerDocument iframe trigger was rejected despite committed host, connected own-root trigger and real frame CSS');
  const frameMenu=frameDocument.querySelector<HTMLElement>('[data-local-tool-context-menu]');
  check(second.event.defaultPrevented&&frameMenu?.parentElement===frameDocument.body&&frameMenu.ownerDocument===frameDocument,'Cross-realm menu must consume its event and portal into its own body');
  check(frameMenu.dataset.enginePaneId==='pane-frame'&&frameMenu.contains(frameDocument.activeElement),'Cross-realm menu must keep its actual pane and focus');
  check(!document.querySelector('[data-local-tool-context-menu]'),'Cross-realm opening must not portal into the parent document');

  const outside=frameDocument.getElementById('frame-outside')!;
  check(outside instanceof frameWindow.Node&&!(outside instanceof Node),'Outside-event positive must be a genuine Node of the iframe realm');
  await act(async()=>{outside.dispatchEvent(new frameWindow.PointerEvent('pointerdown',{bubbles:true,cancelable:true}));await pause();});
  check(!frameDocument.querySelector('[data-local-tool-context-menu]'),'REVIEW_REALM_F2: actual foreign-realm outside pointer Node did not close its menu');
  check(main.invoked===0&&frameOwner.invoked===0,'Presentation/open/close probe must not select an action');
 });
 return ['Independent real iframe realm: same-realm positive, foreign HTMLElement admitted into own body/pane, foreign outside Node closes without invoking'];
}

import {ToastHost} from '@/components/common/toast';
import {t as translate} from '@/i18n/useTranslation';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {registerLocalToolModules} from '@/engines/local/registry';
import {createSourceToolDocument} from '@/engines/local/documents/store';
import {createLocalToolClient} from '@/engines/local/storage';
import {sourceDocumentPreview} from '@/engines/local/documents/preview';
import actualDefinition from '@/engines/local/installed/examples.context-counter/module';
import '@/services/aiBridge/dispatch';

function countedEvent(target:EventTarget|null){let prevented=0,stopped=0;return{currentTarget:target,type:'contextmenu',clientX:70,clientY:90,preventDefault(){prevented++;},stopPropagation(){stopped++;},counts:()=>[prevented,stopped]};}
async function clickMenu(doc:Document=document){const item=doc.querySelector<HTMLButtonElement>('[data-local-tool-context-menu] [role="menuitem"]');check(item,'Independent fixture menu item missing');await act(async()=>{item.click();await pause();});}

async function reviewDocumentCoordinationAndCopies(){
 await testReviewLocalToolContextMenuRealm(); // Historical assertion body above remains unchanged.
 await withRealm(async(main,frameOwner,frameDocument,frameWindow)=>{
  const mount=document.createElement('div'),other=handle('other');document.getElementById('root')!.append(mount);const root=createRoot(mount);
  try{
   await act(async()=>{root.render(<Host owner={other}/>);await pause();});await until(()=>!!other.port,'Second main-document port did not commit');
   await open(frameOwner,frameDocument,frameWindow);check(frameOwner.admitted,'Foreign document must admit its own menu before coordination');
   await open(main,document,window as RealmWindow);check(main.admitted,'Main owner must admit its menu');
   // Moving focus between documents may legitimately close a menu. Only an
   // actually surviving frame presentation is a cross-document control here.
   const survivingFrameMenu=frameDocument.querySelector('[data-local-tool-context-menu]');
   await open(other,document,window as RealmWindow);
   const current=document.querySelector<HTMLElement>('[data-local-tool-context-menu]');
   check(current?.getAttribute('aria-label')==='Review other'&&document.querySelectorAll('[data-local-tool-context-menu]').length===1,'Same-document B must replace A with one presentation');
   if(survivingFrameMenu)check(frameDocument.querySelector('[data-local-tool-context-menu]')===survivingFrameMenu,'Same-document replacement must preserve a surviving presentation owned by another document');
   await act(async()=>{main.port!.close();await pause();});check(document.querySelector('[data-local-tool-context-menu]')===current,'Old owner close must not retire B');

   const target=document.querySelector<HTMLElement>('[data-review-trigger="other"]')!,bad=countedEvent(target);
   check(!other.port!.open(bad,[],{label:'Invalid empty request'})&&JSON.stringify(bad.counts())==='[0,0]','Invalid entries must be rejected without consuming the event');
   check(document.querySelector('[data-local-tool-context-menu]')===current,'Rejected entries must not replace the admitted presentation');
   const foreign=countedEvent(document.querySelector('[data-review-trigger="main"]'));
   check(!other.port!.open(foreign,other.entries,{label:'Foreign root'})&&JSON.stringify(foreign.counts())==='[0,0]','Connected foreign-root trigger must not be consumed');
   check(document.querySelector('[data-local-tool-context-menu]')===current,'Rejected foreign trigger must not replace the admitted presentation');

   let originalCalls=0,changedCalls=0;
   const item:Extract<LocalToolMenuEntry,{kind:'item'}>={kind:'item',id:'copy',label:'Original label',disabled:false,onSelect:()=>{originalCalls++;}};
   const entries:LocalToolMenuEntry[]=[item],options={label:'Copied request'},valid=countedEvent(target);
   await act(async()=>{check(other.port!.open(valid,entries,options),'Valid copied request must be admitted');await pause();});
   check(JSON.stringify(valid.counts())==='[1,1]','Admitted request must consume its event exactly once');
   check(!Object.isFrozen(item)&&!Object.isFrozen(entries)&&!Object.isFrozen(options),'Host must not freeze caller-owned input');
   item.label='Mutated label';item.disabled=true;item.onSelect=()=>{changedCalls++;};entries.push({kind:'label',label:'Inserted later'});options.label='Mutated request';
   const copied=document.querySelector<HTMLElement>('[data-local-tool-context-menu]')!,button=copied.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
   check(copied.getAttribute('aria-label')==='Copied request'&&button.textContent==='Original label'&&!button.disabled&&!copied.textContent?.includes('Inserted later'),'Admitted metadata and nested item must remain detached from later caller mutation');
   await clickMenu();check(originalCalls===1&&changedCalls===0&&!document.querySelector('[data-local-tool-context-menu]'),'Selection must use the original callback exactly once after copied metadata changed');
  }finally{await act(async()=>{root.unmount();await pause();});mount.remove();}
 });
 return ['Independent CSS1: real iframe realm, per-document coordination without forced focus coexistence, validation before replacement/consumption and detached entry/callback copies'];
}

function rejectionGate(){let reject!:(reason:unknown)=>void;const promise=new Promise<void>((_resolve,no)=>{reject=no;});return{promise,reject};}
async function reviewRejectedActionOwners(){
 const container=document.createElement('div');document.getElementById('root')!.append(container);const root=createRoot(container),live=handle('async-live'),retired=handle('async-retired'),replacement=handle('async-replacement');
 const first=rejectionGate(),second=rejectionGate();let firstStarted=0,secondStarted=0;
 live.entries=[{kind:'item',id:'fail-live',label:'Reject while owner lives',onSelect:()=>{firstStarted++;return first.promise;}}];
 retired.entries=[{kind:'item',id:'fail-retired',label:'Reject after owner retires',onSelect:()=>{secondStarted++;return second.promise;}}];
 const render=async(owner:Handle)=>{await act(async()=>{root.render(<><ToastHost/><Host key={owner.id} owner={owner}/></>);await pause();});await until(()=>!!owner.port,'Async fixture owner port unavailable');};
 try{
  await render(live);check(!container.querySelector('[role="alert"]'),'Async fixture must start without an unrelated alert');
  await open(live,document,window as RealmWindow);await clickMenu();check(firstStarted===1&&!document.querySelector('[data-local-tool-context-menu]'),'Admitted action must start once with its menu already closed');
  await act(async()=>{first.reject(Error('REVIEW_PRIVATE_LIVE_DIAGNOSTIC'));await pause();});
  await until(()=>container.querySelectorAll('[role="alert"]').length===1,'Closed menu with live owner must report its later rejection exactly once');
  const alert=container.querySelector<HTMLElement>('[role="alert"]')!;
  check(alert.textContent?.includes(translate('localTool.contextMenu.actionFailed'))&&!alert.textContent.includes('REVIEW_PRIVATE_LIVE_DIAGNOSTIC'),'Live-owner rejection must use the generic host message');
  await act(async()=>{alert.querySelector<HTMLButtonElement>('button')!.click();await pause();});check(!container.querySelector('[role="alert"]'),'Own live-owner alert must dismiss normally');

  await render(retired);await open(retired,document,window as RealmWindow);await clickMenu();check(secondStarted===1&&!document.querySelector('[data-local-tool-context-menu]'),'Second admitted action must start before its owner is revoked');
  await render(replacement);await open(replacement,document,window as RealmWindow);const replacementMenu=document.querySelector('[data-local-tool-context-menu]');check(replacement.admitted&&replacementMenu,'Replacement owner must have a real current menu before the stale rejection');
  await act(async()=>{second.reject(Error('REVIEW_PRIVATE_RETIRED_DIAGNOSTIC'));await pause();});
  check(!container.querySelector('[role="alert"]')&&document.querySelector('[data-local-tool-context-menu]')===replacementMenu&&replacement.invoked===0,'Retired owner rejection must neither notify nor select or replace the new owner');
  check(firstStarted===1&&secondStarted===1,'Rejection settlement must not invoke an action again');
  return ['Independent CSS2: rejection after menu close notifies its living host once; after true owner replacement it cannot notify, select or displace the new host'];
 }finally{await act(async()=>{root.unmount();await pause();});container.remove();}
}

export async function testReviewLocalToolContextMenus(){return[...await reviewDocumentCoordinationAndCopies(),...await reviewRejectedActionOwners()];}

type NativeReply={ok:boolean;result?:Record<string,unknown>;error?:unknown};
function noMenuPayload(value:unknown){check(typeof value!=='function','Serialized Native payload must not contain a callback');if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){check(!['onSelect','contextMenu','contextMenuRequests','currentTarget'].includes(key),'Ephemeral menu field entered Native data: '+key);noMenuPayload(child);}}
export async function testReviewLocalToolContextMenuNative(){
 const native=(window as unknown as{reviewMenuNative?:{execute:(tool:string,args:Record<string,unknown>)=>Promise<NativeReply>}}).reviewMenuNative;check(native,'Use the independent real Native executor wrapper');
 registerLocalToolModules({'./installed/examples.context-counter/module.tsx':{default:actualDefinition}});
 const projectId='review-context-native-'+crypto.randomUUID(),namespace=actualDefinition.namespace;
 await db.projects.put({id:projectId,title:'Independent menu data QA',description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['local-tool-'+namespace],createdAt:1,updatedAt:1});
 try{
  const own=await createSourceToolDocument({projectId},namespace,'Own reset'),sibling=await createSourceToolDocument({projectId},namespace,'Sibling control');
  const client=createLocalToolClient(projectId,actualDefinition,{documentId:own.id,requireSelectedRelease:true,releaseHash:null}),other=createLocalToolClient(projectId,actualDefinition,{documentId:sibling.id,requireSelectedRelease:true,releaseHash:null});
  await client.state!.apply(await client.read(),[{type:'set',field:'count',value:7}]);await other.state!.apply(await other.read(),[{type:'set',field:'count',value:13}]);
  const before=await db.projects.get(projectId),siblingBefore=JSON.stringify(before!.sourceToolDocuments!.find(row=>row.id===sibling.id));
  const described=await native.execute('wh_local_tool_describe',{projectId,namespace});check(described.ok,'Real describe rejected: '+JSON.stringify(described));noMenuPayload(described.result);
  check((described.result!.operations as {id:string}[]).some(operation=>operation.id==='reset'),'Actual selected definition must describe reset');check(JSON.stringify(await db.projects.get(projectId))===JSON.stringify(before),'Describe must not write fixture data');
  const reset=await native.execute('wh_local_tool_call',{projectId,namespace,documentId:own.id,operation:'reset',input:{}});check(reset.ok&&reset.result!.count===0&&typeof reset.result!.receiptId==='string','Native reset from seven must return zero and a real receipt: '+JSON.stringify(reset));noMenuPayload(reset.result);
  check((await client.read()).data.count===0&&(await other.read()).data.count===13,'Native reset must affect only its selected document');
  const undone=await native.execute('wh_local_tool_state_undo',{projectId,namespace,documentId:own.id,receiptId:reset.result!.receiptId});check(undone.ok,'Native undo rejected reset receipt: '+JSON.stringify(undone));noMenuPayload(undone.result);
  check((undone.result!.snapshot as {data:{count:number}}).data.count===7&&(await client.read()).data.count===7,'Native reset receipt Undo must restore exactly the original count');
  const after=await db.projects.get(projectId);check(JSON.stringify(after!.sourceToolDocuments!.find(row=>row.id===sibling.id))===siblingBefore,'Sibling document bytes must remain unchanged through reset and Undo');noMenuPayload(after);noMenuPayload(sourceDocumentPreview(after!.sourceToolDocuments!.find(row=>row.id===own.id)!,'en'));
  return ['Independent Native1: actual selected reset seven→zero→receipt Undo seven, sibling thirteen unchanged, describe/state/preview without ephemeral menu data'];
 }finally{await deleteProject(projectId);}
}
