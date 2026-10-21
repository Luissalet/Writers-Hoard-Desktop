import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import Dashboard from '@/pages/Dashboard';
import { useLocaleStore } from '@/stores/localeStore';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import { seedDuplicateCore } from './project-duplicate.browser';
import { duplicateProject, previewProjectDuplicate } from '@/services/projectDuplicate/service';

const channel=window as unknown as Record<string,any>,pause=()=>new Promise(resolve=>setTimeout(resolve,30));let sequence=0;
const assert:(value:unknown,message:string)=>asserts value=(value,message)=>{if(!value)throw Error(message);};
async function wait(check:()=>boolean,label:string){for(let i=0;i<400;i++){if(check())return;await act(async()=>{await pause();});}throw Error(`Duplicate UI timeout ${label}: ${document.querySelector('[role=alert]')?.textContent}`);}
async function native(events:unknown[]){const n=++sequence;await act(async()=>{channel.__native={n,events};await wait(()=>channel.__nativeAck===n,'native acknowledgment');});}
async function click(node:HTMLElement){node.scrollIntoView({block:'center',behavior:'instant'});let last='',stable=0;await wait(()=>{const r=node.getBoundingClientRect(),next=[r.x,r.y,r.width,r.height].map(Math.round).join(',');stable=last===next?stable+1:0;last=next;return stable>=2;},'stable geometry');const r=node.getBoundingClientRect();assert(r.width&&r.height&&r.top>=0&&r.bottom<=innerHeight,'visible control');const point={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1};await native([{type:'mouseDown',...point},{type:'mouseUp',...point}]);}
async function shot(name:string){channel.__shot={name};await wait(()=>channel.__shotDone===name,'screenshot');}
function Location(){const location=useLocation();return <output data-testid="duplicate-location">{location.pathname}</output>;}
export async function testProjectDuplicateLayout(){
 const root=createRoot(document.getElementById('root')!),out:string[]=[];useLocaleStore.setState({locale:'es'});
 try{for(const width of[1440,640]){
  const{id,parent}=await seedDuplicateCore(),copies:string[]=[];
  try{
   const n=++sequence;await act(async()=>{channel.__want={w:width,h:1000,n};await wait(()=>channel.__sizeAck===n,'resize');root.render(<MemoryRouter key={width}><Dashboard/><Location/></MemoryRouter>);await pause();});
   await wait(()=>Array.from(document.querySelectorAll('article')).some(node=>node.textContent?.includes('Local synthetic world')),'actual Dashboard project card');
   const article=Array.from(document.querySelectorAll('article')).find(node=>node.textContent?.includes('Local synthetic world'))!;
   await click(article.querySelector<HTMLElement>('button[aria-label="Duplicar proyecto"]')!);await wait(()=>!!document.querySelector('[data-testid=project-duplicate-modal]'),'modal');
   const input=document.querySelector<HTMLInputElement>('[data-testid=project-duplicate-name]')!;await click(input);await wait(()=>document.activeElement===input&&!input.disabled,'native title focus');await native([{type:'keyDown',keyCode:'A',modifiers:['control']},{type:'keyUp',keyCode:'A',modifiers:['control']}]);await wait(()=>input.selectionStart===0&&input.selectionEnd===input.value.length,'native select whole title');await native([{type:'text',text:`Copia revisada ${width}`}]);await wait(()=>input.value===`Copia revisada ${width}`,'native copy title');
   const button=document.querySelector<HTMLButtonElement>('[data-testid=project-duplicate-apply]')!;await wait(()=>!button.disabled,'real source preview');
   const details=document.querySelector<HTMLElement>('[data-testid=project-duplicate-modal] summary')!;await click(details);
   assert(document.querySelector('[data-testid=duplicate-location]')?.textContent==='/'&&document.documentElement.scrollWidth<=innerWidth+1,'opening action navigated or narrow overflow');
   await shot(`project-duplicate-review-${width}`);await click(button);
   await wait(()=>!document.querySelector('[data-testid=project-duplicate-modal]'),'normal completion/navigation');
   const copy=(await db.projects.toArray()).find(project=>project.title===`Copia revisada ${width}`)!;assert(copy&&copy.id!==id,'actual copy not persisted');copies.push(copy.id);
   await wait(()=>document.querySelector('[data-testid=duplicate-location]')?.textContent===`/project/${copy.id}`,'actual Dashboard router destination');
   assert((await db.codexEntries.where('projectId').equals(copy.id).count())===1&&copy.worldEras?.length===1&&(await db.projects.get(id))!.title==='Local synthetic world','normal UI lost source/copy data');
   window.scrollTo({top:0,behavior:'instant'});await shot(`project-duplicate-created-${width}`);
   out.push(`Actual Dashboard/card/modal CSS ${width}px: native pointer and keyboard title, source summary/disclosure, no accidental navigation/overflow, persisted Base+era copy and normal router destination`);
  }finally{await act(async()=>root.render(<div/>));for(const copy of copies)await deleteProject(copy);await deleteProject(id);await deleteProject(parent);}
 }return out;}finally{await act(async()=>root.unmount());}
}
export async function testProjectDuplicateRecoveryLayout(){
 const{id,parent}=await seedDuplicateCore(),operationId=crypto.randomUUID(),target=`proj_copy_${operationId}`,root=createRoot(document.getElementById('root')!);
 try{
  await channel.qaNative.duplicateFixture({projectId:id,binding:true,failTarget:target,fail:true});
  const preview=await previewProjectDuplicate({projectId:id}),created=await duplicateProject({projectId:id,title:'Copia pendiente recuperable',operationId,expectedSourceVersion:preview.sourceVersion});assert(!created.complete,'real native fault did not leave pending recovery');
  const n=++sequence;await act(async()=>{channel.__want={w:640,h:1000,n};await wait(()=>channel.__sizeAck===n,'resize');root.render(<MemoryRouter><Dashboard/><Location/></MemoryRouter>);await pause();});
  await wait(()=>Array.from(document.querySelectorAll('article')).some(node=>node.textContent?.includes('Local synthetic world')),'source card after reopening');
  const article=Array.from(document.querySelectorAll('article')).find(node=>node.textContent?.includes('Local synthetic world'))!;await click(article.querySelector<HTMLElement>('button[aria-label="Duplicar proyecto"]')!);
  await wait(()=>document.querySelector<HTMLInputElement>('[data-testid=project-duplicate-name]')?.value==='Copia pendiente recuperable','stored operation restored');
  const button=document.querySelector<HTMLButtonElement>('[data-testid=project-duplicate-apply]')!;assert(button.textContent==='Reintentar'&&!button.disabled&&document.querySelector<HTMLInputElement>('[data-testid=project-duplicate-name]')!.disabled,'pending dialog did not retain original identity/title');
  await shot('project-duplicate-recovery-640');await channel.qaNative.duplicateFixture({projectId:id,failTarget:target,fail:false});await click(button);
  await wait(()=>document.querySelector('[data-testid=duplicate-location]')?.textContent===`/project/${target}`,'resume same destination');assert((await db.projects.toArray()).filter(project=>project.title==='Copia pendiente recuperable').length===1,'reopening generated duplicate destination');
  return['Actual640px Dashboard reopening discovers durable pending receipt/title, native Retry completes same destination and normal navigation without another project'];
 }finally{await act(async()=>root.unmount());await deleteProject(target);await deleteProject(id);await deleteProject(parent);}
}
export async function testProjectDuplicateUiAll(){return[...await testProjectDuplicateLayout(),...await testProjectDuplicateRecoveryLayout()];}
