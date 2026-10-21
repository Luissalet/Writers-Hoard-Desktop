import '@/engines';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import WorkspaceLibrary from '@/components/project/workspace/library/WorkspaceLibrary';
import {readWorkspaceLibrary} from '@/components/project/workspace/library/model';
import {updateWorkspaceLibrary} from '@/components/project/workspace/library/store';
import {getEraProject,listEraRows,saveWorldEra} from '@/services/worldEras/store';
import {useLocaleStore} from '@/stores/localeStore';
import {useAppStore} from '@/stores/appStore';
import {saveCodexTemplate} from '@/engines/codex/templates';
import {codexDraftStore} from '@/components/codex/codexDrafts';
import type {CodexEntry,Project} from '@/types';

const qa=window as any;let seq=0;
const pause=()=>new Promise(resolve=>setTimeout(resolve,40));
function check(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
async function until(test:()=>unknown|Promise<unknown>){for(let i=0;i<220;i++){if(await test())return;await act(async()=>{await pause();});}throw Error('Library UI timeout '+qa.__testStage);}
async function native(events:unknown[]){const n=++seq;await act(async()=>{qa.__native={n,events};await until(()=>qa.__nativeAck===n);await pause();});}
async function key(keyCode:string){await native([{type:'keyDown',keyCode},{type:'keyUp',keyCode}]);}
async function click(el:Element|null|undefined){check(el,'Missing control '+qa.__testStage);el.scrollIntoView({block:'center',behavior:'instant'});const rect=el.getBoundingClientRect(),x=Math.round(rect.x+rect.width/2),y=Math.round(rect.y+rect.height/2);check(el===document.elementFromPoint(x,y)||el.contains(document.elementFromPoint(x,y)),'Occluded '+el.outerHTML.slice(0,100));await native([{type:'mouseMove',x,y},{type:'mouseDown',x,y,button:'left',clickCount:1},{type:'mouseUp',x,y,button:'left',clickCount:1}]);}
const button=(label:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent?.trim()===label);
async function typeTitle(value:string){const el=document.querySelector<HTMLInputElement>('input[placeholder="Entry name..."]');check(el,'Normal Codex title input missing');await click(el);await native([{type:'keyDown',keyCode:'A',modifiers:['control']},{type:'keyUp',keyCode:'A',modifiers:['control']}]);await native([{type:'text',text:value}]);check(el.value===value,'Native title input mismatch');await key('TAB');}
async function shot(name:string,el:Element){el.scrollIntoView({block:'start',behavior:'instant'});check(document.documentElement.scrollWidth<=innerWidth+1,'Library page overflow');qa.__shot={name};await until(()=>qa.__shotDone===name);}

export async function testLibraryCreateUi(){
 useLocaleStore.setState({locale:'en',loaded:true});useAppStore.setState({motion:'reduce'});const results:string[]=[];
 for(const width of [1440,640])for(const eraId of [undefined,'past']){
  const P=`library-ui-${width}-${eraId??'base'}`,scope={projectId:P,eraId};qa.__testStage=P;const n=++seq;qa.__want={n,w:width,h:1000};await until(()=>qa.__sizeAck===n);
  const project:Project={id:P,title:P,description:'',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['codex'],engineOrder:['codex'],createdAt:1,updatedAt:1,workspaceRevision:0,workspaceFolders:[{id:'people',name:'People',order:0},{id:'friends',name:'Friends',parentId:'people',order:0}],workspacePlacements:[]};await db.projects.put(project);
  await saveCodexTemplate(P,{id:'library-template',name:'Short card',category:'character',fields:{Role:'Friend'},content:'<h2>Biography</h2><p>Template body retained.</p>',revision:0,createdAt:1,updatedAt:1},null);
  if(eraId)await saveWorldEra(P,{id:eraId,name:'Past',description:'',revision:0,createdAt:1,updatedAt:1},null);
  const root=createRoot(document.getElementById('root')!);
  try{
   await act(async()=>root.render(<MemoryRouter><WorkspaceLibrary projectId={P} eraId={eraId} enabledEngineIds={['codex']} onOpen={async()=>true} onManage={async()=>true}/></MemoryRouter>));await until(()=>document.querySelector('[data-library-folder="friends"]'));await click(document.querySelector('[data-library-folder="friends"]'));await click(document.querySelector('[data-testid="library-create-card"]'));await until(()=>document.querySelector('[role="dialog"] input[placeholder="Entry name..."]'));
   const destination=document.querySelector<HTMLSelectElement>('select[aria-label="New card folder"]')!;check(destination.value==='friends'&&destination.selectedOptions[0].textContent==='People / Friends','Selected folder not retained/shown');
   const template=[...document.querySelectorAll<HTMLSelectElement>('[role="dialog"] select')].find(el=>[...el.options].some(option=>option.value==='library-template'))!;check(template,'Normal template picker absent');template.focus();await key('END');await key('TAB');check(template.value==='library-template','Native template choice failed');
   await typeTitle('New card '+width+' '+(eraId??'Base'));check(document.querySelector('.tiptap')?.textContent?.includes('Template body retained.'),'Template content not applied in normal form');
   await shot('library-create-form-'+width+'-'+(eraId??'base'),destination.closest('label')!);
   if(!eraId){const revision=readWorkspaceLibrary(await getEraProject(scope)).revision;await act(async()=>{await updateWorkspaceLibrary(P,revision,{kind:'rename-folder',id:'friends',name:'Trusted friends'});});await click(button('Create Entry'));await until(()=>document.querySelector('[role="alert"]'));check(!await db.codexEntries.where('projectId').equals(P).count(),'Stale destination created card');check(document.querySelector<HTMLInputElement>('input[placeholder="Entry name..."]')!.value==='New card '+width+' Base','Conflict lost title');}
   await click(button('Create Entry'));await until(()=>!document.querySelector('[role="dialog"]'));const cards=await listEraRows<CodexEntry>(scope,'codexEntries');check(cards.length===1&&cards[0].content.includes('Template body retained.')&&cards[0].fields.Role==='Friend','Created card/template incorrect');check(readWorkspaceLibrary(await getEraProject(scope)).placements.some(row=>row.entityId===cards[0].id&&row.folderId==='friends'),'Created card not placed');check(!codexDraftStore(P,eraId).has('new'),'Normal Save left stale recovery draft');if(eraId)check(!await db.codexEntries.where('projectId').equals(P).count(),'Era UI wrote Base');await until(()=>document.querySelector('[data-library-document]'));await shot('library-created-'+width+'-'+(eraId??'base'),document.querySelector('[data-testid="workspace-library"]')!);
   results.push(`Normal native Library→nested folder→New card→template→Save ${width}/${eraId??'Base'} persists scoped card+folder with no overflow; ${eraId?'Base untouched':'stale folder conflict retains title and retries explicitly'}`);
  }finally{await act(async()=>root.unmount());await deleteProject(P);}
 }
 return results;
}
