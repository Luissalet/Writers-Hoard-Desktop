import CompactSheetView from './CompactSheetView';
import {LocalToolAtomPendingContext,setLocalToolAtomPending,localToolAtomKey} from '@/engines/local/blocks/pending';
import FocusedToolDocumentEditor from './FocusedToolDocumentEditor';

import {supportsFocusedTool} from './focusedKinds';

import {flushPendingWrites} from '@/services/pendingWrites';

import LocalToolDocumentHost from '@/engines/local/documents/LocalToolDocumentHost';

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

import { lazy,Suspense,useState,useMemo, useSyncExternalStore } from 'react';

import { useLiveQuery } from 'dexie-react-hooks';

import { Blocks, Pencil } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { db } from '@/db';

import { getEraProject } from '@/services/worldEras/store';

import { useEnginePane } from '@/engines/_shared/EnginePaneContext';

import type { CodexBlockHost } from '../codexBlocks/model';

import { toolTarget,targetAllowed } from './model';

import { resolveToolPreview } from './preview';

import { sheetPaper } from '@/engines/character-sheets/paper';

import { toolBlockCopy } from './copy';

import ToolDocumentModal from './ToolDocumentModal';

import { useToolDocumentDepth } from './EmbeddedToolCloseContext';

const noSubscription=()=>()=>{};

const ModelView=lazy(()=>import('@/engines/model-viewer/ModelViewerEngine').then(module=>({default:module.ModelView})));

export default function ToolDocumentBlockView({node,extension,selected,updateAttributes,editor}:NodeViewProps) {

  const {locale}=useTranslation(),c=toolBlockCopy[locale],host=extension.options as CodexBlockHost;

  useSyncExternalStore(host.subscribe??noSubscription,()=>JSON.stringify(host.context()));

  const target=toolTarget(node.attrs),allowed=targetAllowed(target,host.context()),depth=useToolDocumentDepth();

  const pane=useEnginePane(),eraId=pane?.projectId===target?.projectId?pane?.eraId:undefined;

  const targetKey=JSON.stringify([target?.projectId,target?.kind,target?.documentId,target?.namespace,target?.sheetDisplay,eraId]);

  const report=useMemo(()=>(token:string,pending:boolean)=>{const key=localToolAtomKey(node);if(key)setLocalToolAtomPending(editor,key,token,pending);},[editor,node]);
  const [editing,setEditing]=useState(false);

  const resolved=useLiveQuery(async()=>({key:targetKey,preview:allowed&&target?await resolveToolPreview(target,host.context().projectId!,locale,{eraId}).catch(()=>null):null}),[allowed,targetKey,locale,eraId]);

  const inline=target?.presentation==='editor';

  const preview=allowed&&resolved?.key===targetKey?resolved.preview:null;

  const model=useLiveQuery(async()=>allowed&&target?.kind==='model-viewer'?(eraId?await getEraProject({projectId:target.projectId,eraId}):await db.projects.get(target.projectId))?.modelAssets?.find(asset=>asset.id===target.documentId):undefined,[allowed,target?.kind,target?.projectId,target?.documentId,target?.namespace,target?.sheetDisplay,eraId]);

  return <NodeViewWrapper as="figure" contentEditable={false} data-wh-tool-live-view className={`not-prose my-4 min-w-0 rounded-xl border bg-surface p-4 ${selected?'border-accent-gold ring-1 ring-accent-gold':'border-border'}`}>

    <LocalToolAtomPendingContext.Provider value={report}><div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-text-muted"><Blocks size={14}/>{target?c.kinds[target.kind]:c.title}</div>

    {allowed&&target&&!inline&&editor.isEditable&&(target.kind==='local-tool'||supportsFocusedTool(target.kind))&&<button type="button" className="mb-3 min-h-9 rounded-lg border border-border px-3 text-sm" onClick={()=>{void flushPendingWrites().then(result=>{if(result.ok&&targetAllowed(target,host.context()))updateAttributes({presentation:'editor'});});}}>{inline?(locale==='es'?'Mostrar lectura':'Show preview'):(locale==='es'?'Editar aquí':'Edit here')}</button>}

    {allowed&&target&&inline&&editor.isEditable&&supportsFocusedTool(target.kind)?<FocusedToolDocumentEditor target={target} eraId={eraId} locale={locale} onClose={()=>updateAttributes({presentation:'preview'})}/>:allowed&&target?.kind==='local-tool'&&inline&&editor.isEditable?<><button type="button" className="mb-3 min-h-10 rounded-lg border border-border px-3 text-sm" onClick={()=>{void flushPendingWrites().then(result=>{if(result.ok)updateAttributes({presentation:'preview'});});}}>{locale==='es'?'Guardar y volver a lectura':'Save and return to preview'}</button><LocalToolAtomPendingContext.Provider value={report}><LocalToolDocumentHost key={targetKey} projectId={target.projectId} eraId={eraId} documentId={target.documentId} namespace={target.namespace} view="embed" interactive/></LocalToolAtomPendingContext.Provider></>:preview&&target?<><div className="mb-3 flex flex-wrap items-start justify-between gap-3"><h4 className="min-w-0 break-words font-display text-lg text-text-primary">{preview.title||c.fallback}</h4>{!depth&&<button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated" onClick={()=>{if(targetAllowed(target,host.context()))setEditing(true);}}><Pencil size={14}/>{c.edit}</button>}</div>{(preview.summary||preview.sheet?.preset==='coc7')&&editor.isEditable&&<label className="mb-3 block text-sm text-text-primary">{locale==='es'?'Vista de ficha':'Sheet display'} <select aria-label={locale==='es'?'Vista de ficha':'Sheet display'} value={target.sheetDisplay??''} className="min-h-9 rounded border border-border bg-deep px-2" onChange={event=>{if(targetAllowed(target,host.context())&&editor.isEditable)updateAttributes({sheetDisplay:event.target.value==='compact'?'compact':undefined});}}><option value="">{locale==='es'?'Papel completo':'Full paper'}</option><option value="compact">{locale==='es'?'Resumen del investigador':'Investigator summary'}</option></select></label>}{preview.summary?<CompactSheetView key={targetKey} summary={preview.summary} projectId={target.projectId} eraId={eraId} locale={locale} canWrite={editor.isEditable&&depth===0?()=>!editor.isDestroyed&&editor.isEditable&&targetAllowed(target,host.context()):undefined}/>:<div className="prose prose-sm max-w-none overflow-hidden break-words text-text-secondary [&_td]:border [&_td]:border-border [&_td]:px-2 [&_th]:border [&_th]:border-border [&_th]:px-2" dangerouslySetInnerHTML={{__html:preview.sheet?sheetPaper(preview.sheet,locale).svg:preview.html}}/>}{preview.truncated&&<p className="mt-2 text-xs text-text-muted">{c.truncated}</p>}{depth>0&&<p className="mt-2 text-xs text-text-muted">{c.nested}</p>}</>:<p className="text-sm text-text-muted">{!allowed?c.foreign:resolved?c.unavailable:c.loading}</p>}

    {preview&&model&&target?.kind==='model-viewer'&&model.id===target.documentId&&<Suspense fallback={<p role="status">{c.loading}</p>}><ModelView key={model.id} asset={model} compact/></Suspense>}

    {editing&&allowed&&target&&<ToolDocumentModal key={targetKey} target={target} locale={locale} onClose={()=>setEditing(false)}/>}

  </LocalToolAtomPendingContext.Provider></NodeViewWrapper>;

}
