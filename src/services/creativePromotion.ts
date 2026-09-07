import { db } from '@/db';
import { touchProject } from '@/db/operations';
import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import type { CreativePromotionRequest, CreativePromotionResult } from '@/components/project/creative-lab/types';
import type { CharacterPressurePromotionDraft } from './characterPressureChamber';
import { generateId } from '@/utils/idGenerator';

export type DevelopmentPromotionTarget =
  | CreativePromotionRequest['target']
  | 'scene';

export interface DevelopmentSourceReference {
  engineId: string;
  entityType: string;
  entityId: string;
  title: string;
}

export interface DevelopmentPromotionLabels {
  boardTitle: string;
  outlineTitle: string;
  timelineTitle: string;
}

export interface DevelopmentPromotionInput {
  projectId: string;
  target: DevelopmentPromotionTarget;
  title: string;
  text: string;
  group?: string;
  boardRole?: string;
  sources: readonly DevelopmentSourceReference[];
  origin: 'ideas-table' | 'constraint-deck' | 'character-pressure' | 'causal-map';
  provenance: unknown;
}

export interface DevelopmentPromotionResult extends CreativePromotionResult {
  engineId: string;
  entityType: string;
}

const DEFAULT_LABELS: DevelopmentPromotionLabels = {
  boardTitle: 'Idea Lab',
  outlineTitle: 'Development outline',
  timelineTitle: 'Development timeline',
};

const SOURCE_TABLES: Readonly<Record<string, string>> = {
  'notes:note': 'notes',
  'board:board-node': 'boardNodes',
  'codex:codex-entry': 'codexEntries',
  'gallery:inspiration-image': 'inspirationImages',
  'seeds:seed': 'seeds',
  'writings:writing': 'writings',
  'dialog-scene:scene': 'scenes',
  'outline:outline-beat': 'outlineBeats',
  'timeline:timeline-event': 'timelineEvents',
  'character-arc:character-arc': 'characterArcs',
  'relationships:relationship': 'relationships',
  'scrapper:snapshot': 'snapshots',
  'maps:map-pin': 'mapPins',
};

const SOURCE_ENGINE_TABLES: Readonly<Record<string, string>> = {
  notes: 'notes',
  board: 'boardNodes',
  codex: 'codexEntries',
  gallery: 'inspirationImages',
  seeds: 'seeds',
  writings: 'writings',
  'dialog-scene': 'scenes',
  outline: 'outlineBeats',
  timeline: 'timelineEvents',
  'character-arc': 'characterArcs',
  relationships: 'relationships',
  scrapper: 'snapshots',
  maps: 'mapPins',
};

function normalized(value: string, fallback: string): string {
  return value.trim() || fallback;
}

