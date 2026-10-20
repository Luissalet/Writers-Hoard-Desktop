import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { lazy,Suspense,useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Blocks, Pencil } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { db } from '@/db';
import type { CodexBlockHost } from '../codexBlocks/model';
import { toolTarget,targetAllowed } from './model';
import { resolveToolPreview } from './preview';
import { toolBlockCopy } from './copy';
import ToolDocumentModal from './ToolDocumentModal';
import { useToolDocumentDepth } from './EmbeddedToolCloseContext';
const noSubscription=()=>()=>{};
const ModelView=lazy(()=>import('@/engines/model-viewer/ModelViewerEngine').then(module=>({default:module.ModelView})));
export default function ToolDocumentBlockView({node,extension,selected}:NodeViewProps) {
  const {locale}=useTranslation(),c=toolBlockCopy[locale],host=extension.options as CodexBlockHost;
  useSyncExternalStore(host.subscribe??noSubscription,()=>JSON.stringify(host.context()));
  const target=toolTarget(node.attrs),allowed=targetAllowed(target,host.context()),depth=useToolDocumentDepth();
  const targetKey=JSON.stringify([target?.projectId,target?.kind,target?.documentId]);
  const [editing,setEditing]=useState(false);
  const resolved=useLiveQuery(async()=>({key:targetKey,preview:allowed&&target?await resolveToolPreview(target,host.context().projectId!,locale).catch(()=>null):null}),[allowed,targetKey,locale]);
  const preview=allowed&&resolved?.key===targetKey?resolved.preview:null;
  const model=useLiveQuery(async()=>allowed&&target?.kind==='model-viewer'?(await db.projects.get(target.projectId))?.modelAssets?.find(asset=>asset.id===target.documentId):undefined,[allowed,target?.kind,target?.projectId,target?.documentId]);
  return <NodeViewWrapper as="figure" contentEditable={false} data-wh-tool-live-view className={`not-prose my-4 min-w-0 rounded-xl border bg-surface p-4 ${selected?'border-accent-gold ring-1 ring-accent-gold':'border-border'}`}>
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-text-muted"><Blocks size={14}/>{target?c.kinds[target.kind]:c.title}</div>
    {preview&&target?<><div className="mb-3 flex flex-wrap items-start justify-between gap-3"><h4 className="min-w-0 break-words font-display text-lg text-text-primary">{preview.title||c.fallback}</h4>{!depth&&<button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated" onClick={()=>{if(targetAllowed(target,host.context()))setEditing(true);}}><Pencil size={14}/>{c.edit}</button>}</div><div className="prose prose-sm max-w-none overflow-hidden break-words text-text-secondary [&_td]:border [&_td]:border-border [&_td]:px-2 [&_th]:border [&_th]:border-border [&_th]:px-2" dangerouslySetInnerHTML={{__html:preview.html}}/>{preview.truncated&&<p className="mt-2 text-xs text-text-muted">{c.truncated}</p>}{depth>0&&<p className="mt-2 text-xs text-text-muted">{c.nested}</p>}</>:<p className="text-sm text-text-muted">{!allowed?c.foreign:resolved?c.unavailable:c.loading}</p>}
    {preview&&model&&target?.kind==='model-viewer'&&model.id===target.documentId&&<Suspense fallback={<p role="status">{c.loading}</p>}><ModelView key={model.id} asset={model} compact/></Suspense>}
    {editing&&allowed&&target&&<ToolDocumentModal key={targetKey} target={target} locale={locale} onClose={()=>setEditing(false)}/>}
  </NodeViewWrapper>;
}
