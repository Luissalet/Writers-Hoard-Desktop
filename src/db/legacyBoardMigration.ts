import type { Transaction } from 'dexie';
import { DEFAULT_NODE_COLOR, DEFAULT_SIZE } from '@/engines/board/catalog';
import type {
  Board,
  BoardEdge,
  BoardEdgeCurvature,
  BoardEdgeDirection,
  BoardEdgeStyle,
  BoardEntityRef,
  BoardNode,
  BoardNodeKind,
  BoardShape,
} from '@/engines/board/types';
import { htmlToText } from '@/engines/_shared/anchoring/htmlToText';

// These are the persisted contracts from the last release before Board
// replaced Yarn Board and Brainstorm. Keep them here, beside the one migration
// that reads them, rather than reviving either retired engine.
interface LegacyYarnBoard {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

type LegacyYarnNodeType =
  | 'character'
  | 'event'
  | 'concept'
  | 'note'
  | 'postit'
  | 'image'
  | 'text'
  | 'group'
  | 'shape';

interface LegacyYarnNode {
  id: string;
  projectId: string;
  boardId: string;
  type: LegacyYarnNodeType;
  title: string;
  content: string;
  image?: string;
  imageOriginal?: string;
  color: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  linkedEntryId?: string;
  childNodeIds?: string[];
  shape?: Exclude<BoardShape, 'hexagon'>;
  richContent?: string;
  zIndex?: number;
}

interface LegacyYarnEdge {
  id: string;
  boardId: string;
  sourceId: string;
  targetId: string;
  color: string;
  style: BoardEdgeStyle;
  label?: string;
  direction?: BoardEdgeDirection;
  curvature?: Exclude<BoardEdgeCurvature, 'arc'>;
}

interface LegacyBrainstormBoard {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

type LegacyBrainstormItemType = 'note' | 'image' | 'entity-ref' | 'text-block' | 'section';

interface LegacyBrainstormItem {
  id: string;
  boardId: string;
  projectId: string;
  type: LegacyBrainstormItemType;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  content?: string;
  color?: string;
  imageData?: string;
  imageDataOriginal?: string;
  refEntityId?: string;
  refEntityType?: string;
  refPreviewData?: string;
  richContent?: string;
  label?: string;
  sectionColor?: string;
  createdAt: number;
  updatedAt: number;
}

interface LegacyBrainstormConnection {
  id: string;
  boardId: string;
  sourceId: string;
  targetId: string;
  label?: string;
  color?: string;
  style?: BoardEdgeStyle;
}

interface IdMaps {
  yarnBoards: Map<string, string>;
  brainstormBoards: Map<string, string>;
  yarnNodes: Map<string, string>;
  brainstormItems: Map<string, string>;
  yarnEdges: Map<string, string>;
  brainstormConnections: Map<string, string>;
}

interface LegacyPreview {
  title?: string;
  subtitle?: string;
  thumbnail?: string;
  color?: string;
}

const LEGACY_NOTE_COLORS: Record<string, string> = {
  yellow: '#fef3c7',
  pink: '#fce7f3',
  blue: '#dbeafe',
  green: '#d1fae5',
  purple: '#ede9fe',
};

const ENTITY_TYPE_ENGINES: Record<string, string> = {
  codex: 'codex',
  'codex-entry': 'codex',
  character: 'codex',
  location: 'codex',
  timeline: 'timeline',
  'timeline-event': 'timeline',
  snapshot: 'scrapper',
  scrapper: 'scrapper',
  scene: 'dialog-scene',
  'dialog-block': 'dialog-scene',
  'dialog-scene': 'dialog-scene',
  writing: 'writings',
  writings: 'writings',
  image: 'gallery',
  gallery: 'gallery',
  note: 'notes',
  notes: 'notes',
  storyboard: 'storyboard',
  panel: 'storyboard',
  biography: 'biography',
  'biography-fact': 'biography',
  outline: 'outline',
  'outline-beat': 'outline',
  'character-arc': 'character-arc',
  'arc-beat': 'character-arc',
  relationship: 'relationships',
  seed: 'seeds',
  payoff: 'seeds',
  diary: 'diary',
  'diary-entry': 'diary',
  maps: 'maps',
  'map-pin': 'maps',
  'video-planner': 'video-planner',
  'video-segment': 'video-planner',
  'writing-stats': 'writing-stats',
  'writing-session': 'writing-stats',
};

/**
 * Allocate destination IDs without changing any ID that is unique across the
 * two source tables. Yarn wins a true cross-engine collision; the Brainstorm
 * row receives a deterministic, reserved-prefix ID and all of its references
 * are rewritten through the returned map.
 */
function allocateIds(
  yarnIds: string[],
  brainstormIds: string[],
  entity: 'board' | 'node' | 'edge',
): [Map<string, string>, Map<string, string>] {
  const yarn = new Map<string, string>();
  const brainstorm = new Map<string, string>();
  const originals = new Set([...yarnIds, ...brainstormIds]);
  const used = new Set<string>();

  for (const id of [...yarnIds].sort()) {
    yarn.set(id, id);
    used.add(id);
  }

  for (const id of [...brainstormIds].sort()) {
    if (!used.has(id)) {
      brainstorm.set(id, id);
      used.add(id);
      continue;
    }

    const base = `legacy:brainstorm:${entity}:${id}`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate) || originals.has(candidate)) {
      candidate = `${base}:${suffix}`;
      suffix += 1;
    }
    brainstorm.set(id, candidate);
    used.add(candidate);
  }

