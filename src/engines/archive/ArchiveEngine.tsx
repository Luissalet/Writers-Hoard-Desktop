import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, RotateCcw, Trash2 } from 'lucide-react';
import { db } from '@/db';
import type { EngineComponentProps } from '@/engines/_types';
import { ConfirmDialog } from '@/engines/_shared';
import { useTranslation } from '@/i18n/useTranslation';
import { ArchiveRestoreConflict, forgetArchivedDocument, restoreArchivedDocument } from '@/services/documentArchive/store';
import type { ArchivedDocumentKind } from '@/services/documentArchive/types';
import { metadataFields } from '@/services/documentArchive/metadata';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import EraArchive from '@/services/worldEras/EraArchive';
type Document={id:string;title:string;kind:ArchivedDocumentKind;count?:number;date?:number;revision?:number};
const button='inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:border-accent-gold hover:text-accent-gold disabled:opacity-50';
const engineId=(kind:ArchivedDocumentKind)=>kind==='relation-tree'?'genealogy':kind;
async function archiveDocument(document:Document,projectId:string) {
  if(document.kind==='local-tool'){const {archiveSourceToolDocument,readSourceToolDocument}=await import('@/engines/local/documents/store');const current=await readSourceToolDocument({projectId},document.id);if(current)await archiveSourceToolDocument({projectId},document.id,current.document.namespace,current.document.revision,current.version);}
  else if(document.kind==='codex') {const {deleteCodexEntry}=await import('@/db/operations');await deleteCodexEntry(document.id);}
  else if(document.kind==='maps') {const {deleteWorldMap}=await import('@/engines/maps/hooks');await deleteWorldMap(document.id);}
  else if(document.kind==='board') {const {deleteBoard}=await import('@/engines/board/operations');await deleteBoard(document.id);}
  else if(document.kind==='timeline') {const {deleteTimeline}=await import('@/engines/timeline/operations');await deleteTimeline(document.id);}
  else if(document.kind==='writings') {const {deleteWriting}=await import('@/engines/writings/operations');await deleteWriting(document.id);}
  else if(document.kind==='dictionary') {const {removeDictionary}=await import('@/engines/dictionary/operations');await removeDictionary(projectId,document.id);}
  else if(document.kind==='tables') {const {deleteTable}=await import('@/engines/tables/operations');await deleteTable(projectId,document.id);}
  else if(document.kind==='relation-tree') {const {deleteRelationTree}=await import('@/engines/genealogy/relationTreeStore');await deleteRelationTree(projectId,document.id,document.revision!);}
  else if(document.kind==='character-sheets') {const {deleteSheet}=await import('@/engines/character-sheets/operations');await deleteSheet(projectId,document.id,document.revision!);}
  else if(document.kind==='radar') {const {deleteRadarChart}=await import('@/engines/radar/operations');await deleteRadarChart(projectId,document.id,document.revision!);}
  else if(document.kind==='model-viewer') {const {removeModelAsset}=await import('@/engines/model-viewer/model');await removeModelAsset(projectId,document.id);}
}
export default function ArchiveEngine({projectId,eraId}:EngineComponentProps & {eraId?:string}) {
  const paneScope = useWorldEraScope(projectId), contextualEraId = eraId ?? paneScope.eraId;
  return contextualEraId ? <EraArchive scope={{projectId,eraId:contextualEraId}}/> : <BaseArchive projectId={projectId}/>;
}
function BaseArchive({projectId}:EngineComponentProps) {
  const {t,locale}=useTranslation();
  const [tab,setTab]=useState<'deleted'|'active'>('deleted'),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<'error'|'conflict'|null>(null),[message,setMessage]=useState('');
  const [pending,setPending]=useState<{kind:'archive'|'forget';document:Document}|null>(null);
  // Several archived copies at once: the ones ticked, restored or deleted forever together.
  const [picked,setPicked]=useState<Set<string>>(()=>new Set()),[bulkForget,setBulkForget]=useState(false);
  const archived=useLiveQuery(async()=>{
    const result:Document[]=[];
    // The shelf retains metadata only, never every archived manuscript/model body.
    await db.documentArchives.where('projectId').equals(projectId).each(row=>result.push({id:row.id,title:row.title,kind:row.kind,date:row.archivedAt,count:row.mutations.length}));
    return result.sort((a,b)=>(b.date??0)-(a.date??0));
  },[projectId])??[];
  const active=useLiveQuery(async()=>{
    const out:Document[]=[];
    for(const [table,kind]of [['codexEntries','codex'],['worldMaps','maps'],['boards','board'],['timelines','timeline'],['writings','writings']]as const) await db.table(table).where('projectId').equals(projectId).each(row=>out.push({id:row.id,title:row.title,kind}));
    const project=await db.projects.get(projectId);
    for(const [kind,field]of Object.entries(metadataFields))for(const row of ((project as unknown as Record<string,unknown>)?.[field!] as Array<{id:string;title?:string;name?:string;revision?:number}>|undefined)??[])out.push({id:row.id,title:row.title??row.name??row.id,kind:kind as ArchivedDocumentKind,revision:row.revision});
    return out.sort((a,b)=>a.title.localeCompare(b.title));
  },[projectId])??[];
  const documents:Document[]=tab==='deleted'?archived:active;
  const fold=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase();
  const visible=documents.filter(row=>fold(`${row.title} ${row.kind==='local-tool'?(locale==='es'?'Herramienta local':'Local tool'):t(`engines.${engineId(row.kind)}.name`)}`).includes(fold(search)));
  const run=async(action:()=>Promise<void>,success:string)=>{setBusy(true);setError(null);setMessage('');try{await action();setMessage(t(success));}catch(error){setError(error instanceof ArchiveRestoreConflict?'conflict':'error');}finally{setBusy(false);}};
  const chosen=tab==='deleted'?visible.filter(row=>picked.has(row.id)):[];
  /** One by one, oldest archived first (a restore can need an earlier one back): what went, what held. */
  const runMany=async(kind:'restore'|'forget')=>{const rows=[...chosen].sort((a,b)=>(a.date??0)-(b.date??0));setBusy(true);setError(null);setMessage('');let done=0,conflicts=0,failed=0;for(const row of rows){try{if(kind==='restore')await restoreArchivedDocument(projectId,row.id);else await forgetArchivedDocument(projectId,row.id);done++;}catch(error){if(error instanceof ArchiveRestoreConflict)conflicts++;else failed++;}}setPicked(new Set());setBusy(false);setMessage(t(kind==='restore'?'archive.bulkRestored':'archive.bulkForgotten').replace('{done}',String(done)).replace('{conflicts}',String(conflicts)).replace('{failed}',String(failed)));if(conflicts)setError('conflict');else if(failed)setError('error');};
  const toggle=(id:string)=>setPicked(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
  return <div className="space-y-5" data-testid="document-archive"><header><h2 className="text-2xl font-serif font-bold text-accent-gold flex gap-3 items-center"><Archive size={23}/>{t('archive.title')}</h2><p className="mt-2 text-sm text-text-muted max-w-3xl">{t('archive.intro')}</p></header><div className="flex flex-wrap gap-3 items-center"><div className="flex rounded-lg border border-border p-1">{(['deleted','active']as const).map(value=><button key={value} type="button" className={`${button} border-transparent ${tab===value?'bg-accent-gold/15 text-accent-gold':''}`} onClick={()=>{setTab(value);setSearch('');}}>{t(`archive.${value}`)} · {value==='deleted'?archived.length:active.length}</button>)}</div><input type="search" aria-label={t('archive.search')} placeholder={t('archive.search')} className="min-w-48 flex-1 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary" value={search} onChange={event=>setSearch(event.target.value)}/></div>{error&&<p role="alert" className="rounded-lg border border-danger/40 p-3 text-sm text-danger">{t(`archive.${error}`)}</p>}{message&&<p role="status" className="text-sm text-accent-gold">{message}</p>}{tab==='deleted'&&visible.length>0&&<div className="flex flex-wrap items-center gap-2" data-testid="archive-bulk"><label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" data-testid="archive-pick-all" checked={visible.length>0&&visible.every(row=>picked.has(row.id))} onChange={event=>setPicked(event.target.checked?new Set(visible.map(row=>row.id)):new Set())}/>{t('archive.pickAll')}</label><button type="button" data-testid="archive-bulk-restore" disabled={busy||!chosen.length} className={button} onClick={()=>void runMany('restore')}><RotateCcw size={15}/>{t('archive.bulkRestore').replace('{count}',String(chosen.length))}</button><button type="button" data-testid="archive-bulk-forget" disabled={busy||!chosen.length} className={`${button} text-danger`} onClick={()=>setBulkForget(true)}><Trash2 size={15}/>{t('archive.bulkForget').replace('{count}',String(chosen.length))}</button></div>}<div className="divide-y divide-border rounded-xl border border-border bg-surface">{visible.map(row=><article key={row.id} className="flex flex-wrap items-center gap-3 p-4" data-testid={`archive-row-${row.id}`}>{tab==='deleted'&&<input type="checkbox" aria-label={`${t('archive.pick')} ${row.title}`} data-testid={`archive-pick-${row.id}`} checked={picked.has(row.id)} onChange={()=>toggle(row.id)}/>}<div className="flex-1 min-w-40"><h3 className="font-semibold text-text-primary break-words">{row.title}</h3><p className="text-xs text-text-muted mt-1">{row.kind==='local-tool'?(locale==='es'?'Herramienta local':'Local tool'):t(`engines.${engineId(row.kind)}.name`)}{row.date?` · ${new Date(row.date).toLocaleString(locale)}`:''}{row.count!==undefined?` · ${t('archive.rows').replace('{count}',String(row.count))}`:''}</p></div>{tab==='deleted'?<><button type="button" disabled={busy} className={button} onClick={()=>void run(()=>restoreArchivedDocument(projectId,row.id),'archive.restored')}><RotateCcw size={15}/>{t('archive.restore')}</button><button type="button" disabled={busy} className={`${button} text-danger`} onClick={()=>setPending({kind:'forget',document:row})}><Trash2 size={15}/>{t('archive.forget')}</button></>:<button type="button" disabled={busy} className={button} onClick={()=>setPending({kind:'archive',document:row})}><Archive size={15}/>{t('archive.archive')}</button>}</article>)}{!visible.length&&<div className="p-10 text-center"><Archive className="mx-auto text-text-dim" size={30}/><p className="mt-3 text-text-muted">{t('archive.empty')}</p><p className="text-xs text-text-dim mt-1">{t('archive.emptyHelp')}</p></div>}</div><ConfirmDialog open={!!pending} destructive={pending?.kind==='forget'} title={t(pending?.kind==='forget'?'archive.forgetTitle':'archive.archiveTitle')} message={t(pending?.kind==='forget'?'archive.forgetConfirm':'archive.archiveConfirm').replace('{title}',pending?.document.title??'')} confirmLabel={t(pending?.kind==='forget'?'archive.forget':'archive.archive')} onCancel={()=>setPending(null)} onConfirm={async()=>{const choice=pending;if(!choice)return;setPending(null);await run(()=>choice.kind==='forget'?forgetArchivedDocument(projectId,choice.document.id):archiveDocument(choice.document,projectId),choice.kind==='forget'?'archive.forgotten':'archive.archived');}}/><ConfirmDialog open={bulkForget} destructive title={t('archive.bulkForgetTitle').replace('{count}',String(chosen.length))} message={t('archive.bulkForgetConfirm').replace('{count}',String(chosen.length))} confirmLabel={t('archive.forget')} onCancel={()=>setBulkForget(false)} onConfirm={async()=>{setBulkForget(false);await runMany('forget');}}/></div>;
}
