import {useState} from 'react';
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
 const [destination,setDestination]=useState(initialFolderId??''),[revision,setRevision]=useState(library.revision),[pending,setPending]=useState(false),[dirty,setDirty]=useState(false),[error,setError]=useState('');
 return <EnginePaneContext.Provider value={{...pane,instanceId:pane?.instanceId??'library-create',projectId:project.id,eraId,visible:true}}><Modal open title={t('codex.newCodexEntry')} onClose={onClose} busy={pending} dismissible={!dirty} wide>
  <label className="mb-4 block space-y-1 text-sm text-text-muted">{es?'Crear en la carpeta':'Create in folder'}<select aria-label={es?'Carpeta de la nueva ficha':'New card folder'} className="block min-h-10 w-full rounded-lg border border-border bg-deep px-3 text-text-primary" disabled={pending} value={destination} onChange={event=>{setDestination(event.target.value);setRevision(library.revision);setError('');}}>
   <option value="">{es?'Sin carpeta':'Unfiled'}</option>{destination&&!library.folders.some(row=>row.id===destination)&&<option value={destination} disabled>{es?'Carpeta retirada: elige otra':'Folder removed: choose another'}</option>}{library.folders.map(folder=><option key={folder.id} value={folder.id}>{folderPath(library.folders,folder.id)}</option>)}
  </select></label>
  {error&&<p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
  <CodexEntryForm projectId={project.id} onPendingChange={setPending} onDirtyChange={setDirty} onCancel={onClose} onSave={async entry=>{
   setError('');try{await createLibraryCodex({projectId:project.id,eraId},entry,revision,destination||undefined);onClose();}
   catch(failure){if(failure instanceof WorkspaceLibraryConflict){const fresh=await getEraProject({projectId:project.id,eraId});setRevision(readWorkspaceLibrary(fresh).revision);setError(es?'La biblioteca ha cambiado. Revisa la carpeta y vuelve a guardar; se conserva la ficha.':'The library changed. Review the folder and save again; your card is preserved.');}throw failure;}
  }}/>
 </Modal></EnginePaneContext.Provider>;
}
