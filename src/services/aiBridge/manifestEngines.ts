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
