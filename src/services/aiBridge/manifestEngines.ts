// ============================================================================
// AI bridge — tool manifest for the remaining engines (pure data)
// ============================================================================
//
// Split from manifest.ts purely for size: same rules apply. No DOM, no Dexie,
// no React. The descriptions ARE the documentation an external model gets, so
// write them for a reader who has never seen the app and cannot ask.

import { arr, b, MARKDOWN_NOTE, n, PROJECT_ID, s, type BridgeTool } from './schema';

// ---------------------------------------------------------------------------
// Dialog scenes — screenplay and stage-style scenes
// ---------------------------------------------------------------------------

const BLOCK_TYPES = ['dialog', 'stage-direction', 'action', 'transition', 'note', 'slug'];

export const DIALOG_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_scenes',
    description:
      'List the project\'s dialog scenes in order, with their setting, scene number, cast and how many blocks each holds. This engine is the screenplay/stage side of the app: scenes made of speech and action blocks, exportable to Fountain.',
    writes: false,
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_get_scene',
    description:
      'Read one scene as a script: every block in order with its speaker, parenthetical and text, plus the scene\'s cast list. Read this before adding to a scene so the voices already on the page are the ones you continue.',
    writes: false,
    schema: {
      type: 'object',
      properties: { id: s('Scene id.') },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_scene',
    description:
      'Add a scene to the project. It is appended last. Give it a setting like "INT. KITCHEN - NIGHT" when the project is a screenplay; the Fountain export uses the setting as the scene heading and falls back to the title.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        title: s('Short name for the scene.'),
        setting: s('Slugline, e.g. "INT. KITCHEN - NIGHT".'),
        description: s('What happens, in plain text.'),
        tags: arr('Freeform tags.'),
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_scene',
    description: 'Change a scene\'s title, setting, description or tags. Only the fields you pass are touched.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Scene id.'),
        title: s('New title.'),
        setting: s('New slugline.'),
        description: s('New description.'),
        tags: arr('Replacement tag list.'),
        isOmitted: b('Mark the scene omitted: kept in the project, hidden from output.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_dialog',
    description:
      'Append one block to a scene: a line of dialogue, an action beat, a stage direction, a transition, a slugline or a note. For dialogue pass the speaker in `character`; if that name is already in the scene cast the block inherits its colour, and if it matches a codex character it is linked to that entry. A parenthetical is written WITHOUT its brackets.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        sceneId: s('Scene the block belongs to.'),
        type: s('Default "dialog".', { enum: BLOCK_TYPES }),
        content: s('The line, the action, or the direction. Plain text.'),
        character: s('Speaker name. Dialogue only.'),
        parenthetical: s('Delivery note, without brackets: "quietly", not "(quietly)".'),
        dualWithBlockId: s('Id of the block this one is spoken over, for dual dialogue.'),
      },
      required: ['sceneId', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_dialog_block',
    description: 'Change one block of a scene. Only the fields you pass are touched.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Block id.'),
        content: s('New text.'),
        type: s('New block type.', { enum: BLOCK_TYPES }),
        character: s('New speaker name.'),
        parenthetical: s('New delivery note, without brackets.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Character arcs — the inner journey: ghost, lie, truth, want, need
// ---------------------------------------------------------------------------

const ARC_STAGES = [
  'ghost', 'weak', 'flaw', 'denial', 'inciting',
  'commitment', 'growth', 'moment-of-truth', 'climax', 'resolution',
];
const ARC_STATUSES = ['planning', 'drafting', 'revised', 'done'];

export const ARC_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_arcs',
    description:
      'List the project\'s character arcs with their ghost, lie, truth, want and need. An arc is one character\'s inner journey: the wound they carry, the false belief it left them with, and the truth that would free them.',
    writes: false,
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_get_arc',
    description:
      'Read one arc in full with its beats in order: each beat\'s stage, emotion and position in the story. This is the fastest way to see whether a character actually changes or just moves.',
    writes: false,
    schema: {
      type: 'object',
      properties: { id: s('Arc id.') },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_arc',
    description:
      'Create a character arc. The five spine fields matter more than the title: ghost (the old wound), lie (what they wrongly believe because of it), truth (what would free them), want (what they chase) and need (what would actually heal them). Leave any you do not know yet empty rather than inventing it.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        title: s('Name of the arc, e.g. "Anna\'s redemption".'),
        characterId: s('Codex entry id of the character, when one exists.'),
        ghost: s('The past wound.'),
        lie: s('The false belief it left behind.'),
        truth: s('The truth that would free them.'),
        want: s('What they actively pursue.'),
        need: s('What they actually need.'),
        summary: s('One paragraph on the arc as a whole.'),
        status: s('Default "planning".', { enum: ARC_STATUSES }),
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_arc_beat',
    description:
      'Add a beat to an arc: one moment where the character\'s inner state shifts. Appended last unless you pass an order.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        arcId: s('Arc the beat belongs to.'),
        title: s('What happens inside the character.'),
        description: s('Detail. Plain text.'),
        stage: s('Which stage of the journey. Default "inciting".', { enum: ARC_STAGES }),
        emotion: s('Short emotional tag: "hope", "dread", "resolve".'),
        storyPosition: n('Percentage through the story, 0-100.'),
        order: n('Position within the arc.'),
        status: s('Default "planning".', { enum: ARC_STATUSES }),
        linkedSceneId: s('Dialog scene where this beat lands.'),
        linkedBeatId: s('Outline beat this corresponds to.'),
      },
      required: ['arcId', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_arc_beat',
    description: 'Change an arc beat. Only the fields you pass are touched.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Arc beat id.'),
        title: s('New title.'),
        description: s('New description.'),
        stage: s('New stage.', { enum: ARC_STAGES }),
        emotion: s('New emotional tag.'),
        storyPosition: n('New position, 0-100.'),
        order: n('New order.'),
        status: s('New status.', { enum: ARC_STATUSES }),
        linkedSceneId: s('New linked scene.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Relationships — who is what to whom
// ---------------------------------------------------------------------------

const REL_KINDS = [
  'ally', 'friend', 'family', 'romantic', 'rival', 'enemy',
  'mentor', 'subordinate', 'colleague', 'acquaintance', 'other',
];
const REL_STATES = ['current', 'past', 'secret'];

export const RELATIONSHIP_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_relationships',
    description:
      'List who is what to whom, with the kind of bond, how strong it is (-5 hostile to +5 devoted), whether it is current, past or secret, and whether it runs both ways. Pass entityId to get every relationship touching one character — they are stored on either side, so this checks both.',
    writes: false,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        entityId: s('Only relationships involving this codex entry, on either side.'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_relationship',
    description:
      'Record a relationship between two codex entries. `intensity` runs from -5 (open hostility) through 0 (neutral) to +5 (deep loyalty or love). Leave `directional` false for a mutual bond; set it true when it only runs one way, like devotion that is not returned.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        entityAId: s('Codex entry id of the first party.'),
        entityBId: s('Codex entry id of the second party.'),
        kind: s('Default "other".', { enum: REL_KINDS }),
        intensity: n('-5 to 5. Default 0.'),
        label: s('Short label, e.g. "Ex-wife, amicable".'),
        notes: s('Longer notes. Plain text.'),
        state: s('Default "current".', { enum: REL_STATES }),
        directional: b('True when it runs A→B only. Default false.'),
      },
      required: ['entityAId', 'entityBId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_relationship',
    description:
      'Change a relationship — most usefully its state, when something that was current becomes past, or a secret comes out.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Relationship id.'),
        kind: s('New kind.', { enum: REL_KINDS }),
        intensity: n('New intensity, -5 to 5.'),
        label: s('New label.'),
        notes: s('New notes.'),
        state: s('New state.', { enum: REL_STATES }),
        directional: b('Whether it runs one way.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Seeds and payoffs — what was planted, what ever landed
// ---------------------------------------------------------------------------

const SEED_KINDS = ['foreshadow', 'chekhov', 'setup', 'callback', 'mystery'];

export const SEED_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_seeds',
    description:
      'List everything the writer planted — foreshadowing, Chekhov\'s guns, setups, callbacks, open mysteries — each with its payoffs. The status is computed, not stored: a seed that has not been cut and has no payoff comes back "orphaned". Ask for orphanedOnly to answer the question this engine exists for: what did I promise the reader and never deliver?',
    writes: false,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        orphanedOnly: b('Only seeds with no payoff and not cut.'),
        kind: s('Filter by kind.', { enum: SEED_KINDS }),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_seed',
    description:
      'Record something planted in the draft that must matter later. `plantedAt` is a percentage through the story, not a date.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        title: s('What was planted, in a few words.'),
        description: s('The detail as it appears in the draft. Plain text.'),
        kind: s('Default "foreshadow".', { enum: SEED_KINDS }),
        plantedAt: n('Percentage through the story, 0-100.'),
        locationLabel: s('Chapter or scene name, for quick reference.'),
        linkedWritingId: s('Manuscript piece where it is planted.'),
        linkedSceneId: s('Dialog scene where it is planted.'),
        tags: arr('Freeform tags.'),
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_seed',
    description:
      'Change a seed. Set status to "cut" when it was removed in revision — that is the only status worth writing, since the rest is derived from whether payoffs exist.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Seed id.'),
        title: s('New title.'),
        description: s('New description.'),
        kind: s('New kind.', { enum: SEED_KINDS }),
        status: s('Use "cut" to retire it, "planted" to bring it back.', {
          enum: ['planted', 'cut'],
        }),
        plantedAt: n('New position, 0-100.'),
        locationLabel: s('New reference label.'),
        tags: arr('Replacement tag list.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_payoff',
    description:
      'Record where a seed finally landed. Adding one flips the seed from orphaned to paid. `strength` is 1 to 5: how satisfying the payoff actually is, not how important the seed was.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        seedId: s('Seed being paid off.'),
        title: s('What happens when it lands.'),
        description: s('Detail. Plain text.'),
        paidAt: n('Percentage through the story, 0-100.'),
        strength: n('1 to 5. Default 3.'),
        locationLabel: s('Chapter or scene name.'),
        linkedWritingId: s('Manuscript piece where it lands.'),
        linkedSceneId: s('Dialog scene where it lands.'),
      },
      required: ['seedId', 'title'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Biography — a documented life, fact by sourced fact
// ---------------------------------------------------------------------------

const BIO_CATEGORIES = [
  'birth', 'death', 'education', 'career', 'relationship', 'achievement',
  'conflict', 'travel', 'health', 'personal', 'political', 'creative', 'custom',
];
const CONFIDENCE = ['confirmed', 'likely', 'uncertain', 'disputed'];

export const BIOGRAPHY_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_biographies',
    description:
      'List the biographies in the project. A biography is a subject plus a stack of dated, sourced facts — the app\'s tool for real or fictional lives, used by journalists and biographers as much as novelists.',
    writes: false,
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_get_biography',
    description:
      'Read one biography with its facts in order: date, category, confidence and sources for each. Facts come back as Markdown.',
    writes: false,
    schema: {
      type: 'object',
      properties: { id: s('Biography id.') },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_biography',
    description: 'Start a biography for a subject. Link it to a codex entry when the subject already has one.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        subjectName: s('Who the biography is about.'),
        subjectId: s('Codex entry id of the subject, when one exists.'),
      },
      required: ['subjectName'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_biography_fact',
    description:
      'Add one fact to a biography. Be honest with `confidence`: "confirmed" means a source actually establishes it, "disputed" means sources disagree. Guessing here quietly turns research into fiction.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        biographyId: s('Biography the fact belongs to.'),
        title: s('The fact, in a line.'),
        content: s(`The fact in full. ${MARKDOWN_NOTE}`),
        date: s('When it happened. Free text or ISO date; sorted as text.'),
        endDate: s('End of a period, same format.'),
        category: s('Default "custom".', { enum: BIO_CATEGORIES }),
        confidence: s('Default "likely".', { enum: CONFIDENCE }),
        sourceDescription: s('Where this came from, in words.'),
        sourceUrl: s('URL of the source, when there is one.'),
        tags: arr('Freeform tags.'),
      },
      required: ['biographyId', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_biography_fact',
    description: 'Change a biography fact — most often to raise or lower its confidence once a source turns up.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Fact id.'),
        title: s('New title.'),
        content: s(`New body. ${MARKDOWN_NOTE}`),
        date: s('New date.'),
        endDate: s('New end date.'),
        category: s('New category.', { enum: BIO_CATEGORIES }),
        confidence: s('New confidence.', { enum: CONFIDENCE }),
        tags: arr('Replacement tag list.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Board — the detective corkboard: nodes, edges, layers
// ---------------------------------------------------------------------------

const NODE_KINDS = ['card', 'postit', 'text', 'image', 'shape', 'frame', 'entity'];
const EDGE_KINDS = [
  'conflict', 'alliance', 'romance', 'family', 'mystery', 'betrayal', 'causes',
  'blocks', 'enables', 'precedes', 'contains', 'mirrors', 'foreshadows', 'related',
];

export const BOARD_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_boards',
    description:
      'List the project\'s boards. A board is the corkboard-and-string surface: cards and post-its pinned on a canvas with labelled threads between them. Good for investigations, plot webs and anything where the connections matter more than the order.',
    writes: false,
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_board',
    description:
      'Start a corkboard: a free canvas of cards and the threads between them. Use it to lay out suspects, factions, clues or the shape of an argument — anything better seen than listed.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        title: s('What this board is called.'),
        surface: s('Canvas backdrop. Default "cork".', {
          enum: ['cork', 'slate', 'grid', 'blueprint'],
        }),
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_get_board',
    description:
      'Read a board: every card with its role, text and tags, and every thread between them with its kind and label. Card images are reported as present but not included — use wh_view_board_image to look at one.',
    writes: false,
    schema: {
      type: 'object',
      properties: { id: s('Board id.') },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_board_card',
    description:
      'Pin a new card on a board. `role` is what it means — character, event, place, clue, question, theme — and is free text. Give a position when it should sit somewhere specific; otherwise it is placed clear of what is already there.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        boardId: s('Board to pin it on.'),
        title: s('Card title.'),
        content: s('Body text. Plain text.'),
        role: s('What the card means: character, event, place, clue, question, theme…'),
        kind: s('How it looks. Default "card".', { enum: NODE_KINDS }),
        color: s('Colour as #rrggbb.'),
        tags: arr('Freeform tags.'),
        x: n('Horizontal position on the canvas.'),
        y: n('Vertical position on the canvas.'),
      },
      required: ['boardId', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_board_card',
    description: 'Change a card on a board. Only the fields you pass are touched.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Card id.'),
        title: s('New title.'),
        content: s('New body text.'),
        role: s('New role.'),
        color: s('New colour.'),
        tags: arr('Replacement tag list.'),
        x: n('New horizontal position.'),
        y: n('New vertical position.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_connect_board_cards',
    description:
      'Run a thread between two cards. `kind` carries the meaning — causes, blocks, betrayal, foreshadows — and `certainty` (0 to 1) is how sure the writer is, which the board draws as a solid or faded line.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        sourceId: s('Card the thread starts from.'),
        targetId: s('Card it runs to.'),
        // Not an `enum`: the board deliberately accepts a writer's own kind
        // and colours anything it does not recognise grey. Declaring a closed
        // set would have a strict client reject values the app supports.
        kind: s(
          `Meaning of the connection. Default "related". The board knows ${EDGE_KINDS.join(', ')} and draws them in their own colours; any other word is accepted and drawn grey.`,
        ),
        label: s('Text on the thread.'),
        notes: s('Longer reasoning. Plain text.'),
        certainty: n('0 to 1. Default 1.'),
        color: s('Colour as #rrggbb.'),
      },
      required: ['sourceId', 'targetId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_view_board_image',
    description: 'Look at the picture pinned on one board card, downscaled for viewing.',
    writes: false,
    schema: {
      type: 'object',
      properties: { id: s('Card id.') },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Gallery — reference images, and the second half of the vision loop
// ---------------------------------------------------------------------------

export const GALLERY_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_images',
    description:
      'List the project\'s reference images with their tags, notes, collection and which codex entries they are linked to. The pictures themselves are not included — look at one with wh_view_image.',
    writes: false,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        tag: s('Only images carrying this tag.'),
        untaggedOnly: b('Only images with no tags yet — the ones worth describing.'),
        limit: n('Maximum images. Default 50, maximum 200.'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_view_image',
    description:
      'Look at one reference image. Returns the picture itself so a vision-capable model can describe it, then write that description back with wh_tag_image.',
    writes: false,
    schema: {
      type: 'object',
      properties: { id: s('Image id.') },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_tag_image',
    description:
      'Write tags and notes onto a reference image. Describe what is in the frame — subject, setting, light, mood, technique — so the writer can find it again by what it shows rather than by remembering it exists.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Image id.'),
        tags: arr('Replacement tag list.'),
        addTags: arr('Tags to add to the existing ones.'),
        notes: s('Notes about the image. Plain text.'),
        linkedEntryIds: arr('Codex entry ids this image belongs to.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Maps — a drawn world with pins on it
// ---------------------------------------------------------------------------

const PIN_ICONS = [
  'city', 'mountain', 'forest', 'castle', 'port',
  'ruins', 'temple', 'village', 'cave', 'custom',
];

export const MAP_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_maps',
    description:
      'List the project\'s maps with every pin on them: name, icon, description and any codex entry the pin points at. Pin coordinates are relative to the map image, 0 to 100 on each axis.',
    writes: false,
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_map_pin',
    description:
      'Drop a pin on a map. Coordinates are percentages of the image, so x:50 y:50 is dead centre. Link it to a codex entry when the place already has one.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        mapId: s('Map to pin.'),
        name: s('Name of the place.'),
        description: s('What it is. Plain text.'),
        icon: s('Default "city".', { enum: PIN_ICONS }),
        x: n('Horizontal position, 0-100.'),
        y: n('Vertical position, 0-100.'),
        color: s('Colour as #rrggbb.'),
        linkedEntryId: s('Codex entry id for this place.'),
      },
      required: ['mapId', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_map_pin',
    description: 'Change a pin: rename it, move it, or point it at a codex entry.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Pin id.'),
        name: s('New name.'),
        description: s('New description.'),
        icon: s('New icon.', { enum: PIN_ICONS }),
        x: n('New horizontal position, 0-100.'),
        y: n('New vertical position, 0-100.'),
        linkedEntryId: s('New linked codex entry.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// World generator — procedural planets, their places, and the reader's edits
// ---------------------------------------------------------------------------
//
// A world is seed + parameters + an ordered edit list; terrain and places are
// regenerated on demand. Places are addressed by a stable key (`kind:x,y`),
// never by a row id, and every edit tool appends to the list the app's own
// paint tools write to — undoable, and visible in an open view at once.
//
// Order matters here more than elsewhere: this family is larger than the
// copilot's per-turn tool cap (aiRuntime/toolSelection.ts fills an engine in
// manifest order), so the everyday tools come first and the detail view, the
// links and the long gazetteer come last.

const WORLD_ID = s('World id, from wh_list_worlds.');
const PLACE_KEY = s(
  'Place key exactly as wh_list_places, wh_find_place or wh_place_at returned it, e.g. "settlement:512,201" or "landmark:volcano:12,6".',
);
const CELL_X = n('World cell column: 0 (west) to width-1 (east). Fractions are rounded.');
const CELL_Y = n('World cell row: 0 (north) to height-1 (south). Fractions are rounded.');
const PLACE_KINDS = ['settlement', 'ruin', 'realm', 'feature', 'landmark', 'region'];
const RUIN_KINDS = ['city', 'fort', 'tower', 'temple', 'stones', 'bridge', 'mine', 'wall'];
const LANDMARK_TYPES = ['volcano', 'cave', 'waterfall', 'gorge', 'hotspring'];
const PENDING_NOTE =
  'A world never opened on this machine answers { pending: true, code: "generating" } once while it is forged in the background: wait about 30 seconds and call again.';

export const WORLDGEN_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_worlds',
    description:
      'List the project\'s generated worlds: id, title, seed, grid size, how many edits of each kind the reader has made (renames, placed markers, labels, removals, moves, roads), saved regional views and waypoint count. Start here to get a worldId; nothing else in this engine works without one.',
    writes: false,
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_list_places',
    description:
      `The named places of a world, most important first: settlements (capital, city, town, village), ruins, realms (countries), named features (seas, ranges, rivers) and landmarks. Each carries its stable key — the handle every other place tool takes — its cell coordinates x,y and normalised u,v in 0..1, its importance and whether the generator or the reader made it. Scope "places" is cheaper and skips realms, features and roads. ${PENDING_NOTE}`,
    writes: false,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        kind: s('Only places of this kind.', { enum: PLACE_KINDS }),
        scope: s('"full" (default) or "places", which skips realms and named features.', { enum: ['places', 'full'] }),
        limit: n('Maximum places. Default 200, maximum 1000.'),
      },
      required: ['worldId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_find_place',
    description:
      `Find places by name, accent- and case-insensitively, best match first: a name that starts with the query beats one that contains it, and "Río" alone lists the great river before the brook. Returns the same shape as wh_list_places, key included. ${PENDING_NOTE}`,
    writes: false,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        query: s('Name or part of a name.'),
        limit: n('Maximum matches. Default 10, maximum 100.'),
      },
      required: ['worldId', 'query'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_place_at',
    description:
      `What is at a cell: the elevation in km (negative is sea floor), whether it is sea, and the most important place within reach, if any — a click between a capital and a hamlet resolves to the capital. Use it to check ground before placing a settlement. ${PENDING_NOTE}`,
    writes: false,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        x: CELL_X,
        y: CELL_Y,
        maxCells: n('How far to look for a place, in cells. Default 8.'),
      },
      required: ['worldId', 'x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_place',
    description:
      'Place a settlement, a ruin or a landmark on a world at a cell. Settlements need land — the tool refuses a sea cell when the world is in memory, and the engine silently ignores one when it is not, so check with wh_place_at first. A settlement without a rank is a town; a ruin without a kind is a ruined city; a landmark needs its type. Omit the name and the engine coins one in the local language. Returns the new place\'s key. Appended to the world\'s edit list, so the writer can undo it.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        marker: s('What to place.', { enum: ['settlement', 'ruin', 'landmark'] }),
        x: CELL_X,
        y: CELL_Y,
        name: s('Name. Omit to let the engine coin one.'),
        rank: s('Settlements only. Default "town".', { enum: ['capital', 'city', 'town', 'village'] }),
        population: n('Settlements only. Default follows the rank.'),
        ruin: s('Ruins only. Default "city".', { enum: RUIN_KINDS }),
        landmark: s('Landmarks only. Required for marker "landmark".', { enum: LANDMARK_TYPES }),
      },
      required: ['worldId', 'marker', 'x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_rename_place',
    description:
      'Rename a place by its key: a town, a ruin, a realm, a sea, a range or a landmark, whether the generator or the reader made it. The key never changes, so a renamed place keeps its manuscript links. Undoable.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        key: PLACE_KEY,
        name: s('The new name.'),
      },
      required: ['worldId', 'key', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_move_place',
    description:
      'Move a place to another cell without changing its key, so its links and its name survive. Roads re-route to a moved settlement the next time the world\'s full geography is built. Undoable.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        key: PLACE_KEY,
        x: CELL_X,
        y: CELL_Y,
      },
      required: ['worldId', 'key', 'x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_remove_place',
    description:
      'Hide a place from the world: a town that should not exist, a ruin, a named sea, a landmark. Not a deletion — it appends a `remove` edit that wh_restore_place (or the writer\'s undo) reverses, and the place\'s key stays valid for exactly that purpose.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        key: PLACE_KEY,
      },
      required: ['worldId', 'key'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_restore_place',
    description:
      'Bring back a place that wh_remove_place (or the reader\'s eraser) hid, by the same key. A place that was never removed is unaffected.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        key: PLACE_KEY,
      },
      required: ['worldId', 'key'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_label',
    description:
      'Write a free-standing label on the map at a cell — the name of a region, a body of water or a range, a caption under a town, or a note. It names nothing in the atlas; use wh_rename_place to rename an actual place. Undoable.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        x: CELL_X,
        y: CELL_Y,
        text: s('What the label says.'),
        style: s('Type style. Default "note".', { enum: ['region', 'water', 'range', 'settlement', 'note'] }),
      },
      required: ['worldId', 'x', 'y', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_list_waypoints',
    description:
      'The reader\'s waypoints on a world: named pins with a note and a colour, positioned by normalised u (0 west to 1 east, wrapping) and v (0 north to 1 south). Waypoints are the reader\'s own bookmarks, separate from the generated places.',
    writes: false,
    schema: {
      type: 'object',
      properties: { worldId: WORLD_ID },
      required: ['worldId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_waypoint',
    description:
      'Drop a waypoint on a world at a normalised position: u 0..1 west to east (wraps), v 0..1 north to south. To pin a generated place, take its u,v from wh_list_places. The colour cycles through the app\'s palette when omitted.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        name: s('Name of the waypoint.'),
        u: n('Horizontal position, 0..1 west to east.'),
        v: n('Vertical position, 0..1 north to south.'),
        description: s('A note about the place. Plain text.'),
        color: s('Colour as #rrggbb.'),
      },
      required: ['worldId', 'name', 'u', 'v'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_waypoint',
    description: 'Change a waypoint: rename it, move it, recolour it or rewrite its note. Only the fields you pass are touched.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Waypoint id.'),
        name: s('New name.'),
        description: s('New note.'),
        color: s('New colour as #rrggbb.'),
        u: n('New horizontal position, 0..1.'),
        v: n('New vertical position, 0..1.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_get_world',
    description:
      'One world in detail: the same digest as wh_list_worlds plus its full generation parameters, its waypoints, whether a view currently has it open (`live`) and whether it is being forged right now (`forging`, in which case place reads will answer pending until it finishes).',
    writes: false,
    schema: {
      type: 'object',
      properties: { worldId: WORLD_ID },
      required: ['worldId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_link_place',
    description:
      'Connect a place on the map to the manuscript: a codex entry that represents it (a location sheet), or a dialog scene, a manuscript piece or a timeline event that takes place there. This is what makes the map a navigation surface for the book — hover the town and see its scenes. Linking the same pair twice returns the existing link. The target must belong to the world\'s project.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        key: PLACE_KEY,
        targetType: s('What the place is linked to.', { enum: ['codex-entry', 'scene', 'writing', 'timeline-event'] }),
        targetId: s('Id of the codex entry, scene, writing or timeline event.'),
      },
      required: ['worldId', 'key', 'targetType', 'targetId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_list_place_links',
    description:
      'The manuscript links hanging on a world\'s places: which codex entries, scenes, writings and timeline events point at which place key. Pass a key to read one place; omit it for the whole world.',
    writes: false,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        key: s('Only links on this place. Omit for every place in the world.'),
      },
      required: ['worldId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_world_summary',
    description:
      `The world's gazetteer as Markdown: an overview of the planet, its languages, realms, geography, ruins and coasts, and story hooks read off the map — everything in it is derived from the generated world, nothing is invented. Written in Spanish, the engine's language. Long; read it once, then use wh_find_place for specifics. ${PENDING_NOTE}`,
    writes: false,
    schema: {
      type: 'object',
      properties: { worldId: WORLD_ID },
      required: ['worldId'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Real atlas — the story's real-world setting, and where it departs from it
// ---------------------------------------------------------------------------
//
// The counterpart of worldgen: nothing is derived. A place is an authoritative
// row the writer has checked (a name, WGS84 coordinates or an address, the
// facts verified there), and a divergence records one deliberate departure
// from reality. Everyday tools first, the report last: the copilot fills an
// engine in manifest order when a turn's cap is tight.

const ATLAS_PLACE_KINDS = [
  'country', 'region', 'city', 'town', 'village', 'district',
  'street', 'building', 'landmark', 'natural', 'route', 'other',
];
const DIVERGENCE_CATEGORIES = [
  'geography', 'history', 'politics', 'technology', 'culture', 'people', 'other',
];
const LAT = n('Latitude in WGS84 decimal degrees, -90 (south) to 90 (north).');
const LON = n('Longitude in WGS84 decimal degrees, -180 (west) to 180 (east).');
const DIVERGENCE_NOTE =
  'A divergence records a DELIBERATE departure from reality — `reality` is what is actually the case, `fiction` what the book says instead, `reason` why the writer changed it — anchored to a place with `placeId` when the change is local, free-standing (no placeId) when it is global, like a war ending in a different year.';

export const REAL_ATLAS_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_atlas_places',
    description:
      'List the real-world places the book uses, alphabetically: name, kind, aliases, country, WGS84 coordinates when known, era, whether the place is invented (`fictional`), the place that contains it (`parentId`) and how many divergences are anchored to it. This engine is the story\'s REAL setting — Lisbon, 1936 Madrid, a street in Paris — kept as rows the writer has checked, unlike the generated planets of the world generator. Pass `query` to search names and aliases accent- and case-insensitively, best match first. Descriptions, checked facts and sources are not included: read one place with wh_get_atlas_place.',
    writes: false,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        kind: s('Only places of this kind.', { enum: ATLAS_PLACE_KINDS }),
        query: s('Name or alias, or part of one. Accents and case do not matter.'),
        limit: n('Maximum places. Default 100, maximum 500.'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_get_atlas_place',
    description:
      'Read one place in full: `description` (how the story uses it), `realNotes` (what is actually true there, as checked by the writer), `sources`, address, coordinates, era and tags, plus its parent place, the places it contains and the divergences anchored to it. Read this before writing about a place, and treat realNotes as the verified facts and description as the book\'s use of them.',
    writes: false,
    schema: {
      type: 'object',
      properties: { id: s('Place id, from wh_list_atlas_places or wh_search.') },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_atlas_place',
    description:
      'Add a real-world place the book uses. Coordinates are WGS84 decimal degrees, both or neither — a street or a bar may only have an address. Set `fictional: true` for a place the writer invented and set inside the real world (Macondo, Vetusta, a bar that never existed on a real street); a real place\'s `realNotes` should hold only facts that have been checked, with `sources` saying where they came from, and `description` what the story makes of it. Use `parentId` to nest a building in its city or a district in its town; the parent must be a place of the same project. Check wh_list_atlas_places first: the place may already exist under an alias.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        name: s('Name of the place as the book uses it.'),
        kind: s('Default "city".', { enum: ATLAS_PLACE_KINDS }),
        aliases: arr('Other names: historical, local-language, the book\'s own.'),
        country: s('Country, free text.'),
        address: s('Street address, when a point on a map is not enough.'),
        lat: LAT,
        lon: LON,
        parentId: s('Id of the place that contains this one.'),
        era: s('When the place matters to the book: "1936", "summer of 1898", "today".'),
        description: s('How the story uses the place: scenes, mood, what the reader should feel. Plain text.'),
        realNotes: s('What is actually true there, checked: distances, opening hours, what stood where. Plain text.'),
        sources: arr('Where the facts came from: URLs, books, a visit.'),
        fictional: b('True for a place the writer invented inside the real world. Default false.'),
        tags: arr('Freeform tags.'),
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_atlas_place',
    description:
      'Change a place. Only the fields you pass are touched. An empty string clears country, address, era or parentId; `clearCoordinates: true` removes both coordinates, and passing only one of lat/lon keeps the other as it is. Undoable from the app\'s audit log.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Place id.'),
        name: s('New name.'),
        kind: s('New kind.', { enum: ATLAS_PLACE_KINDS }),
        aliases: arr('Replacement alias list.'),
        country: s('New country. "" clears it.'),
        address: s('New address. "" clears it.'),
        lat: LAT,
        lon: LON,
        clearCoordinates: b('Remove both coordinates.'),
        parentId: s('New containing place. "" lifts it to the top level.'),
        era: s('New era. "" clears it.'),
        description: s('New description.'),
        realNotes: s('New checked facts.'),
        sources: arr('Replacement source list.'),
        fictional: b('Whether the place is invented.'),
        tags: arr('Replacement tag list.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_list_divergences',
    description:
      `List the book's deliberate departures from reality, most recently changed first: title, category, the place each is anchored to (none means a global change), from when it applies (\`since\`), and its reality, fiction and reason cut at 300 characters — wh_get_divergence has them in full. Pass \`placeId\` for one place's divergences or \`category\` to filter. ${DIVERGENCE_NOTE} It is a fact about the book, not a mistake.`,
    writes: false,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        placeId: s('Only divergences anchored to this place.'),
        category: s('Only divergences of this category.', { enum: DIVERGENCE_CATEGORIES }),
        limit: n('Maximum divergences. Default 100, maximum 500.'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_get_divergence',
    description:
      'Read one divergence in full: reality (what is actually the case), fiction (what the book says instead), reason (why the writer changed it), since, category, tags and the name of the place it is anchored to, if any.',
    writes: false,
    schema: {
      type: 'object',
      properties: { id: s('Divergence id, from wh_list_divergences or wh_search.') },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_divergence',
    description:
      `Record where the book departs from reality on purpose. ${DIVERGENCE_NOTE} Do not file an error the writer has not chosen: raise a suspected mistake with wh_annotate instead, and record it here only once they decide to keep it.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        title: s('The change in a few words, e.g. "The bridge already stands in 1890".'),
        category: s('Default "other".', { enum: DIVERGENCE_CATEGORIES }),
        placeId: s('Place the change is about. Omit for a global change.'),
        reality: s('What is actually the case. Plain text.'),
        fiction: s('What the book says instead. Plain text.'),
        reason: s('Why the writer changed it: dramatic need, simplification, alternate history…'),
        since: s('From when the change applies in the story\'s chronology, free text.'),
        tags: arr('Freeform tags.'),
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_divergence',
    description:
      'Change a divergence. Only the fields you pass are touched; `placeId: ""` unanchors it (the change becomes global) and an empty `since` clears it. Undoable from the app\'s audit log.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Divergence id.'),
        title: s('New title.'),
        category: s('New category.', { enum: DIVERGENCE_CATEGORIES }),
        placeId: s('New place. "" makes the change global.'),
        reality: s('New reality text.'),
        fiction: s('New fiction text.'),
        reason: s('New reason.'),
        since: s('New since. "" clears it.'),
        tags: arr('Replacement tag list.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_reality_check',
    description:
      'A read-only report on the real setting: how many places have coordinates, which real (non-fictional) places have nothing verified yet in realNotes, which places are invented, divergences per category, and divergences missing their reality or fiction text — as counts, id lists and a short Markdown summary. Run it before telling the writer their setting is consistent or well researched, and to answer "what have I not checked yet". Nothing is written.',
    writes: false,
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Storyboard — panels in sequence
// ---------------------------------------------------------------------------

export const STORYBOARD_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_storyboards',
    description:
      'List the project\'s storyboards with their panels in order: caption, description, duration and which dialog scene each panel belongs to. Panel images are reported as present but not included.',
    writes: false,
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_storyboard',
    description:
      'Start a storyboard: a grid of panels that reads left to right, one shot or beat per panel. Use it to plan how something will be seen rather than how it will be worded.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        title: s('What this storyboard is called.'),
        columns: n('Panels per row, 1-8. Default 3.'),
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_storyboard_panel',
    description: 'Add a panel to a storyboard. Appended last unless you pass an order.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        storyboardId: s('Storyboard the panel belongs to.'),
        subtitle: s('Caption under the panel — the panel\'s title, in effect.'),
        description: s('What the shot shows. Plain text.'),
        duration: s('Timing, free text, e.g. "00:15-00:23".'),
        linkedSceneId: s('Dialog scene this panel illustrates.'),
        order: n('Position within the storyboard.'),
        tags: arr('Freeform tags.'),
      },
      required: ['storyboardId', 'subtitle'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_storyboard_panel',
    description: 'Change a storyboard panel. Only the fields you pass are touched.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Panel id.'),
        subtitle: s('New caption.'),
        description: s('New description.'),
        duration: s('New timing.'),
        linkedSceneId: s('New linked scene.'),
        order: n('New position.'),
        tags: arr('Replacement tag list.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Video planner — segments of script against their visuals
// ---------------------------------------------------------------------------

const VISUAL_TYPES = ['camera', 'broll', 'screen-capture', 'graphic', 'text-overlay', 'custom'];

export const VIDEO_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_video_plans',
    description:
      'List the project\'s video plans with their segments in order: spoken script, timing, speaker and what is on screen. This is the engine for YouTube scripts, podcasts and anything shot to a plan.',
    writes: false,
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_video_plan',
    description:
      'Start a video plan: an ordered script of segments, each with its narration, on-screen visual and timing. Built for talks, essays and anything written to be spoken over pictures.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        title: s('What this plan is called.'),
        totalDuration: s('Target length, free text, e.g. "8 min". Never parsed.'),
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_video_segment',
    description:
      'Add a segment to a video plan: what is said, and what is on screen while it is said. Times are free text, so "0:45" and "00:45" are both fine as long as you stay consistent within a plan.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        videoPlanId: s('Plan the segment belongs to.'),
        title: s('Name of the segment.'),
        script: s('What is spoken. Plain text — this is teleprompter copy.'),
        visualType: s('What is on screen. Default "camera".', { enum: VISUAL_TYPES }),
        visualDescription: s('What the viewer sees.'),
        speakerName: s('Who says it.'),
        startTime: s('Start, free text.'),
        endTime: s('End, free text.'),
        audioNotes: s('Music, effects, silence.'),
        notes: s('Anything else.'),
        order: n('Position within the plan.'),
        tags: arr('Freeform tags.'),
      },
      required: ['videoPlanId', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_video_segment',
    description: 'Change a video segment. Only the fields you pass are touched.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        id: s('Segment id.'),
        title: s('New title.'),
        script: s('New spoken text.'),
        visualType: s('New visual type.', { enum: VISUAL_TYPES }),
        visualDescription: s('New description of what is on screen.'),
        speakerName: s('New speaker.'),
        startTime: s('New start.'),
        endTime: s('New end.'),
        audioNotes: s('New audio notes.'),
        notes: s('New notes.'),
        order: n('New position.'),
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Annotations — margin notes anchored to a phrase in any engine
// ---------------------------------------------------------------------------

export const ANNOTATION_TOOLS: BridgeTool[] = [
  {
    name: 'wh_list_annotations',
    description:
      'List the margin notes in a project: what they say, what they are attached to, and whether the text they were anchored to has since moved away (orphaned). Pass engineId AND entityId to read the notes on one chapter or one codex entry — that form also re-checks every anchor against the text as it stands right now, which is what you want after editing it. Without them the orphan flags are only as fresh as the last time each entity was opened, and `orphanStatus` in the result says which of the two you got.',
    writes: false,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        engineId: s('Engine of the annotated entity, e.g. "writings", "codex", "seeds".'),
        entityId: s('The annotated entity. Requires engineId.'),
        orphanedOnly: b('Only notes whose anchor text has gone.'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_annotate',
    description:
      'Leave a margin note on something. Pass `quote` with the exact phrase you are commenting on and the note anchors to that spot in the text; omit it and the note attaches to the entity as a whole. Text anchoring works on manuscript pieces, codex entries and seeds. Use this to raise a question or flag an inconsistency instead of silently rewriting the writer\'s prose.',
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        engineId: s('Engine of the thing you are annotating: "writings", "codex", "seeds"…'),
        entityId: s('Id of the thing you are annotating.'),
        note: s('What you want to say. Plain text or Markdown.'),
        quote: s('Exact phrase from the entity to anchor to. Must match the text as written.'),
      },
      required: ['engineId', 'entityId', 'note'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Analysis — derived reports, nothing to write
// ---------------------------------------------------------------------------

export const STATS_TOOLS: BridgeTool[] = [
  {
    name: 'wh_pov_audit',
    description:
      'Who actually appears in the scenes, and who does not. Counts scenes, lines and words per character across every dialog scene, then flags two things worth knowing: characters in the codex who never appear anywhere, and speakers on the page who have no codex entry. The fastest way to spot a cast member you invented and forgot.',
    writes: false,
    engineId: 'pov-audit',
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_writing_stats',
    description:
      'The writer\'s own output: words today, current streak, daily average, the last seven days, and any active word-count goals. Read only, deliberately — the app writes these sessions itself as the writer types, and an outside write would corrupt the streak.',
    writes: false,
    engineId: 'writing-stats',
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Image studio — pictures made on demand, kept in Gallery
// ---------------------------------------------------------------------------

export const IMAGE_STUDIO_TOOLS: BridgeTool[] = [
  {
    name: 'wh_generate_image',
    description:
      'Generate one to four reference images from a text prompt using the image model configured in AI settings (a local diffusion server or a remote API), and save them into the project\'s Gallery tagged "generated" with their prompt and seed. Returns the new image ids and shows you a small preview of the first one. Costs time — and money if the configured model is a paid API — so confirm with the user before generating batches. Fails with a clear message when no image model is configured.',
    writes: true,
    timeoutMs: 600_000,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        prompt: s('What to draw, in the language the model works best in (usually English), with style, subject, setting and mood.'),
        negativePrompt: s('What to avoid. Only honoured by servers that support it.'),
        size: s('Aspect preset. Default "square" (1024×1024).', {
          enum: ['square', 'landscape', 'portrait', 'wide', 'tall', 'cover', 'banner', 'small'],
        }),
        count: n('How many variants, 1-4. Default 1.'),
        seed: n('Seed for reproducible results, when the server supports it.'),
        quality: s('"low", "medium" or "high" — servers that understand it trade time for detail.', { enum: ['low', 'medium', 'high'] }),
        collectionId: s('Gallery collection to file the images under (from wh_list_images). Optional.'),
        tags: arr('Extra tags besides "generated".'),
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
];
