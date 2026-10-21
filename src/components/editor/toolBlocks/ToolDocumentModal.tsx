import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { flushPendingWrites } from '@/services/pendingWrites';
import { getEngine } from '@/engines/_registry';
import { EnginePaneContext, activateEnginePane, registerEnginePaneScope, useEnginePane } from '@/engines/_shared/EnginePaneContext';
import Modal from '@/components/common/Modal';
import PaneRouter from '@/components/project/workspace/PaneRouter';
import { paneEngineId, workspaceRoute, routeInEra, type WorkspaceRoute } from '@/components/project/workspace/routes';
import { toolDocumentPath, toolEngineId, type ToolDocumentTarget } from './model';
import { toolBlockCopy } from './copy';
import { createToolDocumentSession } from './session';
import { listToolDocuments } from './preview';
import { EmbeddedToolCloseContext,ToolDocumentDepth,type EmbeddedCloseGuard } from './EmbeddedToolCloseContext';

export default function ToolDocumentModal({target,locale,onClose}:{target:ToolDocumentTarget;locale:'es'|'en';onClose:()=>void}) {
  const parentPane=useEnginePane(),eraId=parentPane?.projectId===target.projectId?parentPane.eraId:undefined;
  const [instanceId] = useState(()=>`embedded-tool-${crypto.randomUUID()}`);
  const [route,setRoute] = useState(()=>routeInEra(workspaceRoute(toolDocumentPath(target)),eraId));
  const [session] = useState(()=>createToolDocumentSession(target,eraId));
  const [busy,setBusy] = useState(false),[blocked,setBlocked] = useState(false);
  const body=useRef<HTMLDivElement>(null),dirtyForms=useRef(new Set<HTMLFormElement>());
  const guards=useRef(new Set<EmbeddedCloseGuard>());
  const register=useMemo(()=>(guard:EmbeddedCloseGuard)=>{guards.current.add(guard);return()=>{guards.current.delete(guard);};},[]);
  const c=toolBlockCopy[locale],engineId=toolEngineId(target.kind,target.namespace),Engine=getEngine(engineId)?.component;
  const available=useLiveQuery(async()=>(await listToolDocuments(target.projectId,eraId)).some(document=>document.kind===target.kind&&document.documentId===target.documentId),[target.projectId,target.kind,target.documentId,eraId]);
  const save = async () => {
    // A deleted/moved source must never fall back to another document in the
    // reused engine. Its recovery journal remains available for a restore.
    if(available===false)return (await flushPendingWrites()).ok;
    if(available!==true)return false;
    for(const guard of guards.current)if(!await guard()){setBlocked(true);return false;}
    // Explicit forms (new events, pins, columns, quick capture) require their
    // own submit, so Save & close cannot silently throw away unsubmitted input.
    const forms=[...dirtyForms.current].filter(form=>form.isConnected&&[...form.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]),textarea')].some(input=>input.value.trim()));
    if(forms.length) {forms[0].querySelector<HTMLElement>('input,textarea,button')?.focus();setBlocked(true);return false;}
    return session.flush();
  };
  const close = async () => {if(busy)return;setBusy(true);try {if(await save())onClose();else setBlocked(true);}finally{setBusy(false);}};
  const navigate = async (next:WorkspaceRoute) => {
    if(busy)return;
    // An embedded editor has one document-tool scope. Cross-tool links remain
    // inside the modal and never change the host editor's route or selection.
    if(paneEngineId(next,target.projectId,[engineId])!==engineId){setBlocked(true);return;}
    setBusy(true);try {if(await save()){setRoute(next);setBlocked(false);}else setBlocked(true);}finally{setBusy(false);}
  };
  const pane=useMemo(()=>({instanceId,projectId:target.projectId,eraId,visible:true,primary:false,navigate:(to:string)=>{void navigate(workspaceRoute(to,route));}}),[instanceId,route,busy,eraId,target.projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>registerEnginePaneScope(instanceId,{projectId:target.projectId,eraId,navigate:pane.navigate}),[instanceId,target.projectId,eraId,pane.navigate]);
  return <Modal open title={`${c.edit} · ${c.kinds[target.kind]}`} fullscreen busy={busy} dismissible={false} onClose={()=>{void close();}}>
    <div className="flex min-h-0 flex-col gap-3 p-4" data-tool-document-modal>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-prose text-sm text-text-muted">{c.help}</p><button type="button" disabled={busy} className="shrink-0 rounded-lg bg-accent-gold px-4 py-2 text-sm font-semibold text-deep disabled:opacity-50" onClick={()=>{void close();}}>{c.close}</button></div>
      {blocked&&<p role="alert" className="rounded-lg border border-warning/40 p-3 text-sm text-warning">{c.blocked}</p>}
      <div ref={body} inert={busy} data-engine-pane-id={instanceId} className="relative h-[68vh] min-h-80 overflow-auto rounded-lg border border-border bg-deep p-3" onFocusCapture={()=>activateEnginePane(instanceId)} onPointerDownCapture={()=>activateEnginePane(instanceId)} onInputCapture={event=>{
        const form=(event.target as HTMLElement).closest('form');
        // Metadata journals are committed by session.flush; their normal
        // explicit Save forms can remain open after a successful save.
        if(form&&!['dictionary','character-sheets','radar','relation-tree'].includes(target.kind))dirtyForms.current.add(form);
      }} onSubmitCapture={event=>{
        const form=event.target as HTMLFormElement;
        // Keep a submitted form protected until the source actually removes
        // it. A validation/storage failure therefore still blocks closing.
        if(!form.checkValidity())dirtyForms.current.add(form);
      }}>
        <EmbeddedToolCloseContext.Provider value={register}><ToolDocumentDepth.Provider value={1}><EnginePaneContext.Provider value={pane}>
          <PaneRouter projectId={target.projectId} engineId={engineId} route={route} onNavigate={next=>{void navigate(next);}} onBack={()=>{void navigate(workspaceRoute(toolDocumentPath(target)));}}>
            <Suspense fallback={<p role="status">{c.loading}</p>}>{available===true&&target.kind==='local-tool'?<LocalToolDocumentHost projectId={target.projectId} eraId={eraId} documentId={target.documentId} namespace={target.namespace} view="fullscreen"/>:available===true&&Engine?<Engine projectId={target.projectId}/>:<p>{available===undefined?c.loading:c.unavailable}</p>}</Suspense>
          </PaneRouter>
        </EnginePaneContext.Provider></ToolDocumentDepth.Provider></EmbeddedToolCloseContext.Provider>
      </div>
    </div>
  </Modal>;
}
