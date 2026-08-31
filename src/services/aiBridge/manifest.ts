// ============================================================================
// AI bridge — tool manifest (pure data, no DOM, no Dexie)
// ============================================================================
//
// This module is imported by BOTH sides:
//   • the renderer, which owns the handlers, and
//   • the Electron main process, which serves GET /api/tools and must answer
//     even while no window is open.
//
// Therefore: no imports beyond types. Nothing here may touch `db`, `window`
// or React. The handlers live in ./tools/*.ts.
//
// The descriptions are the documentation an external model gets. Write them
// for a reader who has never seen Writers Hoard and cannot ask questions.

// `engines/outline/types` is a leaf data module with no imports of its own —
// no Dexie, no DOM — so reading the beat sheets from it keeps the template
// list here and the one the handler validates against the same list.
import { BEAT_SHEET_TEMPLATES } from '@/engines/outline/types';
import {
  arr,
  b,
  grouped,
  inEngine,
  MARKDOWN_NOTE,
  n,
  PROJECT_ID,
  s,
  type BridgeTool,
} from './schema';
import {
  ANNOTATION_TOOLS,
  ARC_TOOLS,
  BIOGRAPHY_TOOLS,
  BOARD_TOOLS,
  DIALOG_TOOLS,
  GALLERY_TOOLS,
  IMAGE_STUDIO_TOOLS,
  MAP_TOOLS,
  REAL_ATLAS_TOOLS,
  RELATIONSHIP_TOOLS,
  SEED_TOOLS,
  STATS_TOOLS,
  STORYBOARD_TOOLS,
  VIDEO_TOOLS,
  WORLDGEN_TOOLS,
} from './manifestEngines';

export type { BridgeTool, BridgeToolGroup, BridgeToolSchema } from './schema';

/** Beat sheet ids a model may ask for, and the only ones the handler accepts. */
export const TEMPLATE_IDS = BEAT_SHEET_TEMPLATES.map((template) => template.id);

/**
 * The engines this bridge has tools for, and the only ones wh_enable_engine
 * will switch on.
 *
 * Written out rather than read from `engines/_registry`, which imports React
 * icons and would drag the whole renderer into the main process. The list is
 * therefore a copy, and `tests/ai-bridge.ts` compares it against the live
 * registry so it cannot drift: every engine the app registers has tools here.
 */
export const BRIDGE_ENGINE_IDS = [
  'writings', 'codex', 'diary', 'timeline', 'outline', 'notes', 'scrapper',
  'dialog-scene', 'character-arc', 'relationships', 'seeds', 'biography',
  'board', 'gallery', 'maps', 'storyboard', 'video-planner', 'annotations',
  'pov-audit', 'writing-stats', 'image-studio', 'worldgen', 'real-atlas',
];

// ---------------------------------------------------------------------------
// Context and search
// ---------------------------------------------------------------------------