  return [yarn, brainstorm];
}

function mapped(map: ReadonlyMap<string, string>, id: string, context: string): string {
  const result = map.get(id);
  if (result === undefined) {
    throw new Error(`Cannot migrate ${context}: missing legacy target "${id}".`);
  }
  return result;
}

function yarnNodeKind(type: LegacyYarnNodeType): BoardNodeKind {
  switch (type) {
    case 'character':
    case 'event':
    case 'concept':
    case 'note':
      return 'card';
    case 'group':
      return 'frame';
    default:
      return type;
  }
}

function brainstormNodeKind(type: LegacyBrainstormItemType): BoardNodeKind {
  switch (type) {
    case 'note': return 'postit';
    case 'image': return 'image';
    case 'entity-ref': return 'entity';
    case 'text-block': return 'text';
    case 'section': return 'frame';
  }
}

function nodeSize(kind: BoardNodeKind, width?: number, height?: number): { width: number; height: number } {
  return {
    width: width ?? DEFAULT_SIZE[kind].width,
    height: height ?? DEFAULT_SIZE[kind].height,
  };
}

function parsePreview(value: string | undefined): LegacyPreview {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const row = parsed as Record<string, unknown>;
    return {
      title: typeof row.title === 'string' ? row.title : undefined,
      subtitle: typeof row.subtitle === 'string' ? row.subtitle : undefined,
      thumbnail: typeof row.thumbnail === 'string' ? row.thumbnail : undefined,
      color: typeof row.color === 'string' ? row.color : undefined,
    };
  } catch {
    return {};
  }
}

function remapLegacyEntity(
  engineId: string,
  entityType: string | undefined,
  entityId: string,
  maps: IdMaps,
): { engineId: string; entityType?: string; entityId: string; missing?: boolean } {
  if (engineId === 'yarn-board' || entityType === 'yarn-board' || entityType === 'yarn-node') {
    if (entityType === 'yarn-board') {
      const next = maps.yarnBoards.get(entityId);
      return {
        engineId: 'board',
        entityType: 'board',
        entityId: next ?? entityId,
        missing: next === undefined,
      };
    }
    if (entityType === 'yarn-node') {
      const next = maps.yarnNodes.get(entityId);
      return {
        engineId: 'board',
        entityType: 'board-node',
        entityId: next ?? entityId,
        missing: next === undefined,
      };
    }
    // The annotation/receipt contracts carry no entity type. Match the old
    // Yarn resolver's node-first lookup, then fall back to a board.
    const nodeId = maps.yarnNodes.get(entityId);
    if (nodeId !== undefined) return { engineId: 'board', entityType, entityId: nodeId };
    const boardId = maps.yarnBoards.get(entityId);
    return {
      engineId: 'board',
      entityType,
      entityId: boardId ?? entityId,
      missing: boardId === undefined,
    };
  }

  if (engineId === 'brainstorm' || entityType === 'brainstorm') {
    const boardId = maps.brainstormBoards.get(entityId);
    return {
      engineId: 'board',
      entityType: 'board',
      entityId: boardId ?? entityId,
      missing: boardId === undefined,
    };
  }

  return { engineId, entityType, entityId };
}

