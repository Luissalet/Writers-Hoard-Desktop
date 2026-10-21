import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import WorldFolderImportPanel from '@/components/import/WorldFolderImportPanel';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { listWorldDocuments } from '@/services/worldEras/store';
import { useLocaleStore } from '@/stores/localeStore';
import { bytesFromBase64 } from '@/services/documents/client';
import { folderProject,worldFolderFixture } from './world-folder-import.browser';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const channel=window as unknown as Record<string,any>,pause=()=>new Promise(resolve=>setTimeout(resolve,35));let sequence=0;
async function wait(check:()=>boolean,label:string){for(let i=0;i<400;i++){if(check())return;await act(async()=>{await pause();});}throw Error(`World folder UI timeout: ${label}: ${document.querySelector('[role=alert]')?.textContent}`);}
async function native(events:unknown[]){const n=++sequence;await act(async()=>{channel.__native={n,events};await wait(()=>channel.__nativeAck===n,'native ack');});}
async function click(node:HTMLElement){node.scrollIntoView({block:'center',behavior:'instant'});let last='',stable=0;await wait(()=>{const r=node.getBoundingClientRect(),next=[r.x,r.y,r.width,r.height].map(Math.round).join(',');stable=next===last?stable+1:0;last=next;return stable>=2;},'geometry');const r=node.getBoundingClientRect();assert(r.width&&r.height&&r.top>=0&&r.bottom<=innerHeight,'actual visible control');const point={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1};await native([{type:'mouseDown',...point},{type:'mouseUp',...point}]);}
const keys=(keyCode:string)=>[{type:'keyDown',keyCode},{type:'keyUp',keyCode}];
async function choose(node:HTMLSelectElement,index:number){await click(node);await native([...keys('HOME'),...Array.from({length:index},()=>keys('DOWN')).flat(),...keys('ENTER')]);await wait(()=>node.selectedIndex===index,'selected index');}
async function shot(name:string){await act(async()=>{channel.__shot={name};await wait(()=>channel.__shotDone===name,'shot');});}
export async function testWorldFolderImportLayout(){
 const out:string[]=[],root=createRoot(document.getElementById('root')!);useLocaleStore.setState({locale:'es'});
 try{for(const width of [1440,640]){
  const projectId=await folderProject(),scope={projectId,eraId:'past'};
  try{
   const n=++sequence;await act(async()=>{channel.__want={w:width,h:1000,n};await wait(()=>channel.__sizeAck===n,'size');root.render(<EnginePaneContext.Provider value={{instanceId:'folder-review',projectId,eraId:'past',visible:true,primary:true}}><main className="mx-auto max-w-6xl p-4"><WorldFolderImportPanel key={width} projectId={projectId} onChanged={()=>undefined}/></main></EnginePaneContext.Provider>);await pause();});
   const input=document.querySelector<HTMLInputElement>('[data-testid=world-folder-files]')!,transfer=new DataTransfer();
   for(const source of worldFolderFixture().files){const file=new File([bytesFromBase64(source.dataBase64)],source.path.split('/').at(-1)!);Object.defineProperty(file,'webkitRelativePath',{value:source.path});transfer.items.add(file);}
   await act(async()=>{input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));});await wait(()=>!document.querySelector<HTMLButtonElement>('[data-testid=world-folder-preview]')!.disabled,'file read');
   await click(document.querySelector<HTMLElement>('[data-testid=world-folder-preview]')!);await wait(()=>!!document.querySelector('[data-import-source="Book/Start.md"]'),'plan');
   const source=(path:string)=>document.querySelector<HTMLElement>(`[data-import-source="${path}"]`)!;
   await choose(source('Book/Start.md').querySelector('select')!,1);
   const title=source('Book/Start.md').querySelector<HTMLInputElement>('input:not([type=checkbox])')!;await click(title);await native([{type:'keyDown',keyCode:'A',modifiers:['control']},{type:'keyUp',keyCode:'A',modifiers:['control']},{type:'text',text:'La llegada revisada'}]);
   await wait(()=>source('Book/Start.md').querySelector<HTMLInputElement>('input:not([type=checkbox])')?.value==='La llegada revisada','native title intent acknowledged');
   await choose(source('data/events.csv').querySelector('select')!,2);
   const mapped=(field:string)=>source('data/events.csv').querySelector<HTMLSelectElement>(`select[aria-label="${field} data/events.csv"]`)!;
   await choose(mapped('title'),1);await choose(mapped('start'),2);await choose(mapped('end'),3);await choose(mapped('description'),4);
   await click(source('data/supplies.csv').querySelector('details > summary')!);await wait(()=>!!source('data/supplies.csv').querySelector('input[aria-label="Fila 2 data/supplies.csv"]'),'open actual row preview');await click(source('data/supplies.csv').querySelector('input[aria-label="Fila 2 data/supplies.csv"]')!);
   await wait(()=>source('data/supplies.csv').querySelector<HTMLInputElement>('input[aria-label="Fila 2 data/supplies.csv"]')?.checked===false,'native row exclusion acknowledged');
   assert(document.querySelector<HTMLButtonElement>('[data-testid=world-folder-apply]')!.disabled,'edited plan requires refresh');
   await click(document.querySelector<HTMLElement>('[data-testid=world-folder-preview]')!);await wait(()=>!document.querySelector<HTMLButtonElement>('[data-testid=world-folder-apply]')!.disabled,'recomputed plan');
   source('data/events.csv').scrollIntoView({block:'center',behavior:'instant'});assert(document.documentElement.scrollWidth<=innerWidth+1,'narrow horizontal overflow');await shot(`world-folder-review-${width}`);
   await click(document.querySelector<HTMLElement>('[data-testid=world-folder-apply]')!);await wait(()=>document.querySelector('[role=status]')?.textContent?.includes('creados')===true,'apply');
   const chapters=await listWorldDocuments(scope,'writings'),timeline=await listWorldDocuments(scope,'timeline'),tables=await listWorldDocuments(scope,'tables');assert(chapters[0].document.root.title==='La llegada revisada'&&timeline[0].document.children.timelineEvents?.length===1&&!await db.writings.where('projectId').equals(projectId).count()&&(tables.find(read=>read.document.root.title==='supplies')!.document.root.rows as unknown[]).length===1,'actual edited scoped destinations and row exclusion '+JSON.stringify({chapters,timeline,tables}));
   window.scrollTo({top:0,behavior:'instant'});await shot(`world-folder-created-${width}`);
   const undo=Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button=>button.textContent?.includes('Deshacer lote'))!;await click(undo);await wait(()=>document.querySelector('[role=status]')?.textContent?.includes('deshecho')===true,'undo');assert(!(await listWorldDocuments(scope,'writings')).length&&!(await listWorldDocuments(scope,'timeline')).length,'actual undo');
   out.push(`Actual CSS ${width}px: folder intake, native chapter title/destination and CSV event mappings, refresh/apply, effective era data and Undo`);
  }finally{await deleteProject(projectId);}
 }return out;}finally{await act(async()=>root.unmount());}
}
