import {useState} from 'react';
import {LayoutGrid,List,Search} from 'lucide-react';
import {selectableCodexTemplates} from '@/engines/codex/templateHierarchy';
import type {CodexTemplate} from '@/engines/codex/templateTypes';
import {codexTypeIcons,codexTypeColors} from '@/components/codex/codexTypeMeta';
import {ProjectIcon} from '@/components/common/ProjectIcon';
import Modal from '@/components/common/Modal';
import CodexEntryForm from '@/components/codex/CodexEntryForm';
import {EnginePaneContext,useEnginePane} from '@/engines/_shared/EnginePaneContext';
import {useTranslation} from '@/i18n/useTranslation';
import {readWorkspaceLibrary,folderPath,WorkspaceLibraryConflict} from './model';
import {getEraProject} from '@/services/worldEras/store';
import type {Project} from '@/types';
import {createLibraryCodex} from './createCodex';

export default function CreateCodexDialog({project,eraId,initialFolderId,onClose}:{project:Project;eraId?:string;initialFolderId?:string;onClose:()=>void}){
 const {locale,t}=useTranslation(),pane=useEnginePane(),library=readWorkspaceLibrary(project),es=locale==='es';
 // First the kind of document, by category, searched, as a grid or a list (or none); then its form.
 const templates=selectableCodexTemplates(project.codexTemplates??[]),[picked,setPicked]=useState<{template?:CodexTemplate}|null>(templates.length?null:{}),[query,setQuery]=useState(''),[view,setView]=useState<'grid'|'list'>('grid');
 const shown=templates.filter(template=>!query.trim()||template.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),categories=[...new Set(shown.map(template=>template.category))];
 const [destination,setDestination]=useState(initialFolderId??''),[revision,setRevision]=useState(library.revision),[pending,setPending]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState('');
 return <EnginePaneContext.Provider value={{...pane,instanceId:pane?.instanceId??'library-create',projectId:project.id,eraId,visible:true}}><Modal open title={t('codex.newCodexEntry')} onClose={onClose} busy={pending} dismissible={!dirty} wide>
  <label className="mb-4 block space-y-1 text-sm text-text-muted">{es?'Crear en la carpeta':'Create in folder'}<select aria-label={es?'Carpeta de la nueva ficha':'New card folder'} className="block min-h-10 w-full rounded-lg border border-border bg-deep px-3 text-text-primary" disabled={pending} value={destination} onChange={event=>{setDestination(event.target.value);setRevision(library.revision);setError('');}}>
   <option value="">{es?'Sin carpeta':'Unfiled'}</option>{destination&&!library.folders.some(row=>row.id===destination)&&<option value={destination} disabled>{es?'Carpeta retirada: elige otra':'Folder removed: choose another'}</option>}{library.folders.map(folder=><option key={folder.id} value={folder.id}>{folderPath(library.folders,folder.id)}</option>)}
  </select></label>
  {error&&<p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
  {!picked&&<section className="space-y-3" data-testid="codex-type-picker">
   <div className="flex flex-wrap items-center gap-2"><label className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-border bg-deep px-3"><Search size={14} aria-hidden="true" className="text-text-muted"/><input data-testid="codex-type-search" aria-label={es?'Buscar un tipo':'Find a type'} placeholder={es?'Buscar un tipo…':'Find a type…'} value={query} onChange={event=>setQuery(event.target.value)} className="min-h-10 flex-1 bg-transparent text-sm text-text-primary outline-none"/></label>
    <div role="group" aria-label={es?'Vista':'View'} className="flex gap-1">{(['grid','list'] as const).map(mode=><button key={mode} type="button" data-testid={`codex-type-view-${mode}`} aria-pressed={view===mode} onClick={()=>setView(mode)} className={`rounded-lg border p-2 ${view===mode?'border-accent-gold text-accent-gold':'border-border text-text-muted'}`} aria-label={mode==='grid'?(es?'Cuadrícula':'Grid'):(es?'Lista':'List')}>{mode==='grid'?<LayoutGrid size={15}/>:<List size={15}/>}</button>)}</div>
    <button type="button" data-testid="codex-type-pick-none" onClick={()=>setPicked({})} className="rounded-lg border border-border px-3 py-2 text-sm text-text-muted hover:text-accent-gold">{es?'Sin tipo':'No type'}</button></div>
   {categories.map(category=><div key={category} className="space-y-1.5"><h4 className="text-xs uppercase tracking-wide text-text-muted">{t(`codex.types.${category}`)}</h4>
    <div className={view==='grid'?'grid grid-cols-2 gap-2 sm:grid-cols-3':'flex flex-col gap-1'}>{shown.filter(template=>template.category===category).map(template=><button key={template.id} type="button" data-testid={`codex-type-pick-${template.id}`} onClick={()=>setPicked({template})} className={`flex items-center gap-2 rounded-lg border border-border text-left text-sm text-text-primary hover:border-accent-gold ${view==='grid'?'flex-col justify-center p-3 text-center':'px-3 py-2'}`}><ProjectIcon name={template.icon} fallback={codexTypeIcons[template.category]} size={view==='grid'?22:15} style={{color:template.color??codexTypeColors[template.category]}}/>{template.name}</button>)}</div></div>)}
   {!shown.length&&<p className="text-sm text-text-muted">{es?'Ningún tipo coincide.':'No type matches.'}</p>}
  </section>}
  {picked&&<CodexEntryForm key={picked.template?.id??'none'} template={picked.template} projectId={project.id} onPendingChange={setPending} onDirtyChange={setDirty} onCancel={onClose} onSave={async entry=>{
   setError('');try{await createLibraryCodex({projectId:project.id,eraId},entry,revision,destination||undefined);onClose();}
   catch(failure){if(failure instanceof WorkspaceLibraryConflict){const fresh=await getEraProject({projectId:project.id,eraId});setRevision(readWorkspaceLibrary(fresh).revision);setError(es?'La biblioteca ha cambiado. Revisa la carpeta y vuelve a guardar; se conserva la ficha.':'The library changed. Review the folder and save again; your card is preserved.');}throw failure;}
  }}/>}
 </Modal></EnginePaneContext.Provider>;
}