function brainstormRef(item: LegacyBrainstormItem, maps: IdMaps): BoardEntityRef | undefined {
  if (!item.refEntityId || !item.refEntityType) return undefined;
  const preview = parsePreview(item.refPreviewData);
  const initialEngine = ENTITY_TYPE_ENGINES[item.refEntityType] ?? item.refEntityType;
  const target = remapLegacyEntity(initialEngine, item.refEntityType, item.refEntityId, maps);
  return {
    engineId: target.engineId,
    entityType: target.entityType ?? item.refEntityType,
    entityId: target.entityId,
    title: preview.title ?? item.refEntityId,
    subtitle: preview.subtitle,
    thumbnail: preview.thumbnail,
    color: preview.color,
    missing: target.missing,
  };
}

function yarnEdgeKind(color: string): string {
  switch (color.toLowerCase()) {
    case '#c4463a': return 'conflict';
    case '#4a9e6d': return 'alliance';
    case '#4a7ec4': return 'romance';
    case '#d4a843': return 'mystery';
    default: return 'related';
  }
}

function assertNodeBelongsToBoard(
  nodeProjectId: string,
  board: LegacyYarnBoard | LegacyBrainstormBoard,
  context: string,
): void {
  if (nodeProjectId !== board.projectId) {
    throw new Error(
      `Cannot migrate ${context}: project "${nodeProjectId}" does not own board "${board.id}".`,
    );
  }
}

function remapConnectionEndpoint<T extends { id: string; boardId: string }>(
  rows: ReadonlyMap<string, T>,
  map: ReadonlyMap<string, string>,
  id: string,
  boardId: string,
  context: string,
): string {
  const row = rows.get(id);
  if (!row || row.boardId !== boardId) {
    throw new Error(`Cannot migrate ${context}: endpoint "${id}" is missing from board "${boardId}".`);
  }
  return mapped(map, id, context);
}

/**
 * Copy both retired canvas models into Board while all eleven stores coexist
 * in the v24 schema. Dexie runs this callback and the schema change in one
 * transaction: any validation/write failure leaves the database at v23 with
 * every legacy row intact. bulkPut plus deterministic IDs makes the body safe
 * to repeat before v25 removes the six source stores.
 */
