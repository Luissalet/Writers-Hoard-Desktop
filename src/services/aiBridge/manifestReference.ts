// ============================================================================
// AI bridge — tool manifest for the Writings reference panel (pure data)
// ============================================================================
//
// No DOM, no Dexie, no React: the Electron main process reads this file too.
// These tools carry no engineId on purpose. They read the chapter, the codex,
// the notes and the library; the only project data they write is a pin (one
// `referencePins` row per chapter or book, never the chapter row itself), and
// the rest is the panel's own UI state (docked preference, width, temporary
// consult), which is the same state the screen shows.

import { b, n, PROJECT_ID, s, type BridgeTool } from './schema';

const SCOPE_PROPS = {
  writingId: s('Chapter id, from wh_list_writings. Omit when scope is "book".'),
  scope: s('"book" to address the whole-book editor instead of one chapter (pins and mentions then cover the whole project).', { enum: ['book'] }),
  projectId: PROJECT_ID,
};

export const REFERENCE_TOOLS: BridgeTool[] = [
  {
    name: 'wh_chapter_references',
    writes: false,
    description: `List the codex entries a chapter (or the whole book) mentions, plus the entries pinned to it.
Matches the names and aliases of the project's codex entries (aliases are read from an "Aliases"/"Apodos" field, comma or semicolon separated) against the text: whole words only, ignoring case and accents, longest name first. Returns for each mention the entry id, name, type, the alias that matched most, and how many times the entry's names occur. A mention only means the name appears in the text: it says nothing about who is present or whose point of view it is. Pinned entries come back in "pinned" (the writer's pins, which the reference panel shows first) whether or not they are mentioned. Nothing is written.`,
    schema: {
      type: 'object',
      properties: SCOPE_PROPS,
      additionalProperties: false,
    },
  },
  {
    name: 'wh_pin_reference',
    writes: true,
    description: `Pin or unpin a codex entry for a chapter (or the whole book) in the reference panel.
Pinned entries are listed first in the panel's "Consultar" (Reference) side panel. A pin is project data kept in its own table, so it travels with the project backup/export; it never changes the chapter text, the chapter row or the codex entry. Returns the scope's pins after the change.`,
    schema: {
      type: 'object',
      properties: {
        ...SCOPE_PROPS,
        entryId: s('Codex entry id, from wh_list_codex.'),
        pinned: b('true to pin, false to unpin.'),
      },
      required: ['entryId', 'pinned'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_reference_consult',
    writes: true,
    description: `Open or close the reference panel as a temporary consult drawer over the text.
The same as the floating "Consultar" button or Ctrl+Alt+R. This is the way the panel shows in focus mode, in the whole-book editor and in windows narrower than the editor's two-column layout. It is not saved: a reload starts closed. Returns the panel's UI state.`,
    schema: {
      type: 'object',
      properties: { open: b('true to open the drawer, false to close it.') },
      required: ['open'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_reference_prefs',
    writes: true,
    description: `Read or set the reference panel's docked preference and width.
That is whether it is open in the chapter editor's side column (wide windows) and how wide that column is (280 to 560 px, clamped). The values are saved in the app's local preferences and survive a reload. Pass nothing to only read the state, which also reports whether the temporary consult drawer is open.`,
    schema: {
      type: 'object',
      properties: {
        open: b('true to dock the panel open in the side column, false to collapse it.'),
        width: n('Column width in pixels; clamped to 280-560.'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_reference_search',
    writes: false,
    description: `Search what the reference panel searches: codex entries, notes and library citations.
Codex entries match on name, alias, tags, fields and body. Read-only; use wh_reference_preview to read one result in full.`,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        query: s('Text to look for.'),
        limit: n('Most results per source (default 10, max 30).'),
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_reference_preview',
    writes: false,
    description: `Read one result as the reference panel previews it, as plain paragraphs.
The result is a codex entry, a note or a library citation. Read-only.`,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        kind: s('Where the result is from.', { enum: ['codex', 'note', 'citation'] }),
        id: s('Result id, from wh_reference_search.'),
      },
      required: ['kind', 'id'],
      additionalProperties: false,
    },
  },
];
