// ============================================================================
// AI bridge — tool manifest for the Writings reference panel (pure data)
// ============================================================================
//
// No DOM, no Dexie, no React: the Electron main process reads this file too.
// These tools carry no engineId on purpose. They read the chapter and the
// codex, and the only thing wh_pin_reference writes is a per-chapter pin kept
// in the app's local preferences, never a project row.

import { b, s, type BridgeTool } from './schema';

export const REFERENCE_TOOLS: BridgeTool[] = [
  {
    name: 'wh_chapter_references',
    writes: false,
    description: `List the codex entries a chapter mentions, plus the entries the writer pinned to it.
Matches the names and aliases of the project's codex entries (aliases are read from an "Aliases"/"Apodos" field, comma or semicolon separated) against the chapter text: whole words only, ignoring case and accents, longest name first. Returns for each mention the entry id, name, type, the alias that matched most, and how many times the entry's names occur. A mention only means the name appears in the text: it says nothing about who is present or whose point of view it is. Pinned entries come back in "pinned" (the writer's pins, which the reference panel shows first) whether or not they are mentioned. Nothing is written.`,
    schema: {
      type: 'object',
      properties: { writingId: s('Chapter id, from wh_list_writings.') },
      required: ['writingId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_pin_reference',
    writes: true,
    description: `Pin or unpin a codex entry for one chapter in the writer's reference panel.
Pinned entries are listed first in the panel's "Consultar" (Reference) side panel for that chapter. The pin is a local reading preference: it does not change the chapter, the codex entry or any project data. Returns the chapter's pins after the change.`,
    schema: {
      type: 'object',
      properties: {
        writingId: s('Chapter id, from wh_list_writings.'),
        entryId: s('Codex entry id, from wh_list_codex.'),
        pinned: b('true to pin, false to unpin.'),
      },
      required: ['writingId', 'entryId', 'pinned'],
      additionalProperties: false,
    },
  },
];
