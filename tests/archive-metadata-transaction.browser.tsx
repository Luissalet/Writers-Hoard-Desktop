import '@/engines';
import '@/services/aiBridge/dispatch';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {deleteTable} from '@/engines/tables/operations';
import {restoreArchivedDocument} from '@/services/documentArchive/store';
import ArchiveEngine from '@/engines/archive/ArchiveEngine';
import {useLocaleStore} from '@/stores/localeStore';
import {t} from '@/i18n/useTranslation';
import type {WorldTable} from '@/engines/tables/types';

const assert:(v:unknown,m:string)=>asserts v=(v,m)=>{if(!v)throw Error(m);};
async function seed(){const id='archive-tx-'+crypto.randomUUID(),entry=id+'-card';await db.projects.put({id,title:'Archive transaction fixture',mode:'custom',type:'standalone',enabledEngines:['archive','tables','codex'],engineOrder:['archive','tables','codex'],createdAt:1,updatedAt:1});await db.codexEntries.put({id:entry,projectId:id,type:'character',title:'Iria',content:'',fields:{},tags:[],relations:[],createdAt:1,updatedAt:1});return{id,entry};}
export async function testArchiveMetadataAtomic(){
 const{id,entry}=await seed(),table:WorldTable={id:id+'-table',title:'Owned table',mode:'table',columns:[{id:'character',name:'Character',kind:'reference'}],rows:[{id:'one',cells:{character:entry}}]};await db.projects.update(id,{dataTables:[table]});
 const rejectAdd=()=>{throw Error('own_late_archive_add');},rejectConsume=()=>{throw Error('own_final_archive_consume');};
 try{
  db.documentArchives.hook('creating',rejectAdd);let rejected=false;try{await deleteTable(id,table.id);}catch(error){rejected=String(error).includes('own_late_archive_add');}finally{db.documentArchives.hook('creating').unsubscribe(rejectAdd);}
  assert(rejected&&JSON.stringify((await db.projects.get(id))!.dataTables)===JSON.stringify([table])&&!await db.documentArchives.where('projectId').equals(id).count(),'late archive failure did not roll back table deletion');
  try{await db.transaction('rw',db.tables,async()=>{await deleteTable(id,table.id);throw Error('own_outer_abort');});}catch(error){assert(String(error).includes('own_outer_abort'),'outer abort wrong failure');}
  assert((await db.projects.get(id))!.dataTables?.[0].id===table.id&&!await db.documentArchives.where('projectId').equals(id).count(),'outer abort leaked metadata deletion/archive');
  await deleteTable(id,table.id);const archive=(await db.documentArchives.where('sourceId').equals(table.id).first())!;await db.projects.update(id,{description:'Later unrelated project prose'});
  db.documentArchives.hook('deleting',rejectConsume);rejected=false;try{await restoreArchivedDocument(id,archive.id);}catch(error){rejected=String(error).includes('own_final_archive_consume');}finally{db.documentArchives.hook('deleting').unsubscribe(rejectConsume);}
  assert(rejected&&!(await db.projects.get(id))!.dataTables?.length&&await db.documentArchives.get(archive.id),'final consume failure leaked partial metadata restoration');
  await restoreArchivedDocument(id,archive.id);const project=(await db.projects.get(id))!;
  assert(JSON.stringify(project.dataTables)===JSON.stringify([table])&&project.description==='Later unrelated project prose'&&!await db.documentArchives.get(archive.id)&&await db.codexEntries.get(entry),'normal retry failed exact typed table/link restore or lost unrelated prose');
  return['Actual deleteTable late archive-add failure and enclosing outer abort roll back metadata/archive together; failed final consume rolls back restore; retry restores exact reference table and preserves later project prose'];
 }finally{db.documentArchives.hook('creating').unsubscribe(rejectAdd);db.documentArchives.hook('deleting').unsubscribe(rejectConsume);await deleteProject(id);}
}
const channel=window as unknown as Record<string,any>;let sequence=0;
async function wait(check:()=>boolean|Promise<boolean>,label:string){for(let n=0;n<300;n++){if(await check())return;await act(async()=>{await new Promise(r=>setTimeout(r,30));});}throw Error('Archive native timeout '+label);}
async function native(events:unknown[]){const n=++sequence;await act(async()=>{channel.__native={n,events};await wait(()=>channel.__nativeAck===n,'input');});}
async function click(node:Element){node.scrollIntoView({block:'center',behavior:'instant'});await act(async()=>{await new Promise(r=>setTimeout(r,50));});const r=node.getBoundingClientRect();assert(r.width&&r.height,'visible archive control');const p={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:'left',clickCount:1};await native([{type:'mouseDown',...p},{type:'mouseUp',...p}]);}
function button(label:string,host:ParentNode=document){const node=[...host.querySelectorAll('button')].find(item=>item.textContent?.trim()===label);assert(node,'missing button '+label);return node;}
export async function testArchiveMetadataNative(){
 const out:string[]=[];useLocaleStore.setState({locale:'en'});
 for(const width of[1440,640]){
  const{id,entry}=await seed(),root=createRoot(document.getElementById('root')!);
  try{
   const created=await channel.qaNative.call('wh_table_create',{projectId:id,title:'Recoverable reference table '+width,columns:[{name:'Text',kind:'text'},{name:'Person',kind:'reference'}],rows:[['Offline exact text 🧭',entry]]});assert(created.ok,'normal MCP table create failed '+JSON.stringify(created));const table=created.result.table;
   const n=++sequence;channel.__want={w:width,h:1000,n};await wait(()=>channel.__sizeAck===n,'resize');await act(async()=>root.render(<MemoryRouter><ArchiveEngine projectId={id}/></MemoryRouter>));
   await wait(()=>!!document.querySelector('[data-testid=document-archive]'),'Archive engine');const tab=[...document.querySelectorAll('button')].find(item=>item.textContent?.includes(t('archive.active')))!;await click(tab);await wait(()=>!!document.querySelector(`[data-testid="archive-row-${table.id}"]`),'active table');
   await click(button(t('archive.archive'),document.querySelector(`[data-testid="archive-row-${table.id}"]`)!));await wait(()=>!!document.querySelector('[role=dialog]'),'confirmation');await click(button(t('archive.archive'),document.querySelector('[role=dialog]')!));await wait(async()=>!(await db.projects.get(id))!.dataTables?.length,'normal table archived');
   const listed=await channel.qaNative.call('wh_tables_list',{projectId:id});assert(listed.ok&&!listed.result.tables.some((item:any)=>item.id===table.id),'MCP listed archived table');
   const deleted=[...document.querySelectorAll('button')].find(item=>item.textContent?.includes(t('archive.deleted')))!;await click(deleted);await wait(()=>[...document.querySelectorAll('button')].some(item=>item.textContent?.trim()===t('archive.restore')),'deleted table');await click(button(t('archive.restore')));await wait(async()=>!!(await db.projects.get(id))!.dataTables?.some(item=>item.id===table.id),'normal metadata restored');
   const read=await channel.qaNative.call('wh_table_get',{projectId:id,tableId:table.id});assert(read.ok&&JSON.stringify(read.result.table.rows)===JSON.stringify(table.rows),'normal MCP exact typed rows/reference restore differs');
   await click([...document.querySelectorAll('button')].find(item=>item.textContent?.includes(t('archive.active')))!);await wait(()=>!!document.querySelector(`[data-testid="archive-row-${table.id}"]`),'restored active row');
   const name='archive-table-restored-'+width;channel.__shot={name,forcePaint:true};await wait(()=>channel.__shotDone===name,'capture');
   out.push(`Actual Archive engine native ${width}: MCP-created reference table confirmed/archive/restore through normal UI; list omits deleted table and complete MCP read retains exact text/reference rows`);
  }finally{await act(async()=>root.unmount());await deleteProject(id);}
 }return out;
}
