// ============================================================================
// Tool-dock layout presets for a session's prep note
// ============================================================================
//
// A preset is a short list of document kinds. Applying one lays the project's
// first document of each kind into the prep note's tool dock, using the dock's
// own `applyWritingToolDock` (the same code behind wh_writing_tool_dock_apply),
// so it keeps the dock's version check and its undo receipt.

import { listWorldDocuments } from '@/services/worldEras/store';
import {
  applyWritingToolDock,
  readWritingToolDock,
  reverseWritingToolDock,
  type ToolDockAction,
  type ToolDockOwner,
} from '@/engines/writings/toolDock/store';
import type { ToolDockDocumentKind } from '@/engines/writings/toolDock/types';

import { DOCK_PRESET_IDS, type DockPresetId } from './types';
export { DOCK_PRESET_IDS };
export type { DockPresetId };

/** Kinds each layout asks for, in dock order. The first one is shown full width. */
export const DOCK_PRESETS: Record<DockPresetId, readonly ToolDockDocumentKind[]> = {
  combat: ['character-sheets', 'tables', 'board'],
  map: ['maps', 'codex'],
  reference: ['codex', 'dictionary', 'timeline'],
};

export interface DockPlan {
  owner: ToolDockOwner;
  /** Pass as `expectedVersion` to wh_writing_tool_dock_apply. */
  expectedVersion: string;
  actions: ToolDockAction[];
  /** The documents the layout will hold. */
  documents: Array<{ kind: ToolDockDocumentKind; documentId: string }>;
}

/**
 * The actions that turn the note's dock into the preset: customise it, drop
 * what is there, add the first document of each kind the project has. Nothing
 * is written. Returns `documents: []` when the project has none of the kinds.
 */
export async function planDockPreset(projectId: string, noteId: string, preset: DockPresetId): Promise<DockPlan> {
  const owner: ToolDockOwner = { kind: 'writings', documentId: noteId };
  const scope = { projectId };
  const read = await readWritingToolDock(scope, owner);
  const documents: DockPlan['documents'] = [];
  for (const kind of DOCK_PRESETS[preset]) {
    const [first] = await listWorldDocuments(scope, kind);
    if (first) documents.push({ kind, documentId: first.document.root.id });
  }
  const actions: ToolDockAction[] = [];
  if (documents.length) {
    actions.push({ type: 'customize' });
    for (const block of read.layout?.blocks ?? []) actions.push({ type: 'remove', blockId: block.id });
    documents.forEach(({ kind, documentId }, index) => {
      const id = `session-${preset}-${index + 1}`;
      actions.push({ type: 'add-document', id, target: { kind, documentId } });
      if (index === 0) actions.push({ type: 'span', blockId: id, span: 2 });
    });
  }
  return { owner, expectedVersion: read.version, actions, documents };
}

/** Plan and apply in one go. Returns the dock's receipt for `undoDockPreset`, or null when there was nothing to lay out. */
export async function applyDockPreset(projectId: string, noteId: string, preset: DockPresetId) {
  const plan = await planDockPreset(projectId, noteId, preset);
  if (!plan.documents.length) return null;
  const result = await applyWritingToolDock({ projectId }, plan.owner, plan.expectedVersion, plan.actions);
  return { receiptId: result.receiptId, documents: plan.documents };
}

export function undoDockPreset(projectId: string, noteId: string, receiptId: string) {
  return reverseWritingToolDock({ projectId }, { kind: 'writings', documentId: noteId }, receiptId, 'undo');
}
