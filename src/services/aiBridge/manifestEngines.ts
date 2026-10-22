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
  { name: 'wh_append_conversation_turn', writes: true, description: 'Append a dialogue turn or scene action using a stable speaker identity. Reads current order atomically; preserves the Codex character link. Use speaker cast:<sceneCastId>, entry:<CodexCharacterId>, or omit it for scene action.', schema: { type: 'object', properties: { sceneId: s('Target scene ID.'), speaker: s('cast:<sceneCastId> or entry:<CodexCharacterId>; empty or omitted means scene action.'), content: s('Authored turn text, including optional line breaks.') }, required: ['sceneId', 'content'], additionalProperties: false } },
  {
    name: 'wh_list_scenes',
    description:
      `List a project's dialog scenes in order, with setting, number, cast and block count.
List the project's dialog scenes in order, with their setting, scene number, cast and how many blocks each holds. This engine is the screenplay/stage side of the app: scenes made of speech and action blocks, exportable to Fountain.`,
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
      `Read one scene as a script: every block, speaker and parenthetical, plus the cast.
Read one scene as a script: every block in order with its speaker, parenthetical and text, plus the scene's cast list. Read this before adding to a scene so the voices already on the page are the ones you continue.`,
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
      `Add a scene to the project, appended last, with a screenplay-style setting heading.
Add a scene to the project. It is appended last. Give it a setting like "INT. KITCHEN - NIGHT" when the project is a screenplay; the Fountain export uses the setting as the scene heading and falls back to the title.`,
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
      `Append a block to a scene: dialogue, action, direction, transition or slugline.
Append one block to a scene: a line of dialogue, an action beat, a stage direction, a transition, a slugline or a note. For dialogue pass the speaker in \`character\`; if that name is already in the scene cast the block inherits its colour, and if it matches a codex character it is linked to that entry. A parenthetical is written WITHOUT its brackets.`,
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
      `List a project's character arcs with their ghost, lie, truth, want and need.
List the project's character arcs with their ghost, lie, truth, want and need. An arc is one character's inner journey: the wound they carry, the false belief it left them with, and the truth that would free them.`,
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
      `Read one character arc in full, with its beats and inner-journey progress.
Read one arc in full with its beats in order: each beat's stage, emotion and position in the story. This is the fastest way to see whether a character actually changes or just moves.`,
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
      `Create a character arc from its five spine fields: ghost, lie, truth, want, need.
Create a character arc. The five spine fields matter more than the title: ghost (the old wound), lie (what they wrongly believe because of it), truth (what would free them), want (what they chase) and need (what would actually heal them). Leave any you do not know yet empty rather than inventing it.`,
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
      `Add a beat to an arc marking a shift in the character's inner state.
Add a beat to an arc: one moment where the character's inner state shifts. Appended last unless you pass an order.`,
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
      `List relationship bonds between characters, with kind, strength and directionality.
List who is what to whom, with the kind of bond, how strong it is (-5 hostile to +5 devoted), whether it is current, past or secret, and whether it runs both ways. Pass entityId to get every relationship touching one character — they are stored on either side, so this checks both.`,
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
      `Record a relationship between two codex entries, with an intensity from hostile to loyal.
Record a relationship between two codex entries. \`intensity\` runs from -5 (open hostility) through 0 (neutral) to +5 (deep loyalty or love). Leave \`directional\` false for a mutual bond; set it true when it only runs one way, like devotion that is not returned.`,
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
      `Change a relationship, most often its state as it becomes past or is revealed.
Change a relationship — most usefully its state, when something that was current becomes past, or a secret comes out.`,
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
      `List planted setups, foreshadowing and mysteries, each with its payoffs and status.
List everything the writer planted — foreshadowing, Chekhov's guns, setups, callbacks, open mysteries — each with its payoffs. The status is computed, not stored: a seed that has not been cut and has no payoff comes back "orphaned". Ask for orphanedOnly to answer the question this engine exists for: what did I promise the reader and never deliver?`,
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
      `Record something planted in the draft that must matter later in the story.
Record something planted in the draft that must matter later. \`plantedAt\` is a percentage through the story, not a date.`,
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
      `Change a seed; set status to cut once it was removed in revision.
Change a seed. Set status to "cut" when it was removed in revision — that is the only status worth writing, since the rest is derived from whether payoffs exist.`,
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
      `Record where a seed finally pays off, flipping it from orphaned to paid.
Record where a seed finally landed. Adding one flips the seed from orphaned to paid. \`strength\` is 1 to 5: how satisfying the payoff actually is, not how important the seed was.`,
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
      `List a project's biographies: a subject plus dated, sourced facts about their life.
List the biographies in the project. A biography is a subject plus a stack of dated, sourced facts — the app's tool for real or fictional lives, used by journalists and biographers as much as novelists.`,
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
      `Read one biography with its facts in order: date, category, confidence and sources.
Read one biography with its facts in order: date, category, confidence and sources for each. Facts come back as Markdown.`,
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
      `Add one fact to a biography with an honest confidence level.
Add one fact to a biography. Be honest with \`confidence\`: "confirmed" means a source actually establishes it, "disputed" means sources disagree. Guessing here quietly turns research into fiction.`,
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
      `List a project's corkboards: cards and threads pinned on a canvas.
List the project's boards. A board is the corkboard-and-string surface: cards and post-its pinned on a canvas with labelled threads between them. Good for investigations, plot webs and anything where the connections matter more than the order.`,
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
      `Start a corkboard for laying out suspects, factions, clues or an argument’s shape.
Start a corkboard: a free canvas of cards and the threads between them. Use it to lay out suspects, factions, clues or the shape of an argument — anything better seen than listed.`,
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
      `Read a board: every card and thread, with image presence flagged but not included.
Read a board: every card with its role, text and tags, and every thread between them with its kind and label. Card images are reported as present but not included — use wh_view_board_image to look at one.`,
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
      `Pin a new card on a board, with a free-text role and optional position.
Pin a new card on a board. \`role\` is what it means — character, event, place, clue, question, theme — and is free text. Give a position when it should sit somewhere specific; otherwise it is placed clear of what is already there.`,
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
      `Run a thread between two cards, with a kind and how certain the writer is.
Run a thread between two cards. \`kind\` carries the meaning — causes, blocks, betrayal, foreshadows — and \`certainty\` (0 to 1) is how sure the writer is, which the board draws as a solid or faded line.`,
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
      `List a project's reference images with tags, notes and linked codex entries.
List the project's reference images with their tags, notes, collection and which codex entries they are linked to. The pictures themselves are not included — look at one with wh_view_image.`,
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
      `Look at one reference image so a vision model can describe it and tag it.
Look at one reference image. Returns the picture itself so a vision-capable model can describe it, then write that description back with wh_tag_image.`,
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
      `Write tags and notes onto a reference image describing what is in the frame.
Write tags and notes onto a reference image. Describe what is in the frame — subject, setting, light, mood, technique — so the writer can find it again by what it shows rather than by remembering it exists.`,
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
    name: 'wh_list_map_versions', writes: false,
    description: 'List a map\'s eras (dated copies of its image, shapes, layers and pins) in the order a reader travels them: eras linked to timeline events first, in the timeline\'s chronology, then unlinked eras in the order they were saved. Each era gives its date label, the linked event, and whether that event was deleted.',
    schema: { type: 'object', properties: { mapId: s('Map id, from wh_list_maps.') }, required: ['mapId'], additionalProperties: false },
  },
  {
    name: 'wh_capture_map_version', writes: true,
    description: 'Save the map as it stands now as a new era (only saved content), optionally standing for a timeline event whose date then labels and orders it. Undo removes this era if it still exists.',
    schema: { type: 'object', properties: { mapId: s('Map id.'), name: s('Era name.'), date: s('Typed world date, used when no event is linked.'), description: s('Era notes.'), eventId: s('Timeline event id the era stands for (wh_list_events).') }, required: ['mapId', 'name'], additionalProperties: false },
  },
  {
    name: 'wh_link_map_version', writes: true,
    description: 'Link an existing map era to a timeline event, or pass eventId null to unlink it. Undo restores the previous link only while this one is still in place.',
    schema: { type: 'object', properties: { mapId: s('Map id.'), versionId: s('Era id, from wh_list_map_versions.'), eventId: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Timeline event id, or null to unlink.' } }, required: ['mapId', 'versionId', 'eventId'], additionalProperties: false },
  },
  {
    name: 'wh_list_maps',
    description:
      `List a project's maps with every pin: name, icon, description and codex link.
List the project's maps with every pin on them: name, icon, description and any codex entry the pin points at. Pin coordinates are relative to the map image, 0 to 100 on each axis.`,
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
      `Drop a pin on a map at percentage coordinates, optionally linked to a codex entry.
Drop a pin on a map. Coordinates are percentages of the image, so x:50 y:50 is dead centre. Link it to a codex entry when the place already has one.`,
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
        size: s('Marker size S, M (default) or L.', { enum: ['S', 'M', 'L'] }),
        hideIcon: { type: 'boolean', description: 'Show a plain dot without the icon.' },
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
        size: s('Marker size S, M or L.', { enum: ['S', 'M', 'L'] }),
        hideIcon: { type: 'boolean', description: 'Show a plain dot without the icon.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_list_map_features', writes: false,
    description: 'List the regions, routes and labels drawn on a classic map, in drawing order (order 0 is at the back), with points (0-100), colours, outline, pattern, lettering style and, for routes, pathStyle (road, trail or river) and linePattern (solid, dashed, dotted). When the map has a scale (wh_set_map_scale) each route also gives lengthKm and each region areaKm2, and the result gives widthKm.',
    schema: { type: 'object', properties: { mapId: s('Map id.'), aspect: n('Picture height divided by width; only used to measure when the map has no readable image.') }, required: ['mapId'], additionalProperties: false },
  },
  {
    name: 'wh_add_map_feature', writes: true,
    description: `Draw a region (3+ points), route (2+ points) or label (1 point) on a classic map, points in percent of the image (x:50 y:50 is the centre).
Optional: pathStyle for a route (road, trail or river; not for regions or labels), linePattern for a route (solid, dashed or dotted; thickness is strokeWidth), description, codex link, named layer, fill colour and opacity, outline colour and width, hatch pattern (stripes, stripes-v, stripes-d, dots, crosshatch) and its scale, and lettering (font serif/sans/mono/script, size in % of width, colour, outline and width, bold, italic, rotation). Undo removes it if the shapes have not changed since.`,
    schema: { type: 'object', properties: {
      mapId: s('Map id.'),
      kind: s('Shape kind.', { enum: ['region', 'path', 'label'] }),
      name: s('Name written on the map.'),
      description: s('Notes.'),
      points: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'object', properties: { x: n('0-100'), y: n('0-100') }, required: ['x', 'y'], additionalProperties: false } },
      linkedEntryId: s('Codex entry id.'),
      layerId: s('Named layer id.'),
      layerIds: { type: 'array', items: { type: 'string' }, description: 'Several named layers; the shape shows while any is visible.' },
      pathStyle: s('Routes only: how the line is drawn.', { enum: ['road', 'trail', 'river'] }),
      linePattern: s('Routes only: solid, dashed or dotted line (default: as the pathStyle draws it; a trail is dashed). Thickness is strokeWidth.', { enum: ['solid', 'dashed', 'dotted'] }),
      color: s('#rrggbb.'), opacity: n('Fill opacity 0-1.'),
      strokeColor: s('Outline #rrggbb.'), strokeWidth: n('Outline width 0.5-12 px.'),
      pattern: s('Hatch over the fill.', { enum: ['none', 'stripes', 'stripes-v', 'stripes-d', 'dots', 'crosshatch'] }), patternScale: n('Hatch spacing 0.5-4.'),
      labelStyle: { type: 'object', properties: { font: s('Font.', { enum: ['serif', 'sans', 'mono', 'script'] }), size: n('0.6-8, % of width.'), color: s('#rrggbb.'), outline: s('#rrggbb.'), outlineWidth: n('0-10 px.'), bold: { type: 'boolean' }, italic: { type: 'boolean' }, rotation: n('-180 to 180 degrees.') }, additionalProperties: false },
    }, required: ['mapId', 'kind', 'name', 'points'], additionalProperties: false },
  },
  {
    name: 'wh_update_map_feature', writes: true,
    description: 'Change a shape on a classic map: only the fields given (name, description, points, link, colours, outline, pattern ("none" removes it), lettering (null resets it), pathStyle of a route (road, trail, river; null removes it; refused on regions and labels), linePattern of a route (solid, dashed, dotted; null follows the style)); order front/forward/backward/back moves it in the drawing order. Undo puts the previous shapes back if they have not changed since.',
    schema: { type: 'object', properties: {
      mapId: s('Map id.'), id: s('Shape id from wh_list_map_features.'),
      name: s('Name.'), description: s('Notes.'),
      points: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'object', properties: { x: n('0-100'), y: n('0-100') }, required: ['x', 'y'], additionalProperties: false } },
      linkedEntryId: s('Codex entry id, or "" to unlink.'),
      layerId: s('Named layer id, or "" for none.'),
      layerIds: { type: 'array', items: { type: 'string' }, description: 'Named layers; the shape shows while any is visible.' },
      pathStyle: { anyOf: [{ type: 'string', enum: ['road', 'trail', 'river'] }, { type: 'null' }], description: 'Routes only: road, trail or river; null removes it.' },
      linePattern: { anyOf: [{ type: 'string', enum: ['solid', 'dashed', 'dotted'] }, { type: 'null' }], description: 'Routes only: solid, dashed or dotted; null goes back to the pathStyle\'s own.' },
      color: s('#rrggbb.'), opacity: n('Fill opacity 0-1.'),
      strokeColor: s('Outline #rrggbb.'), strokeWidth: n('Outline width 0.5-12 px.'),
      pattern: s('Hatch.', { enum: ['none', 'stripes', 'stripes-v', 'stripes-d', 'dots', 'crosshatch'] }), patternScale: n('Hatch spacing 0.5-4.'),
      labelStyle: { anyOf: [{ type: 'object', properties: { font: s('Font.', { enum: ['serif', 'sans', 'mono', 'script'] }), size: n('0.6-8.'), color: s('#rrggbb.'), outline: s('#rrggbb.'), outlineWidth: n('0-10.'), bold: { type: 'boolean' }, italic: { type: 'boolean' }, rotation: n('-180 to 180.') }, additionalProperties: false }, { type: 'null' }] },
      order: s('Drawing order move.', { enum: ['front', 'forward', 'backward', 'back'] }),
    }, required: ['mapId', 'id'], additionalProperties: false },
  },
  {
    name: 'wh_set_map_scale', writes: true,
    description: 'Give a classic map a scale: how many kilometres the picture spans from left to right. Pass exactly one of widthKm (0.01 to 40000), knownDistance ({from:{x,y}, to:{x,y}, km}: two points in percent of the picture that are km apart; needs the picture proportions, read from its image or given as aspect) or clear: true to remove the scale. Returns the widthKm saved. Undo restores the previous scale only while this one is still in place.',
    schema: { type: 'object', properties: {
      mapId: s('Map id.'),
      widthKm: n('Kilometres from the left edge to the right edge of the picture, 0.01 to 40000.'),
      knownDistance: { type: 'object', properties: { from: { type: 'object', properties: { x: n('0-100'), y: n('0-100') }, required: ['x', 'y'], additionalProperties: false }, to: { type: 'object', properties: { x: n('0-100'), y: n('0-100') }, required: ['x', 'y'], additionalProperties: false }, km: n('Real distance between the two points, in kilometres.') }, required: ['from', 'to', 'km'], additionalProperties: false },
      clear: { type: 'boolean', description: 'true removes the map\'s scale.' },
      aspect: n('Picture height divided by width; only used when the map has no readable image.'),
    }, required: ['mapId'], additionalProperties: false },
  },
  {
    name: 'wh_measure_map', writes: false,
    description: 'Measure on a classic map that has a scale: pass points (2+ positions in percent of the picture) for a line, or featureId of a route or region. Returns km along the points, the widthKm used and travel estimates (walk, horse, carriage, rail, car, plane) for the length; for a region also perimeterKm (closed outline, used for the travel estimates) and areaKm2. Fails when the map has no scale (set one with wh_set_map_scale).',
    schema: { type: 'object', properties: {
      mapId: s('Map id.'),
      points: { type: 'array', minItems: 2, maxItems: 500, items: { type: 'object', properties: { x: n('0-100'), y: n('0-100') }, required: ['x', 'y'], additionalProperties: false } },
      featureId: s('Route or region id from wh_list_map_features.'),
      aspect: n('Picture height divided by width; only used when the map has no readable image.'),
    }, required: ['mapId'], additionalProperties: false },
  },
  {
    name: 'wh_name_map_pins_from_key', writes: true,
    description: 'Name the pins of a classic map that are still called by a letter or number ("A", "b.", "(3)") from a pasted key: lines such as "A. The Old Mill", "B) Crossroads Inn", "3 - Watchtower" (separated by new lines, " / " or ";"). Returns matches ({pinId, key, from, to}) and unmatched key lines. With dryRun true nothing is renamed. Undo gives each pin its old name back where it still has the name this call gave it.',
    schema: { type: 'object', properties: {
      mapId: s('Map id.'),
      key: s('The pasted key, one entry per line.'),
      dryRun: { type: 'boolean', description: 'Only report the matches; rename nothing.' },
    }, required: ['mapId', 'key'], additionalProperties: false },
  },
  {
    name: 'wh_preview_map_ground', writes: false,
    description: 'Before replacing a classic map\'s image: compare a candidate image (galleryAssetId from wh_list_images, or imageDataUrl) with the current one. Returns both pixel sizes, whether they have the same shape (aspect ratios within 2%), and how many places, zones, paths and names move with the map. Nothing is changed.',
    schema: { type: 'object', properties: {
      mapId: s('Map id.'), galleryAssetId: s('Gallery image id to use as the new ground.'), imageDataUrl: s('A base64 data:image/... URL; use this or galleryAssetId, not both.'),
    }, required: ['mapId'], additionalProperties: false },
  },
  {
    name: 'wh_change_map_ground', writes: true,
    description: 'Replace a classic map\'s ground image with a gallery image (galleryAssetId) or a base64 data URL (imageDataUrl). Shapes and pins are percentages of the image, so a new image with another shape would stretch them: fit "keep" (default) keeps their proportions by placing the old drawing centred inside the new image, "stretch" leaves their coordinates as they are. The map is first saved as an era ("Before changing the ground image"). Undo restores the image, shapes, pins and removes that era, if none of them changed since.',
    schema: { type: 'object', properties: {
      mapId: s('Map id.'), galleryAssetId: s('Gallery image id to use as the new ground.'), imageDataUrl: s('A base64 data:image/... URL; use this or galleryAssetId, not both.'),
      fit: s('How shapes and pins fit a differently shaped image. Default keep.', { enum: ['keep', 'stretch'] }),
    }, required: ['mapId'], additionalProperties: false },
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
    name: 'wh_render_world_map', writes: false,
    description: `Render a generated world as a portable PNG using the same cartographic materials as the app. Styles: wonder (illustrated parchment), antique (engraving), relief (continuous painted terrain) and survey (night contour chart). Without theme it uses the world's saved look (wh_get_world_presentation), including its layers, relief density and play grid. readerView renders the reader's-eye map (blank paper where the story has not been, a wash over what is only heard of), optionally only up to readerChapter. Does not change the geography or saved world. ${PENDING_NOTE}`,
    schema: { type: 'object', properties: { worldId: WORLD_ID, theme: s('Cartographic style.', { enum: ['wonder', 'antique', 'relief', 'survey'] }), readerView: { type: 'boolean', description: "Render the reader's-eye map (fog painted with wh_paint_reader_fog)." }, readerChapter: { type: 'integer', minimum: 0, description: "Only the fog strokes revealed up to this chapter (implies readerView); story events that happened by then are marked." }, storyEvents: { type: 'boolean', description: 'Mark every story event (wh_list_story_events) on the map; the reader view marks only those known by its chapter.' }, width: n('PNG width in pixels, default 1600.'), height: n('PNG height in pixels; default preserves the view aspect ratio.'), view: { type: 'object', description: 'Optional source rectangle in world-grid cells, within the world dimensions from wh_get_world. Omit for the whole world.', properties: { x: n('Left cell.'), y: n('Top cell.'), w: n('Width in cells.'), h: n('Height in cells.') }, required: ['x', 'y', 'w', 'h'], additionalProperties: false } }, required: ['worldId'], additionalProperties: false },
  },
  {
    name: 'wh_get_world_presentation', writes: false,
    description: 'Read the saved look of a generated world: cartographic style (wonder, antique, relief, survey), which layers are drawn, relief density and 3D skin. Everyone who opens the world, and wh_render_world_map without an explicit theme, uses this look. Returns the saved fields, the effective values with defaults filled in, and the revision for compare-and-swap.',
    schema: { type: 'object', properties: { worldId: WORLD_ID }, required: ['worldId'], additionalProperties: false },
  },
  {
    name: 'wh_set_world_presentation', writes: true,
    description: 'Change the saved look of a generated world. Only the fields you pass change; layers merge key by key. Pass expectedRevision from wh_get_world_presentation to refuse the write if someone changed the look meanwhile. Undo reverts only the fields this call changed and still hold its value.',
    schema: { type: 'object', properties: {
      worldId: WORLD_ID,
      theme: s('Cartographic style.', { enum: ['wonder', 'antique', 'relief', 'survey'] }),
      skin3D: s('3D surface.', { enum: ['satelite', 'dibujado', 'arcilla'] }),
      reliefAmount: n('Relief symbol density, 0.3 to 2. Default 1.'),
      layers: { type: 'object', description: 'Layers to show (true) or hide (false).', properties: Object.fromEntries(['relief', 'forests', 'labels', 'settlements', 'roads', 'borders', 'frame', 'compass', 'scaleBar'].map((key) => [key, { type: 'boolean' }])), additionalProperties: false },
      readerStart: s("How the reader's-eye map starts before any fog stroke: blank (default), sketch (all heard of) or ink (all seen).", { enum: ['blank', 'sketch', 'ink'] }),
      grid: { anyOf: [{ type: 'object', properties: { kind: { type: 'string', enum: ['square', 'hex'] }, km: { type: 'number', minimum: 1, maximum: 2000 } }, required: ['kind', 'km'], additionalProperties: false }, { type: 'null' }], description: 'A square or hex play grid over the map, cell size in km; null removes it.' },
      expectedRevision: n('Revision read before changing; a different current revision refuses the write.'),
    }, required: ['worldId'], additionalProperties: false },
  },
  {
    name: 'wh_create_world', writes: true,
    description: 'Create a generated world from a starting point, as the engine form does. Presets: continents, pangaea, archipelago, shattered, iceAge, desertWorld, blankSea (open sea to paint a coast on with the Coast brush), blankLand (a low plain with no coast), lushWorld. Returns the worldId; the terrain is forged the first time it is opened or read.',
    schema: { type: 'object', properties: {
      projectId: PROJECT_ID,
      title: s('World title. Default "World".'),
      preset: s('Starting point.', { enum: ['continents', 'pangaea', 'archipelago', 'shattered', 'iceAge', 'desertWorld', 'blankSea', 'blankLand', 'lushWorld'] }),
      seed: s('Seed text; omit for a random one. Same seed and preset give the same world.'),
      width: n('Grid width: 1024 fast, 2048 standard (default), 3072 high.'),
    }, additionalProperties: false },
  },
  {
    name: 'wh_measure_world', writes: false,
    description: 'Measure on a generated world like the map ruler: great-circle distance along points in world cells (each leg with bearing) and, for three or more points, the enclosed area in km² and the closed perimeter. Uses the planet size every map instrument uses.',
    schema: { type: 'object', properties: { worldId: WORLD_ID, points: { type: 'array', minItems: 2, maxItems: 500, description: 'Points in world cells, in order.', items: { type: 'object', properties: { x: CELL_X, y: CELL_Y }, required: ['x', 'y'], additionalProperties: false } } }, required: ['worldId', 'points'], additionalProperties: false },
  },
  {
    name: 'wh_get_world_travel_settings', writes: false,
    description: 'Read a generated world\'s travel physics (speed factor per way of travelling, cost factor per kind of ground off the road; 1 = built-in) and its usual pace. The Travel panel and wh_plan_journey use them.',
    schema: { type: 'object', properties: { worldId: WORLD_ID }, required: ['worldId'], additionalProperties: false },
  },
  {
    name: 'wh_set_world_travel_settings', writes: true,
    description: 'Change a generated world\'s travel physics or usual pace. profile replaces the whole profile ({} restores the built-in physics). Factors go from 0.25 to 4. Saved itineraries keep the settings they were planned with. Undo reverts only fields still holding this call\'s value.',
    schema: { type: 'object', properties: {
      worldId: WORLD_ID,
      profile: { type: 'object', description: 'speed: factor per mode (2 = twice as fast); ground: factor per ground class off the road (2 = twice as slow).', properties: {
        speed: { type: 'object', properties: Object.fromEntries(['foot', 'horse', 'cart', 'boat', 'ship'].map((key) => [key, { type: 'number', minimum: 0.25, maximum: 4 }])), additionalProperties: false },
        ground: { type: 'object', properties: Object.fromEntries(['open', 'dry', 'forest', 'jungle', 'marsh', 'mountains', 'ice'].map((key) => [key, { type: 'number', minimum: 0.25, maximum: 4 }])), additionalProperties: false },
      }, additionalProperties: false },
      pace: s('Usual pace for new plans.', { enum: ['easy', 'steady', 'hard'] }),
      expectedRevision: n('Revision read before changing; a different current revision refuses the write.'),
    }, required: ['worldId'], additionalProperties: false },
  },
  {
    name: 'wh_plan_journey', writes: false,
    description: `Plan a journey on a generated world with the least-time model of the Travel panel: real gradient, ground, roads, rivers, ice and season. Stops are place keys (wh_find_place) or world cells; routes leg by leg through intermediate stops, each leg optionally with its own mode. Pace easy uses 75% of the day, hard 130% plus a rest day after every six on the move. Returns distance, hours, days (rest days included), road share, crossings, realms, climb, where each night falls and the route's path in cells (pass it as points to wh_paint_reader_fog to mark the way as seen on the reader's map). Uses the world's travel settings unless profile/pace are given. ${PENDING_NOTE}`,
    schema: { type: 'object', properties: {
      worldId: WORLD_ID,
      stops: { type: 'array', minItems: 2, maxItems: 12, description: 'Ordered stops: {place: key} or {x, y} world cells.', items: { type: 'object', properties: { place: PLACE_KEY, x: CELL_X, y: CELL_Y }, additionalProperties: false } },
      mode: s('Way of travelling.', { enum: ['foot', 'horse', 'cart', 'boat', 'ship'] }),
      legModes: { type: 'array', description: 'One mode per leg (stops - 1).', items: { type: 'string', enum: ['foot', 'horse', 'cart', 'boat', 'ship'] } },
      season: s('Season.', { enum: ['spring', 'summer', 'autumn', 'winter'] }),
      pace: s('Pace; default the world\'s usual pace.', { enum: ['easy', 'steady', 'hard'] }),
      hoursPerDay: n('Hours of usable daylight per day before pace; default by season.'),
      atDay: { type: 'number', minimum: 0, description: 'Optional: also report where the party is on this day of the journey (0 = setting off), and whether it is travelling, spending a night, resting or has arrived.' },
      profile: { type: 'object', description: 'Override the world\'s travel physics for this plan only (same shape as wh_set_world_travel_settings).' },
      locale: s('Language of terrain words.', { enum: ['en', 'es'] }),
    }, required: ['worldId', 'stops'], additionalProperties: false },
  },
  {
    name: 'wh_list_worlds',
    description:
      `List generated worlds with their id, seed, edit counts and waypoints.
List the project's generated worlds: id, title, seed, grid size, how many edits of each kind the reader has made (renames, placed markers, labels, removals, moves, roads), saved regional views and waypoint count. Start here to get a worldId; nothing else in this engine works without one.`,
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
      `List a generated world's named places, most important first, with keys and coordinates.
The named places of a world, most important first: settlements (capital, city, town, village), ruins, realms (countries), named features (seas, ranges, rivers) and landmarks. Each carries its stable key (and locked: true when the author locked it against moving and hiding) — the handle every other place tool takes — its cell coordinates x,y and normalised u,v in 0..1, its importance and whether the generator or the reader made it. Scope "places" is cheaper and skips realms, features and roads. ${PENDING_NOTE}`,
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
      `Find a world's places by name, accent- and case-insensitive, best match first.
Find places by name, accent- and case-insensitively, best match first: a name that starts with the query beats one that contains it, and "Río" alone lists the great river before the brook. Returns the same shape as wh_list_places, key included. ${PENDING_NOTE}`,
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
      `Check what is at a world cell: elevation, sea or land, and the nearest important place.
What is at a cell: the elevation in km (negative is sea floor), whether it is sea or a lake, and the most important place within reach (locked: true when the author locked it), if any — a click between a capital and a hamlet resolves to the capital. Use it to check ground before placing a settlement. ${PENDING_NOTE}`,
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
      `Place a settlement, ruin or landmark on a world at a cell; land only, undoable.
Place a settlement, a ruin or a landmark on a world at a cell. Settlements need land — the tool refuses a sea cell when the world is in memory, and the engine silently ignores one when it is not, so check with wh_place_at first. A settlement without a rank is a town; a ruin without a kind is a ruined city; a landmark needs its type. Omit the name and the engine coins one in the local language. Returns the new place's key. Appended to the world's edit list, so the writer can undo it.`,
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
      `Rename a world place by its key without breaking its manuscript links; undoable.
Rename a place by its key: a town, a ruin, a realm, a sea, a range or a landmark, whether the generator or the reader made it. The key never changes, so a renamed place keeps its manuscript links. Undoable.`,
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
      `Move a world place to another cell, keeping its key, name and links; undoable.
Move a place to another cell without changing its key, so its links and its name survive. Roads re-route to a moved settlement the next time the world's full geography is built. Refused while the place is locked (wh_lock_place). Undoable.`,
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
      `Hide a place from the world; a reversible edit, not a deletion.
Hide a place from the world: a town that should not exist, a ruin, a named sea, a landmark. Not a deletion — it appends a \`remove\` edit that wh_restore_place (or the writer's undo) reverses, and the place's key stays valid for exactly that purpose. Refused while the place is locked (wh_lock_place).`,
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
    name: 'wh_lock_place',
    description:
      `Lock a world place against moving and hiding, or unlock it (locked: false).
The author's guard against accidents: a locked place is not picked up by the Move tool, no card, sheet or eraser hides it, and wh_move_place / wh_remove_place refuse it. wh_list_places, wh_find_place and wh_place_at mark it locked: true. The key must name a place. Unlock only when the author asks. Changes nothing in the world; undoable.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        key: PLACE_KEY,
        locked: { type: 'boolean', description: 'true locks (default), false unlocks.' },
      },
      required: ['worldId', 'key'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_duplicate_place',
    description:
      `Copy a settlement, ruin or landmark as a new hand-placed one, beside it or at x, y.
The copy keeps the kind (a town's rank, except that a capital's copy is a city; a ruin's or landmark's type) and is named "<name> 2" (or the next free number) unless name is given; without x and y it goes to the nearest free dry land around the place (two cells east first). Realms, seas, ranges and regions cannot be copied. A cell that is sea, a lake, or already has a place or its history is refused. Returns the new key; undoable.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        key: PLACE_KEY,
        x: CELL_X,
        y: CELL_Y,
        name: s('Name of the copy (default "<name> 2").'),
      },
      required: ['worldId', 'key'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_restore_place',
    description:
      `Bring back a place hidden by wh_remove_place, by the same key.
Bring back a place that wh_remove_place (or the reader's eraser) hid, by the same key. A place that was never removed is unaffected.`,
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
      `Write a free-standing map label at a cell; does not rename an actual place.
Write a free-standing label on the map at a cell — the name of a region, a body of water or a range, a caption under a town, or a note. It names nothing in the atlas; use wh_rename_place to rename an actual place. Undoable.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        x: CELL_X,
        y: CELL_Y,
        text: s('What the label says.'),
        style: s('Type style. Default "note".', { enum: ['region', 'water', 'range', 'settlement', 'note'] }),
        size: { type: 'number', minimum: 8, maximum: 48, description: 'Type size in pixels at the default zoom.' },
        angleDegrees: { type: 'number', minimum: -180, maximum: 180, description: 'Rotation, clockwise on the map.' },
        spacing: { type: 'number', minimum: 0, maximum: 1, description: 'Extra space between letters as a share of the type size.' },
        curve: { type: 'number', minimum: -1, maximum: 1, description: 'Bend: positive arches up, negative bows down, 0 straight.' },
      },
      required: ['worldId', 'x', 'y', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_stamp',
    description:
      `Place a pictorial map stamp (inn, shrine, tower, barrow, mountain…) at a cell.
A picture on the map with an optional name; it adds no settlement to the geography. Glyphs: hamlet, village, town, city, capital, camp, inn, temple, shrine, monastery, mill, windmill, farm, mine, lighthouse, harbour, bridge, well, standingStones, barrow, ruins, battlefield, castle, fort, tower, wizardTower, motte, walls, mountain, volcano, forest, cave. Move, rename or remove it by its key (stamp:x,y) with wh_move_place, wh_rename_place, wh_remove_place. Undoable.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        x: CELL_X,
        y: CELL_Y,
        glyph: s('Which stamp.'),
        size: s('S, M (default) or L.', { enum: ['S', 'M', 'L'] }),
        name: s('Optional name written beside it.'),
      },
      required: ['worldId', 'x', 'y', 'glyph'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_paint_reader_fog',
    description:
      `Paint the reader's-eye map: mark ground as seen, heard of, or hidden again.
A brush stroke along the given cells with a radius in cells. It changes nothing in the world itself; it is what the Reader's view, wh_reader_view and wh_render_world_map readerView show. chapter makes the stroke appear only from that chapter on (omit for "from the start"). Strokes apply in order and the last one over a cell wins. Undoable.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        op: s('seen (in ink), heard (a sketch under a wash) or hide (blank paper again).', { enum: ['seen', 'heard', 'hide'] }),
        points: { type: 'array', minItems: 1, maxItems: 500, description: 'World cells along the stroke; one cell paints a disc.', items: { type: 'object', properties: { x: CELL_X, y: CELL_Y }, required: ['x', 'y'], additionalProperties: false } },
        radiusCells: { type: 'number', minimum: 0.5, description: 'Brush radius in world cells, default 6.' },
        chapter: { type: 'integer', minimum: 0, description: 'Chapter from which this stroke is revealed; omit for always.' },
      },
      required: ['worldId', 'op', 'points'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_reader_view',
    description:
      `What the reader knows of a world's map, up to a chapter.
Returns the share of the map seen, heard of and hidden, the chapters that reveal something, the saved starting state (readerStart) and, for any cells given, whether each is seen, heard or hidden. Render it with wh_render_world_map readerView.`,
    writes: false,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        chapter: { type: 'integer', minimum: 0, description: 'Count only the strokes revealed up to this chapter; omit for all.' },
        cells: { type: 'array', maxItems: 200, items: { type: 'object', properties: { x: CELL_X, y: CELL_Y }, required: ['x', 'y'], additionalProperties: false } },
      },
      required: ['worldId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_story_event',
    description:
      `Put a story event on a world's map: what happens, where, in which chapter.
Kinds: fight, find, meeting, rest, change, journey (travelling), camp, inn, custom. status planned or happened (default). Place it at a place key (wh_find_place) or world cells. Shown with the Story tool, in the Reader's view (happened events up to its chapter) and in wh_render_world_map. Changes nothing in the world. Undoable.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        place: PLACE_KEY,
        x: CELL_X,
        y: CELL_Y,
        type: s('Kind of event.', { enum: ['fight', 'find', 'meeting', 'rest', 'change', 'journey', 'camp', 'inn', 'custom'] }),
        title: s('What happens, in a few words.'),
        note: s('Optional note: what changed, what was said.'),
        chapter: { type: 'integer', minimum: 0, description: 'Chapter in which it happens.' },
        status: s('planned or happened (default).', { enum: ['planned', 'happened'] }),
        who: { type: 'array', maxItems: 20, items: { type: 'string' }, description: 'Who was there: Codex entry ids (characters, factions) from wh_list_codex.' },
        order: { type: 'integer', minimum: 0, maximum: 9999, description: 'Position within its chapter, from 0 (first); the chapter\'s other events move along, past the end puts it last. Without it the event follows in the order it was placed.' },
      },
      required: ['worldId', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_update_story_event',
    description:
      `Change a story event by id: only the fields given change; place or x/y moves it; chapter null unties it from a chapter. Undoable.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        id: s('Event id from wh_list_story_events.'),
        place: PLACE_KEY,
        x: CELL_X,
        y: CELL_Y,
        type: s('Kind of event.', { enum: ['fight', 'find', 'meeting', 'rest', 'change', 'journey', 'camp', 'inn', 'custom'] }),
        title: s('What happens.'),
        note: s('Note.'),
        chapter: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }], description: 'Chapter, or null for none.' },
        status: s('planned or happened.', { enum: ['planned', 'happened'] }),
        who: { type: 'array', maxItems: 20, items: { type: 'string' }, description: 'Who was there: the whole list of Codex character or faction ids (an empty list clears it).' },
        order: { anyOf: [{ type: 'integer', minimum: 0, maximum: 9999 }, { type: 'null' }], description: 'Position within its chapter, from 0 (first); the others move along. null goes back to placement order. Changing chapter without it puts the event last in the new chapter.' },
      },
      required: ['worldId', 'id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_remove_story_event',
    description: `Take a story event off a world's map by id. Not a deletion: it appends an undoable edit to the world's list (Ctrl+Z or the bridge undo puts the event back).`,
    writes: true,
    schema: { type: 'object', properties: { worldId: WORLD_ID, id: s('Event id from wh_list_story_events.') }, required: ['worldId', 'id'], additionalProperties: false },
  },
  {
    name: 'wh_set_world_levels',
    description:
      `Move the whole world's sea level and/or snowline, in metres against the generated ones (absolute; 0 puts it back). The sea moves every height, so coasts drown or shelves come up and the biomes follow (rivers keep their courses until the author recalculates climate and rivers); the snowline only changes where snow is drawn (higher = less snow). wh_get_world reports both. Undoable. Change them only when the author asks.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        seaLevelM: { type: 'number', minimum: -1000, maximum: 1000, description: 'Sea level in metres against the generated one.' },
        snowlineM: { type: 'number', minimum: -3000, maximum: 3000, description: 'Snowline in metres against the climate\'s own.' },
      },
      required: ['worldId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_lake',
    description:
      `Fill a lake at a place or cell, like the River tool's Lake mode.
From the spot the water runs a few cells down to the bottom of its hollow and fills it until it spills (over land, or into the sea as a lagoon) or reaches maxCells; with no hollow that close it is dammed at the spot (dammed: true) and rises up the valley, a pond of a few cells or at least size cells. The cells become lake (biome, shore, travel, trade). It is re-derived from the ground on every replay, so later terrain edits reshape it. Refused on sea or an existing lake, and when it would touch another lake. dryRun only says how big it would be. Undoable; wh_drain_lake removes a lake.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        place: PLACE_KEY,
        x: CELL_X,
        y: CELL_Y,
        size: { type: 'integer', minimum: 1, maximum: 20000, description: 'Least lake size in cells (the River tool\'s Least size).' },
        maxCells: { type: 'integer', minimum: 1, maximum: 20000, description: 'Largest lake in cells (default scaled to the world grid, and never below size).' },
        dryRun: { type: 'boolean', description: 'Only measure it.' },
      },
      required: ['worldId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_drain_lake',
    description: 'Drain the lake under a place or cell, painted or generated: its cells become land again (biomes re-derived). Undoable.',
    writes: true,
    schema: {
      type: 'object',
      properties: { worldId: WORLD_ID, place: PLACE_KEY, x: CELL_X, y: CELL_Y },
      required: ['worldId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_world_road',
    description:
      `Lay a road by hand between two places (keys from wh_find_place) or world cells, routed like the Road tool: the cart route over the real ground, through passes and around marshes, then drawn with the world's roads (map, 3D, Carta, travel). major true is a royal road (solid on the map and in 3D; the Carta draws every road in its theme's dashes unless a pattern is chosen), false a track (dashed). width scales its line (0.5–3, default 1) and pattern draws it solid, dashed or dotted over its class's own. dryRun only routes it and says how long it is. Undone like any world edit; the Road tool's eraser removes it.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        from: { type: 'object', description: '{place: key} or {x, y} world cells.', properties: { place: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, additionalProperties: false },
        to: { type: 'object', description: '{place: key} or {x, y} world cells.', properties: { place: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, additionalProperties: false },
        major: { type: 'boolean', description: 'A royal road (true) or a track (false, default).' },
        width: { type: 'number', minimum: 0.5, maximum: 3, description: 'Line width as a multiple of the class\'s, default 1.' },
        pattern: { type: 'string', enum: ['solid', 'dashed', 'dotted'], description: 'Line pattern over the class\'s own.' },
        dryRun: { type: 'boolean', description: 'Only route it.' },
      },
      required: ['worldId', 'from', 'to'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_add_spring_river',
    description:
      `Add a river that runs downhill from a spring at a place or cell, until the sea, a lake, another river or a hollow.
From the given spot the water steps to the lowest neighbouring cell while there is one lower, round the east/west seam, and the path is added as a drawn river (it carves a channel like one drawn by hand). It stops at rivers drawn earlier too, and not at ones that were erased. Refused when the spot is sea, a lake or a hollow already. dryRun returns the path without adding it. Undo removes the river.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        place: PLACE_KEY,
        x: CELL_X,
        y: CELL_Y,
        width: { type: 'number', minimum: 0.5, maximum: 12, description: 'River width in cells, default 2.' },
        dryRun: { type: 'boolean', description: 'Only trace the path and say where it ends.' },
      },
      required: ['worldId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_story_chapters',
    description:
      `A world's story chapter by chapter: what happens, what is planned and how much of the map the reader knows.
The story of a world chapter by chapter, the way the reader's view plays it: for each chapter with events or fog strokes, what happens there, what is only planned, and how much of the map the reader has seen, heard of or not reached by its end. Use it to tell what changes from one chapter to the next before describing a place or a journey.`,
    writes: false,
    schema: { type: 'object', properties: { worldId: WORLD_ID }, required: ['worldId'], additionalProperties: false },
  },
  {
    name: 'wh_roll_name',
    description:
      `Roll fresh names for a map label in the world's own languages, like the dice on the Label tool.
Coins names with roots that suit the label: region (lands, realms), water (seas, lakes, bays), range (mountains) or settlement (a town). With x and y the names are in the language spoken at the nearest town; without them the rolls walk through the world's languages. Never a name the world already uses. Each name comes with its language and etymology. Writes nothing: put the one the author likes on the map with wh_add_label.`,
    writes: false,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        style: s('Kind of label.', { enum: ['region', 'water', 'range', 'settlement'] }),
        count: { type: 'integer', minimum: 1, maximum: 10, description: 'How many names, default 5.' },
        x: CELL_X,
        y: CELL_Y,
      },
      required: ['worldId', 'style'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_list_story_events',
    description:
      `List a world's story events in chapter order: id, kind, title, note, chapter, planned/happened and position in world cells. knownByChapter keeps only what the reader knows by then (happened, in or before it).`,
    writes: false,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        knownByChapter: { type: 'integer', minimum: 0, description: 'Only events that happened in or before this chapter (and unchaptered ones).' },
        status: s('Only planned or only happened events.', { enum: ['planned', 'happened'] }),
      },
      required: ['worldId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_world_economy',
    description:
      `The trade lens of a world: month by month, who is fed, who will go short of what and when (shortIn: months until a place first cannot get all it needs, trade included; grain, meat and salt are the staples), prices against the usual (1 = usual), shipments on the move by road and sea, and which goods nobody makes.
Generated from the settlements (each opens farms, fisheries, pastures, logging camps, quarries, mines and saltworks near it by the ground) plus the sites the author placed. month is 1..240 (default 1). place narrows the detail to one settlement by name. Deterministic: the same world gives the same economy. ${PENDING_NOTE}`,
    writes: false,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        month: { type: 'integer', minimum: 1, maximum: 240, description: 'Which month, from 1.' },
        place: s('A settlement name for its detail only.'),
        limit: n('How many places in the detail, default 30.'),
      },
      required: ['worldId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_list_trade_sites',
    description: `List a world's production sites with id, kind, size, cell, settlement and whether the author placed it (auto false). ${PENDING_NOTE}`,
    writes: false,
    schema: { type: 'object', properties: { worldId: WORLD_ID, onlyYours: { type: 'boolean', description: 'Only the sites the author placed.' } }, required: ['worldId'], additionalProperties: false },
  },
  {
    name: 'wh_add_trade_site',
    description:
      `Place a production site on a world: farm (grain), fishery (fish), pasture (meat, wool), camp (timber), quarry (stone), mine (iron) or saltworks (salt), size S, M or L, at a place key or a world cell. It joins the nearest settlement's economy. Undoable.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        kind: s('Kind of site.', { enum: ['farm', 'fishery', 'pasture', 'camp', 'quarry', 'mine', 'saltworks'] }),
        size: s('S, M (default) or L.', { enum: ['S', 'M', 'L'] }),
        place: PLACE_KEY,
        x: CELL_X,
        y: CELL_Y,
      },
      required: ['worldId', 'kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_restore_trade_site',
    description: `Switch a generated trade site back on after wh_remove_trade_site switched it off (its id keeps the settlement's cell: auto:x,y:kind:n). Undoable.`,
    writes: true,
    schema: { type: 'object', properties: { worldId: WORLD_ID, id: s('Generated site id.') }, required: ['worldId', 'id'], additionalProperties: false },
  },
  {
    name: 'wh_remove_trade_site',
    description: `Remove a site the author placed, or switch off a generated one, by id (wh_list_trade_sites). Not a deletion: it appends an undoable edit to the world's list.`,
    writes: true,
    schema: { type: 'object', properties: { worldId: WORLD_ID, id: s('Site id.') }, required: ['worldId', 'id'], additionalProperties: false },
  },
  {
    name: 'wh_list_stamps',
    description:
      `List the stamps placed by hand on a world, with keys, glyph, size, name and cell.`,
    writes: false,
    schema: { type: 'object', properties: { worldId: WORLD_ID }, required: ['worldId'], additionalProperties: false },
  },
  {
    name: 'wh_list_labels',
    description:
      `List the reader's painted labels on a world with keys, place and shape.
Each label's key (label:x,y, where it was first painted), text, style, current cell and any size, angleDegrees, spacing and curve. Use the key with wh_update_label, wh_move_place, wh_rename_place or wh_remove_place.`,
    writes: false,
    schema: { type: 'object', properties: { worldId: WORLD_ID }, required: ['worldId'], additionalProperties: false },
  },
  {
    name: 'wh_update_label',
    description:
      `Change a painted label's text, style, size, angle, letter spacing or curve.
Only the fields given change; the label keeps its place (use wh_move_place to move it). Undoable.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        worldId: WORLD_ID,
        key: s('Painted label key from wh_list_labels (label:x,y).'),
        text: s('New wording.'),
        style: s('Type style.', { enum: ['region', 'water', 'range', 'settlement', 'note'] }),
        size: { type: 'number', minimum: 8, maximum: 48, description: 'Type size in pixels at the default zoom.' },
        angleDegrees: { type: 'number', minimum: -180, maximum: 180, description: 'Rotation, clockwise on the map.' },
        spacing: { type: 'number', minimum: 0, maximum: 1, description: 'Extra space between letters as a share of the type size.' },
        curve: { type: 'number', minimum: -1, maximum: 1, description: 'Bend: positive arches up, negative bows down, 0 straight.' },
      },
      required: ['worldId', 'key'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_list_waypoints',
    description:
      `List the reader's own bookmarked waypoints on a world, separate from generated places.
The reader's waypoints on a world: named pins with a note and a colour, positioned by normalised u (0 west to 1 east, wrapping) and v (0 north to 1 south). Waypoints are the reader's own bookmarks, separate from the generated places.`,
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
      `Drop a waypoint on a world at a normalised position; colour cycles if omitted.
Drop a waypoint on a world at a normalised position: u 0..1 west to east (wraps), v 0..1 north to south. To pin a generated place, take its u,v from wh_list_places. The colour cycles through the app's palette when omitted.`,
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
      `Read one world in detail: digest, generation parameters, waypoints and live/forging state.
One world in detail: the same digest as wh_list_worlds plus its full generation parameters, its waypoints, whether a view currently has it open (\`live\`) and whether it is being forged right now (\`forging\`, in which case place reads will answer pending until it finishes).`,
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
      `Connect a map place to a codex entry, scene, manuscript piece or timeline event.
Connect a place on the map to the manuscript: a codex entry that represents it (a location sheet), or a dialog scene, a manuscript piece or a timeline event that takes place there. This is what makes the map a navigation surface for the book — hover the town and see its scenes. Linking the same pair twice returns the existing link. The target must belong to the world's project.`,
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
      `List the manuscript links hanging on a world's places, for one place or the whole world.
The manuscript links hanging on a world's places: which codex entries, scenes, writings and timeline events point at which place key. Pass a key to read one place; omit it for the whole world.`,
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
      `Read a generated world's Markdown gazetteer: overview, languages, geography and hooks.
The world's gazetteer as Markdown: an overview of the planet, its languages, realms, geography, ruins and coasts, and story hooks read off the map — everything in it is derived from the generated world, nothing is invented. Written in Spanish, the engine's language. Long; read it once, then use wh_find_place for specifics. ${PENDING_NOTE}`,
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
      `List the real-world places a book uses, alphabetically, with coordinates and status.
List the real-world places the book uses, alphabetically: name, kind, aliases, country, WGS84 coordinates when known, era, whether the place is invented (\`fictional\`), the place that contains it (\`parentId\`) and how many divergences are anchored to it. This engine is the story's REAL setting — Lisbon, 1936 Madrid, a street in Paris — kept as rows the writer has checked, unlike the generated planets of the world generator. Pass \`query\` to search names and aliases accent- and case-insensitively, best match first. Descriptions, checked facts and sources are not included: read one place with wh_get_atlas_place.`,
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
      `Read one real-world place in full: description, verified notes, sources and appearances.
Read one place in full: \`description\` (how the story uses it), \`realNotes\` (what is actually true there, as checked by the writer), \`sources\`, address, coordinates, era and tags, plus its parent place, the places it contains, the divergences anchored to it and \`appearsIn\` — the chapters whose prose names the place or one of its aliases (\`{writingId, title, chapter}\`, in manuscript order; accents, case and plurals do not matter; at most 20 chapters, and \`appearsInTruncated: true\` says there were more). Read this before writing about a place, and treat realNotes as the verified facts and description as the book's use of them.`,
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
      `Add a real-world place the book uses, with coordinates, notes and sources.
Add a real-world place the book uses. Coordinates are WGS84 decimal degrees, both or neither — a street or a bar may only have an address. Set \`fictional: true\` for a place the writer invented and set inside the real world (Macondo, Vetusta, a bar that never existed on a real street); a real place's \`realNotes\` should hold only facts that have been checked, with \`sources\` saying where they came from, and \`description\` what the story makes of it. Use \`parentId\` to nest a building in its city or a district in its town; the parent must be a place of the same project. Check wh_list_atlas_places first: the place may already exist under an alias.`,
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
      `Change a real-world place; only the fields you pass are touched. Undoable.
Change a place. Only the fields you pass are touched. An empty string clears country, address, era or parentId; \`clearCoordinates: true\` removes both coordinates, and passing only one of lat/lon keeps the other as it is. Undoable from the app's audit log.`,
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
      `List the book's deliberate departures from real-world fact, most recent first.
Each with title, category, anchored place (none: a global change), \`since\` and its reality, fiction and reason cut at 300 characters (wh_get_divergence has them in full). Pass \`placeId\` for one place's divergences or \`category\` to filter. ${DIVERGENCE_NOTE} It is a fact about the book, not a mistake.`,
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
      `Read one divergence in full: reality, fiction, reason, date, category and anchor place.
Read one divergence in full: reality (what is actually the case), fiction (what the book says instead), reason (why the writer changed it), since, category, tags and the name of the place it is anchored to, if any.`,
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
      `Record where the book departs from reality on purpose, once the writer has decided.
Record where the book departs from reality on purpose. ${DIVERGENCE_NOTE} Do not file an error the writer has not chosen: raise a suspected mistake with wh_annotate instead, and record it here only once they decide to keep it.`,
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
      `Change a divergence; only the fields you pass are touched. Undoable.
Change a divergence. Only the fields you pass are touched; \`placeId: ""\` unanchors it (the change becomes global) and an empty \`since\` clears it. Undoable from the app's audit log.`,
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
    name: 'wh_atlas_distance',
    description:
      `Great-circle distance between two atlas places, with bearing and travel time by six modes.
Great-circle distance between two places of the atlas, in km, with the initial compass bearing and how long the journey takes by six means: on foot (4.5 km/h, 36 km a day), on horseback (40 km a day in stages), by carriage (60 km a day), by mid-19th-century train (40 km/h), by car (90 km/h) and by plane (800 km/h plus two hours of airports). Staged modes report \`days\`; every mode reports \`hours\` moving. Use it to answer "how long does my character take" and to check that a chapter's timing is possible; real roads add a fifth or more, which the writer decides. Both places need coordinates. Nothing is written.`,
    writes: false,
    schema: {
      type: 'object',
      properties: {
        fromPlaceId: s('Id of the place the journey starts from.'),
        toPlaceId: s('Id of the destination place.'),
      },
      required: ['fromPlaceId', 'toPlaceId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_atlas_places_near',
    description:
      `List atlas places within a radius of a point or another place, nearest first.
The atlas places within \`radiusKm\` of a point, nearest first, each with its distance in km and compass bearing from the centre. Centre on a place (\`placeId\`, which is itself left out of the results) or on raw \`lat\`/\`lon\`. Default radius 50 km. Use it to find what the story has already placed around a scene, or which places a character could reach in a day. Nothing is written.`,
    writes: false,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        placeId: s('Place to search around. Its own project is used, and it is excluded from the results.'),
        lat: LAT,
        lon: LON,
        radiusKm: n('Radius in kilometres. Default 50, maximum 20000.'),
        limit: n('Maximum places. Default 50, maximum 500.'),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_list_atlas_routes',
    description:
      `List the project's itineraries: ordered atlas-place routes with distance and travel time.
The project's itineraries: each route is a named, ordered list of atlas places (a journey the story makes), with its stops, its great-circle length in km, each leg's distance and compass bearing, the ids of stops that have no coordinates (\`missing\`), and how long the whole journey takes by the six means wh_atlas_distance uses (hours moving, and days in stages for the staged ones). Use it to answer "how long is the road trip in chapter four" or to check an itinerary against the chapter order. Nothing is written.`,
    writes: false,
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_create_atlas_route',
    description:
      `Save an itinerary of at least two atlas places in travelling order.
Save an itinerary: a name and at least two atlas place ids of this project in travelling order (a place may recur, for a journey there and back). Optional \`mode\` records the means of travel the writer has in mind. Returns the route with its totals, as wh_list_atlas_routes reports them. Stops without coordinates are allowed but contribute no distance. Routes are edited, renamed and deleted from the map's Routes panel; there is no bridge tool to delete one. Undoable.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        name: s('Name of the route, e.g. "Lisboa to Madrid by post road".'),
        placeIds: arr('Atlas place ids in travelling order, at least two.'),
        mode: {
          type: 'string',
          enum: ['walk', 'horse', 'carriage', 'rail19', 'car', 'plane'],
          description: 'Means of travel the writer has in mind for this journey, if any.',
        },
      },
      required: ['name', 'placeIds'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_reality_check',
    description:
      `A read-only report on the real setting's coverage: coordinates, unverified facts, divergences.
A read-only report on the real setting: how many places have coordinates, which real (non-fictional) places have nothing verified yet in realNotes, which places are invented, divergences per category, and divergences missing their reality or fiction text — as counts, id lists and a short Markdown summary. Run it before telling the writer their setting is consistent or well researched, and to answer "what have I not checked yet". Nothing is written.`,
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
      `List a project's storyboards with panels in order: caption, description and duration.
List the project's storyboards with their panels in order: caption, description, duration and which dialog scene each panel belongs to. Panel images are reported as present but not included.`,
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
      `Start a storyboard: a grid of panels for planning shots or beats visually.
Start a storyboard: a grid of panels that reads left to right, one shot or beat per panel. Use it to plan how something will be seen rather than how it will be worded.`,
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
      `List a project's video plans with segments in order: script, timing and visuals.
List the project's video plans with their segments in order: spoken script, timing, speaker and what is on screen. This is the engine for YouTube scripts, podcasts and anything shot to a plan.`,
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
      `Start a video plan: an ordered script of narrated segments with on-screen visuals.
Start a video plan: an ordered script of segments, each with its narration, on-screen visual and timing. Built for talks, essays and anything written to be spoken over pictures.`,
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
      `Add a segment to a video plan with its narration, on-screen visual and timing.
Add a segment to a video plan: what is said, and what is on screen while it is said. Times are free text, so "0:45" and "00:45" are both fine as long as you stay consistent within a plan.`,
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
      `List a project's margin notes, with anchor status, optionally scoped to one entity.
List the margin notes in a project: what they say, what they are attached to, and whether the text they were anchored to has since moved away (orphaned). Pass engineId AND entityId to read the notes on one chapter or one codex entry — that form also re-checks every anchor against the text as it stands right now, which is what you want after editing it. Without them the orphan flags are only as fresh as the last time each entity was opened, and \`orphanStatus\` in the result says which of the two you got.`,
    writes: false,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        eraId: s('Contexto exacto del comentario. Omitir consulta Base; una era consulta sólo sus comentarios locales.'),
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
      `Leave a margin note on something, optionally anchored to an exact quoted phrase.
Leave a margin note on something. Pass \`quote\` with the exact phrase you are commenting on and the note anchors to that spot in the text; omit it and the note attaches to the entity as a whole. Text anchoring works on manuscript pieces, codex entries and seeds. Use this to raise a question or flag an inconsistency instead of silently rewriting the writer's prose.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        eraId: s('Contexto exacto del comentario. Omitir escribe en Base; una era conserva Base intacta.'),
        engineId: s('Engine of the thing you are annotating: "writings", "codex", "seeds"…'),
        entityId: s('Id of the thing you are annotating.'),
        note: s('What you want to say. Plain text or Markdown.'),
        quote: s('Exact phrase from the entity to anchor to. Must match the text as written.'),
        at: {
          type: 'object',
          description: 'Classic maps only (engineId "maps"): the spot the comment points at, in percent of the map image (x from the left, y from the top), the same units as pins and shapes. The note shows as a marker on the map. Not with quote.',
          properties: { x: { type: 'number', minimum: 0, maximum: 100 }, y: { type: 'number', minimum: 0, maximum: 100 } },
          required: ['x', 'y'],
          additionalProperties: false,
        },
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
      `Who appears in the scenes and who does not, by lines, words and codex mismatches.
Who actually appears in the scenes, and who does not. Counts scenes, lines and words per character across every dialog scene, then flags two things worth knowing: characters in the codex who never appear anywhere, and speakers on the page who have no codex entry. The fastest way to spot a cast member you invented and forgot.`,
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
      `The writer's own output stats: words today, streak, daily average and goals.
The writer's own output: words today, current streak, daily average, the last seven days, and any active word-count goals. Read only, deliberately — the app writes these sessions itself as the writer types, and an outside write would corrupt the streak.`,
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
      `Generate one to four reference images from a text prompt and save them to the Gallery.
Generate one to four reference images from a text prompt using the image model configured in AI settings (a local diffusion server or a remote API), and save them into the project's Gallery tagged "generated" with their prompt and seed. Returns the new image ids and shows you a small preview of the first one. Costs time — and money if the configured model is a paid API — so confirm with the user before generating batches. Fails with a clear message when no image model is configured.`,
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
        width: n('Exact width in pixels, 256-2048. Overrides "size". Local servers round to the nearest multiple of 64.'),
        height: n('Exact height in pixels, 256-2048. Overrides "size". Local servers round to the nearest multiple of 64.'),
        count: n('How many variants, 1-4. Default 1.'),
        seed: n('Seed for reproducible results, when the server supports it.'),
        steps: n('Denoising steps, 1-150. Leave it out to use the model\'s own default — more steps cost time, not always quality.'),
        quality: s('"low", "medium" or "high" — servers that understand it trade time for detail.', { enum: ['low', 'medium', 'high'] }),
        collectionId: s('Gallery collection to file the images under (from wh_list_images). Optional.'),
        tags: arr('Extra tags besides "generated".'),
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
];
