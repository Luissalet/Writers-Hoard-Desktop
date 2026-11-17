import { b, n, s, PROJECT_ID, type BridgeTool } from '@/services/aiBridge/schema';

const WORLD = s('Generated world id (wh_list_worlds).');
const ERA = s('Named era id; omit for Shared Base. Pass projectId for an era-only world.');
const LANG = s('Language of names in sentences and cards; omit for the app language.', { enum: ['es', 'en'] });
const PIN = {
  type: 'object',
  properties: {
    id: s('Pin id; any short unique text.'),
    kind: s('realm-exists: the realm stands in year. city-falls: the place is taken in year.', { enum: ['realm-exists', 'city-falls'] }),
    polity: s('realm-exists: realm key from wh_world_history.'),
    place: s('city-falls: settlement or ruin key from wh_world_history.'),
    year: n('Absolute year in the world calendar.', { type: 'integer' }),
    by: s('city-falls: realm key of the conqueror; omit for the strongest neighbour.'),
  },
  required: ['id', 'kind', 'year'],
  additionalProperties: false,
};

/** World history simulation: settings, reading, Codex proposals and the timeline. */
export const WORLD_HISTORY_TOOLS: BridgeTool[] = [
  {
    name: 'wh_world_history_simulate',
    description: `Simulate a world's history by seed · Simula la historia de un mundo con su semilla. Undoable.
Stores the settings on the world in the selected era and returns the history they produce: same world, same settings, same history. Realms rise at today's capitals and at the sites today's ruins mark, expand along terrain and trade ways, wage war, sack and found places, change dynasty and fall; migrations carry languages. The span ends on today's borders. Omitted fields keep their stored value. pins replaces the list of fixed facts (realm-exists, city-falls); facts run in their exact years, including the final year; notes report facts that could not be honoured. Accepted Codex cards are never touched by a new simulation.`,
    writes: true,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID, worldId: WORLD, eraId: ERA,
        seed: s('History seed.'), centuries: n('Length of the span, 1–30 centuries.', { type: 'integer', minimum: 1, maximum: 30 }),
        aggression: n('0 peaceful – 1 constant war.', { minimum: 0, maximum: 1 }), endYear: n('Year of today\'s map in the world calendar.', { type: 'integer' }),
        pins: { type: 'array', items: PIN, description: 'Fixed facts; replaces the stored list.' }, lang: LANG,
      },
      required: ['worldId'], additionalProperties: false,
    },
  },
  {
    name: 'wh_world_history',
    description: `Read a world's simulated history, a realm's or a place's · Lee la historia de un mundo, reino o lugar.
Without realm or place: realms with their dates, ruins with cause and date, substrate place names, and the events (filter by fromYear/toYear and kinds). realm (key or name): its dynasties and rulers, wars, places held, events. place (settlement or ruin key or name): who held it and when, its founding, its fall when it is a ruin, the events there. year: the realms standing and who held each place that year.`,
    writes: false,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID, worldId: WORLD, eraId: ERA, realm: s('Realm key or name.'), place: s('Settlement or ruin key or name.'),
        year: n('A single year: realms standing and holders.', { type: 'integer' }), fromYear: n('Events from this year.', { type: 'integer' }), toYear: n('Events up to this year.', { type: 'integer' }),
        kinds: { type: 'array', items: s('Event kind.'), description: 'Only these event kinds (war, conquest, sack, collapse, dynasty, migration, peace, cession, polity-founded, city-founded, annexed, abandoned, flood).' },
        limit: n('Most events to return (default 200).', { type: 'integer', minimum: 1, maximum: 2000 }), lang: LANG,
      },
      required: ['worldId'], additionalProperties: false,
    },
  },
  {
    name: 'wh_world_history_proposals',
    description: `List Codex cards the world history proposes · Lista las fichas del Códex que propone la historia.
Realms, dynasties, rulers, wars, treaties and ruins, each with a stable key, its fields and text, and accepted: true when its card is already in the Codex. Nothing is written; accept with wh_world_history_accept.`,
    writes: false,
    schema: { type: 'object', properties: { projectId: PROJECT_ID, worldId: WORLD, eraId: ERA, groups: { type: 'array', items: s('Group.', { enum: ['realm', 'dynasty', 'ruler', 'war', 'treaty', 'ruin'] }) }, onlyOpen: b('Only proposals not accepted yet.'), lang: LANG }, required: ['worldId'], additionalProperties: false },
  },
  {
    name: 'wh_world_history_accept',
    description: `Accept proposed history cards into the Codex · Acepta en el Códex fichas de la historia. Undoable.
Writes the cards for keys (from wh_world_history_proposals), or every open proposal of groups when all is true. Cards accepted together are related to each other; ones already accepted are skipped. Only on the author's request.`,
    writes: true,
    schema: { type: 'object', properties: { projectId: PROJECT_ID, worldId: WORLD, eraId: ERA, keys: { type: 'array', items: s('Proposal key.') }, all: b('Every open proposal (of groups, when given).'), groups: { type: 'array', items: s('Group.', { enum: ['realm', 'dynasty', 'ruler', 'war', 'treaty', 'ruin'] }) }, lang: LANG }, required: ['worldId'], additionalProperties: false },
  },
  {
    name: 'wh_world_history_to_timeline',
    description: `Send world history events to a timeline · Lleva los hechos de la historia a la línea de tiempo. Undoable.
Events are dated in the world calendar (wars as ranges) and linked to accepted realm and war cards. The first call creates the timeline; later calls add only the events it does not have yet.`,
    writes: true,
    schema: { type: 'object', properties: { projectId: PROJECT_ID, worldId: WORLD, eraId: ERA, title: s('Timeline title for a new one.'), lang: LANG }, required: ['worldId'], additionalProperties: false },
  },
];