const CONTEXT_TOOLS: BridgeTool[] = [
  {
    name: 'wh_get_context',
    description:
      'What the user is looking at right now: the open project with the engines it has switched on, the open engine (tab), and whether writing is currently permitted. Call this first when the user says "this chapter", "my project" or "here" without naming anything.',
    writes: false,
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'wh_list_projects',
    description:
      'Every project in Writers Hoard with its id, title, mode and item counts. Use it to resolve a project the user named, or to pick one when no project is open.',
    writes: false,
    schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'wh_enable_engine',
    description:
      'Switch an engine on for a project. Projects only show the engines they have enabled, and the app\'s own search only looks at those, so writing into a disabled engine is refused — this is how you unblock that. Adding an engine is additive and the writer can remove it in one click, but it does change their workspace, so prefer asking first unless they clearly want the thing it holds. There is no way to switch one off from here: that would hide material they can no longer search for.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        engineId: s('Engine to switch on.', { enum: [...BRIDGE_ENGINE_IDS] }),
      },
      required: ['engineId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_delete',
    description:
      'Delete one thing, after asking the person at the keyboard. A dialog opens in the app naming what will go and what goes with it; if nobody confirms — including because nobody is there — nothing is deleted and the call fails. Deletion cannot be undone, so prefer saying what should go and letting the writer do it; use this when they have clearly asked you to remove something.',
    writes: true,
    // Two minutes: the dialog waits for a human, and a human may be elsewhere.
    timeoutMs: 150_000,
    schema: {
      type: 'object',
      properties: {
        type: s('What kind of thing.', {
          enum: [
            'writing', 'codex-entry', 'note', 'diary-entry', 'scene', 'dialog-block',
            'timeline', 'timeline-event', 'timeline-connection', 'outline', 'beat',
            'seed', 'payoff', 'arc', 'arc-beat', 'relationship', 'biography',
            'biography-fact', 'board', 'board-card', 'snapshot', 'image', 'map-pin',
            'storyboard', 'panel', 'video-plan', 'video-segment', 'annotation',
            'generated-world', 'world-waypoint', 'atlas-place', 'divergence',
          ],
        }),
        id: s('Id of the thing to delete.'),
        reason: s('Why, in one line. Shown to the user in the confirmation.'),
      },
      required: ['type', 'id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_search',
    description:
      'Full-text search across the project\'s prose: manuscripts, codex entries, diary entries, dialog scenes, web clippings, notes, outline beats, seeds and payoffs, character arcs and their beats, relationships, biography facts, timeline events, map pins, real-atlas places and divergences, and margin notes. Searches the BODY, not just titles, and returns a snippet plus the engine and id of each hit — the right first move for almost any question about the user\'s material. Picture-based engines (board cards, gallery, storyboard, video planner) are NOT in this index; reach those through their own wh_list_* tools.',
    writes: false,
    schema: {
      type: 'object',
      properties: {
        query: s('What to look for. Fewer than 3 characters returns nothing.'),
        projectId: PROJECT_ID,
        limit: n('Maximum hits. Default 8, maximum 50.'),
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Writings — the manuscript engine
// ---------------------------------------------------------------------------

const WRITING_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_writings',
    description:
      'List the manuscript pieces (chapters, scenes, drafts) of a project with their status, word count and synopsis. Bodies are NOT included — fetch one with wh_get_writing.',
    writes: false,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        status: s('Filter by status.', { enum: ['idea', 'draft', 'finished'] }),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_get_writing',
    description: 'Read one manuscript piece in full. The body comes back as Markdown.',
    writes: false,
    schema: {
      type: 'object',
      properties: { id: s('Writing id, from wh_list_writings or wh_search.') },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_writing',
    description: `Create a new manuscript piece. ${MARKDOWN_NOTE}`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        title: s('Title of the piece.'),
        content: s(`Body. ${MARKDOWN_NOTE}`),
        synopsis: s('One-paragraph summary shown on the card.'),
        status: s('Default "draft".', { enum: ['idea', 'draft', 'finished'] }),
        chapter: n('Chapter number, for ordering.'),
        tags: arr('Freeform tags.'),
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_writing',
    description:
      'Change a manuscript piece. Only the fields you pass are touched. Passing `content` REPLACES the whole body — a previous version is snapshotted first, so the user can undo it from the history panel, but prefer wh_append_writing when you are only adding.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Writing id.'),
        title: s('New title.'),
        content: s(`Replacement body. ${MARKDOWN_NOTE}`),
        synopsis: s('New synopsis.'),
        status: s('New status.', { enum: ['idea', 'draft', 'finished'] }),
        chapter: n('New chapter number.'),
        tags: arr('Replacement tag list.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_append_writing',
    description:
      'Add text to the end of a manuscript piece without resending what is already there. Cheaper and far safer than wh_update_writing for continuing a scene.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Writing id.'),
        content: s(`Markdown to append. ${MARKDOWN_NOTE}`),
      },
      required: ['id', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_list_writing_versions',
    description:
      'List the saved versions of a manuscript piece, newest first, with the reason each was taken ("pre-ai" means an AI tool was about to overwrite it).',
    writes: false,
    schema: {
      type: 'object',
      properties: { id: s('Writing id.') },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_restore_writing_version',
    description:
      'Roll a manuscript piece back to a saved version. The current text is snapshotted first, so restoring is itself reversible.',
    writes: true,
    schema: {
      type: 'object',
      properties: { snapshotId: s('Snapshot id from wh_list_writing_versions.') },
      required: ['snapshotId'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Codex — the encyclopedia of characters, places, items, factions, concepts
// ---------------------------------------------------------------------------

const CODEX_TYPES = ['character', 'location', 'item', 'faction', 'concept', 'magic', 'custom'];

const CODEX_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_codex',
    description:
      'List codex entries (characters, locations, items, factions, concepts) with their type, tags and structured fields. Bodies are not included.',
    writes: false,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        type: s('Filter by entry type.', { enum: CODEX_TYPES }),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_get_codex_entry',
    description:
      'Read one codex entry in full: its structured `fields` map plus the long-form body as Markdown.',
    writes: false,
    schema: {
      type: 'object',
      properties: { id: s('Codex entry id.') },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_codex_entry',
    description:
      'Create a character sheet, location, item, faction or concept. `fields` is a free-form label→value map (e.g. {"Age":"34","Occupation":"Smuggler"}); the app offers a suggested set per type in its own form, but this tool starts from whatever you pass and nothing else — send the fields you want the sheet to have.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        type: s('Entry type. Default "character".', { enum: CODEX_TYPES }),
        title: s('Name of the character, place or thing.'),
        fields: {
          type: 'object',
          description: 'Structured attributes as a flat label→value map of strings.',
          additionalProperties: { type: 'string' },
        },
        content: s(`Long-form description. ${MARKDOWN_NOTE}`),
        tags: arr('Freeform tags.'),
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_codex_entry',
    description:
      'Change a codex entry. `fields` is MERGED into the existing map by default, so you can add one attribute without resending the sheet; pass an empty string as a value to clear one key, or replaceFields:true to swap the whole map. Avatars and cross-entity relations are managed in the app and are never touched here.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Codex entry id.'),
        title: s('New name.'),
        type: s('New entry type.', { enum: CODEX_TYPES }),
        fields: {
          type: 'object',
          description: 'Attributes to merge in. A value of "" clears that key.',
          additionalProperties: { type: 'string' },
        },
        replaceFields: b('Replace the whole field map instead of merging. Default false.'),
        content: s(`Replacement body. ${MARKDOWN_NOTE}`),
        tags: arr('Replacement tag list.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Diary — the writer's own log, not the characters'
// ---------------------------------------------------------------------------

const DIARY_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_diary',
    description:
      'List the diary: pinned entries first, then newest first, each with its date, mood and tags. Because pinned entries lead the whole list, a small `limit` can return an old pinned entry instead of this week\'s — pass a larger one when you want recent ones. This is the writer\'s working journal about the project, not a character\'s in-world diary.',
    writes: false,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        limit: n('Maximum entries. Default 30.'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_diary_entry',
    description: `Write a new diary entry. ${MARKDOWN_NOTE}`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        content: s(`Body of the entry. ${MARKDOWN_NOTE}`),
        title: s('Optional headline.'),
        entryDate: s('Moment being recorded, as "YYYY-MM-DDTHH:mm". Defaults to now.'),
        mood: s('Optional mood tag.', { enum: ['great', 'good', 'neutral', 'low', 'bad'] }),
        tags: arr('Freeform tags.'),
        pinned: b('Pin the entry to the top of the list, above every unpinned one.'),
      },
      required: ['content'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_diary_entry',
    description: 'Change an existing diary entry. Only the fields you pass are touched.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Diary entry id.'),
        content: s(`Replacement body. ${MARKDOWN_NOTE}`),
        title: s('New headline.'),
        entryDate: s('New moment, as "YYYY-MM-DDTHH:mm".'),
        mood: s('New mood.', { enum: ['great', 'good', 'neutral', 'low', 'bad'] }),
        tags: arr('Replacement tag list.'),
        pinned: b('Pin or unpin.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Timeline — swim-lane chronologies and the links between events
// ---------------------------------------------------------------------------

const TIMELINE_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_timelines',
    description:
      'List the timelines of a project. A project can hold several (main plot, a character\'s life, a war), each drawn as its own lane group.',
    writes: false,
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_timeline',
    description:
      'Create a new timeline inside a project. Make one per chronology worth reading separately — the main plot, one character\'s life, a war — rather than crowding unrelated threads into a single line.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        title: s('Name of the timeline.'),
        description: s('What era or thread it covers.'),
        color: s('Lane colour as #rrggbb. A default is picked if omitted.'),
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_list_events',
    description:
      'List events. Pass timelineId for one timeline, or only projectId for every event in the project, ordered as they are drawn.',
    writes: false,
    schema: {
      type: 'object',
      properties: {
        timelineId: s('Timeline to read. Omit to read the whole project.'),
        projectId: PROJECT_ID,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_event',
    description:
      'Add an event to a timeline. Dates are free text by default ("Third age, 2412"), which is what invented chronologies need; pass dateMode:"calendar" with realDate to place it on a real calendar instead.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        timelineId: s('Timeline the event belongs to. Required — get one from wh_list_timelines.'),
        title: s('What happens.'),
        description: s('Detail. Plain text.'),
        date: s('Displayed date. Free text unless dateMode is "calendar".'),
        dateMode: s('Default "text".', { enum: ['text', 'calendar'] }),
        realDate: s('ISO date "YYYY-MM-DD", only when dateMode is "calendar".'),
        realDateEnd: s('ISO end date for a range.'),
        eventType: s('Default "point".', { enum: ['point', 'range', 'milestone'] }),
        lane: s('Swim lane label, e.g. a character or plot thread.'),
        color: s('Colour as #rrggbb.'),
        order: n('Position within the timeline. Appended last if omitted.'),
        linkedEntryId: s('Codex entry id this event is about, if any.'),
      },
      required: ['timelineId', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_event',
    description: 'Change a timeline event. Only the fields you pass are touched.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Event id.'),
        title: s('New title.'),
        description: s('New description.'),
        date: s('New displayed date.'),
        dateMode: s('New date mode.', { enum: ['text', 'calendar'] }),
        realDate: s('New ISO date.'),
        realDateEnd: s('New ISO end date.'),
        eventType: s('New event type.', { enum: ['point', 'range', 'milestone'] }),
        lane: s('New lane.'),
        color: s('New colour.'),
        order: n('New position.'),
        linkedEntryId: s('New linked codex entry id.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_connect_events',
    description:
      'Draw a causal or narrative link between two events ("this leads to that"). The two events may live on different timelines.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        sourceEventId: s('Event the arrow starts from.'),
        targetEventId: s('Event the arrow points to.'),
        label: s('Text on the arrow, e.g. "causes", "twenty years later".'),
        style: s('Default "solid".', { enum: ['solid', 'dashed', 'dotted'] }),
        color: s('Colour as #rrggbb.'),
      },
      required: ['sourceEventId', 'targetEventId'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Scrapper — web clippings and saved social posts, with a vision path
// ---------------------------------------------------------------------------

const SCRAPPER_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_snapshots',
    description:
      'List the project\'s clippings: saved links, archived pages and downloaded social posts, with their tags, captions and whether an image is available to look at.',
    writes: false,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        tag: s('Only clippings carrying this tag.'),
        untaggedOnly: b('Only clippings with no tags yet — the ones worth captioning.'),
        withImageOnly: b('Only clippings that have an image you can actually view.'),
        limit: n('Maximum clippings. Default 50, maximum 200.'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_get_snapshot',
    description:
      'Read one clipping in full: caption, tags, the writer\'s notes as Markdown, and the text extracted from the archived page when there is one.',
    writes: false,
    schema: {
      type: 'object',
      properties: { id: s('Snapshot id.') },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_view_snapshot_image',
    description:
      'Look at a clipping\'s image. Returns the picture itself, downscaled for viewing, so a vision-capable model can describe or tag what is actually in it. Pick the frame with itemIndex when the post is a carousel.',
    writes: false,
    schema: {
      type: 'object',
      properties: {
        id: s('Snapshot id, from wh_list_snapshots or wh_search.'),
        itemIndex: n('Which image of a multi-image post, starting at 0. Default 0.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_tag_snapshot',
    description:
      'Write tags, a caption or notes onto a clipping. This is the other half of the vision loop: view the image, then describe it here so it becomes searchable.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Snapshot id.'),
        tags: arr('Replacement tag list. Use addTags instead to keep what is there.'),
        addTags: arr('Tags to add to the existing ones, without duplicates.'),
        description: s('Short caption describing the clipping.'),
        title: s('New title.'),
        notes: s(`Longer notes. ${MARKDOWN_NOTE}`),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_list_instagram_collection',
    description:
      'List every post in an Instagram saved collection WITHOUT downloading anything: permalink, caption, author and date. Slow on purpose — the underlying tool paces its requests 6-12 seconds apart to avoid tripping Instagram, so dozens of posts take minutes. Tell the user it is running rather than retrying.',
    writes: false,
    // Ten minutes: a 50-post collection at ~9s per request is genuinely that long.
    timeoutMs: 600_000,
    schema: {
      type: 'object',
      properties: { url: s('URL of the Instagram saved collection.') },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_import_snapshots',
    description:
      'Save a list of links into the project as clippings, link-only (nothing is downloaded). Feed it what wh_list_instagram_collection returned, minus whatever the user does not want. Duplicates by URL are skipped.',
    writes: true,
    timeoutMs: 120_000,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        items: {
          type: 'array',
          description: 'The links to save.',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              author: { type: 'string' },
              publishDate: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['url'],
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_download_snapshot_media',
    description:
      'Download one clipping\'s media (photo, carousel or video) onto the disk so it can then be viewed with wh_view_snapshot_image. One clipping per call: each download is slow, and doing them one at a time keeps the user informed.',
    writes: true,
    timeoutMs: 300_000,
    schema: {
      type: 'object',
      properties: {
        id: s('Snapshot id.'),
        format: s('"video" keeps motion, "audio" strips it. Default "video"; photos ignore this.', {
          enum: ['video', 'audio'],
        }),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Notes — the smallest unit of capture, plus the project-less inbox
// ---------------------------------------------------------------------------

const NOTE_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_notes',
    description:
      'List notes: single thoughts, quotes, ideas and words the writer liked. Plain text, no titles. Pass inbox:true for the project-less capture inbox instead of a project.',
    writes: false,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        inbox: b('Read the project-less inbox instead of a project.'),
        kind: s('Filter by kind.', { enum: ['note', 'quote', 'idea', 'word'] }),
        limit: n('Maximum notes. Default 50, maximum 300.'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_note',
    description:
      'Capture one note. Keep it to a thought or a quote — anything longer than a paragraph belongs in a writing or a diary entry instead.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        inbox: b('Capture into the project-less inbox instead of a project.'),
        text: s('The note itself, as plain text. Its first line doubles as the title.'),
        kind: s('Default "note".', { enum: ['note', 'quote', 'idea', 'word'] }),
        source: s('Who said it, or where it came from.'),
        tags: arr('Freeform tags.'),
        pinned: b('Float it to the top of the board.'),
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_note',
    description: 'Change a note. Only the fields you pass are touched.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Note id.'),
        text: s('Replacement text.'),
        kind: s('New kind.', { enum: ['note', 'quote', 'idea', 'word'] }),
        source: s('New attribution.'),
        tags: arr('Replacement tag list.'),
        pinned: b('Pin or unpin.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Outline — the story's skeleton: acts, chapters, scenes, beats
// ---------------------------------------------------------------------------

const BEAT_LEVELS = ['act', 'chapter', 'scene', 'beat'];
const BEAT_STATUSES = ['empty', 'outlined', 'drafted', 'done'];

const OUTLINE_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_outlines',
    description:
      'List the project\'s outlines. An outline is a beat sheet: the story broken into acts, chapters, scenes and beats, each with a status showing how far it has been written.',
    writes: false,
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_outline',
    description:
      'Start an outline. Pass `template` to lay it out from a beat sheet — the beats are written in the app\'s language, with their positions and colours, ready to be filled in. Without a template you get an empty outline to build with wh_create_beat.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        title: s('What this outline is called.'),
        template: s(
          'Beat sheet to lay down. Omit for an empty outline.',
          { enum: [...TEMPLATE_IDS] },
        ),
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_list_beats',
    description:
      'Read the beats of an outline in order, with their level, description, status, story position and any linked manuscript piece. This is the fastest way to understand the shape of a story before writing into it.',
    writes: false,
    schema: {
      type: 'object',
      properties: {
        outlineId: s('Outline to read. Omit to read every beat in the project.'),
        projectId: PROJECT_ID,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_beat',
    description:
      'Add a beat to an outline. Levels nest: an act contains chapters, a chapter contains scenes, a scene contains beats. Appended last unless you pass an order.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        outlineId: s('Outline the beat belongs to. Required.'),
        title: s('What happens in this beat.'),
        description: s('Detail. Plain text.'),
        level: s('Default "beat".', { enum: BEAT_LEVELS }),
        parentId: s('Parent beat id, for nesting.'),
        status: s('Default "empty".', { enum: BEAT_STATUSES }),
        storyPosition: n('Percentage through the story, 0-100.'),
        order: n('Position within the outline.'),
        color: s('Colour as #rrggbb.'),
        wordTarget: n('Word count target for this beat.'),
        linkedWritingId: s('Manuscript piece that covers this beat.'),
      },
      required: ['outlineId', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_beat',
    description:
      'Change a beat. Only the fields you pass are touched. Moving a beat to "drafted" or "done" is how the outline tracks progress, so update the status when you write the scene it describes.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Beat id.'),
        title: s('New title.'),
        description: s('New description.'),
        level: s('New level.', { enum: BEAT_LEVELS }),
        status: s('New status.', { enum: BEAT_STATUSES }),
        storyPosition: n('New position, 0-100.'),
        order: n('New order within the outline.'),
        color: s('New colour.'),
        wordTarget: n('New word target.'),
        linkedWritingId: s('Manuscript piece that covers this beat.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export const BRIDGE_TOOLS: BridgeTool[] = [
  // Core spans every engine or none, so it carries no engineId.
  ...grouped('core', CONTEXT_TOOLS),
  ...grouped('writing', inEngine('writings', WRITING_TOOLS)),
  ...grouped('writing', inEngine('outline', OUTLINE_TOOLS)),
  ...grouped('writing', inEngine('notes', NOTE_TOOLS)),
  ...grouped('writing', inEngine('diary', DIARY_TOOLS)),
  ...grouped('people', inEngine('codex', CODEX_TOOLS)),
  ...grouped('people', inEngine('biography', BIOGRAPHY_TOOLS)),
  ...grouped('people', inEngine('relationships', RELATIONSHIP_TOOLS)),
  ...grouped('story', inEngine('timeline', TIMELINE_TOOLS)),
  ...grouped('story', inEngine('seeds', SEED_TOOLS)),
  ...grouped('story', inEngine('character-arc', ARC_TOOLS)),
  ...grouped('script', inEngine('dialog-scene', DIALOG_TOOLS)),
  ...grouped('visual', inEngine('board', BOARD_TOOLS)),
  ...grouped('visual', inEngine('gallery', GALLERY_TOOLS)),
  ...grouped('visual', inEngine('image-studio', IMAGE_STUDIO_TOOLS)),
  ...grouped('visual', inEngine('maps', MAP_TOOLS)),
  ...grouped('visual', inEngine('worldgen', WORLDGEN_TOOLS)),
  ...grouped('visual', inEngine('real-atlas', REAL_ATLAS_TOOLS)),
  ...grouped('visual', inEngine('storyboard', STORYBOARD_TOOLS)),
  ...grouped('visual', inEngine('video-planner', VIDEO_TOOLS)),
  ...grouped('research', inEngine('scrapper', SCRAPPER_TOOLS)),
  ...grouped('analysis', inEngine('annotations', ANNOTATION_TOOLS)),
  // STATS_TOOLS straddles two engines and names them itself.
  ...grouped('analysis', STATS_TOOLS),
];

export const BRIDGE_TOOL_NAMES: string[] = BRIDGE_TOOLS.map((tool) => tool.name);

export function getBridgeTool(name: string): BridgeTool | undefined {
  return BRIDGE_TOOLS.find((tool) => tool.name === name);
}

/** Read-only view for a client that has writing disabled. */
export function readOnlyTools(): BridgeTool[] {
  return BRIDGE_TOOLS.filter((tool) => !tool.writes);
}

/**
 * The catalogue a client actually sees.
 *
 * `groups` narrows it to the toolsets a client asked for — 'core' is always
 * included, because without wh_get_context and wh_search nothing else is
 * usable. An empty or absent list means everything.
 */
export function selectTools(options: {
  groups?: string[];
  writesEnabled?: boolean;
}): BridgeTool[] {
  const wanted = (options.groups ?? [])
    .map((group) => group.trim().toLowerCase())
    .filter(Boolean);
  return BRIDGE_TOOLS.filter((tool) => {
    if (options.writesEnabled === false && tool.writes) return false;
    if (!wanted.length) return true;
    return tool.group === 'core' || wanted.includes(tool.group ?? '');
  });
}

/**
 * Ready-to-paste briefing for a model that has never seen this app.
 * Served at GET /api/instructions and shown in the settings panel.
 */
export const BRIDGE_INSTRUCTIONS = `You are connected to Writers Hoard, a desktop workbench a writer uses to build long-form projects: novels, biographies, screenplays, investigations, video scripts.

Its data is organised as PROJECTS. Inside a project sit several engines:
- Writings — the manuscript itself, split into chapters or scenes.
- Codex — the encyclopedia: characters, locations, items, factions, concepts.
- Diary — the writer's own working journal about the project.
- Timeline — chronologies of events, in swim lanes, with links between events.
- Outline — the skeleton: acts, chapters, scenes and beats, each with a status.
- Notes — single thoughts, quotes and words, plus a project-less inbox.
- Scrapper — clippings: saved links, archived pages and social posts with images.
- Dialog scenes — screenplay-style scenes: a cast, and blocks of dialogue and action.
- Character arcs — a character's inner journey: ghost, lie, truth, want, need, and the beats where it shifts.
- Relationships — who is what to whom, with an intensity from hostility to devotion.
- Seeds and payoffs — things planted early and where they land. A seed with no payoff is orphaned.
- Biography — a documented life, fact by fact, each with a confidence and a source.
- Board — a corkboard: cards on a canvas with labelled threads between them.
- Gallery, Maps, Storyboard, Video planner — reference images, pinned places, shot grids and spoken scripts.
- World generator — procedurally generated planets: terrain, climate, realms, settlements, ruins and landmarks, plus the reader's own edits (renamed and placed towns, labels) and waypoints.
- Real atlas — the story's real-world setting: places with coordinates and checked facts, and the deliberate divergences from reality.
- Annotations — margin notes anchored to an exact phrase somewhere else in the project.
- Image studio — pictures generated from a prompt with the model configured in AI settings; they are filed in the Gallery with their prompt and seed.

Not every project has every engine. A project shows only the engines it has switched on, and its own search only looks at those — so writing into a switched-off engine is refused rather than quietly filed somewhere the writer will never see. wh_get_context and wh_list_projects both report enabledEngines; wh_enable_engine turns one on. Turning an engine on changes the writer's workspace, so if it is not obvious they want it, ask.

Containers before contents: outlines, boards, storyboards, video plans and timelines hold everything else in their engine. If wh_list_* comes back empty, create one (wh_create_outline, wh_create_board, wh_create_storyboard, wh_create_video_plan, wh_create_timeline) rather than concluding the engine is unusable. wh_create_outline can lay down a whole beat sheet in one call.

Generated worlds work differently from everything above. Their places are not rows: each has a stable key of the form kind:x,y — settlement:512,201, ruin:88,140, a landmark carries its type as landmark:volcano:12,6, a realm realm:3:0,0 — which you get from wh_list_places, wh_find_place or wh_place_at and never invent (wh_search does not index worlds; wh_find_place is their search). Coordinates are world cells: x runs 0..width-1 west to east, y runs 0..height-1 north to south (height is width/2), and every place also carries normalised u,v in 0..1, which is what waypoints use. Placing, renaming, moving, removing and labelling are edits appended to the world's edit list — the same list the writer's own brushes write — so they show up in an open view at once and can be undone; a removed place can be brought back with wh_restore_place. A world that was never opened on this machine may answer { pending: true, code: "generating" } once: it is being forged in the background, so wait about 30 seconds and call again rather than treating it as a failure.

The real atlas is the opposite case: the story's REAL setting, for a project set in the real world — a historical novel, a crime story in an actual city, alternate history. Its places are ordinary rows: a name, WGS84 coordinates or an address, an era, the facts the writer has checked (realNotes) and where they came from; a place marked fictional is one the writer invented inside the real world. Divergences are deliberate departures from reality — what is actually the case, what the book says instead, and why — anchored to a place when the change is local and free-standing when it is global. Run wh_reality_check before claiming the setting is consistent or well researched. wh_search finds places and divergences by their prose; the wh_*_atlas_place and wh_*_divergence tools are for the facts themselves.

How to work here:
1. Start with wh_get_context. It tells you which project and which engine the writer is looking at, so "this chapter" and "her" resolve to something real.
2. Prefer wh_search over listing everything. It searches bodies, not just titles, across every prose engine at once. It does not index the picture-based engines (board, gallery, storyboard, video planner) — use their own wh_list_* tools for those.
3. Read before you write. A codex entry or a chapter usually already exists; extend it instead of creating a duplicate.
4. All prose is Markdown, in and out.
5. Only the fields you pass are changed. To add one attribute to a character, send just that attribute — the rest of the sheet is preserved.
6. To continue a scene use wh_append_writing, not wh_update_writing. Replacing a whole chapter to add a paragraph risks losing the writer's own edits.
7. Deleting is the one thing you cannot undo. wh_delete exists, but it opens a dialog the writer has to confirm, and a call that nobody answers deletes nothing. Prefer saying what should go and letting them do it; reach for the tool only when they have clearly asked you to remove something. If a deletion is declined, drop it — do not ask again.
8. Manuscript changes are snapshotted before they happen and can be undone from the app's history panel. Say what you changed so the writer can check it.
9. If you can see images: wh_view_snapshot_image returns a clipping's picture, and wh_tag_snapshot writes what you saw back onto it. Describe what is actually in the frame — concrete subjects, setting, mood, colour, technique — not what the caption already says. Two to six tags beats twenty.
10. Some tools are slow by design: listing an Instagram collection paces its requests to avoid being blocked, and downloading media takes as long as it takes. Let them run and tell the user what is happening instead of retrying.

This is someone's creative work. Match the voice already on the page rather than imposing your own, and when you are unsure whether an invention is welcome, ask instead of writing it in.`;
