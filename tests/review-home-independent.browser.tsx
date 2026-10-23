import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { db } from '@/db';
import type { Project } from '@/types';
import { BRIDGE_TOOLS } from '@/services/aiBridge/manifest';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { undoAuditEntry } from '@/services/aiBridge/undo';
import { quickCreateProjectDocument } from '@/services/projectQuickCreate';
import { listEraRows } from '@/services/worldEras/store';
import { deriveDocumentGrowth } from '@/services/projectIntelligence';
import { parseSearchQuery } from '@/services/searchQuery';
import GlobalSearch from '@/components/common/GlobalSearchBody';
import { useAppStore } from '@/stores/appStore';
import { useLocaleStore } from '@/stores/localeStore';
import { t } from '@/i18n/useTranslation';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }
const P = 'home-independent-review';
const wait = async (condition: () => boolean, label: string) => {
  for(let i=0;i<80;i++) { if(condition()) return; await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));}); }
  throw Error('Timed out '+label);
};
export const reviewHomeIndependent = () => runReview(true);
export const reviewHomeIndependentCore = () => runReview(false);
async function runReview(includeFilters: boolean) {
  const passed: string[] = [];
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const project={id:P,title:'Independent Home',description:'',mode:'custom',type:'standalone',status:'draft',color:'#888',enabledEngines:['writings','notes','outline'],engineOrder:[],createdAt:1,updatedAt:1,
    worldEras:[{id:'older',name:'Older',description:'',revision:1,createdAt:1,updatedAt:1},{id:'archived',name:'Archived',description:'',archived:true,revision:1,createdAt:1,updatedAt:1}]} as Project;
  try {
    await db.projects.put(project);
    for(const name of ['wh_project_home','wh_project_quick_create']) assert(BRIDGE_TOOLS.some(tool=>tool.name===name),'Missing manifest '+name);
    const home=await runBridgeTool('wh_project_home',{projectId:P});assert(home.ok,'Global handler missing');
    passed.push('Manifest and actual global dispatcher register both Home tools');
    for(const engineId of ['writings','notes','outline']){
      const created=await runBridgeTool('wh_project_quick_create',{projectId:P,engineId,text:'Independent '+engineId});assert(created.ok,JSON.stringify(created));
      const value=created.result as {id:string;__audit:Record<string,unknown>};
      const table=engineId==='outline'?'outlines':engineId;assert(await db.table(table).get(value.id),'Not persisted '+engineId);
      await undoAuditEntry({entry:{...value.__audit,tool:'wh_project_quick_create',kind:'create'}});
      assert(!await db.table(table).get(value.id),'Undo did not remove '+engineId);
    }
    passed.push('All 3 engines persist through global MCP dispatcher and generic create undo');
    for(const engineId of ['writings','notes']){
      const created=await runBridgeTool('wh_project_quick_create',{projectId:P,eraId:'older',engineId,text:'Era '+engineId});assert(created.ok,JSON.stringify(created));
      const value=created.result as {id:string;__audit:Record<string,unknown>};
      assert(!await db.table(engineId).get(value.id),'Era leaked into base '+engineId);
      assert((await listEraRows<{id:string}>({projectId:P,eraId:'older'},engineId)).some(row=>row.id===value.id),'Era row absent');
      await undoAuditEntry({entry:{...value.__audit,tool:'wh_project_quick_create',kind:'create',eraId:'older'}});
      assert(!(await listEraRows<{id:string}>({projectId:P,eraId:'older'},engineId)).some(row=>row.id===value.id),'Era undo did not remove '+engineId);
    }
    passed.push('Era writing/note creation and undo preserve base and other rows');
    for(const scope of [{projectId:P,eraId:'missing'},{projectId:P,eraId:'archived'}]){
      let refused=false;try{await quickCreateProjectDocument(scope,'notes','Refuse');}catch{refused=true;}assert(refused,'Invalid/archived era accepted');
    }
    const eraOutline=await runBridgeTool('wh_project_quick_create',{projectId:P,eraId:'older',engineId:'outline',text:'Refuse'});assert(!eraOutline.ok,'Era outline accepted');
    await db.projects.update(P,{enabledEngines:[]});
    const disabled=await runBridgeTool('wh_project_quick_create',{projectId:P,engineId:'notes',text:'Refuse'});assert(!disabled.ok,'Disabled engine accepted');
    assert(await db.notes.where('projectId').equals(P).count()===0,'Rejected writes left notes');
    passed.push('Invalid/archived eras, era outlines and disabled engines rejected without hidden data');
    const data=deriveDocumentGrowth([{createdAt:new Date(2026,0,2).getTime()},{createdAt:new Date(2026,11,2).getTime()},{createdAt:Infinity},{createdAt:NaN},{}]);
    assert(data.months.map(row=>row.month).join(',')==='2026-01,2026-12' && data.undated===3,'Growth invented dates or misordered years');
    passed.push('Growth uses actual creation timestamps, correct month order and explicit undated rows');
    if (!includeFilters) return passed;
    await db.projects.update(P,{enabledEngines:project.enabledEngines});useLocaleStore.setState({locale:'en'});
    await act(async()=>{root.render(<MemoryRouter initialEntries={[`/project/${P}/overview`]}><Routes><Route path="/project/:id/*" element={<GlobalSearch/>}/></Routes></MemoryRouter>);useAppStore.setState({searchOpen:true});});
    await wait(()=>!!host.querySelector('[role="combobox"]'),'palette');
    const box=host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    const typeQuery=async(query:string)=>{await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(box,query);box.dispatchEvent(new Event('input',{bubbles:true}));});
      await act(async()=>{await new Promise(resolve=>setTimeout(resolve,80));});};
    const creationOptions=()=>[...host.querySelectorAll<HTMLElement>('[role="option"]')].filter(option=>option.textContent?.includes(t('home.createQuery')));
    for(const query of ['engine:notes Título café','Título café -borrador','"Título café"','Título café tag:magia']){
      assert(parseSearchQuery(query).hasText,'Invalid test query');
      await typeQuery(query);
      assert(creationOptions().length===0,'Search syntax offered creation actions: '+query);
    }
    assert(await db.notes.where('projectId').equals(P).count()===0,'Filtered queries wrote data');
    await typeQuery('Título café');
    await wait(()=>creationOptions().length===3,'plain creation choices');
    const notes=creationOptions().find(option=>option.textContent?.includes(t('engines.notes.name')));assert(notes,'Missing note action');
    await act(async()=>notes.click());
    await wait(()=>!useAppStore.getState().searchOpen,'created and closed');
    const createdNotes=await db.notes.where('projectId').equals(P).toArray();
    assert(createdNotes.length===1,'Expected exactly 1 note');
    assert(createdNotes[0].text==='Título café','Plain creation folded accents or changed case: '+createdNotes[0].text);
    passed.push('Filtered, excluded and quoted search syntax offers no creation; plain titles preserve accents and case');
    return passed;
  } finally {
    await act(async()=>{root.unmount();useAppStore.setState({searchOpen:false});});host.remove();
    for(const table of [db.writings,db.notes,db.outlines,db.worldEraVariants])await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
}
