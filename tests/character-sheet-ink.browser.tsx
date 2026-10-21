import { act,createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import JSZip from 'jszip';
import { db } from '@/db';
import { createSheet,exportSheet,parseSheetImport,validateSheet } from '@/engines/character-sheets/types';
import { applySheetInk,validSheetInk,type SheetInkStroke } from '@/engines/character-sheets/ink';
import { sheetPaper } from '@/engines/character-sheets/paper';
import { saveSheet } from '@/engines/character-sheets/operations';
import CharacterSheetsEngine from '@/engines/character-sheets/CharacterSheetsEngine';
import ReadingView from '@/engines/writings/components/ReadingView';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { saveWorldEra,getEraProject } from '@/services/worldEras/store';
import { createProjectZipArchive,importProjectZip } from '@/services/zipBackup';
import { exportProjectData,importProjectData } from '@/db/operations';
import type { CharacterSheet } from '@/engines/character-sheets/types';
import type { Writing } from '@/types';

const P='sheet-ink-world',eraId='ink-later';
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
async function pixels(sheet:CharacterSheet){const svg=sheetPaper(sheet).svg,image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg)));await image.decode();const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=200;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);return{x:(x:number,y:number)=>Array.from(ctx.getImageData(x,y,1,1).data),png:canvas.toDataURL()};}
export async function prepareSheetInkFixture(){
  const plain=createSheet('5e-character','Synthetic ink investigator'),before=JSON.stringify(plain);
  const red:SheetInkStroke={id:'ink-red',tool:'pen',color:'#c4463a',width:12,points:[{x:100,y:120,pressure:.1},{x:200,y:120,pressure:1},{x:300,y:120,pressure:.2}]};
  const eraser:SheetInkStroke={id:'ink-eraser',tool:'eraser',color:'#000000',width:24,points:[{x:200,y:100},{x:200,y:140}]};
  const drawn=applySheetInk(plain,{kind:'stroke',stroke:red}),erased=applySheetInk(drawn,{kind:'stroke',stroke:eraser}),undone=applySheetInk(erased,{kind:'undo'});
  assert(JSON.stringify(plain)===before,'Ink mutation changed source rules/fields');assert(JSON.stringify(drawn.ink)===JSON.stringify(undone.ink),'Eraser Undo did not restore exact stroke');
  const a=await pixels(drawn),b=await pixels(erased),c=await pixels(undone);assert(a.x(200,120)[0]>150&&a.x(200,120)[1]<100,'Pen not rendered');assert(b.x(200,120)[1]>200,'Eraser did not remove earlier ink');assert(JSON.stringify(a.x(200,120))===JSON.stringify(c.x(200,120)),'Undo pixels not restored');
  const later=applySheetInk(erased,{kind:'stroke',stroke:{...red,id:'later-blue',color:'#2464ee',width:8,points:[{x:180,y:120},{x:220,y:120}]}});assert((await pixels(later)).x(200,120)[2]>200,'Earlier eraser removed later stroke');
  assert(JSON.stringify(parseSheetImport(exportSheet(later)).ink)===JSON.stringify(later.ink),'JSON ink operations lost');
  const invalid=structuredClone(later);invalid.ink!.strokes[0].points[0].pressure=2;assert(!validSheetInk(invalid.ink),'Invalid pressure accepted');let failed=false;try{validateSheet(invalid);}catch{failed=true;}assert(failed,'Sheet accepted invalid ink');
  const low=applySheetInk(plain,{kind:'stroke',stroke:{...red,id:'low-pressure',points:[{x:100,y:120,pressure:.1},{x:300,y:120,pressure:.1}]}}),high=applySheetInk(plain,{kind:'stroke',stroke:{...red,id:'high-pressure',points:[{x:100,y:120,pressure:1},{x:300,y:120,pressure:1}]}});assert((await pixels(low)).x(150,126)[1]>200&&(await pixels(high)).x(150,126)[1]<100,'Pressure did not change footprint');
  await db.projects.add({id:P,title:'Synthetic sheet ink QA',description:'Local fixture',mode:'custom',type:'standalone',status:'draft',color:'#d5b575',enabledEngines:['character-sheets','writings','codex'],createdAt:1,updatedAt:1});
  const sheet=await saveSheet(P,plain,null);await saveWorldEra(P,{id:eraId,name:'Ink later',description:'',revision:0,createdAt:1,updatedAt:1},null);
  const block=`<figure data-wh-tool-block="true" data-project-id="${P}" data-tool-kind="character-sheets" data-document-id="${sheet.id}" data-label="Paper"></figure>`;
  const writing:Writing={id:'sheet-ink-writing',projectId:P,title:'Synthetic ink chapter',content:'<p>Original paper and ink.</p>'+block,status:'draft',wordCount:5,tags:[],createdAt:1,updatedAt:1};await db.writings.add(writing);
  await db.codexEntries.add({id:'sheet-ink-card',projectId:P,title:'Synthetic ink record',type:'character',content:block,fields:{},tags:[],relations:[],createdAt:1,updatedAt:1});
  const host=document.createElement('div');host.id='sheet-ink-test-root';document.body.append(host);const root=createRoot(host);
  const api={
    async show(mode:'editor'|'reader',era=false){document.getElementById('root')!.hidden=true;await act(async()=>{root.render(createElement(MemoryRouter,null,createElement(EnginePaneContext.Provider,{value:{instanceId:'ink-qa',projectId:P,eraId:era?eraId:undefined,visible:true}},mode==='editor'?createElement(CharacterSheetsEngine,{projectId:P}):createElement(ReadingView,{pieces:[writing],onClose:()=>{},onOpenInEditor:()=>{}}))));await pause();});await act(async()=>{await pause();});},
    async portability(){const source=(await getEraProject({projectId:P,eraId}))!.characterSheets!.find(row=>row.id===sheet.id)!;const cloneId=await importProjectData(await exportProjectData(P)),clone=(await getEraProject({projectId:cloneId,eraId:(await db.projects.get(cloneId))!.worldEras![0].id}))!.characterSheets![0];assert(JSON.stringify(clone.ink)===JSON.stringify(source.ink),'Project JSON clone lost ink');const archive=await createProjectZipArchive(P),zip=await JSZip.loadAsync(await archive.blob.arrayBuffer());assert(Object.keys(zip.files).some(file=>file.endsWith('/project.json')),'Normal ZIP project absent');await importProjectZip(new File([archive.blob],archive.fileName),{replaceProjectIds:[P]});const restored=(await getEraProject({projectId:P,eraId}))!.characterSheets!.find(row=>row.id===sheet.id)!;assert(JSON.stringify(restored.ink)===JSON.stringify(source.ink),'Normal ZIP restore lost era ink');return{jsonClone:true,zipRestore:true,operations:source.ink?.strokes.length};},
    async stroke(tool:'pen'|'eraser'='pen'){const control=[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()==='Paper');assert(control,'Paper tab');await act(async()=>{control.click();await pause();});let canvas=host.querySelector<SVGSVGElement>('[data-testid="sheet-ink-canvas"]');if(!canvas){const draw=[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()==='Draw');assert(draw,'Draw action');await act(async()=>{draw.click();await pause();});}if(tool==='eraser'){const erase=[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()==='Erase');assert(erase,'Erase action');await act(async()=>{erase.click();await pause();});}canvas=host.querySelector('[data-testid="sheet-ink-canvas"]')!;const bounds=canvas.getBoundingClientRect(),at=(x:number,y:number)=>({clientX:bounds.left+x*bounds.width/1000,clientY:bounds.top+y*bounds.width/1000,pointerId:101,pointerType:'pen',bubbles:true,button:0,buttons:1});await act(async()=>{canvas!.dispatchEvent(new PointerEvent('pointerdown',{...at(100,120),pressure:.1}));canvas!.dispatchEvent(new PointerEvent('pointermove',{...at(200,120),pressure:1}));canvas!.dispatchEvent(new PointerEvent('pointerup',{...at(300,120),pressure:.2,buttons:0}));await pause();});},
    async save(){const prior=(await db.projects.get(P))!.characterSheets!.find(row=>row.id===sheet.id)!.revision,save=[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()==='Save sheet');assert(save&&!save.disabled,'Normal Save sheet');await act(async()=>{save.click();await pause();});for(let n=0;n<100;n++){const current=[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()==='Save sheet'),saved=(await db.projects.get(P))!.characterSheets!.find(row=>row.id===sheet.id)!;if(!host.querySelector('[role="alert"]')&&current?.disabled&&saved.revision>prior&&host.querySelector('[data-sheet-paper]'))return saved;await act(async()=>{await pause();});}throw Error('Sheet did not finish save/reload');},
    async focusPaper(){for(let n=0;n<100&&!host.querySelector('[role="tab"]');n++)await act(async()=>{await pause();});const paper=[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()==='Paper');assert(paper,'Paper after save');await act(async()=>{paper.click();await pause();});const draw=[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()==='Draw');if(draw)await act(async()=>{draw.click();await pause();});host.querySelector('[data-testid="sheet-paper-view"]')!.scrollIntoView({block:'start'});},
    async undo(){const undo=[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()==='Undo ink');assert(undo&&!undo.disabled,'Undo ink button');await act(async()=>{undo.click();await pause();});},
  };
  (window as unknown as {__sheetInk:typeof api}).__sheetInk=api;
  return{projectId:P,eraId,sheetId:sheet.id,writingId:writing.id,red,eraser,pureTests:7,pixels:{draw:a.png,erase:b.png,undo:c.png}};
}
