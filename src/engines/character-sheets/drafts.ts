import { createLocalDraftStore } from '@/hooks/localDraftStore';
import { sheetDraftKey } from './operations';
import { validateSheet, type CharacterSheet } from './types';
export interface SheetDraft { sheet: CharacterSheet; base: number | null }
export function sheetDraftStore(projectId: string): Map<string, SheetDraft> {
  return createLocalDraftStore<SheetDraft>(sheetDraftKey(projectId), (value): value is SheetDraft => {
    try { const draft = value as SheetDraft; validateSheet(draft.sheet); return draft.base === null || Number.isSafeInteger(draft.base); } catch { return false; }
  });
}
