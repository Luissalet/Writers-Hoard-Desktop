import { arr, PROJECT_ID, s, type BridgeTool } from './schema';

const ROLES = ['absent', 'mention', 'presence', 'pov'] as const;
const EVIDENCE = ['narrated', 'not_narrated', 'contradiction', 'unverified'] as const;
const VIEWS = ['list', 'binder', 'kanban'] as const;

export const COVERAGE_TOOLS: BridgeTool[] = [
  {
    name: 'wh_get_narrative_coverage',
    writes: false,
    description: `Character×chapter coverage matrix for one project.
Mention = name/alias in that chapter's prose only — never upgraded to presence/POV by itself. Entity/planning links appear as plannedPresence/plannedPov flags and do not change role. POV is inferred only from explicit prose markers (pov:Name); presence requires a manual override (stores chapter contentHash; overrideStale falls back to inference when prose changes). Also lists outline beats linked to an empty writing. Does not replace wh_pov_audit or outline coverage percentages.`,
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_set_coverage_cell',
    writes: true,
    description: `Set or clear a manual character×chapter coverage role.
Use presence/pov here when the chapter actually stages or narrates from the character. clear:true removes the override. Does not edit the manuscript.`,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        characterId: s('Codex character id.'),
        writingId: s('Writing/chapter id.'),
        role: s('Manual coverage role.', { enum: [...ROLES] }),
        clear: { type: 'boolean', description: 'Remove the manual override.' },
      },
      required: ['characterId', 'writingId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_list_timeline_evidence',
    writes: false,
    description: `Whether each timeline event is narrated in the manuscript.
Narrated only with an anchored multi-token title witness in one non-empty chapter (word boundaries; think/remember/avoid frames do not count). A single title token never certifies narration. A linked character mentioned without those words is not_narrated. Otherwise unverified. Hash mismatch (writing or manuscript) or legacy override without hash → unverified+stale. Rows may include witness {writingId,chapter,excerpt}.`,
    schema: {
      type: 'object',
      properties: { projectId: PROJECT_ID },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_set_timeline_evidence',
    writes: true,
    description: `Set or clear a manual timeline evidence status for one event.
Statuses: narrated, not_narrated, contradiction, unverified. Optional writingId stores a content hash; later edits force unverified+stale. clear:true removes the override.`,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        eventId: s('Timeline event id.'),
        status: s('Manual evidence status.', { enum: [...EVIDENCE] }),
        writingId: s('Optional writing whose content hash anchors the judgment.'),
        note: s('Optional short note.'),
        clear: { type: 'boolean', description: 'Remove the manual override.' },
      },
      required: ['eventId'],
      additionalProperties: false,
    },
  },
  {
    name: 'wh_get_manuscript_board',
    writes: false,
    description: `List, binder or kanban projection of the same Writing rows.
No parallel store: cards are writings with their status and chapter order. mode list|binder|kanban changes presentation only.`,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        mode: s('View mode.', { enum: [...VIEWS] }),
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_list_phrase_recurrence',
    writes: false,
    description: `Filler/muletilla and phrase recurrence across the manuscript.
Marks phrases that repeat (count≥2 or near-repeat in a chapter). Does not auto-correct. Optional fillers and exclusions override the default es/en lists. Distinct from the world bible exporter.`,
    schema: {
      type: 'object',
      properties: {
        projectId: PROJECT_ID,
        locale: s('Filler list language.', { enum: ['es', 'en'] }),
        fillers: arr('Optional filler phrases to scan.'),
        exclusions: arr('Phrases to ignore.'),
      },
      additionalProperties: false,
    },
  },
];
