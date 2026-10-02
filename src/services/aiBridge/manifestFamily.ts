// ============================================================================
// AI bridge — tool manifest for the hand-offs to the other Hoard apps
// ============================================================================
//
// Pure data, same rules as manifest.ts. Two of these send something out
// (a character or a storyboard to Prospero's Hoard, the project's world to
// Scheherazade's Hoard) and one brings a world in; all four go through the
// local Hoard hub, need the desktop app, and say which app to start when it is
// not running. They span engines, so none carries an engineId; the import
// checks the engines it writes into itself.

import { b, PROJECT_ID, s, type BridgeTool } from './schema';

const NEEDS_HUB =
  'Goes through the local Hoard hub; needs the desktop app, the hub and the other app running — if one is not, the error says which to start.';

export const FAMILY_TOOLS: BridgeTool[] = [
  {
    name: 'wh_character_to_prospero',
    description:
      `Send a codex character to Prospero's Hoard as a cast member (name, look, portrait).
Hands one codex CHARACTER to Prospero's Hoard as a new cast member: the name, a description built from the character sheet and body, the physical look fields, and the portrait plus up to three gallery pictures linked to the character (sent as temporary PNG files, deleted right after). The entry is only read, never changed. ${NEEDS_HUB} The hub is told the two records are the same thing.`,
    writes: true,
    timeoutMs: 120_000,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        characterId: s('Codex entry id of a character (wh_list_codex type "character"). Also accepted as character_id.'),
      },
      required: ['characterId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_storyboard_to_prospero',
    description:
      `Send a storyboard to Prospero's Hoard as a production draft, one shot per panel.
Turns one storyboard into a Prospero production draft: each panel, in order, becomes a shot with its title and description as the text, its duration when it is a time ("8s", "00:15-00:23") and its picture (sent as a temporary PNG, deleted right after). The storyboard is only read. ${NEEDS_HUB}`,
    writes: true,
    timeoutMs: 240_000,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        storyboardId: s('Storyboard id (wh_list_storyboards). Also accepted as storyboard_id.'),
      },
      required: ['storyboardId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_world_to_scheherazade',
    description:
      `Send the project's world (codex, relations, timeline) to Scheherazade's Hoard as a story world.
Exports the project's codex entries, relationships and timeline events as a neutral hoard.world/1 document (the format is in Scheherazade's docs/WORLD_SCHEMA.md) and imports it into Scheherazade: a new world, or the one this project was sent to before — safe to repeat, since nothing there is duplicated, deleted or overwritten if the writer edited it. Never sent: the manuscript, pictures, diary, notes, research, and secret relationships unless includeSecret is true. Returns what was sent and how each record fared there (created, unchanged, updated, local_modified, linked_existing…). ${NEEDS_HUB}`,
    writes: true,
    timeoutMs: 180_000,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        worldId: s("Scheherazade world to merge into (id or exact name). Omit to use the world this project was sent to before, or create a new one. Also accepted as world_id."),
        includeSecret: b('Also send relationships marked "secret". Default false: they stay with the author.'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_world_from_scheherazade',
    description:
      `Bring a Scheherazade world into the project's codex, relationships and timeline.
Reads a world from Scheherazade's Hoard (hoard.world/1) and merges it here: characters, places, factions and things become codex entries, relations become relationships, and events go on a timeline named after the world. New records are created; ones imported before are updated only if the writer has not edited them since (otherwise reported as local_modified and left alone); a codex entry with the same name is linked, never duplicated or changed; nothing is deleted, and an entry the writer deleted is not brought back. Needs the codex engine on; relations and events are skipped, and say so, if their engines are off. ${NEEDS_HUB}`,
    writes: true,
    timeoutMs: 180_000,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        worldId: s('Scheherazade world to bring in (id or exact name). Also accepted as world_id.'),
      },
      required: ['worldId'],
      additionalProperties: false,
    },
  },
];
