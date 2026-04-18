// ============================================
// POV / Scene Audit — derived view types
// ============================================
//
// POV Audit is a "compute-only" engine — it doesn't own any Dexie tables.
// It derives summaries from existing `scenes`, `sceneCasts`, `dialogBlocks`,
// and `codexEntries` (characters) tables.
//
// The shape below is the single row of the audit grid. One row per character.

export interface CharacterUsage {
  /** Codex character id, or `__unmapped__:<name>` for cast members not in codex. */
  characterId: string;
  /** Display name (taken from codex if available, otherwise from cast / dialog). */
  characterName: string;
  /** How many scenes this character is listed in (via sceneCasts). */
  sceneCount: number;
  /** How many dialog blocks this character speaks (any block with characterId === id or characterName match). */
  lineCount: number;
  /** Total words spoken across all dialog blocks. */
  wordCount: number;
  /** True when the character exists in codex but never appears anywhere. */
  isUnused: boolean;
  /** True when the character appears in scenes/dialog but isn't in codex. */
  isUnmapped: boolean;
  /** Avatar from codex (base64 data URL) if available. */
  avatar?: string;
  /** Color tag from codex / cast row. */
  color?: string;
}

/** Aggregate stats for the project as a whole. */
export interface ProjectAuditTotals {
  /** Number of characters in the codex (type === 'character'). */
  charactersInCodex: number;
  /** Number of distinct characters that actually appear (in cast or dialog). */
  charactersUsed: number;
  /** Codex characters that never show up. */
  unusedCount: number;
  /** Cast/dialog characters that aren't in the codex. */
  unmappedCount: number;
  /** Total scenes scanned. */
  sceneCount: number;
  /** Total dialog blocks scanned. */
  blockCount: number;
  /** Total words across all dialog. */
  totalWords: number;
}

export interface PovAuditReport {
  totals: ProjectAuditTotals;
  /** One row per character, sorted descending by lineCount. */
  rows: CharacterUsage[];
}
