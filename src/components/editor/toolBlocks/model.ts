import { blockIdentifier, blockLabel, type CodexBlockContext } from '../codexBlocks/model';
import { localToolNamespace } from '@/engines/local/stateTypes';
export const TOOL_BLOCK_NAME = 'toolDocumentBlock';
export const TOOL_KINDS = ['maps','board','timeline','relation-tree','dictionary','tables','character-sheets','radar','model-viewer','local-tool'] as const;
export type ToolDocumentKind = typeof TOOL_KINDS[number];
export interface ToolDocumentTarget { projectId: string; kind: ToolDocumentKind; documentId: string; label: string; namespace?:string; presentation?:'preview'|'editor' }
export const toolKind = (value: unknown): ToolDocumentKind | null => TOOL_KINDS.includes(value as ToolDocumentKind) ? value as ToolDocumentKind : null;
export function toolTarget(value: Record<string, unknown>): ToolDocumentTarget | null {
  const kind=toolKind(value.kind),projectId=blockIdentifier(value.projectId),documentId=blockIdentifier(value.documentId);
  if(!kind||!projectId||!documentId||kind==='local-tool'&&!localToolNamespace(value.namespace))return null;
  if(value.presentation!==undefined&&value.presentation!=='preview'&&value.presentation!=='editor')return null;
  return{kind,projectId,documentId,label:blockLabel(value.label),...(kind==='local-tool'?{namespace:value.namespace as string}:{}),...(value.presentation?{presentation:value.presentation as 'preview'|'editor'}:{})};
}
export const targetAllowed = (target:ToolDocumentTarget|null,context:CodexBlockContext) => !!target&&target.projectId===context.projectId;
export const toolEngineId = (kind: ToolDocumentKind,namespace?:string) => kind==='relation-tree'?'genealogy':kind==='local-tool'&&localToolNamespace(namespace)?`local-tool-${namespace}`:kind;
export function toolDocumentPath(target:ToolDocumentTarget) {
  const key=target.kind==='maps'?'map':target.kind==='relation-tree'?'tree':target.kind==='board'?'board':target.kind==='local-tool'?'document':'entity';
  return `/project/${encodeURIComponent(target.projectId)}/${toolEngineId(target.kind,target.namespace)}?${key}=${encodeURIComponent(target.documentId)}${target.kind==='timeline'?'&view=list':''}`;
}
export const escapeToolText = (value:unknown) => String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
