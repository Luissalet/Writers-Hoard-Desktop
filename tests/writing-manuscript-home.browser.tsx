import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import type {Project,Writing} from '@/types';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {listManuscripts,setManuscript,undoManuscript} from '@/engines/writings/manuscriptStore';
import {createWriting,updateWritingAtVersion,deleteWritingRestorable,restoreDeletedWriting} from '@/engines/writings/operations';
import {readWorldDocument,saveEraDocument,hideEraDocument,resetEraDocument} from '@/services/worldEras/store';
import {eraSnapshotOperations} from '@/services/worldEras/writings';
import WritingsEngine from '@/engines/writings/WritingsEngine';
import ManuscriptsPanel from '@/engines/writings/components/ManuscriptsPanel';
import {useLocaleStore} from '@/stores/localeStore';
import {t} from '@/i18n/useTranslation';

function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
const pause=(ms=60)=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(test:()=>boolean|Promise<boolean>,label:string){const deadline=Date.now()+12000;while(Date.now()<deadline){if(await test())return;await act(async()=>{await pause();});}throw Error(label);}
async function click(element:HTMLElement){await act(async()=>{element.click();await pause();});}
function button(label:string,scope:ParentNode=document){const found=[...scope.querySelectorAll('button')].find(node=>node.textContent?.trim()===label);assert(found,`Button ${label}`);return found;}
interface Summary {chapterCount:number;wordCount:number;lastChapterUpdatedAt:number|null;lastChapterId:string|null}
interface Listing {manuscripts:({id:string;summary:Summary})[]}
async function fixture(id:string){
 const project={id,title:'Harbour main',description:'',mode:'custom',type:'standalone',color:'#d5b575',status:'draft',enabledEngines:['writings','codex'],engineOrder:['writings'],createdAt:1,updatedAt:10000,author:'Main author',worldEras:[{id:'past',name:'Past',description:'',revision:0,createdAt:1,updatedAt:1}],manuscriptCatalog:{revision:0,entries:[{id:'a',title:'Harbour A',author:'Author A',blurb:'Only the blurb of A',createdAt:5,updatedAt:9999},{id:'b',title:'Harbour B',author:'Author B',createdAt:6,updatedAt:8888}]}} as Project;
 const main:Writing={id:id+'-main',projectId:id,title:'Main chapter',status:'draft',content:'<p>Main text</p>',wordCount:2,tags:[],chapter:1,createdAt:1,updatedAt:100};
 const a={...main,id:id+'-a',title:'Chapter A',manuscriptId:'a',content:'<p>A first text</p>',wordCount:3,updatedAt:200};
 const last={...a,id:id+'-a2',title:'Latest A',chapter:2,status:'finished' as const,heldBack:true,wordCount:4,updatedAt:250};
 const b={...main,id:id+'-b',title:'Chapter B',manuscriptId:'b',updatedAt:900};
 await db.projects.put(project);await db.writings.bulkPut([main,a,last,b]);return{project,main,a,last,b};
}
async function summary(projectId:string,id:string,eraId?:string){const result=await runBridgeTool('wh_writing_manuscripts',{projectId,includeSummary:true,...(eraId?{eraId}:{})});assert(result.ok,`Registered read supports summary: ${JSON.stringify(result)}`);const row=(result.result as Listing).manuscripts.find(row=>row.id===id);assert(row?.summary,'Manuscript summary exists');return row.summary;}
async function state(projectId:string){return JSON.stringify({project:await db.projects.get(projectId),writings:await db.writings.where('projectId').equals(projectId).toArray(),variants:await db.worldEraVariants.where('projectId').equals(projectId).toArray(),archives:await db.documentArchives.where('projectId').equals(projectId).toArray(),snapshots:await db.writingSnapshots.where('projectId').equals(projectId).toArray()});}

