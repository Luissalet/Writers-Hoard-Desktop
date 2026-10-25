import {useLayoutEffect,useRef,useState} from 'react';
import {Download,FileText,Image as ImageIcon,Printer,RefreshCw} from 'lucide-react';
import Modal from '@/components/common/Modal';
import {useTranslation} from '@/i18n/useTranslation';
import {canExportPdf,downloadBlobFile} from '@/engines/writings/manuscriptExport';
import {downloadDocumentImage} from '@/services/documentImage';
import {prepareCodexEntryExport,codexEntryMarkdown,captureCodexEntryImage,saveCodexEntryPdf,reserveCodexPrintView,type CodexEntryExportRequest,type PreparedCodexEntryExport} from '@/services/codexEntryExport';

export default function CodexEntryExportDialog({request,title,eraName,onClose}:{request:CodexEntryExportRequest;title:string;eraName?:string;onClose:()=>void}){
 const {t}=useTranslation(),[includeMedia,setIncludeMedia]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[artifact,setArtifact]=useState<PreparedCodexEntryExport>();
 const lease=useRef(0),printView=useRef<ReturnType<typeof reserveCodexPrintView>>(null);
 const owner=JSON.stringify([request.projectId,request.eraId,request.entryId,request.locale]);
 useLayoutEffect(()=>()=>{lease.current++;printView.current?.cancel();},[owner]);
 const close=()=>{lease.current++;printView.current?.cancel();onClose();};
 const run=async(format:'markdown'|'pdf'|'print'|'png')=>{
  if(busy)return;const generation=++lease.current;
  if(format==='print'){printView.current=reserveCodexPrintView();if(!printView.current){setError(t('codex.export.popupBlocked'));return;}}
  setBusy(true);setError('');setStatus('');const current=()=>lease.current===generation;
  try{
   const prepared=artifact??await prepareCodexEntryExport(request);if(!current())return;setArtifact(prepared);
   if(format==='markdown'){const result=await codexEntryMarkdown(prepared,includeMedia);if(!current())return;downloadBlobFile(result.blob,result.fileName);setStatus(result.warnings.join(' ')||t('codex.export.downloaded'));}
   else if(format==='print'){if(!printView.current?.show(prepared.prepared.html))throw Error(t('codex.export.printChanged'));setStatus(t('codex.export.printReady'));}
   else if(format==='png'){const result=await captureCodexEntryImage(prepared);if(!current())return;await downloadDocumentImage(result,current);if(current())setStatus(t('codex.export.downloaded'));}
   else{const result=await saveCodexEntryPdf(prepared);if(!current())return;if(result.ok)setStatus(t('codex.export.saved'));else if(result.canceled)setStatus(t('codex.export.canceled'));else throw Error(result.error||t('codex.export.failed'));}
  }catch(cause){if(current()){printView.current?.cancel();setError(cause instanceof Error?cause.message:t('codex.export.failed'));}}
  finally{if(current())setBusy(false);}
 };
 const button='inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-text-primary hover:bg-elevated disabled:opacity-50 disabled:cursor-wait';
 return <Modal open onClose={close} title={`${t('codex.export.title')} — ${title}`}>
  <div data-codex-entry-export className="space-y-6">
   <p className="text-sm leading-relaxed text-text-secondary">{t('codex.export.description')}</p>
   <div className="flex flex-wrap gap-2 text-sm text-text-secondary"><span>{eraName||t('codex.export.base')}</span><span>·</span><span>{artifact?t('codex.export.prepared'):t('codex.export.savedSource')}</span></div>
   <div className="space-y-3">
    <label className="flex items-center gap-2 text-sm text-text-primary"><input type="checkbox" checked={includeMedia} disabled={busy} onChange={event=>setIncludeMedia(event.target.checked)}/>{t('codex.export.includeMedia')}</label>
    <div className="flex flex-wrap gap-3">
     <button type="button" className={button} disabled={busy} onClick={()=>void run('markdown')}><FileText size={16}/>Markdown <Download size={14}/></button>
     <button type="button" className={button} disabled={busy} onClick={()=>void run(canExportPdf()?'pdf':'print')}><Printer size={16}/>{canExportPdf()?'PDF':t('codex.export.print')}</button>
     <button type="button" className={button} disabled={busy||!window.electronAPI?.documentImages} onClick={()=>void run('png')}><ImageIcon size={16}/>{t('codex.export.png')}</button>
    </div>
    {!window.electronAPI?.documentImages&&<p className="text-sm text-text-secondary">{t('codex.export.desktop')}</p>}
   </div>
   {busy&&<p role="status" className="text-sm text-text-secondary">{t('codex.export.preparing')}</p>}
   {error&&<p role="alert" className="text-sm text-danger">{error}</p>}
   {status&&<p role="status" className="text-sm text-text-secondary">{status}</p>}
   <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
    <button type="button" className={button} disabled={busy||!artifact} onClick={()=>{setArtifact(undefined);setStatus('');setError('');}}><RefreshCw size={14}/>{t('codex.export.refresh')}</button>
    <button type="button" className={button} onClick={close}>{t('common.close')}</button>
   </div>
  </div>
 </Modal>;
}
