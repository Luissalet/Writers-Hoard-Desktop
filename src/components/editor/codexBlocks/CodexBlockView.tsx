import {LocalToolAtomPendingContext,setLocalToolAtomPending,localToolAtomKey} from '@/engines/local/blocks/pending';
import FocusedToolDocumentEditor from '../toolBlocks/FocusedToolDocumentEditor';

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';

import { useSyncExternalStore,useMemo } from 'react';

import { useLiveQuery } from 'dexie-react-hooks';

import { BookOpen, ExternalLink } from 'lucide-react';

import { db } from '@/db';

import { getEraProject, readEraRow } from '@/services/worldEras/store';

import type { CodexEntry } from '@/types';

import { useTranslation } from '@/i18n/useTranslation';

import { OPEN_CODEX_REFERENCE, type OpenCodexReferenceDetail } from '@/services/codexReference/inlineMentions';

import { navigateTo } from '@/engines/_shared/anchoring';

import { useEnginePane } from '@/engines/_shared/EnginePaneContext';

import { blockIdentifier, blockMatchesProject, codexBlockPreview, type CodexBlockHost } from './model';

const noSubscription = () => () => {};



export default function CodexBlockView({ node, extension, selected,updateAttributes,editor }: NodeViewProps) {

  const pane = useEnginePane();
  const report=useMemo(()=>(token:string,pending:boolean)=>{const key=localToolAtomKey(node);if(key)setLocalToolAtomPending(editor,key,token,pending);},[editor,node]);

  const { locale } = useTranslation(); const host = extension.options as CodexBlockHost;

  useSyncExternalStore(host.subscribe ?? noSubscription, () => JSON.stringify(host.context()));

  const context = host.context(), projectId = blockIdentifier(node.attrs.projectId), entryId = blockIdentifier(node.attrs.entryId);

  const allowed = blockMatchesProject({ projectId, entryId }, context);

  const eraId = pane?.projectId === projectId ? pane.eraId : undefined;

  const resolved = useLiveQuery(async () => {

    if (!allowed) return { entry: undefined };

    const scope = { projectId, eraId };

    const [entry, project] = await Promise.all([eraId ? readEraRow<CodexEntry>(scope, 'codexEntries', entryId) : db.codexEntries.where('projectId').equals(projectId).filter(item => item.id === entryId).first(), eraId ? getEraProject(scope) : db.projects.get(projectId)]); return { entry, templates: project?.codexTemplates };

  }, [allowed, projectId, entryId, eraId]);

  const entry = allowed && resolved?.entry?.id === entryId && resolved.entry.projectId === projectId ? resolved.entry : undefined; const preview = entry ? codexBlockPreview(entry, resolved?.templates) : undefined;

  const open = () => {

    // Recheck host scope at activation, including a context change before render.

    if (!entry || !blockMatchesProject({ projectId, entryId }, host.context())) return;

    const detail: OpenCodexReferenceDetail = { projectId, entryId, scopeId: host.context().scopeId, handled: false };

    window.dispatchEvent(new CustomEvent(OPEN_CODEX_REFERENCE, { detail }));

    if (!detail.handled) (pane?.navigate ?? navigateTo)(`/project/${encodeURIComponent(projectId)}/codex?entry=${encodeURIComponent(entryId)}`);

  };

  return <NodeViewWrapper as="aside" contentEditable={false} data-wh-codex-live-view className={`not-prose my-4 rounded-xl border bg-surface p-4 ${selected ? 'border-accent-gold ring-1 ring-accent-gold' : 'border-border'}`}>

    <LocalToolAtomPendingContext.Provider value={report}><div className="mb-3 flex items-center gap-2 text-xs text-text-muted"><BookOpen size={14} aria-hidden="true" />{locale === 'es' ? 'Referencia viva · Codex' : 'Live reference · Codex'}</div>

    {allowed&&editor.isEditable&&node.attrs.presentation==='editor'?<FocusedToolDocumentEditor target={{projectId,kind:'codex',documentId:entryId,label:entry?.title??''}} eraId={eraId} locale={locale} onClose={()=>updateAttributes({presentation:'preview'})}/>:preview ? <><div className="flex items-start gap-3">{preview.avatar && <img alt="" src={preview.avatar} className="h-14 w-14 shrink-0 rounded-lg object-cover" />}<h4 className="min-w-0 flex-1 break-words font-display text-lg text-text-primary">{preview.title || (locale === 'es' ? 'Entrada sin título' : 'Untitled entry')}</h4><button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold" onClick={open}><ExternalLink size={15} aria-hidden="true" />{locale === 'es' ? 'Abrir entrada' : 'Open entry'}</button><button type="button" className="min-h-9 rounded-lg border border-border px-3 text-sm" disabled={!editor.isEditable} onClick={()=>{if(editor.isEditable&&blockMatchesProject({projectId,entryId},host.context()))updateAttributes({presentation:'editor'});}}>{locale==='es'?'Editar aquí':'Edit here'}</button></div>

      {preview.fields.length > 0 && <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{preview.fields.map(([key, value]) => <div key={key} className="min-w-0"><dt className="break-words text-xs text-text-muted">{key}</dt><dd className="m-0 break-words text-text-primary">{preview.fieldHtml[key] ? <span dangerouslySetInnerHTML={{ __html: preview.fieldHtml[key] }} /> : value}</dd></div>)}</dl>}

      {preview.text && <p className="mb-0 mt-3 break-words text-sm leading-relaxed text-text-secondary">{preview.text}{preview.truncated ? '…' : ''}</p>}

    </> : <p className="m-0 text-sm text-text-muted">{!allowed ? (locale === 'es' ? 'Esta referencia pertenece a otro proyecto o no tiene contexto local.' : 'This reference belongs to another project or has no local context.') : resolved ? (locale === 'es' ? 'La entrada vinculada ya no está disponible. Puedes recuperar la entrada o quitar este bloque.' : 'The linked entry is unavailable. Restore the entry or remove this block.') : (locale === 'es' ? 'Cargando entrada…' : 'Loading entry…')}</p>}

  </LocalToolAtomPendingContext.Provider></NodeViewWrapper>;

}