export async function testManuscriptHomeSummaryIsolation(){
 const {project,main,last,b}=await fixture('manuscript-home-isolation');
 const before=await state(project.id),legacy=await listManuscripts(project.id),wire=await runBridgeTool('wh_writing_manuscripts',{projectId:project.id});
 assert(wire.ok&&JSON.stringify(wire.result)===JSON.stringify(legacy),'Absent options retain exact legacy read response');
 const a=await summary(project.id,'a');assert(a.chapterCount===2&&a.wordCount===7&&a.lastChapterUpdatedAt===250&&a.lastChapterId===last.id,'A aggregates all own statuses including held-back, not world/catalog timestamps');
 assert((await summary(project.id,'main')).lastChapterUpdatedAt===main.updatedAt,'Implicit main uses its own chapter timestamp');
 assert(await state(project.id)===before,'Repeated summary reads do not write rows/catalogue/snapshots');
 await updateWritingAtVersion(b.id,{content:'<p>B saved later</p>'},b.updatedAt);await db.projects.update(project.id,{description:'Another world edit',updatedAt:Date.now()+100000});
 assert((await summary(project.id,'a')).lastChapterUpdatedAt===250&&(await summary(project.id,'main')).lastChapterUpdatedAt===100,'Normal B/world writes never move A/main summary');
 const foreign={...last,id:'foreign-'+project.id,projectId:project.id+'-foreign',updatedAt:Date.now()+500000};await db.writings.put(foreign);
 assert((await summary(project.id,'a')).lastChapterId===last.id,'Foreign project with same owner is excluded');
 await createWriting({...last,id:project.id+'-a0'});
 assert((await summary(project.id,'a')).lastChapterId===project.id+'-a0','Equal timestamps resolve by ascending stable id');
 const changed=await setManuscript(project.id,'a','update',{title:'A details only'},0);assert((await summary(project.id,'a')).lastChapterUpdatedAt===250,'Details only do not masquerade as chapter changes');await undoManuscript(project.id,changed.receipt);
 return['Registered manuscript summaries isolate A/B/main, include all own states, use stable tie order, retain exact legacy response and read without writes'];
}

export async function testManuscriptHomeEraAndSnapshot(){
 const {project,a,last,b}=await fixture('manuscript-home-era'),scope={projectId:project.id,eraId:'past'};
 const read=(await readWorldDocument(scope,'writings',last.id))!;
 const saved=await saveEraDocument(scope,'writings',{...read.document,root:{...read.document.root,content:'<p>A past changed</p>'}},read.version);
 const version=Number(saved.document.root.updatedAt);assert((await summary(project.id,'a','past')).lastChapterUpdatedAt===version&&(await summary(project.id,'a')).lastChapterUpdatedAt===250,'Era overlay affects only its own era');
 const bRead=(await readWorldDocument(scope,'writings',b.id))!;await saveEraDocument(scope,'writings',{...bRead.document,root:{...bRead.document.root,title:'B past changed'}},bRead.version);
 assert((await summary(project.id,'a','past')).lastChapterUpdatedAt===version,'Other book overlay never changes A');
 await eraSnapshotOperations(scope).ensureSnapshot(saved.document.root as unknown as Writing,'manual');assert((await summary(project.id,'a','past')).lastChapterUpdatedAt===version,'Snapshot child changes are not chapter row edits');
 const current=(await readWorldDocument(scope,'writings',last.id))!;await hideEraDocument(scope,'writings',last.id,current.version);
 const hidden=await summary(project.id,'a','past');assert(hidden.lastChapterUpdatedAt===a.updatedAt&&hidden.chapterCount===1,'Hidden chapter is not available in summary');
 const variant=(await db.worldEraVariants.where('[projectId+eraId+kind+entityId]').equals([project.id,'past','writings',last.id]).first())!;await resetEraDocument(scope,'writings',last.id,variant.revision);
 assert((await summary(project.id,'a','past')).lastChapterUpdatedAt===250,'Reinherit returns original effective Base timestamp');
 const before=await state(project.id);await summary(project.id,'a','past');assert(await state(project.id)===before,'Era summary performs no normalization writes');
 const invalid=await runBridgeTool('wh_writing_manuscripts',{projectId:project.id,includeSummary:true,eraId:'missing'});assert(!invalid.ok,'Unknown era rejects, not empty successful summary');
 return['Era summaries follow native overlays/hide/reinherit and ignore snapshot-only/B activity without normalizing data'];
}