export async function migrateLegacyBoards(tx: Transaction): Promise<void> {
  const [
    yarnBoards,
    yarnNodes,
    yarnEdges,
    brainstormBoards,
    brainstormItems,
    brainstormConnections,
  ] = await Promise.all([
    tx.table('yarnBoards').toArray() as Promise<LegacyYarnBoard[]>,
    tx.table('yarnNodes').toArray() as Promise<LegacyYarnNode[]>,
    tx.table('yarnEdges').toArray() as Promise<LegacyYarnEdge[]>,
    tx.table('brainstormBoards').toArray() as Promise<LegacyBrainstormBoard[]>,
    tx.table('brainstormItems').toArray() as Promise<LegacyBrainstormItem[]>,
    tx.table('brainstormConnections').toArray() as Promise<LegacyBrainstormConnection[]>,
  ]);

  const [yarnBoardIds, brainstormBoardIds] = allocateIds(
    yarnBoards.map((row) => row.id),
    brainstormBoards.map((row) => row.id),
    'board',
  );
  const [yarnNodeIds, brainstormItemIds] = allocateIds(
    yarnNodes.map((row) => row.id),
    brainstormItems.map((row) => row.id),
    'node',
  );
  const [yarnEdgeIds, brainstormConnectionIds] = allocateIds(
    yarnEdges.map((row) => row.id),
    brainstormConnections.map((row) => row.id),
    'edge',
  );
  const maps: IdMaps = {
    yarnBoards: yarnBoardIds,
    brainstormBoards: brainstormBoardIds,
    yarnNodes: yarnNodeIds,
    brainstormItems: brainstormItemIds,
    yarnEdges: yarnEdgeIds,
    brainstormConnections: brainstormConnectionIds,
  };

  const yarnBoardById = new Map(yarnBoards.map((row) => [row.id, row]));
  const brainstormBoardById = new Map(brainstormBoards.map((row) => [row.id, row]));
  const yarnNodeById = new Map(yarnNodes.map((row) => [row.id, row]));
  const brainstormItemById = new Map(brainstormItems.map((row) => [row.id, row]));

  const boards: Board[] = [
    ...yarnBoards.map((row): Board => ({
      id: mapped(yarnBoardIds, row.id, 'Yarn board'),
      projectId: row.projectId,
      title: row.title,
      // Neither legacy board persisted a surface. Use the same default as the
      // current Board creation path; do not infer author intent from engine ID.
      surface: 'cork',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    ...brainstormBoards.map((row): Board => ({
      id: mapped(brainstormBoardIds, row.id, 'Brainstorm board'),
      projectId: row.projectId,
      title: row.title,
      surface: 'cork',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
  ];

  const nodes: BoardNode[] = [
    ...yarnNodes.map((row): BoardNode => {
      const owner = yarnBoardById.get(row.boardId);
      if (!owner) throw new Error(`Cannot migrate Yarn node "${row.id}": board "${row.boardId}" is missing.`);
      assertNodeBelongsToBoard(row.projectId, owner, `Yarn node "${row.id}"`);
      const kind = yarnNodeKind(row.type);
      const childIds = row.childNodeIds?.map((id) => yarnNodeIds.get(id) ?? id);
      return {
        id: mapped(yarnNodeIds, row.id, 'Yarn node'),
        projectId: row.projectId,
        boardId: mapped(yarnBoardIds, row.boardId, `Yarn node "${row.id}"`),
        kind,
        role: kind === 'card' ? row.type : undefined,
        title: row.title,
        content: row.content,
        richContent: row.richContent,
        image: row.image,
        imageOriginal: row.imageOriginal,
        color: row.color,
        position: { ...row.position },
        size: nodeSize(kind, row.width, row.height),
        shape: row.shape,
        zIndex: row.zIndex ?? (kind === 'frame' ? -1 : 0),
        tags: [],
        props: childIds?.length ? { 'legacy.yarn.childNodeIds': JSON.stringify(childIds) } : undefined,
        ref: row.linkedEntryId
          ? {
              engineId: 'codex',
              entityType: 'codex-entry',
              entityId: row.linkedEntryId,
              title: row.title,
            }
          : undefined,
        createdAt: owner.createdAt,
        updatedAt: owner.updatedAt,
      };
    }),
    ...brainstormItems.map((row): BoardNode => {
      const owner = brainstormBoardById.get(row.boardId);
      if (!owner) {
        throw new Error(`Cannot migrate Brainstorm item "${row.id}": board "${row.boardId}" is missing.`);
      }
      assertNodeBelongsToBoard(row.projectId, owner, `Brainstorm item "${row.id}"`);
      const kind = brainstormNodeKind(row.type);
      const preview = parsePreview(row.refPreviewData);
      const color = row.type === 'note'
        ? (LEGACY_NOTE_COLORS[row.color ?? ''] ?? row.color ?? '#fef3c7')
        : row.type === 'section'
          ? (row.sectionColor ?? '#6b7280')
          : (preview.color ?? DEFAULT_NODE_COLOR[kind]);
      return {
        id: mapped(brainstormItemIds, row.id, 'Brainstorm item'),
        projectId: row.projectId,
        boardId: mapped(brainstormBoardIds, row.boardId, `Brainstorm item "${row.id}"`),
        kind,
        title: row.type === 'section'
          ? (row.label ?? '')
          : row.type === 'entity-ref'
            ? (preview.title ?? row.refEntityId ?? '')
            : '',
        content: row.content ?? htmlToText(row.richContent),
        richContent: row.richContent,
        image: row.imageData,
        imageOriginal: row.imageDataOriginal,
        color,
        position: { ...row.position },
        size: nodeSize(kind, row.width, row.height),
        zIndex: kind === 'frame' ? -1 : 0,
        tags: [],
        ref: row.type === 'entity-ref' ? brainstormRef(row, maps) : undefined,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }),
  ];

  const edges: BoardEdge[] = [
    ...yarnEdges.map((row): BoardEdge => {
      const owner = yarnBoardById.get(row.boardId);
      if (!owner) throw new Error(`Cannot migrate Yarn edge "${row.id}": board "${row.boardId}" is missing.`);
      const sourceId = remapConnectionEndpoint(
        yarnNodeById, yarnNodeIds, row.sourceId, row.boardId, `Yarn edge "${row.id}"`,
      );
      const targetId = remapConnectionEndpoint(
        yarnNodeById, yarnNodeIds, row.targetId, row.boardId, `Yarn edge "${row.id}"`,
      );
      return {
        id: mapped(yarnEdgeIds, row.id, 'Yarn edge'),
        projectId: owner.projectId,
        boardId: mapped(yarnBoardIds, row.boardId, `Yarn edge "${row.id}"`),
        sourceId,
        targetId,
        sources: [{ id: sourceId, on: 'node' }],
        targets: [{ id: targetId, on: 'node' }],
        kind: yarnEdgeKind(row.color),
        label: row.label,
        color: row.color,
        style: row.style,
        width: 0,
        direction: row.direction ?? 'none',
        curvature: row.curvature ?? 'curved',
        weight: 1,
        certainty: 1,
        tags: [],
        createdAt: owner.createdAt,
        updatedAt: owner.updatedAt,
      };
    }),
    ...brainstormConnections.map((row): BoardEdge => {
      const owner = brainstormBoardById.get(row.boardId);
      if (!owner) {
        throw new Error(`Cannot migrate Brainstorm connection "${row.id}": board "${row.boardId}" is missing.`);
      }
      const sourceId = remapConnectionEndpoint(
        brainstormItemById,
        brainstormItemIds,
        row.sourceId,
        row.boardId,
        `Brainstorm connection "${row.id}"`,
      );
      const targetId = remapConnectionEndpoint(
        brainstormItemById,
        brainstormItemIds,
        row.targetId,
        row.boardId,
        `Brainstorm connection "${row.id}"`,
      );
      return {
        id: mapped(brainstormConnectionIds, row.id, 'Brainstorm connection'),
        projectId: owner.projectId,
        boardId: mapped(brainstormBoardIds, row.boardId, `Brainstorm connection "${row.id}"`),
        sourceId,
        targetId,
        sources: [{ id: sourceId, on: 'node' }],
        targets: [{ id: targetId, on: 'node' }],
        kind: 'related',
        label: row.label,
        color: row.color ?? '#9ca3af',
        style: row.style ?? 'solid',
        width: 0,
        direction: 'none',
        curvature: 'curved',
        weight: 1,
        certainty: 1,
        tags: [],
        createdAt: owner.createdAt,
        updatedAt: owner.updatedAt,
      };
    }),
  ];

  if (boards.length) await tx.table('boards').bulkPut(boards);
  if (nodes.length) await tx.table('boardNodes').bulkPut(nodes);
  if (edges.length) await tx.table('boardEdges').bulkPut(edges);

  const swapEngines = (list: unknown): string[] | undefined => {
    if (!Array.isArray(list)) return undefined;
    const mappedList = (list as string[]).map((id) =>
      id === 'yarn-board' || id === 'brainstorm' ? 'board' : id,
    );
    return mappedList.filter((id, index) => mappedList.indexOf(id) === index);
  };
  await tx.table('projects').toCollection().modify((project: Record<string, unknown>) => {
    const enabled = swapEngines(project.enabledEngines);
    if (enabled) project.enabledEngines = enabled;
    const order = swapEngines(project.engineOrder);
    if (order) project.engineOrder = order;
  });

  await tx.table('annotations').toCollection().modify((row: Record<string, unknown>) => {
    if (typeof row.sourceEngineId !== 'string' || typeof row.sourceEntityId !== 'string') return;
    const target = remapLegacyEntity(row.sourceEngineId, undefined, row.sourceEntityId, maps);
    row.sourceEngineId = target.engineId;
    row.sourceEntityId = target.entityId;
  });
  await tx.table('annotationReferences').toCollection().modify((row: Record<string, unknown>) => {
    if (typeof row.targetEngineId !== 'string' || typeof row.targetEntityId !== 'string') return;
    const target = remapLegacyEntity(row.targetEngineId, undefined, row.targetEntityId, maps);
    row.targetEngineId = target.engineId;
    row.targetEntityId = target.entityId;
  });

  await tx.table('entityLinks').toCollection().modify((row: Record<string, unknown>) => {
    for (const side of ['source', 'target'] as const) {
      const engineField = `${side}EngineId`;
      const typeField = `${side}EntityType`;
      const idField = `${side}EntityId`;
      if (typeof row[engineField] !== 'string' || typeof row[idField] !== 'string') continue;
      const entityType = typeof row[typeField] === 'string' ? row[typeField] : undefined;
      const target = remapLegacyEntity(row[engineField], entityType, row[idField], maps);
      row[engineField] = target.engineId;
      row[idField] = target.entityId;
      if (target.entityType) row[typeField] = target.entityType;
    }
  });
  await tx.table('conversionReceipts').toCollection().modify((row: Record<string, unknown>) => {
    for (const side of ['source', 'target'] as const) {
      const engineField = `${side}EngineId`;
      const idField = `${side}EntityId`;
      if (typeof row[engineField] !== 'string' || typeof row[idField] !== 'string') continue;
      const target = remapLegacyEntity(row[engineField], undefined, row[idField], maps);
      row[engineField] = target.engineId;
      row[idField] = target.entityId;
    }
  });
}
