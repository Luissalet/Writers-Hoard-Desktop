import {useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createLocalToolClient} from '../storage';
import type {LocalToolDefinition} from '../sdk';
import {validateLocalToolConvergenceUpdate} from '../convergence/format';
import {flushPendingWrites} from '@/services/pendingWrites';
import type {SourceToolDocument} from './types';

const button='inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-3 text-base text-text-primary hover:bg-elevated disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent-gold';
/** Explicit file exchange for the same document; opening these controls never starts a history. */
export default function SourceToolConvergenceControls({projectId,eraId,definition,document,version,releaseHash,es}:{projectId:string;eraId?:string;definition:LocalToolDefinition;document:SourceToolDocument;version:string;releaseHash:string|null;es:boolean}){
 const lease=useMemo(()=>({current:true,projectId,eraId,definition,documentId:document.id,releaseHash}),[projectId,eraId,definition,document.id,releaseHash]);
 const currentVersion=useRef(version);useLayoutEffect(()=>{currentVersion.current=version;},[version]);
 const running=useRef(false),download=useRef<string|undefined>(undefined),preparedVersion=useRef<string|undefined>(undefined),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[prepared,setPrepared]=useState<{url:string;name:string}|null>(null);
 useLayoutEffect(()=>{lease.current=true;running.current=false;download.current=undefined;preparedVersion.current=undefined;setBusy(false);setPrepared(null);setError('');setStatus('');return()=>{lease.current=false;if(download.current)URL.revokeObjectURL(download.current);};},[lease]);
 useLayoutEffect(()=>{if(download.current&&preparedVersion.current!==version){URL.revokeObjectURL(download.current);download.current=undefined;preparedVersion.current=undefined;setPrepared(null);setStatus('');}},[version]);
 const client=useMemo(()=>createLocalToolClient(projectId,definition,{documentId:document.id,eraId,releaseHash,requireSelectedRelease:true,isCurrent:()=>lease.current}),[projectId,definition,document.id,eraId,releaseHash,lease]);
 const clearPrepared=()=>{if(download.current)URL.revokeObjectURL(download.current);download.current=undefined;preparedVersion.current=undefined;setPrepared(null);};
 const run=async(action:()=>Promise<void>)=>{
  if(running.current||!lease.current)return;running.current=true;setBusy(true);setError('');setStatus('');
  try{if(!(await flushPendingWrites()).ok)throw Error('pending');if(!lease.current)return;await action();}
  catch(reason){if(lease.current)setError(reason instanceof SyntaxError?es?'El archivo no contiene cambios válidos. Conserva el original y elige otro archivo.':'This file contains no valid changes. Keep the original and choose another file.':es?'No se completó el intercambio. Conserva el archivo y revisa el documento guardado antes de reintentar.':'The exchange did not complete. Keep the file and review the saved document before retrying.');}
  finally{if(lease.current){running.current=false;setBusy(false);}}
 };
 const started=!!document.convergence,canStart=!!(definition.codec??document.codec);
 return <details className="min-w-0 border-t border-border pt-3 text-base">
  <summary className="min-h-10 cursor-pointer text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold">{es?'Intercambiar cambios':'Exchange changes'}{started?(es?' · activo':' · active'):''}</summary>
  <div className="min-w-0 space-y-3 py-3">
   <p className="max-w-prose text-text-muted">{es?'Intercambia archivos de cambios entre instalaciones del mismo proyecto. Actívalo antes de llevar una copia del proyecto a otro equipo. Cada texto se intercambia como un bloque completo.':'Exchange change files between installations of the same project. Activate it before taking a project copy to another computer. Each text is exchanged as a complete block.'}</p>
   {document.convergence?.conflict&&<p role="alert" className="max-w-prose text-warning">{es?'Hay ediciones incompatibles. Se muestra una versión válida y las demás contribuciones se conservan en el historial. Exporta los cambios y revisa los campos afectados.':'Some edits are incompatible. A valid version is shown and the other contributions remain in the history. Export the changes and review the affected fields.'}</p>}
   <div className="flex min-w-0 flex-wrap items-center gap-2">
    {!started&&<button type="button" className={button} disabled={busy||!canStart} onClick={()=>void run(async()=>{await client.convergence!.start(await client.read());if(lease.current){clearPrepared();setStatus(es?'Intercambio activado para este documento.':'Change exchange activated for this document.');}})}>{es?'Activar intercambio':'Activate exchange'}</button>}
    {started&&<><button type="button" className={button} disabled={busy} onClick={()=>void run(async()=>{const versionBefore=currentVersion.current;const result=await client.convergence!.export();if(!lease.current)return;if(!result.update)throw Error('not_started');if(currentVersion.current!==versionBefore&&result.snapshot.document?.version!==currentVersion.current)throw Error('source_tool_document_conflict');const url=URL.createObjectURL(new Blob([JSON.stringify(result.update,null,2)],{type:'application/json'}));clearPrepared();download.current=url;preparedVersion.current=result.snapshot.document?.version;setPrepared({url,name:`document-${document.id}-changes.json`});setStatus(es?'Archivo de cambios preparado.':'Change file prepared.');})}>{es?'Preparar archivo de cambios':'Prepare change file'}</button>
     {prepared&&<a className={button} href={prepared.url} download={prepared.name}>{es?'Descargar cambios':'Download changes'}</a>}
     <label className="flex min-w-0 max-w-full flex-col gap-1 text-text-primary">{es?'Importar archivo de cambios':'Import change file'}<input className="min-h-10 min-w-0 max-w-full rounded-lg border border-border bg-elevated p-2 text-base focus-visible:outline-2 focus-visible:outline-accent-gold" type="file" accept=".json,application/json" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void run(async()=>{const update:unknown=JSON.parse(await file.text());validateLocalToolConvergenceUpdate(update);if(!lease.current)return;const result=await client.convergence!.import(update);if(lease.current){clearPrepared();setStatus(result.pending?(es?'Cambios guardados; faltan archivos anteriores para completarlos.':'Changes saved; earlier change files are needed to complete them.'):result.causalChanged?(es?'Cambios incorporados al documento.':'Changes merged into the document.'):(es?'Estos cambios ya estaban incorporados.':'These changes were already merged.'));}});}}/></label>
    </>}
   </div>
   {!canStart&&!started&&<p className="max-w-prose text-text-muted">{es?'Esta herramienta todavía no declara los campos necesarios para intercambiar cambios.':'This tool does not yet declare the fields needed for change exchange.'}</p>}
   {busy&&<p role="status" className="text-text-muted">{es?'Procesando cambios…':'Processing changes…'}</p>}
   {status&&<p role="status" className="max-w-prose text-text-muted">{status}</p>}
   {error&&<p role="alert" className="max-w-prose text-danger">{error}</p>}
  </div>
 </details>;
}