export async function testManuscriptHomeArchiveAndEmpty(){
 const {project,main,a,last}=await fixture('manuscript-home-archive');
 const archived=await setManuscript(project.id,'a','archive',{},0);assert((await summary(project.id,'a')).lastChapterUpdatedAt===250,'Catalogue archive preserves available chapter summary');await undoManuscript(project.id,archived.receipt);
 const deleted=await deleteWritingRestorable(last.id);assert(deleted,'Normal chapter archive returned bundle');assert((await summary(project.id,'a')).lastChapterUpdatedAt===200,'Document archive excludes unavailable chapter');await restoreDeletedWriting(deleted);assert((await summary(project.id,'a')).lastChapterUpdatedAt===250,'Restoring chapter returns its saved timestamp');
 await db.writings.bulkDelete([main.id,a.id,last.id]);const empty=await summary(project.id,'a');assert(empty.chapterCount===0&&empty.lastChapterId===null&&empty.lastChapterUpdatedAt===null,'Empty new book does not use entry.createdAt/updatedAt');
 const stored=(await db.projects.get(project.id))!;delete stored.manuscriptCatalog;await db.projects.put({...stored,id:project.id+'-legacy'});const before=await state(project.id+'-legacy');
 const implicit=await summary(project.id+'-legacy','main');assert(implicit.lastChapterUpdatedAt===null&&implicit.chapterCount===0&&await state(project.id+'-legacy')===before,'Empty legacy principal stays implicit and has no synthetic date');
 return['Organizational archive, document archive/restore and empty implicit/new manuscripts retain explicit available-chapter semantics'];
}

export async function testManuscriptHomeEngineUi(){
 useLocaleStore.setState({locale:'en'});const {project,last}=await fixture('manuscript-home-ui'),host=document.getElementById('root')!,root=createRoot(host);
 try{
  await act(async()=>{root.render(<MemoryRouter initialEntries={[`/project/${project.id}/writings?manuscript=a`]}><WritingsEngine projectId={project.id}/></MemoryRouter>);await pause();});
  await until(()=>!!host.querySelector('[aria-label="Manuscript overview"]'),'Normal Writings has manuscript overview');
  const overview=host.querySelector('[aria-label="Manuscript overview"]')!;
  assert(overview.textContent?.includes('Author A')&&overview.textContent.includes('Only the blurb of A')&&overview.textContent.includes('2 chapters')&&overview.textContent.includes('7 words'),'Home projects author/blurb/counts for all A statuses');
  assert(overview.querySelector('time')?.dateTime===new Date(250).toISOString()&&overview.textContent?.includes('Chapters last updated'),'Explicit chapter timestamp ignores high catalogue/world dates');
  assert(overview.querySelector('[role="img"]')?.getAttribute('aria-label')?.includes('Harbour A'),'Home reuses existing cover projection');
  assert(host.textContent?.includes(t('writings.recent.title'))&&host.textContent.includes(t('writings.book.button')),'Existing recent changes and actions remain visible');
  await click(button('Open last edited chapter',overview));await until(()=>!!host.querySelector('.ProseMirror[contenteditable="true"]'),'Normal latest-chapter editor opens');
  assert((host.querySelector('input') as HTMLInputElement)?.value===last.title||host.textContent?.includes(last.title),'Latest own chapter opens, not newer B or only current Drafts');
  await click(button(t('common.back')));await until(()=>!!host.querySelector('[aria-label="Manuscript overview"]'),'Back returns to overview');
  await click(button('Manuscripts'));await until(()=>!!host.querySelector('li h2'),'Library rows loaded');
  const bRow=[...host.querySelectorAll('li')].find(row=>row.querySelector('h2')?.textContent==='Harbour B')!;assert(bRow.querySelector('time')?.dateTime===new Date(900).toISOString(),'Library per-book timestamp');await click(button('Open',bRow));
  await until(()=>host.querySelector('h1')?.textContent==='Harbour B','B opens without remounting engine');assert(!host.querySelector('[aria-label="Manuscript overview"]')?.textContent?.includes('Author A'),'Book retarget does not retain A metadata');
  await click(button(t('writings.newWriting')));const dialog=document.querySelector('[role="dialog"]')!;await act(async()=>{const input=dialog.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'B newly saved');input.dispatchEvent(new Event('input',{bubbles:true}));});await click(button(t('common.create'),dialog));
  await until(async()=>!!await db.writings.where('projectId').equals(project.id).filter(row=>row.title==='B newly saved').first(),'Existing new chapter form persists');assert((await db.writings.where('projectId').equals(project.id).filter(row=>row.title==='B newly saved').first())?.manuscriptId==='b','Home leaves normal chapter owner creation intact');
  const created=(await db.writings.where('projectId').equals(project.id).filter(row=>row.title==='B newly saved').first())!;await click(button(t('common.back')));await until(()=>!!host.querySelector('[aria-label="Manuscript overview"]'),'Saved B chapter returns home');const savedOverview=host.querySelector('[aria-label="Manuscript overview"]')!;assert(savedOverview.textContent?.includes('2 chapters')&&savedOverview.querySelector('time')?.dateTime===new Date(created.updatedAt).toISOString(),'Saved creation refreshes B home count and exact persisted timestamp');assert((await summary(project.id,'a')).lastChapterUpdatedAt===250,'Creating B through normal UI keeps A date unchanged');
  return['Real engine home/library retarget, cover/counts, latest owned editor and existing B create flow work together'];
 }finally{await act(async()=>{root.unmount();await pause();});}
}

