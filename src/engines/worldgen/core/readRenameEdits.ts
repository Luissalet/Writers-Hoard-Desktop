export interface WorldRenameEdit {
  kind: 'rename';
  key: string;
  name: string;
}

/**
 * Reads only the rename records needed by the engine registry. Both the legacy
 * bare-array format and the current versioned envelope are accepted. Keeping
 * this reader independent prevents registry startup from loading the terrain
 * replay and sculpting implementation in `core/edits`.
 */
export function readWorldRenameEdits(json: string): WorldRenameEdit[] {
  try {
    const value: unknown = JSON.parse(json);
    const edits = Array.isArray(value)
      ? value
      : value && typeof value === 'object' && Array.isArray((value as { edits?: unknown }).edits)
        ? (value as { edits: unknown[] }).edits
        : [];

    return edits.filter((edit): edit is WorldRenameEdit => {
      if (!edit || typeof edit !== 'object') return false;
      const candidate = edit as Partial<WorldRenameEdit>;
      return candidate.kind === 'rename'
        && typeof candidate.key === 'string'
        && typeof candidate.name === 'string';
    });
  } catch {
    return [];
  }
}
