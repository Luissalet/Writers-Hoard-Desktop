import { lazy, Suspense, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import type { Editor } from '@tiptap/core';
import type { Project, Writing, CodexEntry } from '@/types';
import type { EntitySpan } from '@/services/entityDetection/types';
import type { EntityCandidateScope } from '@/services/entityDetection/dismissalTypes';

// No DB or product module is loaded until a user presses Prepare/Load/Query/Cleanup.
const TiptapEditor = lazy(() => import('@/components/editor/TiptapEditor'));
const PREFIX = 'qa-ner-manual-', MARKER = 'Own synthetic durable NER browser fixture v1';
const parameters = new URL(location.href), requested = parameters.searchParams.get('project');
const projectId = requested && /^qa-ner-manual-[a-f0-9-]{36}$/.test(requested) ? requested : PREFIX + crypto.randomUUID();
parameters.searchParams.set('project', projectId); history.replaceState(null, '', parameters);
const ids = { projectId, first: projectId + '-A', second: projectId + '-B', known: projectId + '-known', codex: projectId + '-card', draft: projectId + '-draft', eraDraft: projectId + '-era-draft', era: 'past' };
const text = 'Nora travelled with Rowan to Castle Blackthorn. La Guía kept the authored link.';
const sourceHtml = `<p>Nora travelled with Rowan to Castle Blackthorn. La Guía kept the <a href="/project/${projectId}/codex?entry=${ids.known}">authored link</a>.</p>`;
type Choice = 'base' | 'era' | 'draft' | 'eraDraft' | 'codex';
const choices: Choice[] = ['base','era','draft','eraDraft','codex'];
const initialChoice = choices.includes(parameters.searchParams.get('scope') as Choice) ? parameters.searchParams.get('scope') as Choice : 'base';
const scopes: Record<Choice, EntityCandidateScope> = {
 base:{projectId,context:{kind:'writings',documentId:ids.first}},
 era:{projectId,eraId:ids.era,context:{kind:'writings',documentId:ids.first}},
 draft:{projectId,context:{kind:'writings',documentId:ids.first,draftId:ids.draft}},
 eraDraft:{projectId,eraId:ids.era,context:{kind:'writings',documentId:ids.first,draftId:ids.eraDraft}},
 codex:{projectId,context:{kind:'codex',documentId:ids.codex}},
};
async function owned() {
 const {db}=await import('@/db');const project=await db.projects.get(projectId);
 if(!project||project.description!==MARKER)throw Error('No existen datos propios reconocidos. Prepara primero; no se accede a otro proyecto.');
 return {db,project};
}
function installControlledUiInference() {
 const previous=window.electronAPI;
 const controlled={status:async()=>({state:'ready' as const,model:'CONTROLLED_UI_FIXTURE_NO_MODEL'}),prepare:async()=>{throw Error('La fixture no prepara modelos');},detect:async(source:string):Promise<EntitySpan[]>=>['Nora','Rowan','Castle Blackthorn','La Guía'].flatMap(name=>{const from=source.indexOf(name);return from<0?[]:[{from,to:from+name.length,text:name,label:name==='Castle Blackthorn'?'LOC' as const:'PER' as const,score:.99}];})};
 Object.defineProperty(window,'electronAPI',{configurable:true,value:{...previous,entityDetection:controlled}});
 return ()=>Object.defineProperty(window,'electronAPI',{configurable:true,value:previous});
}
async function prepare() {
 const {db}=await import('@/db');if(await db.projects.get(projectId))throw Error('El ID ya existe. Usa Cargar datos propios; Preparar no sobrescribe.');
 const project:Project={id:projectId,title:'Own NER browser fixture',description:MARKER,mode:'custom',type:'standalone',color:'#777777',status:'draft',enabledEngines:['writings','codex'],engineOrder:['writings','codex'],createdAt:1,updatedAt:1,entityDetectionPreferences:{revision:1,detectNewEntities:true,autoLinkMentions:true,animateNewLinks:false},worldEras:[{id:ids.era,name:'Past own scope',description:'Synthetic',revision:1,createdAt:1,updatedAt:1}]};
 const writing=(id:string):Writing=>({id,projectId,title:id.endsWith('-A')?'Own document A':'Own control document B',content:sourceHtml,wordCount:15,status:'draft',tags:['synthetic'],createdAt:1,updatedAt:1});
 const card=(id:string,title:string,fields:Record<string,string>):CodexEntry=>({id,projectId,title,type:'character',fields,content:sourceHtml,tags:['synthetic'],relations:[],createdAt:1,updatedAt:1});
 await db.transaction('rw',db.tables,async()=>{
  await db.projects.add(project);await db.writings.bulkAdd([writing(ids.first),writing(ids.second)]);
  await db.codexEntries.bulkAdd([card(ids.known,'Known Pilot',{aliases:'["La Guía"]'}),card(ids.codex,'Own target card',{})]);
  await db.writingSnapshots.add({id:ids.draft,writingId:ids.first,projectId,title:'Own parallel draft',content:sourceHtml,wordCount:15,reason:'manual',kind:'parallel-draft',draftName:'Own draft',basedOnVersion:1,createdAt:1,updatedAt:1});
 });
 const {readWorldDocument,saveEraDocument}=await import('@/services/worldEras/store'),scope={projectId,eraId:ids.era},current=(await readWorldDocument(scope,'writings',ids.first))!;
 await saveEraDocument(scope,'writings',{...current.document,children:{...current.document.children,writingSnapshots:[...current.document.children.writingSnapshots??[],{id:ids.eraDraft,writingId:ids.first,projectId,title:'Own era alternative',content:sourceHtml,wordCount:15,reason:'manual',kind:'parallel-draft',draftName:'Own era-only draft',basedOnVersion:1,createdAt:1,updatedAt:1}]}},current.version);
 return {prepared:true,ids,metadataInitiallyAbsent:!Object.hasOwn((await db.projects.get(projectId))!,'entityCandidateDismissals'),inference:'not invoked by preparation'};
}
async function digest(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
function Fixture() {
 const [loaded,setLoaded]=useState(false),[choice,setChoice]=useState<Choice>(initialChoice),[busy,setBusy]=useState(false),[error,setError]=useState(''),[report,setReport]=useState(''),[edits,setEdits]=useState(0);
 const editors=useRef(new Map<string,Editor>()),restoreApi=useRef<(()=>unknown)|undefined>(undefined);
 const publish=(value:unknown)=>{Reflect.set(window,'__nerManualLastReceipt',value);setReport(JSON.stringify(value,null,2));};
 const action=async(work:()=>Promise<unknown>)=>{setBusy(true);setError('');try{publish(await work());}catch(cause){setError(String(cause));}finally{setBusy(false);}};
 const load=async()=>{await owned();const {useLocaleStore}=await import('@/stores/localeStore');useLocaleStore.setState({locale:'es'});restoreApi.current?.();restoreApi.current=installControlledUiInference();setLoaded(true);return {loadedExisting:true,projectId,scope:choice,resetOrWrites:false,inference:'Controlled API only for this UI fixture; no model and no Browser NER end-to-end claim'};};
 const query=async()=>{
  const {db,project}=await owned(),{getEntityCandidateDismissals}=await import('@/services/entityDetection/service');
  const writings=await db.writings.bulkGet([ids.first,ids.second]),cards=await db.codexEntries.bulkGet([ids.known,ids.codex]),draft=await db.writingSnapshots.get(ids.draft),variants=await db.worldEraVariants.where('projectId').equals(projectId).toArray();
  const snapshots=await Promise.all(Object.entries(scopes).map(async([key,scope])=>({key,...await getEntityCandidateDismissals(scope)})));
  return {ids,url:location.href,scope:choice,loaded,proseOnChangeCount:edits,hasLedger:Object.hasOwn(project,'entityCandidateDismissals'),ledger:project.entityCandidateDismissals,scopes:snapshots,originalSourceHtml:sourceHtml,originalSourceSha256:await digest(sourceHtml),savedWritings:await Promise.all(writings.map(async writing=>({id:writing?.id,content:writing?.content,sha256:await digest(writing?.content??''),exact:writing?.content===sourceHtml,updatedAt:writing?.updatedAt}))),cards,draft,variants,editorHtml:await Promise.all([...editors.current].filter(([,editor])=>!editor.isDestroyed).map(async([slot,editor])=>({slot,html:editor.getHTML(),sha256:await digest(editor.getHTML()),text:editor.getText()}))),visibleCandidates:[...document.querySelectorAll('[data-ner-pane]')].map(pane=>({pane:pane.getAttribute('data-ner-pane'),names:[...pane.querySelectorAll('.wh-entity-panel li > span')].map(node=>node.textContent)})),claim:'UI controlled inference; this query does not constitute cold reload proof without external before/reload/after observation'};
 };
 const cleanup=async()=>{
  const {db}=await owned();flushSync(()=>setLoaded(false));editors.current.clear();restoreApi.current?.();restoreApi.current=undefined;
  const {deleteProject}=await import('@/db/operations');await deleteProject(projectId);
  return {cleaned:true,projectId,projects:await db.projects.where('id').equals(projectId).count(),writings:await db.writings.where('projectId').equals(projectId).count(),codex:await db.codexEntries.where('projectId').equals(projectId).count(),drafts:await db.writingSnapshots.where('projectId').equals(projectId).count(),variants:await db.worldEraVariants.where('projectId').equals(projectId).count(),history:await db.documentHistory.where('projectId').equals(projectId).count(),links:await db.entityLinks.where('projectId').equals(projectId).count()};
 };
 const changeChoice=(next:Choice)=>{setChoice(next);const url=new URL(location.href);url.searchParams.set('scope',next);history.replaceState(null,'',url);};
 const first=scopes[choice],second:EntityCandidateScope={projectId,context:{kind:'writings',documentId:ids.second}};
 const mount=(slot:string,scope:EntityCandidateScope)=><section data-ner-pane={slot} className="min-w-0 space-y-2 rounded border border-border p-3"><h2>{slot==='A'?'Documento A / scope elegido':'Documento B / control Base'}</h2><p className="text-xs break-all">{JSON.stringify(scope)}</p><TiptapEditor key={slot+JSON.stringify(scope)} content={sourceHtml} onChange={()=>setEdits(value=>value+1)} onEditorReady={editor=>{if(editor)editors.current.set(slot,editor);else editors.current.delete(slot);}} copilotIdentity={scope.context.kind==='writings'?{projectId,objectId:scope.context.documentId,kind:'writings'}:undefined} referenceContext={{projectId,scopeId:'own-ner-manual-'+slot,eraId:scope.eraId}} documentOwner={scope.context} entityCandidateContext={scope.context} /></section>;
 return <MemoryRouter><main className="mx-auto max-w-7xl space-y-4 p-5"><h1 className="text-xl">Descarte durable · datos propios de QA</h1><p>Inferencia controlada explícita; editor Tiptap y acciones del producto normales. No usa modelo ni acredita NER Browser de extremo a extremo. No escribas prosa durante la prueba: se cuenta cualquier onChange y esta fixture no la guarda.</p><p>Una recarga conserva el ID de abajo en la URL. Tras recargar, pulsa <strong>Cargar datos propios</strong>; no vuelvas a Preparar. Nada se consulta automáticamente antes de pulsar un botón.</p><code className="block break-all">{projectId}</code><div className="flex flex-wrap gap-3"><button disabled={busy} onClick={()=>void action(prepare)}>Preparar datos propios</button><button disabled={busy} onClick={()=>void action(load)}>Cargar datos propios</button><button disabled={busy} onClick={()=>void action(query)}>Consultar datos propios</button><button disabled={busy} onClick={()=>void action(cleanup)}>Limpiar datos propios</button></div><label>Scope de A <select value={choice} onChange={event=>changeChoice(event.target.value as Choice)}>{choices.map(value=><option key={value} value={value}>{value}</option>)}</select></label><p>Ediciones de prosa detectadas: <strong>{edits}</strong>. Abre «Referencias y herramientas del documento» → «Entidades y menciones» en ambos documentos. Cada uno debe ofrecer Nora, Rowan y Castle Blackthorn; La Guía es alias conocido. Los controles normales ofrecen Descartar, Recuperar y Deshacer.</p>{error&&<p role="alert">{error}</p>}{loaded&&<Suspense fallback={<p>Cargando editor real…</p>}><div className="grid gap-4 xl:grid-cols-2">{mount('A',first)}{mount('B',second)}</div></Suspense>}<label className="block">Recibo consultable <textarea aria-label="Recibo de datos propios" className="mt-2 h-80 w-full rounded border border-border bg-deep p-3 font-mono text-xs" readOnly value={report}/></label></main></MemoryRouter>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
