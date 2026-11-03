export const eraDocumentKinds = ['dialog-scene', 'codex', 'writings', 'maps', 'worldgen', 'board', 'timeline', 'notes', 'dictionary', 'tables', 'genealogy', 'character-sheets', 'radar', 'model-viewer', 'media', 'local-tool'] as const;
export type EraDocumentKind = typeof eraDocumentKinds[number];
