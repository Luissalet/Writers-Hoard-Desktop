import {lazy,Suspense} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import type {WorldEraScope} from '@/services/worldEras/types';
import {readEraRow,getEraProject} from '@/services/worldEras/store';
import type {CodexEntry} from '@/types';
import {projectCodexEntry} from '@/engines/codex/properties';
import {resolveToolPreview,sanitizeToolPreviewHtml} from '@/components/editor/toolBlocks/preview';
import {toolDocumentPath,type ToolDocumentTarget} from '@/components/editor/toolBlocks/model';
import {useEnginePane} from '@/engines/_shared/EnginePaneContext';
import type {ToolDockBlock} from './types';
const FocusedEditor=lazy(()=>import('@/components/editor/toolBlocks/FocusedToolDocumentEditor'));
const SourceDocument=lazy(()=>import('@/engines/local/documents/LocalToolDocumentHost'));
export default function DocumentDockBlock({scope,block,locale,onPreview}:{scope:WorldEraScope;block:Extract<ToolDockBlock,{kind:'document'}>;locale:'es'|'en';onPreview:()=>void}){
 const target=block.target,pane=useEnginePane(),tool:ToolDocumentTarget={...target,projectId:scope.projectId,kind:target.kind==='genealogy'?'relation-tree':target.kind as ToolDocumentTarget['kind'],label:target.label??target.documentId},editable=['codex','maps','board','timeline','genealogy','local-tool'].includes(target.kind);
 const preview=useLiveQuery(async()=>{if(target.kind==='codex'){const entry=await readEraRow<CodexEntry>(scope,'codexEntries',target.documentId),project=await getEraProject(scope);if(!entry||!project)return null;const projected=projectCodexEntry(entry,project.codexTemplates??[]);return{title:entry.title,html:'',fields:projected.fields};}return resolveToolPreview(tool,scope.projectId,locale,{eraId:scope.eraId});},[scope.projectId,scope.eraId,target.kind,target.documentId,target.namespace,locale]);
 if(block.presentation==='editor'&&editable)return <Suspense fallback={<p role="status">…</p>}>{target.kind==='local-tool'?<><button type="button" className="mb-3 min-h-10 rounded border border-border px-3 text-sm" onClick={onPreview}>{locale==='es'?'Volver a lectura':'Return to preview'}</button><SourceDocument {...scope} documentId={target.documentId} namespace={target.namespace} view="embed" interactive/></>:<FocusedEditor target={target.kind==='codex'?{projectId:scope.projectId,kind:'codex',documentId:target.documentId,label:target.label??''}:tool} eraId={scope.eraId} locale={locale} onClose={onPreview}/>}</Suspense>;
 return <div>{preview===undefined?<p role="status">…</p>:preview===null?<p role="alert">{locale==='es'?'Documento no disponible.':'Document unavailable.'}</p>:<>{'fields'in preview?<dl className="space-y-2">{Object.entries(preview.fields).map(([key,value])=><div key={key}><dt className="text-xs text-text-muted">{key}</dt><dd className="break-words text-sm">{String(value)}</dd></div>)}</dl>:<div className="prose prose-sm max-w-none break-words" dangerouslySetInnerHTML={{__html:sanitizeToolPreviewHtml(preview.html)}}/>}<button type="button" className="mt-3 min-h-10 rounded border border-border px-3 text-sm" onClick={()=>{(pane?.openBeside??pane?.navigate)?.(target.kind==='codex'?`/project/${encodeURIComponent(scope.projectId)}/codex?entry=${encodeURIComponent(target.documentId)}`:toolDocumentPath(tool));}}>{locale==='es'?'Abrir aparte':'Open beside'}</button></>}</div>;
}