function htmlParagraphs(value: string): string {
  const escape = (part: string) => part
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return value
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escape(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function compactProvenance(origin: DevelopmentPromotionInput['origin'], provenance: unknown): string {
  try {
    const serialized = JSON.stringify({ version: 1, origin, payload: provenance });
    return serialized.length <= 20_000
      ? serialized
      : JSON.stringify({ version: 1, origin, truncated: true });
  } catch {
    return JSON.stringify({ version: 1, origin, unreadablePayload: true });
  }
}

function sourceTable(source: DevelopmentSourceReference): string | null {
  return SOURCE_TABLES[`${source.engineId}:${source.entityType}`]
    ?? SOURCE_ENGINE_TABLES[source.engineId]
    ?? null;
}

async function assertSourcesBelongToProject(
  projectId: string,
  sources: readonly DevelopmentSourceReference[],
): Promise<void> {
  for (const source of sources) {
    const tableName = sourceTable(source);
    if (!tableName) throw new Error(`Unsupported development source: ${source.engineId}:${source.entityType}`);
    const row = await db.table(tableName).get(source.entityId) as { projectId?: string } | undefined;
    if (!row || row.projectId !== projectId) {
      throw new Error(`Development source is missing or belongs to another project: ${source.entityId}`);
    }
  }
}

function uniqueSources(sources: readonly DevelopmentSourceReference[]): DevelopmentSourceReference[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.engineId}:${source.entityType}:${source.entityId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Materialise one exploratory result and its source edges in a single Dexie
 * transaction. A failed source or target validation therefore leaves neither
 * a half-created canonical entity nor a misleading provenance link.
 */
export async function promoteDevelopmentDraft(
  input: DevelopmentPromotionInput,
  labels: Partial<DevelopmentPromotionLabels> = {},
): Promise<DevelopmentPromotionResult> {
  const projectId = input.projectId.trim();
  const title = normalized(input.title, 'Untitled possibility');
  const text = input.text.trim();
  if (!projectId) throw new Error('A project is required');
  if (!text) throw new Error('A development draft needs content');

  const sources = uniqueSources(input.sources);
  if (sources.length === 0) throw new Error('A development draft needs at least one live source');
  const copy = { ...DEFAULT_LABELS, ...labels };
  const now = Date.now();
  const entityId = generateId(`creative-${input.target}`);
  let targetEngineId = '';
  let targetEntityType = '';

  await db.transaction('rw', [
    db.projects,
    db.notes,
    db.boards,
    db.boardNodes,
    db.codexEntries,
    db.seeds,
    db.outlines,
    db.outlineBeats,
    db.timelines,
    db.timelineEvents,
    db.scenes,
    db.entityLinks,
    db.inspirationImages,
    db.writings,
    db.characterArcs,
    db.relationships,
    db.snapshots,
    db.mapPins,
  ], async () => {
    if (!await db.projects.get(projectId)) throw new Error('Development project does not exist');
    await assertSourcesBelongToProject(projectId, sources);

    switch (input.target) {
      case 'note': {
        targetEngineId = 'notes';
        targetEntityType = 'note';
        await db.notes.add({
          id: entityId,
          projectId,
          kind: 'idea',
          text: `${title}\n\n${text}`,
          source: input.origin,
          tags: input.group ? [input.group] : [],
          pinned: false,
          createdAt: now,
          updatedAt: now,
        });
        break;
      }
      case 'board': {
        targetEngineId = 'board';
        targetEntityType = 'board-node';
        let board = await db.boards.where('projectId').equals(projectId).first();
        if (!board) {
          board = {
            id: generateId('creative-board'),
            projectId,
            title: copy.boardTitle,
            surface: 'cork',
            viewport: { x: 0, y: 0, zoom: 1 },
            createdAt: now,
            updatedAt: now,
          };
          await db.boards.add(board);
        }
        const count = await db.boardNodes.where('boardId').equals(board.id).count();
        await db.boardNodes.add({
          id: entityId,
          projectId,
          boardId: board.id,
          kind: 'card',
          role: input.boardRole?.trim() || 'possibility',
          title,
          content: text,
          richContent: htmlParagraphs(text),
          color: '#c4973b',
          position: { x: 80 + (count % 5) * 280, y: 80 + Math.floor(count / 5) * 210 },
          size: { width: 240, height: 150 },
          zIndex: count + 1,
          tags: input.group ? [input.group] : [],
          props: { developmentOrigin: input.origin, sourceCount: sources.length },
          createdAt: now,
          updatedAt: now,
        });
        break;
      }
      case 'codex': {
        targetEngineId = 'codex';
        targetEntityType = 'codex-entry';
        await db.codexEntries.add({
          id: entityId,
          projectId,
          type: 'concept',
          title,
          fields: {},
          content: htmlParagraphs(text),
          tags: input.group ? [input.group] : [],
          relations: [],
          createdAt: now,
          updatedAt: now,
        });
        break;
      }
      case 'seed': {
        targetEngineId = 'seeds';
        targetEntityType = 'seed';
        await db.seeds.add({
          id: entityId,
          projectId,
          title,
          description: text,
          kind: 'mystery',
          status: 'planted',
          tags: input.group ? [input.group] : [],
          color: '#c4973b',
          createdAt: now,
          updatedAt: now,
        });
        break;
      }
      case 'outline': {
        targetEngineId = 'outline';
        targetEntityType = 'outline-beat';
        let outline = await db.outlines.where('projectId').equals(projectId).first();
        if (!outline) {
          outline = {
            id: generateId('creative-outline'),
            projectId,
            title: copy.outlineTitle,
            createdAt: now,
            updatedAt: now,
          };
          await db.outlines.add(outline);
        }
        const beats = await db.outlineBeats.where('outlineId').equals(outline.id).toArray();
        const order = beats.reduce((max, beat) => Math.max(max, beat.order), -1) + 1;
        await db.outlineBeats.add({
          id: entityId,
          projectId,
          outlineId: outline.id,
          order,
          level: 'beat',
          title,
          description: text,
          status: 'outlined',
          color: '#c4973b',
          createdAt: now,
          updatedAt: now,
        });
        break;
      }
      case 'timeline': {
        targetEngineId = 'timeline';
        targetEntityType = 'timeline-event';
        let timeline = await db.timelines.where('projectId').equals(projectId).first();
        if (!timeline) {
          timeline = {
            id: generateId('creative-timeline'),
            projectId,
            title: copy.timelineTitle,
            color: '#c4973b',
            createdAt: now,
            updatedAt: now,
          };
          await db.timelines.add(timeline);
        }
        const events = await db.timelineEvents.where('timelineId').equals(timeline.id).toArray();
        const order = events.reduce((max, event) => Math.max(max, event.order), -1) + 1;
        await db.timelineEvents.add({
          id: entityId,
          projectId,
          timelineId: timeline.id,
          title,
          description: text,
          date: '',
          dateMode: 'text',
          eventType: 'point',
          order,
          lane: 'development',
          color: '#c4973b',
          createdAt: now,
          updatedAt: now,
        });
        break;
      }
      case 'scene': {
        targetEngineId = 'dialog-scene';
        targetEntityType = 'scene';
        const scenes = await db.scenes.where('projectId').equals(projectId).toArray();
        const order = scenes.reduce((max, scene) => Math.max(max, scene.order), -1) + 1;
        await db.scenes.add({
          id: entityId,
          projectId,
          title,
          description: text,
          order,
          tags: input.group ? [input.group] : [],
          createdAt: now,
          updatedAt: now,
        });
        break;
      }
    }

    const linkNotes = compactProvenance(input.origin, input.provenance);
    await db.entityLinks.bulkAdd(sources.map((source) => ({
      id: generateId('creative-link'),
      projectId,
      sourceEngineId: source.engineId,
      sourceEntityType: source.entityType,
      sourceEntityId: source.entityId,
      sourceTitle: source.title,
      targetEngineId,
      targetEntityType,
      targetEntityId: entityId,
      targetTitle: title,
      relation: 'developed-into',
      notes: linkNotes,
      provenance: 'manual' as const,
      createdAt: now,
      updatedAt: now,
    })));
  });

  notifyDataChanged({ source: 'other', projectId, entityId });
  await touchProject(projectId);
  return { entityId, label: title, engineId: targetEngineId, entityType: targetEntityType };
}

const CREATIVE_SOURCE_REFS: Readonly<Record<string, Pick<DevelopmentSourceReference, 'engineId' | 'entityType'>>> = {
  note: { engineId: 'notes', entityType: 'note' },
  board: { engineId: 'board', entityType: 'board-node' },
  codex: { engineId: 'codex', entityType: 'codex-entry' },
  gallery: { engineId: 'gallery', entityType: 'inspiration-image' },
  seed: { engineId: 'seeds', entityType: 'seed' },
};

export function promoteCreativePossibility(
  request: CreativePromotionRequest,
  labels: Partial<DevelopmentPromotionLabels> = {},
): Promise<DevelopmentPromotionResult> {
  return promoteDevelopmentDraft({
    projectId: request.projectId,
    target: request.target,
    title: request.title,
    text: request.text,
    group: request.group,
    sources: request.provenance.sources.map((source) => ({
      ...CREATIVE_SOURCE_REFS[source.kind],
      entityId: source.id,
      title: source.title,
    })),
    origin: request.provenance.origin,
    provenance: request.provenance,
  }, labels);
}

export function promoteCharacterPressureDraft(
  projectId: string,
  draft: CharacterPressurePromotionDraft,
  labels: Partial<DevelopmentPromotionLabels> = {},
): Promise<DevelopmentPromotionResult> {
  const target: DevelopmentPromotionTarget = draft.target === 'beat'
    ? 'outline'
    : draft.target === 'scene'
      ? 'scene'
      : 'note';
  const sources: DevelopmentSourceReference[] = [
    ...draft.provenance.codexEntryIds.map((entityId) => ({
      engineId: 'codex', entityType: 'codex-entry', entityId,
      title: entityId,
    })),
    ...draft.provenance.characterArcIds.map((entityId) => ({
      engineId: 'character-arc', entityType: 'character-arc', entityId,
      title: entityId,
    })),
    ...draft.provenance.relationshipIds.map((entityId) => ({
      engineId: 'relationships', entityType: 'relationship', entityId,
      title: entityId,
    })),
  ];
  return promoteDevelopmentDraft({
    projectId,
    target,
    title: draft.title,
    text: draft.prompt,
    group: draft.target === 'relationship-change' ? 'relationship possibility' : 'character pressure',
    sources,
    origin: 'character-pressure',
    provenance: draft.provenance,
  }, labels);
}
