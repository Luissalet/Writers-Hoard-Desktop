import '@/engines';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject,getAllProjects,getProjectsVersion,notifyProjectsChanged,exportProjectData,importProjectData,exportFullDatabase,importFullDatabase} from '@/db/operations';
import {createProjectZipArchive,importProjectZip,createFullZipArchive,importFullZip} from '@/services/zipBackup';
import {setProjectPinned} from '@/services/projectPin/store';
import {validateProjectArchiveMetadata,preserveLegacyProjectMetadata} from '@/services/projectArchiveMetadata';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {undoAuditEntry} from '@/services/aiBridge/undo';
import Dashboard from '@/pages/Dashboard';
import {useLocaleStore} from '@/stores/localeStore';
import {useAppStore} from '@/stores/appStore';
const qa=window as any;let seq=0;
const pause=()=>new Promise(r=>setTimeout(r,45));
function check(v:unknown,m:string):asserts v{if(!v)throw Error(m);}
const project=(id:string,updatedAt=1)=>({id,title:id,description:'Keep authored description',mode:'custom' as const,type:'standalone' as const,color:'#777777',status:'draft' as const,enabledEngines:['codex'],engineOrder:['codex'],createdAt:1,updatedAt});
async function refused(action:()=>Promise<unknown>){let failed=false;try{await action();}catch{failed=true;}check(failed,'Expected refusal');}
export async function testProjectPin(){
 const P='pin-older',N='pin-newer',clones:string[]=[],results:string[]=[];await db.projects.bulkPut([project(P),project(N,2)]);
 try{
  check((await getAllProjects()).filter(p=>[P,N].includes(p.id))[0].id===N,'Baseline recent order wrong');
  await setProjectPinned(P,true,false);check((await getAllProjects()).filter(p=>[P,N].includes(p.id))[0].id===P,'Pinned project did not lead recent project');
  await refused(()=>setProjectPinned(P,false,false));let announced=getProjectsVersion();await refused(()=>db.transaction('rw',db.projects,async()=>{await setProjectPinned(P,false,true);throw Error('outer abort');}));check((await db.projects.get(P))!.pinned===true&&getProjectsVersion()===announced,'Abort changed pin or announced uncommitted project');
  const metadata=(await db.projects.get(P))!;check(metadata.description==='Keep authored description'&&metadata.enabledEngines.join()==='codex','Pin overwrote unrelated metadata');
  const change=await runBridgeTool('wh_project_pin_set',{projectId:P,pinned:false,expectedPinned:true});check(change.ok,'Normal pin MCP failed');const audit=(change.result as any).__audit;check(audit?.before.__projectPin.from===true,'Pin audit receipt missing');await undoAuditEntry({entry:{...audit,tool:'wh_project_pin_set'}});check((await db.projects.get(P))!.pinned===true,'Normal pin Undo failed');await refused(()=>undoAuditEntry({entry:{...audit,tool:'wh_project_pin_set'}}));
  const listed=await runBridgeTool('wh_list_projects',{});check(listed.ok&&(listed.result as any).projects.find((p:any)=>p.id===P).pinned===true,'Project list does not report pin');
  results.push('Pinned-first order, normal MCP/list/Undo, field CAS, stale reversal refusal, outer rollback and unchanged unrelated metadata');
  const data=await exportProjectData(P),cloned=await importProjectData(data);clones.push(cloned);check((await db.projects.get(cloned))!.pinned===true,'Project JSON lost pin');
  const zip=await createProjectZipArchive(P);await deleteProject(P);await importProjectZip(new File([zip.blob],'pin.zip'));check((await db.projects.get(P))!.pinned===true,'Project ZIP lost pin');
  const full=await exportFullDatabase();await db.projects.update(P,{pinned:false});await importFullDatabase(full);check((await db.projects.get(P))!.pinned===true,'Full JSON lost pin');
  const all=await createFullZipArchive();await db.projects.update(P,{pinned:false});await importFullZip(new File([all.blob],'pin-all.zip'));check((await db.projects.get(P))!.pinned===true,'Full ZIP lost pin');
  check(preserveLegacyProjectMetadata({},metadata).pinned===true&&preserveLegacyProjectMetadata({pinned:false},metadata).pinned===false,'Legacy absence or explicit false semantics wrong');
  let bad=false;try{validateProjectArchiveMetadata({pinned:'yes'});}catch{bad=true;}check(bad,'Malformed pin accepted');
  const legacy=await exportFullDatabase();delete legacy.projects.find(p=>p.id===P)!.pinned;await importFullDatabase(legacy);check((await db.projects.get(P))!.pinned===true,'Actual legacy fullJSON erased pin');legacy.projects.find(p=>p.id===P)!.pinned=false;await importFullDatabase(legacy);check((await db.projects.get(P))!.pinned===false,'Actual false fullJSON did not clear pin');
  results.push('Project/full JSON/ZIP and clone carry pins; actual legacy import preserves absence, explicit false clears, malformed metadata rejects');
  return results;
 }finally{for(const id of [P,N,...clones])await deleteProject(id);}
}
async function until(check:()=>boolean){for(let i=0;i<220;i++){if(check())return;await act(async()=>{await pause();});}throw Error('Pin UI timeout '+qa.__testStage);}
async function native(events:unknown[]){const n=++seq;await act(async()=>{qa.__native={n,events};await until(()=>qa.__nativeAck===n);await pause();});}
async function click(node:HTMLElement){check(node,'Pin action missing');node.scrollIntoView({block:'center',behavior:'instant'});const r=node.getBoundingClientRect(),p={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1};await native([{type:'mouseMove',x:p.x,y:p.y},{type:'mouseDown',...p},{type:'mouseUp',...p}]);}
function Harness(){const location=useLocation();return <><output id="pin-route">{location.pathname}</output><Dashboard/></>;}
export async function testProjectPinUi(){
 useLocaleStore.setState({locale:'en'});useAppStore.setState({motion:'reduce'});const results:string[]=[];
 for(const width of [1440,640]){
  const P=`Pinned world${width}`,N=`Recent world${width}`;await db.projects.bulkPut([project(P),project(N,2)]);const root=createRoot(document.getElementById('root')!);
  const cards=()=>[...document.querySelectorAll<HTMLElement>('article')].filter(node=>node.querySelector('h3'));
  try{
   qa.__testStage='pin '+width;const n=++seq;qa.__want={w:width,h:1000,n};await until(()=>qa.__sizeAck===n);await act(async()=>root.render(<MemoryRouter><Harness/></MemoryRouter>));await until(()=>cards().length===2);
   check(cards()[0].textContent?.includes(N),'Dashboard did not use normal recent order');const older=cards().find(node=>node.textContent?.includes(P))!;await click(older.querySelector<HTMLButtonElement>('button[aria-label="Pin to front"]')!);await until(()=>cards()[0].textContent?.includes(P)===true&&!!cards()[0].querySelector('button[aria-pressed="true"]'));
   check(document.getElementById('pin-route')!.textContent==='/'&&(await db.projects.get(P))!.pinned,'Pin click navigated or did not persist');
   await act(async()=>{notifyProjectsChanged();await pause();});await until(()=>cards()[0].textContent?.includes(P)===true);
   check(document.documentElement.scrollWidth<=innerWidth+1,'Dashboard overflow with pins');const shot=`project-pin-${width}`;qa.__shot={name:shot,forcePaint:true};await until(()=>qa.__shotDone===shot);
   await click(cards()[0].querySelector<HTMLButtonElement>('button[aria-label="Unpin project"]')!);await until(()=>!(cards().find(node=>node.textContent?.includes(P))!.querySelector('button[aria-pressed="true"]')));check((await db.projects.get(P))!.pinned===false,'Unpin failed');
   results.push(`Native${width} normal Dashboard: pin moves project first, survives refresh, unpin persists, no navigation or overflow`);
  }finally{await act(async()=>root.unmount());await deleteProject(P);await deleteProject(N);}
 }
 return results;
}
