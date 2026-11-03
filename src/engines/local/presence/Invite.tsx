import {useEffect,useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {useLocation,useNavigate} from 'react-router-dom';
import Modal from '@/components/common/Modal';
import ImportCollisionDialog from '@/components/dashboard/ImportCollisionDialog';
import {useTranslation} from '@/i18n/useTranslation';
import {readSourceToolDocument} from '../documents/store';
import {previewProjectZipImport,importProjectZip,type ProjectZipImportCollision} from '@/services/zipBackup';
import type {LocalToolPresenceDocument} from './types';
import {currentPresenceInvite} from './profile';
/** The invite remains usable in a second, empty library before a Source route exists. */
export default function LocalPresenceInvite(){
 const location=useLocation(),navigate=useNavigate(),{locale}=useTranslation(),es=locale==='es',room=currentPresenceInvite(),[closed,setClosed]=useState(''),[target,setTarget]=useState<LocalToolPresenceDocument>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState<{file:File;collisions:ProjectZipImportCollision[]}>();
 useEffect(()=>{if(!room)return;let active=true;setTarget(undefined);setError('');void fetch('/__wh_presence/invite?'+new URLSearchParams({roomId:room})).then(async response=>{const result=await response.json();if(!response.ok)throw Error(result.error);if(active)setTarget(result.document);}).catch(()=>{if(active)setError(es?'La sesión local no está disponible en este Writer.':'The local session is unavailable in this Writer.');});return()=>{active=false;};},[room,es]);
 const local=useLiveQuery(async()=>{if(!target)return null;try{return await readSourceToolDocument({projectId:target.projectId,...(target.eraId?{eraId:target.eraId}:{})},target.documentId,target.namespace)??null;}catch{return null;}},[target]);
 if(!room||closed===room||location.pathname.startsWith('/project/'))return null;
 const importFile=async(file:File,replaceProjectIds?:string[])=>{setBusy(true);setError('');try{await importProjectZip(file,{replaceProjectIds});setPending(undefined);}catch{setError(es?'No se pudo importar el proyecto. La biblioteca se conserva.':'Could not import the project. The library is preserved.');}finally{setBusy(false);}};
 const preview=async(file:File)=>{setBusy(true);setError('');try{const result=await previewProjectZipImport(file);if(result.collisions.length)setPending({file,collisions:result.collisions});else await importFile(file);}catch{setError(es?'Este archivo no es un ZIP de proyecto válido.':'This file is not a valid project ZIP.');}finally{setBusy(false);}};
 // The invite locates a document; opening it does not admit room content.
 // The mounted host verifies the current definition, full history and D before join.
 const compatible=!!local&&local.lineage===target?.lineage;
 const open=()=>{if(!target)return;const query=new URLSearchParams({document:target.documentId,presenceSession:room});if(target.eraId)query.set('era',target.eraId);const url=new URL(window.location.href);url.searchParams.delete('presenceSession');window.history.replaceState(window.history.state,'',url);setClosed(room);navigate('/project/'+encodeURIComponent(target.projectId)+'/local-tool-'+encodeURIComponent(target.namespace)+'?'+query);};
 return <><Modal open title={es?'Unirse a una sesión local':'Join a local session'} onClose={()=>setClosed(room)}><div className="space-y-4 p-4" data-presence-invite>
  <p>{es?'Abre una copia compatible del proyecto para compartir personas y cursores. Puedes importar el ZIP del proyecto en esta biblioteca.':'Open a compatible copy of the project to share people and cursors. You can import its project ZIP into this library.'}</p>
  <label className="block rounded-lg border border-border p-3 text-sm">{es?'Importar proyecto ZIP':'Import project ZIP'}<input type="file" accept=".zip,application/zip" className="mt-2 block w-full" disabled={busy||!target} onChange={e=>{const file=e.target.files?.[0];if(file)void preview(file);e.target.value='';}}/></label>
  {local&&!compatible&&<p role="status">{es?'Esta copia tiene otra identidad de documento. Importa el ZIP de la sesión o elige otro documento compatible.':'This copy has another document identity. Import the session ZIP or choose another compatible document.'}</p>}
  <button className="min-h-10 rounded-lg border border-border px-3 disabled:opacity-50" disabled={busy||!compatible} onClick={open}>{es?'Abrir documento':'Open document'}</button>
  {error&&<p role="alert" className="text-sm text-danger">{error}</p>}
 </div></Modal><ImportCollisionDialog open={!!pending} busy={busy} collisions={pending?.collisions??[]} onCancel={()=>setPending(undefined)} onReplace={()=>pending?importFile(pending.file,pending.collisions.map(c=>c.projectId)):undefined}/></>;
}
