import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {useNavigate} from 'react-router-dom';
import {db} from '@/db';
import Modal from '@/components/common/Modal';
import {useTranslation} from '@/i18n/useTranslation';
import {flushPendingWrites} from '@/services/pendingWrites';
import {getLocalToolDefinition} from './definitions';
import {listLocalRuntimePackages} from './runtimePackages';
import {createRuntimeTrial,keepRuntimeTrial,discardRuntimeTrial} from './runtimeTrials';
import {readRuntimeUsage} from './runtimeUsage';

type Installed=Awaited<ReturnType<typeof listLocalRuntimePackages>>['packages'];
const button='min-h-10 rounded-lg border border-border px-3 text-sm text-text-primary hover:bg-elevated disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent-gold';
const input='block min-h-10 w-full min-w-0 rounded-lg border border-border bg-surface px-3 text-base text-text-primary outline-none focus:border-accent-gold';
function instanceLabel(kind:string,es:boolean){const labels:Record<string,string>={legacy:es?'Estado del proyecto':'Project state','era-state':es?'Estado propio de época':'Own era state',document:es?'Documento':'Document','era-variant':es?'Variante de época':'Era variant',archive:es?'Archivo':'Archive'};return labels[kind]??kind;}
function problem(error:unknown,es:boolean){
  const message=error instanceof Error?error.message:String(error);
  if(message==='local_runtime_trial_pending')return es?'Guarda o descarta los borradores pendientes con sus controles antes de descartar el proyecto.':'Use the editor controls to save or discard pending drafts before discarding the project.';
  if(message==='local_runtime_trial_marker_conflict')return es?'La prueba ha cambiado o ya se ha conservado. Recarga el proyecto.':'The trial changed or was already kept. Reload the project.';
  if(message.includes('dependency')||message.includes('selection')||message.includes('unavailable'))return es?'Elige una versión disponible para cada herramienta requerida.':'Choose an available version for every required tool.';
  return es?'No se completó el cambio. Los datos guardados se conservan; revísalos antes de reintentar.':'The change did not complete. Saved data is retained; review it before retrying.';
}
function dependencies(namespace:string,hash:string,choices:Record<string,string>,own:Installed[number]){
  const required=new Map<string,string>(),queue=[{namespace,contentHash:hash}];
  for(let index=0;index<queue.length;index++)for(const tool of getLocalToolDefinition(queue[index].namespace,queue[index].contentHash)?.app?.descriptor.tools??[]){
    if(tool===namespace||required.has(tool))continue;
    const selected=choices[tool]??(own.manifest.members.some(member=>member.namespace===tool)?own.manifest.contentHash:'');
    required.set(tool,selected);if(selected)queue.push({namespace:tool,contentHash:selected});
  }
  return [...required].map(([namespace,contentHash])=>({namespace,contentHash}));
}
export function LocalRuntimeTrialActions({row,onNavigate}:{row:Installed[number];onNavigate?:()=>void}){
  const {locale}=useTranslation(),es=locale==='es',navigate=useNavigate();
  const [open,setOpen]=useState(false),[namespace,setNamespace]=useState(''),[title,setTitle]=useState(''),[choices,setChoices]=useState<Record<string,string>>({});
  const [available,setAvailable]=useState<Installed>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[created,setCreated]=useState<{projectId:string;path:string}>();
  const [usage,setUsage]=useState<Awaited<ReturnType<typeof readRuntimeUsage>>>(),[usageOpen,setUsageOpen]=useState(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const tools=namespace?dependencies(namespace,row.manifest.contentHash,choices,row):[];
  const navigateTo=(path:string)=>{navigate(path);onNavigate?.();};
  const begin=async()=>{setError('');setBusy(true);try{const list=await listLocalRuntimePackages();if(alive.current){setAvailable(list.packages);setOpen(true);}}catch(reason){if(alive.current)setError(problem(reason,es));}finally{if(alive.current)setBusy(false);}};
  const create=async()=>{
    if(busy||!namespace||!title.trim()||tools.some(tool=>!tool.contentHash))return;
    setBusy(true);setError('');
    try{
      if(!(await flushPendingWrites()).ok)throw Error('local_runtime_trial_pending');
      const result=await createRuntimeTrial({contentHash:row.manifest.contentHash,namespace,title,tools});
      if(!alive.current)return;setCreated(result);
      // Creation is already committed. A routing failure retains this link.
      try{navigateTo(result.path);}catch{setError(es?'Proyecto creado. Puedes abrirlo con el enlace.':'Project created. Use the link to open it.');}
    }catch(reason){if(alive.current)setError(problem(reason,es));}
    finally{if(alive.current)setBusy(false);}
  };
  const showUsage=async()=>{setBusy(true);setError('');try{const result=await readRuntimeUsage(row.manifest.contentHash);if(alive.current){setUsage(result);setUsageOpen(true);}}catch(reason){if(alive.current)setError(problem(reason,es));}finally{if(alive.current)setBusy(false);}};
  return <div className="basis-full space-y-3">
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy||row.status!=='available'} onClick={()=>void begin()}>{es?'Probar':'Try'}</button><button type="button" className={button} disabled={busy} onClick={()=>void showUsage()}>{es?'Uso':'Usage'}</button></div>
    {error&&<p role="alert" className="max-w-prose text-sm text-danger">{error}</p>}
    <Modal open={open} busy={busy} onClose={()=>{if(!busy)setOpen(false);}} title={es?'Probar en un proyecto nuevo':'Try in a new project'}><div className="space-y-4 p-5">
      <p className="max-w-prose text-sm text-text-muted">{es?'Crearás un proyecto normal con estas versiones. El paquete seguirá instalado al descartar la prueba.':'This creates a normal project with these versions. The package stays installed when the trial is discarded.'}</p>
      <label className="block space-y-1 text-sm">{es?'Nombre del proyecto':'Project name'}<input className={input} value={title} onChange={event=>setTitle(event.target.value)} disabled={busy||!!created}/></label>
      <label className="block space-y-1 text-sm">{es?'App o herramienta inicial':'Starting app or tool'}<select className={input} value={namespace} disabled={busy||!!created} onChange={event=>{setNamespace(event.target.value);setChoices({});}}><option value="">{es?'Elegir…':'Choose…'}</option>{row.manifest.members.map(member=><option key={member.namespace} value={member.namespace}>{member.namespace} · {member.version}</option>)}</select></label>
      {namespace&&<p className="break-words text-sm text-text-muted">{row.manifest.version} · {row.manifest.contentHash.slice(0,12)}</p>}
      {tools.map(tool=><label key={tool.namespace} className="block space-y-1 break-words text-sm">{tool.namespace}<select className={input} disabled={busy||!!created} value={tool.contentHash} onChange={event=>setChoices(previous=>({...previous,[tool.namespace]:event.target.value}))}><option value="">{es?'Elegir versión requerida…':'Choose required version…'}</option>{available.filter(packet=>packet.status==='available'&&packet.manifest.members.some(member=>member.namespace===tool.namespace)).map(packet=><option key={packet.manifest.contentHash} value={packet.manifest.contentHash}>{packet.manifest.members.find(member=>member.namespace===tool.namespace)!.version} · {packet.manifest.contentHash.slice(0,12)}</option>)}</select></label>)}
      {created?<button type="button" className={button} onClick={()=>navigateTo(created.path)}>{es?'Abrir proyecto creado':'Open created project'}</button>:<button type="button" className={button} disabled={busy||!namespace||!title.trim()||tools.some(tool=>!tool.contentHash)} onClick={()=>void create()}>{es?'Crear y abrir prueba':'Create and open trial'}</button>}
      {error&&<p role="alert" className="max-w-prose text-sm text-danger">{error}</p>}
    </div></Modal>
    {usageOpen&&usage&&<section aria-label={es?'Uso guardado del paquete':'Saved package usage'} className="space-y-3 border-t border-border pt-3"><div className="flex flex-wrap justify-between gap-2"><h5 className="text-sm font-medium">{es?'Uso guardado':'Saved usage'}</h5><button type="button" className={button} disabled={busy} onClick={()=>void showUsage()}>{es?'Actualizar uso':'Refresh usage'}</button><button type="button" className={button} onClick={()=>setUsageOpen(false)}>{es?'Cerrar uso':'Close usage'}</button></div><p className="max-w-prose text-sm text-text-muted">{es?'La versión es la elegida actualmente por cada proyecto. Los documentos heredados no se cuentan de nuevo en cada época.':'The version is each project’s current selection. Inherited documents are not counted again in every era.'}</p>{usage.members.map(member=><div key={member.namespace} className="space-y-2"><p className="break-words text-sm font-medium">{member.namespace}</p>{!member.projects.length?<p className="text-sm text-text-muted">{es?'Sin proyectos con contenido o versión elegida.':'No projects with saved content or a selected version.'}</p>:<ul className="space-y-2">{member.projects.map(project=><li key={project.projectId} className="space-y-1 text-sm"><p className="break-words">{project.title} · {project.selectedHash?.slice(0,12)??(project.selection==='development'?(es?'Desarrollo':'Development'):(es?'Sin versión':'No version'))}{!project.enabled&&(es?' · Deshabilitado':' · Disabled')}</p><ul className="ml-4 list-disc space-y-1">{project.instances.map((instance,index)=><li key={`${instance.kind}:${instance.documentId??''}:${instance.eraId??''}:${index}`} className="break-words">{instance.path?<a className="text-accent-gold underline underline-offset-4" href={instance.path} onClick={event=>{event.preventDefault();void flushPendingWrites().then(result=>{if(result.ok){navigateTo(instance.path!);}else setError(problem(Error('local_runtime_trial_pending'),es));}).catch(reason=>setError(problem(reason,es)));}}>{instance.title??member.namespace}</a>:<span>{instance.title??member.namespace}</span>} · {instanceLabel(instance.kind,es)}{instance.eraName?' · '+instance.eraName:''}{instance.hidden?(es?' · Oculto':' · Hidden'):''}{instance.archived?(es?' · Archivo':' · Archived'):''}</li>)}</ul></li>)}</ul>}</div>)}</section>}
  </div>;
}
export function RuntimeTrialBanner({projectId}:{projectId:string}){
  const {locale}=useTranslation(),es=locale==='es',navigate=useNavigate(),project=useLiveQuery(()=>db.projects.get(projectId),[projectId]);
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const owner=useRef({projectId,active:true});
  useLayoutEffect(()=>{const next={projectId,active:true};owner.current=next;return()=>{next.active=false;};},[projectId]);
  const trial=project?.id===projectId&&project.localRuntimeTrial?.projectId===projectId?project.localRuntimeTrial:undefined;
  if(!trial)return null;
  const change=async(discard:boolean)=>{
    if(busy)return;setBusy(true);setError('');const id=projectId,hash=trial.packageHash,lease=owner.current;
    const current=()=>lease.active&&owner.current===lease;
    try{if(discard)await discardRuntimeTrial(id,hash);else await keepRuntimeTrial(id,hash);if(current()){if(discard)navigate('/');else setConfirm(false);}}
    catch(reason){if(current())setError(problem(reason,es));}
    finally{if(current())setBusy(false);}
  };
  return <section aria-label={es?'Proyecto de prueba':'Trial project'} className="space-y-2 border-b border-border bg-elevated px-4 py-3"><div className="flex flex-wrap items-center gap-3"><p className="mr-auto text-sm font-medium">{es?'Proyecto de prueba':'Trial project'}</p><button type="button" className={button} disabled={busy} onClick={()=>void change(false)}>{es?'Conservar':'Keep'}</button><button type="button" className={button} disabled={busy} onClick={()=>setConfirm(true)}>{es?'Descartar':'Discard'}</button></div><p className="text-sm text-text-muted">{es?'El paquete seguirá instalado.':'The package will stay installed.'}</p>{error&&<p role="alert" className="text-sm text-danger">{error}</p>}<Modal open={confirm} busy={busy} onClose={()=>{if(!busy)setConfirm(false);}} title={es?'Descartar este proyecto de prueba':'Discard this trial project'}><div className="space-y-4 p-5"><p className="max-w-prose text-sm text-text-muted">{es?'Se borrará sólo este proyecto y su contenido. El paquete seguirá instalado. Resuelve los borradores pendientes con sus controles antes de continuar.':'Only this project and its content will be deleted. The package stays installed. Resolve pending drafts with their editor controls before continuing.'}</p><div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={()=>void change(true)}>{es?'Descartar proyecto':'Discard project'}</button><button type="button" className={button} disabled={busy} onClick={()=>setConfirm(false)}>{es?'Volver al proyecto':'Return to project'}</button></div>{error&&<p role="alert" className="text-sm text-danger">{error}</p>}</div></Modal></section>;
}