export async function testManuscriptHomeLibraryRetarget(){
 useLocaleStore.setState({locale:'es'});const {project,main,a,last,b}=await fixture('manuscript-home-retarget'),other=await fixture('manuscript-home-other'),host=document.getElementById('root')!,root=createRoot(host);
 try{
  const render=async(projectId:string,writings:Writing[])=>{await act(async()=>{root.render(<ManuscriptsPanel projectId={projectId} writings={writings} onOpen={()=>{}} onClose={()=>{}}/>);await pause();});};
  await render(project.id,[main,a,last,b]);await until(()=>!!host.querySelector('time'),'Spanish library timestamps');assert(host.textContent?.includes('Última edición de capítulos'),'Spanish precise label');
  await render(other.project.id,[{...other.a,updatedAt:3000},main]);await until(()=>[...host.querySelectorAll('time')].some(node=>node.dateTime===new Date(3000).toISOString()),'Project retarget summary');
  const aRow=[...host.querySelectorAll('li')].find(row=>row.querySelector('h2')?.textContent==='Harbour A')!;assert(aRow.querySelector('time')?.dateTime===new Date(3000).toISOString(),'New project uses its own effective chapter rows');
  const mainRow=[...host.querySelectorAll('li')].find(row=>row.querySelector('h2')?.textContent==='Harbour main')!;assert(!mainRow.querySelector('time')&&mainRow.textContent?.includes('Sin capítulos disponibles'),'Foreign project row does not populate empty principal');
  return['Spanish library retarget excludes foreign rows and displays null empty principal without a false timestamp'];
 }finally{await act(async()=>{root.unmount();await pause();});}
}

export async function testManuscriptHomeUnavailableDate(){
 useLocaleStore.setState({locale:'en'});const {project,a}=await fixture('manuscript-home-date-range'),host=document.getElementById('root')!,root=createRoot(host);
 const unavailable={...a,updatedAt:Number.MAX_SAFE_INTEGER};await db.writings.put(unavailable);
 try{
  await act(async()=>{root.render(<ManuscriptsPanel projectId={project.id} writings={[unavailable]} onOpen={()=>{}} onClose={()=>{}}/>);await pause();});
  await until(()=>!!host.querySelector('li h2'),'Invalid-date library remains usable');const row=[...host.querySelectorAll('li')].find(row=>row.querySelector('h2')?.textContent==='Harbour A')!;
  assert(row.textContent?.includes('Date unavailable')&&!row.querySelector('time'),'Out-of-range timestamp has explicit unavailable label, not empty or crash');
  await act(async()=>{root.render(<MemoryRouter initialEntries={[`/project/${project.id}/writings?manuscript=a`]}><WritingsEngine projectId={project.id}/></MemoryRouter>);await pause();});
  await until(()=>!!host.querySelector('[aria-label="Manuscript overview"]'),'Invalid-date home remains usable');const overview=host.querySelector('[aria-label="Manuscript overview"]')!;
  assert(overview.textContent?.includes('Date unavailable')&&!overview.querySelector('time'),'Home shares safe date presentation');assert((await summary(project.id,'a')).lastChapterUpdatedAt===Number.MAX_SAFE_INTEGER,'Read projection does not rewrite or reject existing timestamp');
  return['Existing out-of-range chapter timestamps remain readable in library/home with explicit unavailable dates and unchanged data'];
 }finally{await act(async()=>{root.unmount();await pause();});}
}
