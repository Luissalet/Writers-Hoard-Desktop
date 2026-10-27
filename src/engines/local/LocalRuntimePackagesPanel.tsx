import {useCallback,useEffect,useRef,useState} from 'react';
import {useTranslation} from '@/i18n/useTranslation';
import {onDataChanged} from '@/engines/_shared/dataChanged';
import {runtimeBase64,runtimeDecodeBase64} from './runtimeFormat.mjs';
import {inspectLocalRuntimePackage,installLocalRuntimePackage,listLocalRuntimePackages,exportLocalRuntimePackage,loadLocalRuntimePackages} from './runtimePackages';
import type {RuntimePackageInput} from './runtimeTypes';

type Inspection=Awaited<ReturnType<typeof inspectLocalRuntimePackage>>;
type Installed=Awaited<ReturnType<typeof listLocalRuntimePackages>>['packages'];
const button='min-h-10 rounded-lg border border-border px-3 text-sm text-text-primary hover:bg-elevated disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent-gold';

export default function LocalRuntimePackagesPanel(){
  const {locale}=useTranslation(),es=locale==='es';
  const [file,setFile]=useState<RuntimePackageInput>(),[inspection,setInspection]=useState<Inspection>();
  const [packages,setPackages]=useState<Installed>([]),[loaded,setLoaded]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const request=useRef(0);
  const refresh=useCallback(async()=>{
    const id=++request.current;
    try{const result=await listLocalRuntimePackages();if(id===request.current){setPackages(result.packages);setLoaded(true);}}
    catch(reason){if(id===request.current){setError(reason instanceof Error?reason.message:String(reason));setLoaded(true);}}
  },[]);
  useEffect(()=>{
    void refresh();
    const stop=onDataChanged(detail=>{if(!detail.table||detail.table==='localToolPackages')void refresh();});
    // This ref is a request sequence counter, not a DOM node captured for cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return()=>{stop();request.current++;};
  },[refresh]);
  const choose=async(selected:File|undefined)=>{
    setFile(undefined);setInspection(undefined);setError('');setNotice('');
    if(!selected)return;
    setBusy(true);
    try{
      const input={name:selected.name,mime:selected.type||'application/json',base64:runtimeBase64(new Uint8Array(await selected.arrayBuffer()))};
      const result=await inspectLocalRuntimePackage(input);
      setFile(input);setInspection(result);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  };
  const install=async()=>{
    if(!file||!inspection||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const result=await installLocalRuntimePackage(file);
      setInspection({...inspection,installed:true});
      setNotice(result.alreadyInstalled?(es?'Este paquete ya está instalado.':'This package is already installed.'):(es?'Paquete instalado. Elige sus versiones para este proyecto.':'Package installed. Choose its versions for this project.'));
      await refresh();
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  };
  const download=async(contentHash:string)=>{
    setBusy(true);setError('');setNotice('');
    try{
      const result=await exportLocalRuntimePackage(contentHash);
      const bytes=runtimeDecodeBase64(result.file.base64),url=URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer],{type:result.file.mime}));
      const link=document.createElement('a');link.href=url;link.download=result.file.name;
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
      setNotice(es?'Descarga iniciada.':'Download started.');
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  };
  const retry=async()=>{
    setBusy(true);setError('');setNotice('');
    try{await loadLocalRuntimePackages();await refresh();}
    catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  };
  return <div className="space-y-4" aria-label={es?'Paquetes locales':'Local packages'}>
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-text-primary">{es?'Instalar un paquete':'Install a package'}</h4>
      <p className="max-w-prose text-sm leading-relaxed text-text-muted">{es?'Añade herramientas y apps desde un archivo local. El paquete queda disponible sin reconstruir Writer; cada proyecto mantiene su versión elegida.':'Add tools and apps from a local file. The package becomes available without rebuilding Writer; each project keeps its selected version.'}</p>
      <label className="block space-y-1 text-sm text-text-muted">{es?'Paquete local (.json)':'Local package (.json)'}
        <input type="file" accept=".json,application/json" disabled={busy} onChange={event=>void choose(event.target.files?.[0])} className="block min-h-10 w-full min-w-0 max-w-full rounded-lg border border-border bg-surface p-2 text-base text-text-primary focus-visible:outline-2 focus-visible:outline-accent-gold"/>
      </label>
    </div>
    {inspection&&<div className="space-y-2 border-t border-border pt-3">
      <p className="break-words text-sm font-medium text-text-primary">{inspection.manifest.namespace} · {inspection.manifest.version}</p>
      <ul className="space-y-1 text-sm text-text-muted">{inspection.manifest.members.map(member=><li key={member.namespace} className="break-words">{member.namespace} · {member.kind==='app'?(es?'App':'App'):(es?'Herramienta':'Tool')}</li>)}</ul>
      <p className="break-all text-xs text-text-muted">{inspection.bytes.toLocaleString(locale)} bytes · {inspection.manifest.contentHash.slice(0,12)}</p>
      <button type="button" disabled={busy||inspection.installed} onClick={()=>void install()} className="min-h-10 rounded-lg bg-accent-gold px-3 text-sm font-medium text-deep hover:bg-accent-amber disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent-gold">{inspection.installed?(es?'Instalado':'Installed'):(es?'Instalar paquete':'Install package')}</button>
    </div>}
    <div className="space-y-2 border-t border-border pt-3">
      <h4 className="text-sm font-medium text-text-primary">{es?'Paquetes instalados':'Installed packages'}</h4>
      {!loaded?<p className="text-sm text-text-muted">{es?'Cargando paquetes…':'Loading packages…'}</p>:!packages.length?<p className="text-sm text-text-muted">{es?'Aún no hay paquetes instalados.':'No packages installed yet.'}</p>:<ul className="divide-y divide-border">{packages.map(row=><li key={row.manifest.contentHash} className="flex flex-wrap items-start justify-between gap-3 py-3">
        <div className="min-w-0 flex-1 space-y-1"><p className="break-words text-sm text-text-primary">{row.manifest.namespace} · {row.manifest.version}</p><p className="break-all text-xs text-text-muted">{row.manifest.contentHash.slice(0,12)} · {row.bytes.toLocaleString(locale)} bytes</p>{row.status==='unavailable'&&<p className="break-words text-sm text-warning">{es?'No disponible en esta sesión':'Unavailable in this session'}{row.error?': '+row.error.message:''}</p>}</div>
        <button type="button" disabled={busy} onClick={()=>void download(row.manifest.contentHash)} className={button} aria-label={`${es?'Descargar paquete':'Download package'} · ${row.manifest.namespace} · ${row.manifest.version}`}>{es?'Descargar paquete':'Download package'}</button>
      </li>)}</ul>}
      {packages.some(row=>row.status==='unavailable')&&<button type="button" disabled={busy} onClick={()=>void retry()} className={button}>{es?'Reintentar carga':'Retry loading'}</button>}
    </div>
    {busy&&<p role="status" className="text-sm text-text-muted">{es?'Procesando paquete…':'Processing package…'}</p>}
    {error&&<p role="alert" className="break-words text-sm text-danger">{error}</p>}
    {notice&&<p role="status" className="text-sm text-success">{notice}</p>}
  </div>;
}
