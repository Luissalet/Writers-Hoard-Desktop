import '@/engines';
import {act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route,useLocation} from 'react-router-dom';
import {db} from '@/db';
import type {Project} from '@/types';
import {deleteProject,exportFullDatabase,importFullDatabase,getAllProjects,getProjectsVersion} from '@/db/operations';
import {setProjectPinned} from '@/services/projectPin/store';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {undoAuditEntry} from '@/services/aiBridge/undo';
import ProjectCard from '@/components/bubbles/ProjectCard';
import {useLocaleStore} from '@/stores/localeStore';
import {useAppStore} from '@/stores/appStore';
import {t} from '@/i18n/useTranslation';
import MainLayout from '@/components/layout/MainLayout';
import ProjectDetail from '@/pages/ProjectDetail';
import Dashboard from '@/pages/Dashboard';
import {codexDraftStore} from '@/components/codex/codexDrafts';
const qa=window as any;let seq=0;
const pause=(ms=40)=>new Promise(r=>setTimeout(r,ms));
function check(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
const project=(id:string):Project=>({id,title:id,description:'Preserve 🧭',mode:'custom',type:'standalone',color:'#aabbcc',status:'draft',enabledEngines:['codex'],engineOrder:['codex'],genres:['Fantasy'],createdAt:7,updatedAt:19});
async function refused(action:()=>Promise<unknown>,label:string){let failed=false;try{await action();}catch{failed=true;}check(failed,label+' was accepted');}
export async function testProjectPinIndependent(){
 const P='own-pin-one',Q='own-pin-two',results:string[]=[];await db.projects.bulkPut([project(P),{...project(Q),updatedAt:20}]);
 try{
  const original=(await db.projects.get(P))!;
  const raced=await Promise.allSettled([setProjectPinned(P,true,false),setProjectPinned(P,true,false)]);
  check(raced.filter(x=>x.status==='fulfilled').length===1&&raced.filter(x=>x.status==='rejected').length===1,'Competing stale flag writers both succeeded');
  const current=(await db.projects.get(P))!,withoutPin=({pinned:_p,updatedAt:_u,...row}:Project)=>row;
  check(JSON.stringify(withoutPin(current))===JSON.stringify(withoutPin(original)),'CAS winner replaced unrelated metadata');
  const noop=await runBridgeTool('wh_project_pin_set',{projectId:P,pinned:true,expectedPinned:true});
  check(noop.ok&&(noop.result as any).changed===false&&!(noop.result as any).__audit,'No-op produced mutation audit');
  check(JSON.stringify(await db.projects.get(P))===JSON.stringify(current),'No-op changed timestamp or project data');
  results.push('Concurrent field CAS has one winner; no-op leaves project bytes/timestamp unchanged and has no audit receipt');
  const version=getProjectsVersion();
  await refused(()=>db.transaction('rw',db.projects,async()=>{await setProjectPinned(P,false,true);check(getProjectsVersion()===version,'Announced before outer commit');await db.projects.update(P,{description:'Must roll back'});throw Error('own outer abort');}),'Outer rollback');
  check(JSON.stringify(await db.projects.get(P))===JSON.stringify(current)&&getProjectsVersion()===version,'Aborted pin leaked project or notification');
  await setProjectPinned(P,false,true);check((await db.projects.get(P))!.pinned===false,'Retry after rollback lost capability');
  results.push('Outer transaction does not announce early; abort restores pin and unrelated edits, then normal retry succeeds');
  const mutation=await runBridgeTool('wh_project_pin_set',{projectId:P,pinned:true,expectedPinned:false});check(mutation.ok,'Bridge pin failed');
  const audit=(mutation.result as any).__audit;check(audit,'No audit for changed pin');
  await db.projects.update(P,{description:'Later independent description',genres:['Mystery'],color:'#123456'});
  await undoAuditEntry({entry:{...audit,tool:'wh_project_pin_set'}});
  const undone=(await db.projects.get(P))!;check(undone.pinned===false&&undone.description==='Later independent description'&&undone.genres?.[0]==='Mystery'&&undone.color==='#123456','Pin Undo replaced newer independent metadata');
  results.push('Normal pin Undo preserves newer authored description, genre and color');
  const exported=await exportFullDatabase(),snapshot=JSON.stringify(await db.projects.toArray());
  for(const invalid of [null,'true',1,{},[]]){const data=structuredClone(exported);Object.assign(data.projects.find(x=>x.id===P)!,{pinned:invalid,title:'Must not partially import'});await refused(()=>importFullDatabase(data),'Malformed import '+JSON.stringify(invalid));check(JSON.stringify(await db.projects.toArray())===snapshot,'Malformed import partially changed projects');}
  const legacy=structuredClone(exported);delete legacy.projects.find(x=>x.id===P)!.pinned;await setProjectPinned(P,true,false);await importFullDatabase(legacy);check((await db.projects.get(P))!.pinned===true,'Legacy actual import erased current pin');
  const listed=(await getAllProjects()).filter(x=>[P,Q].includes(x.id));check(listed[0].id===P,'Imported pin not respected by normal project order');
  results.push('Actual full JSON import rejects five malformed pin representations atomically; legacy absence preserves current pin and ordering');
  return results;
 }finally{await deleteProject(P);await deleteProject(Q);}
}
async function until(test:()=>boolean){for(let i=0;i<220;i++){if(test())return;await act(async()=>{await pause();});}throw Error('Independent pin UI timeout');}
async function native(events:unknown[]){const n=++seq;await act(async()=>{qa.__native={n,events};await until(()=>qa.__nativeAck===n);});}
export async function testProjectPinIndependentUi(){
 useLocaleStore.setState({locale:'en'});const results:string[]=[];
 for(const width of [1440,640]){
  const P=`own-pin-ui-${width}`,initial=project(P);await db.projects.put(initial);let navigations=0;
  function Harness(){const [row,setRow]=useState(initial);return <main style={{padding:24,maxWidth:480}}><ProjectCard project={row} index={0} onClick={()=>{navigations++;}} onDelete={()=>{}} onPin={async()=>{await setProjectPinned(P,!row.pinned,row.pinned??false);setRow((await db.projects.get(P))!);}}/><button id="refresh-own-pin" onClick={async()=>setRow((await db.projects.get(P))!)}>Refresh project</button></main>;}
  const root=createRoot(document.getElementById('root')!);
  try{
   const n=++seq;qa.__want={w:width,h:900,n};await until(()=>qa.__sizeAck===n);await act(async()=>{root.render(<Harness/>);await pause();});
   const pin=()=>document.querySelector<HTMLButtonElement>('article button[aria-pressed]')!;
   check(pin()&&getComputedStyle(pin()).visibility==='visible'&&pin().getBoundingClientRect().width>=36,'Pin not reachable without hover');
   await setProjectPinned(P,true,false);pin().focus();await native([{type:'keyDown',keyCode:'Space'},{type:'keyUp',keyCode:'Space'}]);
   await until(()=>!!document.querySelector('[role="alert"]'));check((await db.projects.get(P))!.pinned===true&&navigations===0,'Stale UI overwrote pin or navigated');
   const shot=`project-pin-independent-conflict-${width}`;qa.__shot={name:shot,forcePaint:true};await until(()=>qa.__shotDone===shot);
   await act(async()=>{document.getElementById('refresh-own-pin')!.click();await pause();});await until(()=>pin().getAttribute('aria-pressed')==='true');
   pin().focus();await native([{type:'keyDown',keyCode:'Space'},{type:'keyUp',keyCode:'Space'}]);await until(()=>pin().getAttribute('aria-pressed')==='false');
   check((await db.projects.get(P))!.pinned===false&&navigations===0,'Keyboard retry did not unpin locally');
   results.push(`Native${width}: always-reachable pin, keyboard stale conflict preserves canonical flag with visible error, refresh + Space retries without navigation`);
  }finally{await act(async()=>root.unmount());await deleteProject(P);}
 }
 return results;
}
export async function testProjectSwitchDirtyIndependent(){
 const P='own-switch-first',Q='own-switch-other',E='own-switch-entry',root=createRoot(document.getElementById('root')!);
 useLocaleStore.setState({locale:'en'});useAppStore.setState({sidebarOpen:true,sidebarHidden:false,motion:'reduce'});
 await db.projects.bulkPut([{...project(P),title:'First world'},{...project(Q),title:'Other world'}]);
 await db.codexEntries.put({id:E,projectId:P,type:'concept',title:'Saved switch idea',fields:{origin:'Canonical origin'},content:'<p>Canonical body</p>',tags:[],relations:[],createdAt:1,updatedAt:1});
 const canonical=JSON.stringify(await db.codexEntries.get(E));
 const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(n=>n.textContent?.trim()===text)!;
 const title=()=>document.querySelector<HTMLInputElement>(`input[placeholder="${t('codex.entryName')}"]`);
 async function click(node:HTMLElement){check(node,'Switch control missing');node.scrollIntoView({block:'center',behavior:'instant'});const r=node.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);await native([{type:'mouseMove',x,y},{type:'mouseDown',x,y,button:'left',clickCount:1},{type:'mouseUp',x,y,button:'left',clickCount:1}]);}
 function Probe(){const location=useLocation();return <output id="own-switch-route" style={{display:'none'}}>{location.pathname}</output>;}
 const route=()=>document.getElementById('own-switch-route')!.textContent;
 const home=()=>document.querySelector<HTMLElement>('aside a[aria-label="Home"]')!;
 const canonUnchanged=async()=>check(JSON.stringify(await db.codexEntries.get(E))===canonical,'Navigation changed canonical Codex row before Save');
 try{
  const n=++seq;qa.__want={w:1440,h:1000,n};await until(()=>qa.__sizeAck===n);
  await act(async()=>{root.render(<MemoryRouter initialEntries={[`/project/${P}/codex?entry=${E}`]}><Probe/><Routes><Route element={<MainLayout/>}><Route path="/" element={<Dashboard/>}/><Route path="/project/:id" element={<ProjectDetail/>}/><Route path="/project/:id/:tab" element={<ProjectDetail/>}/></Route></Routes></MemoryRouter>);await pause();});
  await until(()=>!!button('Edit'));await click(button('Edit'));await until(()=>!!title());await click(title()!);
  await native([{type:'keyDown',keyCode:'A',modifiers:['control']},{type:'keyUp',keyCode:'A',modifiers:['control']}]);await native([{type:'text',text:'Unsaved voyage 🧭'}]);
  await until(()=>codexDraftStore(P).get(E)?.title==='Unsaved voyage 🧭');await canonUnchanged();
  await native([{type:'keyDown',keyCode:'Escape'},{type:'keyUp',keyCode:'Escape'}]);check(title()?.value==='Unsaved voyage 🧭','Dirty Escape dismissed form');
  await click(button('Cancel'));await until(()=>!title());check(codexDraftStore(P).get(E)?.title==='Unsaved voyage 🧭','Cancel discarded journal');
  await click(home());await until(()=>route()==='/');await canonUnchanged();
  await until(()=>!!button('Other world'));await click(button('Other world'));await until(()=>route()===`/project/${Q}/overview`);await canonUnchanged();check(codexDraftStore(Q).size===0,'First world draft contaminated second world');
  await click(home());await until(()=>route()==='/');await until(()=>!!button('First world'));await click(button('First world'));await until(()=>route()===`/project/${P}/overview`);
  const codex=[...document.querySelectorAll<HTMLAnchorElement>('aside a')].find(a=>a.getAttribute('href')===`/project/${P}/codex`)!;await click(codex);await until(()=>route()===`/project/${P}/codex`);
  await until(()=>!![...document.querySelectorAll<HTMLButtonElement>('#main-content button')].find(b=>b.querySelector('h3')?.textContent==='Saved switch idea'));
  await click([...document.querySelectorAll<HTMLButtonElement>('#main-content button')].find(b=>b.querySelector('h3')?.textContent==='Saved switch idea')!);await until(()=>!!button('Edit'));await click(button('Edit'));await until(()=>title()?.value==='Unsaved voyage 🧭');
  await canonUnchanged();check(document.body.textContent?.includes(t('codex.draftRecovered')),'Recovered form lacks visible journal notice');
  const shot='project-switch-dirty-recovered-1440';qa.__shot={name:shot,forcePaint:true};await until(()=>qa.__shotDone===shot);
  await click(button(t('codex.saveChanges')));for(let i=0;i<150&&(await db.codexEntries.get(E))!.title!=='Unsaved voyage 🧭';i++)await act(async()=>{await pause();});
  check((await db.codexEntries.get(E))!.title==='Unsaved voyage 🧭'&&!codexDraftStore(P).has(E),'Explicit Save did not commit/retire journal');
  return ['Native1440 actual MainLayout/Sidebar→Dashboard→other project→Dashboard→first project→Codex: dirty Escape guarded; Cancel retains journal; recovered title returns with no canonical write until explicit Save'];
 }finally{await act(async()=>root.unmount());codexDraftStore(P).clear();codexDraftStore(Q).clear();await deleteProject(P);await deleteProject(Q);}
}
