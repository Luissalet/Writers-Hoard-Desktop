// ============================================
// POV / Scene Audit — pure derived computations
// ============================================
//
// Walks existing scenes/dialog/cast tables and the character subset of the
// codex, then produces a `PovAuditReport`. This engine owns no storage —
// every call is a fresh query.
//
// The derivation is idempotent and cheap: three table scans (one filtered by
// `projectId`, two filtered by the resulting scene id set).

import { db } from '@/db/index';
import type { CodexEntry } from '@/types';
import type { CharacterUsage, PovAuditReport } from './types';

/** Count words in a string, tolerant to empty / HTML-tag stripped content. */
function countWords(text: string | undefined): number {
  if (!text) return 0;
  // Strip HTML tags if any, then split on whitespace.
  const clean = text.replace(/<[^>]*>/g, ' ');
  const tokens = clean.trim().split(/\s+/);
  return tokens.length === 1 && tokens[0] === '' ? 0 : tokens.length;
}

/**
 * Compute a character usage report for a project.
 *
 * Algorithm:
 *   1. Collect codex characters (type === 'character').
 *   2. Load every scene for the project to get the sceneId set.
 *   3. Load sceneCasts for those scene ids.
 *   4. Load dialogBlocks for those scene ids.
 *   5. Build a map keyed by characterId (falling back to name when the id is blank).
 *   6. Fold counts, mark unused / unmapped.
 */
export async function computeUsage(projectId: string): Promise<PovAuditReport> {
  // 1. Characters in the codex.
  const codexChars: CodexEntry[] = await db
    .table('codexEntries')
    .where('projectId')
    .equals(projectId)
    .filter((e: CodexEntry) => e.type === 'character')
    .toArray();

  // 2. Scenes in the project.
  const scenes = await db.table('scenes').where('projectId').equals(projectId).toArray();
  const sceneIds = scenes.map((s) => s.id);

  // 3. Cast rows for those scenes.
  const casts = sceneIds.length
    ? await db.table('sceneCasts').where('sceneId').anyOf(sceneIds).toArray()
    : [];

  // 4. Dialog blocks for those scenes.
  const blocks = sceneIds.length
    ? await db.table('dialogBlocks').where('sceneId').anyOf(sceneIds).toArray()
    : [];

  // ---------------------------------------------------------------------------
  // Build the aggregation map.
  // ---------------------------------------------------------------------------
  const byKey = new Map<string, CharacterUsage>();

  const resolveKey = (id: string | undefined, name: string): string =>
    id && id.trim() ? id : `__unmapped__:${name.trim().toLowerCase()}`;

  const touch = (
    id: string | undefined,
    name: string,
    patch: Partial<CharacterUsage>,
  ): void => {
    const key = resolveKey(id, name);
    const existing = byKey.get(key) ?? {
      characterId: key,
      characterName: name || 'Unnamed',
      sceneCount: 0,
      lineCount: 0,
      wordCount: 0,
      isUnused: false,
      isUnmapped: key.startsWith('__unmapped__:'),
    };
    byKey.set(key, {
      ...existing,
      sceneCount: existing.sceneCount + (patch.sceneCount ?? 0),
      lineCount: existing.lineCount + (patch.lineCount ?? 0),
      wordCount: existing.wordCount + (patch.wordCount ?? 0),
      color: patch.color ?? existing.color,
      avatar: patch.avatar ?? existing.avatar,
    });
  };

  // Seed rows from codex so unused characters appear with zero counts.
  for (const c of codexChars) {
    byKey.set(c.id, {
      characterId: c.id,
      characterName: c.title,
      sceneCount: 0,
      lineCount: 0,
      wordCount: 0,
      isUnused: true, // flipped off below if we see any activity
      isUnmapped: false,
      avatar: c.avatar,
    });
  }

  // Fold in scene-cast presence — 1 scene per cast row.
  for (const cast of casts) {
    touch(cast.characterId, cast.characterName || 'Unnamed', {
      sceneCount: 1,
      color: cast.color,
    });
  }

  // Fold in dialog blocks — only count blocks of type 'dialog' (so action /
  // slug / transition lines don't inflate a character's count).
  for (const block of blocks) {
    if (block.type !== 'dialog') continue;
    const words = countWords(block.content);
    touch(block.characterId, block.characterName || 'Unnamed', {
      lineCount: 1,
      wordCount: words,
      color: block.characterColor,
    });
  }

  // Flip `isUnused` off for codex characters that have any counts.
  for (const [key, row] of byKey) {
    if (!row.isUnmapped && (row.sceneCount > 0 || row.lineCount > 0)) {
      byKey.set(key, { ...row, isUnused: false });
    } else if (!row.isUnmapped && row.sceneCount === 0 && row.lineCount === 0) {
      byKey.set(key, { ...row, isUnused: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Sort rows: descending by line count, then by scene count, then by name.
  // ---------------------------------------------------------------------------
  const rows = Array.from(byKey.values()).sort((a, b) => {
    if (b.lineCount !== a.lineCount) return b.lineCount - a.lineCount;
    if (b.sceneCount !== a.sceneCount) return b.sceneCount - a.sceneCount;
    return a.characterName.localeCompare(b.characterName);
  });

  // ---------------------------------------------------------------------------
  // Totals.
  // ---------------------------------------------------------------------------
  const unusedCount = rows.filter((r) => r.isUnused).length;
  const unmappedCount = rows.filter((r) => r.isUnmapped).length;
  const totalWords = rows.reduce((sum, r) => sum + r.wordCount, 0);

  return {
    totals: {
      charactersInCodex: codexChars.length,
      charactersUsed: rows.filter((r) => !r.isUnused).length,
      unusedCount,
      unmappedCount,
      sceneCount: scenes.length,
      blockCount: blocks.length,
      totalWords,
    },
    rows,
  };
}
