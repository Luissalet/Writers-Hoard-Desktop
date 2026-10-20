import {act,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import JSZip from 'jszip';
import {db} from '@/db';
import type {Project,CodexEntry} from '@/types';
import '@/engines/codex';
import {saveCodexTemplate,deleteCodexTemplate,CodexTemplateConflict,type CodexTemplate} from '@/engines/codex/templates';
import {effectiveCodexTemplate,effectiveTemplatePresentation,selectableCodexTemplates} from '@/engines/codex/templateHierarchy';
import {validateTemplatePresentation} from '@/engines/codex/templateTypes';
import {templatePresentationCopy} from '@/engines/codex/templatePresentationCopy';
import CodexTemplateManager from '@/components/codex/CodexTemplateManager';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import CodexEntryList from '@/components/codex/CodexEntryList';
import {codexDraftStore} from '@/components/codex/codexDrafts';
import {useLocaleStore} from '@/stores/localeStore';
import {t} from '@/i18n/useTranslation';
import {createProjectZipArchive,importProjectZip} from '@/services/zipBackup';
import {exportProjectData,importProjectData} from '@/db/operations';
const P='test-template-presentation',image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const pause=()=>new Promise(resolve=>setTimeout(resolve,60));
function assert(value:unknown,message:string):asserts value {if(!value)throw new Error(message);}
function value(node:HTMLInputElement|HTMLSelectElement,value:string){Object.getOwnPropertyDescriptor(node instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));}
const template=(id:string,name:string):CodexTemplate=>({id,name,category:'custom',fields:{},content:'',revision:0,createdAt:1,updatedAt:1});
export async function testCodexTemplatePresentation():Promise<string[]>{
  const root=createRoot(document.getElementById('root')!),passed:string[]=[];let cloneId='';
  const project:Project={id:P,title:'Types',description:'',mode:'custom',type:'standalone',status:'draft',color:'#000',enabledEngines:['codex'],engineOrder:['codex'],createdAt:1,updatedAt:1};
  const render=async(node:React.ReactNode)=>{await act(async()=>{root.render(<StrictMode><MemoryRouter>{node}</MemoryRouter></StrictMode>);await pause();});await act(async()=>{await pause();});};
  const wait=async(check:()=>boolean,message:string)=>{for(let i=0;i<80;i++){if(check())return;await act(async()=>{await pause();});}throw new Error(message);};
  const click=async(node:HTMLElement|null|undefined,message:string)=>{assert(node,message);await act(async()=>{node.click();await pause();});await act(async()=>{await pause();});};
  const button=(label:string,scope:ParentNode=document)=>[...scope.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()===label);
  const change=async(label:string,text:string)=>{const field=document.querySelector<HTMLInputElement|HTMLSelectElement>(`[aria-label="${label}"]`);assert(field,'field '+label);await act(async()=>{value(field,text);await pause();});};
  const cleanup=async(id:string)=>{await db.codexEntries.where('projectId').equals(id).delete();await db.projects.delete(id);};
  useLocaleStore.setState({locale:'en',loaded:true});
  try{
    await cleanup(P);await db.projects.put(project);codexDraftStore(P).clear();
    const base=await saveCodexTemplate(P,{...template('base','Public type'),icon:'BookOpen',color:'#ccaa44',imageLayout:'portrait',hiddenFromPickers:false},null);
    let hidden=await saveCodexTemplate(P,{...template('hidden','Private type'),parentTemplateId:base.id,icon:'Sword',color:'#336699',imageLayout:'none',hiddenFromPickers:true},null);
    let child=await saveCodexTemplate(P,{...template('child','Visible child'),parentTemplateId:hidden.id,imageLayout:'landscape',hiddenFromPickers:false},null);
    let templates=(await db.projects.get(P))!.codexTemplates!;
    const defaults=effectiveTemplatePresentation(template('old','Legacy'),[]);assert(defaults.icon===undefined&&defaults.color===undefined&&defaults.imageLayout===undefined&&!defaults.hiddenFromPickers,'legacy defaults preserved');
    const inherited=effectiveCodexTemplate(child,templates);assert(inherited.icon==='Sword'&&inherited.color==='#336699'&&inherited.imageLayout==='landscape'&&inherited.hiddenFromPickers===false,'independent inheritance and explicit false');
    assert(!selectableCodexTemplates(templates).some(item=>item.id===hidden.id)&&selectableCodexTemplates(templates,hidden.id).some(item=>item.id===hidden.id),'selected hidden option remains available');
    for(const bad of [{color:'red'},{color:'#fff'},{color:'url(https://evil.invalid)'},{icon:'constructor'},{icon:'<img>'},{imageLayout:'remote'},{hiddenFromPickers:'yes'}]){let rejected=false;try{await saveCodexTemplate(P,{...child,...bad}as CodexTemplate,child.revision);}catch{rejected=true;}assert(rejected,'reject unsafe metadata '+JSON.stringify(bad));}
    const safe=effectiveTemplatePresentation({...child,color:'url(https://evil.invalid)',icon:'constructor'},templates);assert(safe.color==='#336699'&&safe.icon==='Sword','malformed imported values inherit safely');
    validateTemplatePresentation({icon:'Wand2',color:'#12ABef',imageLayout:'none',hiddenFromPickers:false});
    passed.push('Presentation: legacy defaults, independent inheritance/false override, picker retention and strict malicious-value admission');

    const c=templatePresentationCopy.en;
    await render(<CodexTemplateManager projectId={P} open initial={child} onClose={()=>{}} onUse={()=>{throw new Error('hidden type used');}}/>);
    await wait(()=>Boolean(document.querySelector('[data-testid="template-appearance"]')),'manager appearance');
    const appearance=document.querySelector<HTMLElement>('[data-testid="template-appearance"]')!;
    await click(appearance.querySelector('button[title]'),'existing icon picker');
    await click(appearance.querySelector('button[title="Globe"]'),'choose real catalog icon');
    await change(c.color,'#11aa66');await change(c.image,'landscape');await change(c.visibility,'true');
    await click(button(t('codex.templates.save')),'save template');
    await wait(()=>Boolean(button(t('codex.templates.save'))?.disabled),'template save completed');assert(button(t('codex.templates.use'))?.disabled,'hidden Use is disabled');
    child=(await db.projects.get(P))!.codexTemplates!.find(item=>item.id===child.id)!;
    assert(child.icon==='Globe'&&child.color==='#11aa66'&&child.imageLayout==='landscape'&&child.hiddenFromPickers===true,'actual manager saves appearance');
    let conflict=false;try{await saveCodexTemplate(P,{...child,color:'#ffffff'},child.revision-1);}catch(error){conflict=error instanceof CodexTemplateConflict;}assert(conflict,'appearance changes obey revision CAS');
    passed.push('Type manager: real icon catalog, color/layout/visibility controls, persisted appearance and revision conflict protection');

    const makeEntry=(id:string,title:string,templateId:string):CodexEntry=>({id,projectId:P,title,type:'custom',templateId,avatar:image,avatarOriginal:image,fields:{},content:'<p>Authored text.</p>',tags:[],relations:[],createdAt:1,updatedAt:1});
    const hiddenEntry=makeEntry(P+'-hidden','Hush',hidden.id),landscapeEntry=makeEntry(P+'-landscape','Coast',child.id),publicEntry=makeEntry(P+'-public','Beacon',base.id);
    hiddenEntry.referenceFields={Bond:[landscapeEntry.id]};await db.codexEntries.bulkPut([hiddenEntry,landscapeEntry,publicEntry]);
    await render(<CodexEntryForm key="new" projectId={P} onSave={async()=>{}} onCancel={()=>{}}/>);
    await wait(()=>Boolean(document.querySelector('select[id$="-template"]')),'new form template choices');
    let selector=document.querySelector<HTMLSelectElement>('select[id$="-template"]')!;
    assert([...selector.options].some(option=>option.value===base.id)&&![...selector.options].some(option=>[hidden.id,child.id].includes(option.value)),'new type picker excludes hidden descendants only');
    let saved:CodexEntry|undefined;
    await render(<CodexEntryForm key="existing" projectId={P} entry={hiddenEntry} onSave={async entry=>{saved=entry;await db.codexEntries.put(entry);}} onCancel={()=>{}}/>);
    await wait(()=>Boolean(document.querySelector('[data-testid="codex-hidden-image"]')),'hidden image message');selector=document.querySelector<HTMLSelectElement>('select[id$="-template"]')!;
    assert(selector.value===hidden.id&&selector.selectedOptions[0].textContent?.includes(c.hiddenTag),'existing hidden type retains an honest selected option');
    const bond=document.querySelector('[data-reference-field="Bond"]');assert(bond?.textContent?.includes('Coast')&&!bond.querySelector('select option[value="'+hiddenEntry.id+'"]'),'selected hidden references visible, new hidden candidates excluded');
    await click(button(t('codex.saveChanges')),'save unchanged avatar through hidden layout');assert(saved?.avatar===image&&saved.avatarOriginal===image&&saved.type==='custom'&&saved.referenceFields?.Bond[0]===landscapeEntry.id,'hiding presentation never mutates bytes/category/links');
    passed.push('Entry forms: hidden new choices filtered, current hidden type/link retained, image none preserves original bytes and canonical category');

    const entries=await db.codexEntries.where('projectId').equals(P).toArray();
    await render(<CodexEntryList projectId={P} entries={entries} onAdd={async()=>{}} onEdit={async()=>{}} onDelete={()=>{}}/>);
    await wait(()=>Boolean(button('Hush'))||[...document.querySelectorAll('button')].some(node=>node.textContent?.includes('Hush')),'Codex list ready');
    const card=(title:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.querySelector('h3')?.textContent?.trim()===title);
    assert(card('Hush')&&!card('Hush')!.querySelector('img')&&card('Hush')!.querySelector('svg.lucide-sword'),'hidden type cards remain visible with custom icon and no image');
    assert(card('Coast')?.querySelector('img')?.className.includes('w-16')&&card('Beacon')?.querySelector('img')?.className.includes('h-14'),'landscape and portrait cards apply distinct layouts');
    const filter=document.querySelector<HTMLSelectElement>('[aria-label="'+t('codex.templates.template')+'"]');assert(filter?.options[0].value===''&&![...filter.options].some(option=>option.value===hidden.id),'All remains available while hidden template filters are omitted');
    await click(card('Hush'),'open hidden card');const dialog=[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!;
    assert(!dialog.querySelector('img[src="'+image+'"]')&&dialog.textContent?.includes('Coast'),'detail hides only image and keeps linked cards accessible');
    passed.push('Codex list/detail: All exposes hidden-type cards, custom icons/colors and portrait/landscape/none apply without hiding existing links');

    await render(<div/>);const inheritor=await saveCodexTemplate(P,{...template('inheritor','Inherited hidden type'),parentTemplateId:hidden.id},null);
    const archive=await createProjectZipArchive(P),zip=await JSZip.loadAsync(await archive.blob.arrayBuffer());const path=Object.keys(zip.files).find(path=>path.endsWith('/project.json'))!;
    const metadata=JSON.parse(await zip.file(path)!.async('string'))as Project;assert(metadata.codexTemplates?.find(template=>template.id===child.id)?.color==='#11aa66','ZIP includes appearance metadata');
    await db.projects.update(P,{codexTemplates:[]});await importProjectZip(new File([archive.blob],'types.zip'),{replaceProjectIds:[P]});
    templates=(await db.projects.get(P))!.codexTemplates!;assert(templates.find(template=>template.id===hidden.id)?.imageLayout==='none'&&(await db.codexEntries.get(hiddenEntry.id))?.avatarOriginal===image,'real ZIP restores presentation and hidden bytes');
    cloneId=await importProjectData(await exportProjectData(P));const clone=(await db.projects.get(cloneId))!,clonedHidden=clone.codexTemplates!.find(template=>template.name===hidden.name)!,clonedChild=clone.codexTemplates!.find(template=>template.name===child.name)!;
    assert(clonedChild.parentTemplateId===clonedHidden.id&&clonedChild.icon==='Globe'&&clonedChild.color==='#11aa66'&&clonedChild.hiddenFromPickers===true&&clonedHidden.imageLayout==='none','JSON clone remaps lineage and retains all appearance metadata');
    passed.push('Portability: actual ZIP restore and project clone preserve appearance, hierarchy, hidden flags and avatar originals');

    hidden=templates.find(template=>template.id===hidden.id)!;await deleteCodexTemplate(P,hidden.id,hidden.revision);templates=(await db.projects.get(P))!.codexTemplates!;
    const surviving=templates.find(template=>template.id===child.id)!;assert(surviving.parentTemplateId===base.id&&surviving.icon==='Globe'&&surviving.color==='#11aa66'&&surviving.imageLayout==='landscape'&&surviving.hiddenFromPickers===true,'parent retirement folds presentation into descendants safely');
    const inheritedSurvivor=templates.find(template=>template.id===inheritor.id)!;assert(inheritedSurvivor.icon==='Sword'&&inheritedSurvivor.color==='#336699'&&inheritedSurvivor.imageLayout==='none'&&inheritedSurvivor.hiddenFromPickers===true,'retiring layer folds inherited presentation into an otherwise unmodified child');
    const currentBase=templates.find(template=>template.id===base.id)!;await saveCodexTemplate(P,{...currentBase,color:'#ffffff'},currentBase.revision);assert(effectiveCodexTemplate(surviving,(await db.projects.get(P))!.codexTemplates!).color==='#11aa66','retired explicit override survives future ancestor edits');
    passed.push('Parent retirement: presentation overrides survive reparenting and later ancestor changes');
    return passed;
  }finally{await act(async()=>{root.unmount();await pause();});codexDraftStore(P).clear();await cleanup(P);if(cloneId)await cleanup(cloneId);}
}
