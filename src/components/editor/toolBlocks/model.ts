import { blockIdentifier, blockLabel, type CodexBlockContext } from '../codexBlocks/model';
export const TOOL_BLOCK_NAME = 'toolDocumentBlock';
export const TOOL_KINDS = ['maps','board','timeline','relation-tree','dictionary','tables','character-sheets','radar','model-viewer'] as const;
export type ToolDocumentKind = typeof TOOL_KINDS[number];
export interface ToolDocumentTarget { projectId: string; kind: ToolDocumentKind; documentId: string; label: string }
export const toolKind = (value: unknown): ToolDocumentKind | null => TOOL_KINDS.includes(value as ToolDocumentKind) ? value as ToolDocumentKind : null;
export function toolTarget(value: Record<string, unknown>): ToolDocumentTarget | null {
  const kind=toolKind(value.kind),projectId=blockIdentifier(value.projectId),documentId=blockIdentifier(value.documentId);
  return kind&&projectId&&documentId?{kind,projectId,documentId,label:blockLabel(value.label)}:null;
}
export const targetAllowed = (target:ToolDocumentTarget|null,context:CodexBlockContext) => !!target&&target.projectId===context.projectId;
export const toolEngineId = (kind: ToolDocumentKind) => kind==='relation-tree'?'genealogy':kind;
export function toolDocumentPath(target:ToolDocumentTarget) {
  const key=target.kind==='maps'?'map':target.kind==='relation-tree'?'tree':target.kind==='board'?'board':'entity';
  return `/project/${encodeURIComponent(target.projectId)}/${toolEngineId(target.kind)}?${key}=${encodeURIComponent(target.documentId)}${target.kind==='timeline'?'&view=list':''}`;
}
export const escapeToolText = (value:unknown) => String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
