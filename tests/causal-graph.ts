import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CausalConsequencesMap, {
  type CausalConsequencesMapCopy,
} from '../src/components/causal/CausalConsequencesMap';
import type { BoardEdge, BoardNode } from '../src/engines/board/types';
import type { Payoff, Seed } from '../src/engines/seeds/types';
import {
  buildCausalGraph,
  causalRelationFromEntityLink,
  causalRelationsFromBoard,
  causalRelationsFromSeeds,
  causalRelationsFromTimeline,
  materializeCausalEntityLink,
  mergeCausalRelations,
  normalizeCausalRelationKind,
  type CausalCanonState,
  type CausalEntityReference,
  type CausalNecessity,
  type CausalRelation,
  type CausalRelationKind,
} from '../src/services/causalGraph';
import type { TimelineConnection, TimelineEvent } from '../src/types';
import type { EntityLink } from '../src/types/projectTools';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const PROJECT_ID = 'project-causal-test';

function ref(id: string, title = id): CausalEntityReference {
  return {
    engineId: 'codex',
    entityType: 'codex-entry',
    entityId: id,
    title,
  };
}

function relation(
  id: string,
  kind: CausalRelationKind,
  source: CausalEntityReference,
  target: CausalEntityReference,
  overrides: Partial<Pick<
    CausalRelation,
    'certainty' | 'canonState' | 'necessity' | 'deliberateCoincidence'
  >> = {},
): CausalRelation {
  return {
    id,
    projectId: PROJECT_ID,
    kind,
    source,
    target,
    certainty: 1,
    canonState: 'canon',
    necessity: 'necessary',
    deliberateCoincidence: false,
    origin: { kind: 'entity-link', id },
    ...overrides,
  };
}

function testVocabularyAndStorageShape(): string {
  assert(normalizeCausalRelationKind('causa') === 'cause', 'Spanish cause was not normalized');
  assert(normalizeCausalRelationKind('hipótesis') === 'hypothesis', 'accented hypothesis was not normalized');
  assert(normalizeCausalRelationKind('blocks') === 'obstacle', 'Board causal alias was not normalized');
  assert(normalizeCausalRelationKind('precedes') === null, 'chronology was invented as causality');

  const row = materializeCausalEntityLink({
    projectId: PROJECT_ID,
    kind: 'enables',
    source: ref('source', 'Source'),
    target: ref('target', 'Target'),
    certainty: 0.8,
    canonState: 'hypothesis',
    necessity: 'possible',
    deliberateCoincidence: true,
    notes: 'Only the assertion, never duplicated entity content.',
  }, { id: 'link-1', now: 20, createdAt: 10 });
  assert(row.relation === 'enables', 'causal kind did not use EntityLink.relation');
  assert(row.causal.version === 1 && row.causal.certainty === 0.8, 'causal metadata was not versioned');
  assert(row.createdAt === 10 && row.updatedAt === 20, 'link timestamps were not stable on update');
  const projected = causalRelationFromEntityLink(row);
  assert(projected?.canonState === 'hypothesis', 'stored canonical state was not projected');
  assert(projected?.origin.id === row.id, 'projection lost the canonical EntityLink id');

  let rejected = false;
  try {
    materializeCausalEntityLink({
      projectId: PROJECT_ID,
      kind: 'cause',
      source: ref('same'),
      target: ref('same'),
      certainty: 2,
      canonState: 'canon',
      necessity: 'necessary',
    }, { id: 'invalid', now: 1 });
  } catch {
    rejected = true;
  }
  assert(rejected, 'invalid/self causal assertion was accepted');

  const legacy: EntityLink = {
    id: 'legacy',
    projectId: PROJECT_ID,
    sourceEngineId: 'codex',
    sourceEntityType: 'codex-entry',
    sourceEntityId: 'a',
    sourceTitle: 'A',
    targetEngineId: 'codex',
    targetEntityType: 'codex-entry',
    targetEntityId: 'b',
    targetTitle: 'B',
    relation: 'causes',
    provenance: 'manual',
    createdAt: 1,
    updatedAt: 1,
  };
  const legacyProjection = causalRelationFromEntityLink(legacy);
  assert(legacyProjection?.canonState === 'hypothesis', 'legacy link was silently declared canonical');
  assert(legacyProjection?.certainty === 0.5, 'legacy uncertainty did not fail conservatively');
  return 'causal vocabulary persists as versioned metadata on existing entityLinks';
}

function boardNode(id: string, linked?: CausalEntityReference): BoardNode {
  return {
    id,
    projectId: PROJECT_ID,
    boardId: 'board-1',
    kind: linked ? 'entity' : 'card',
    title: `Board ${id}`,
    content: '',
    color: '#888888',
    position: { x: 0, y: 0 },
    size: { width: 200, height: 120 },
    zIndex: 1,
    tags: [],
    ref: linked ? {
      engineId: linked.engineId,
      entityType: linked.entityType,
      entityId: linked.entityId,
      title: linked.title,
    } : undefined,
    createdAt: 1,
    updatedAt: 1,
  };
}

function boardEdge(id: string, kind: string, direction: BoardEdge['direction']): BoardEdge {
  return {
    id,
    projectId: PROJECT_ID,
    boardId: 'board-1',
    sourceId: 'board-a',
    targetId: 'board-b',
    sources: [{ id: 'board-a', on: 'node' }],
    targets: [{ id: 'board-b', on: 'node' }],
    kind,
    color: '#888888',
    style: 'solid',
    width: 1,
    direction,
    curvature: 'straight',
    weight: 1,
    certainty: 1,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function timelineEvent(id: string): TimelineEvent {
  return {
    id,
    projectId: PROJECT_ID,
    timelineId: 'timeline-1',
    title: `Event ${id}`,
    description: '',
    date: id,
    dateMode: 'text',
    eventType: 'point',
    order: 0,
    lane: 'main',
    color: '#888888',
    createdAt: 1,
    updatedAt: 1,
  };
}

function testExistingSourceAdapters(): string {
  const boardRelations = causalRelationsFromBoard(
    PROJECT_ID,
    [boardNode('board-a'), boardNode('board-b', ref('real-b', 'Real B'))],
    [boardEdge('causal', 'causes', 'forward'), boardEdge('chronology', 'precedes', 'forward')],
  );
  assert(boardRelations.length === 1, 'Board adapter admitted a non-causal relation');
  assert(boardRelations[0].source.entityType === 'board-node', 'Board source stopped opening its real card');
  assert(boardRelations[0].target.entityId === 'real-b', 'live Board entity reference was not reused');
  assert(boardRelations[0].canonState === 'hypothesis', 'Board confidence was mistaken for canon status');

  const seed: Seed = {
    id: 'seed',
    projectId: PROJECT_ID,
    title: 'The key',
    description: '',
    kind: 'chekhov',
    status: 'planted',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const payoff: Payoff = {
    id: 'payoff',
    seedId: seed.id,
    projectId: PROJECT_ID,
    title: 'The lock opens',
    description: '',
    strength: 3,
    createdAt: 1,
    updatedAt: 1,
  };
  const seedRelations = causalRelationsFromSeeds(PROJECT_ID, [seed], [payoff]);
  assert(seedRelations.length === 1 && seedRelations[0].canonState === 'canon', 'stored payoff fact was not reused');

  const timelineConnections: TimelineConnection[] = [
    {
      id: 'explicit',
      projectId: PROJECT_ID,
      timelineId: 'timeline-1',
      sourceEventId: 'event-a',
      targetEventId: 'event-b',
      label: 'causes',
      color: '#888888',
      style: 'solid',
      createdAt: 1,
    },
    {
      id: 'mere-order',
      projectId: PROJECT_ID,
      timelineId: 'timeline-1',
      sourceEventId: 'event-a',
      targetEventId: 'event-b',
      label: 'twenty years later',
      color: '#888888',
      style: 'solid',
      createdAt: 1,
    },
  ];
  const timelineRelations = causalRelationsFromTimeline(
    PROJECT_ID,
    [timelineEvent('event-a'), timelineEvent('event-b')],
    timelineConnections,
  );
  assert(timelineRelations.length === 1, 'Timeline chronology was invented as a causal assertion');

  const explicit = relation(
    'explicit-link',
    'cause',
    boardRelations[0].source,
    boardRelations[0].target,
    { certainty: 0.9 },
  );
  const merged = mergeCausalRelations(boardRelations, [explicit]);
  assert(merged.length === 1 && merged[0].id === explicit.id, 'explicit entity link did not win deduplication');
  return 'causal adapters reuse Board, Seeds and explicit Timeline links without inventing facts';
}

function diagnosticGraph() {
  const a = ref('a', 'Decision A');
  const b = ref('b', 'Immediate B');
  const c = ref('c', 'Indirect C');
  const cost = ref('cost', 'Visible cost');
  const d = ref('d', 'Uncaused jump');
  const e = ref('e', 'Dangling E');
  const x = ref('x', 'Coincidence X');
  const y = ref('y', 'Coincidence Y');
  const relations = [
    relation('a-b', 'consequence', a, b),
    relation('b-c', 'consequence', b, c),
    relation('a-cost', 'cost', a, cost),
    relation('a-d', 'contradicts', a, d),
    relation('d-e', 'consequence', d, e),
    relation('x-b', 'hypothesis', x, b, { certainty: 0.4, canonState: 'hypothesis', necessity: 'possible' }),
    relation('y-b', 'cause', y, b, { certainty: 0.4, canonState: 'hypothesis', necessity: 'possible' }),
    relation('discarded', 'consequence', a, ref('discarded'), { certainty: 0, canonState: 'discarded' }),
  ];
  return buildCausalGraph({
    projectId: PROJECT_ID,
    root: { ...a, title: 'Current Decision A' },
    relations,
  });
}

function testGraphTraversalAndDiagnostics(): string {
  const graph = diagnosticGraph();
  const findings = new Set(graph.findings.map((finding) => `${finding.kind}:${finding.nodeKey}`));
  assert(graph.nodes[0].ref.title === 'Current Decision A', 'stale denormalized title replaced selected source');
  assert(graph.directConsequenceKeys.includes('codex:b'), 'direct consequence was not found');
  assert(graph.directConsequenceKeys.includes('codex:cost'), 'direct cost was not exposed');
  assert(
    graph.indirectConsequences.some((group) => group.depth === 2 && group.nodeKeys.includes('codex:c') && group.relationIds.includes('b-c')),
    'indirect consequence chain lost its connecting assertion',
  );
  assert(findings.has('missing-cause:codex:d'), 'jump without a supporting cause was not detected');
  assert(findings.has('dangling-consequence:codex:c'), 'dangling consequence was not detected');
  assert(findings.has('coincidence-stack:codex:b'), 'stacked uncertain coincidences were not detected');
  assert(findings.has('vanishing-cost:codex:cost'), 'cost without repercussions was not detected');
  assert(graph.counts.discarded === 1, 'discarded relation disappeared from the visible graph');
  assert(graph.counts.unresolved === 2, 'discarded relation polluted unresolved count');

  const deliberate = buildCausalGraph({
    projectId: PROJECT_ID,
    root: ref('a'),
    relations: graph.relations.map((item) => item.id === 'x-b' || item.id === 'y-b'
      ? { ...item, deliberateCoincidence: true }
      : item),
  });
  assert(
    !deliberate.findings.some((finding) => finding.kind === 'coincidence-stack' && finding.nodeKey === 'codex:b'),
    'declared coincidence stayed flagged',
  );
  return 'causal traversal distinguishes direct/indirect effects and all four weak-chain diagnostics';
}

const COPY: CausalConsequencesMapCopy = {
  title: 'Causal map',
  description: 'Trace consequences without copying source material.',
  root: 'Decision',
  because: 'Because',
  therefore: 'Therefore',
  but: 'But',
  noCauses: 'No cause yet.',
  noConsequences: 'No consequence yet.',
  noTensions: 'No tension yet.',
  consequences: 'Consequences',
  directConsequences: 'Direct consequences',
  indirectConsequences: (depth) => `Indirect level ${depth}`,
  diagnostics: 'Diagnostics',
  noDiagnostics: 'No structural warning.',
  notAssessed: 'Add an assertion before assessing this chain.',
  canonCount: (count) => `${count} facts`,
  hypothesisCount: (count) => `${count} hypotheses`,
  unresolvedCount: (count) => `${count} unresolved`,
  hiddenRelations: (count) => `${count} outside this view`,
  certainty: (percentage) => `${percentage}% certainty`,
  openSource: (title) => `Open source ${title}`,
  changeCanonState: (title) => `Change canonical state for ${title}`,
  changeNecessity: (title) => `Change necessity for ${title}`,
  relationLabels: {
    cause: 'Cause',
    consequence: 'Consequence',
    obstacle: 'Obstacle',
    enables: 'Enables',
    contradicts: 'Contradicts',
    cost: 'Cost',
    hypothesis: 'Hypothesis',
  },
  canonStateLabels: {
    canon: 'Fact',
    hypothesis: 'Hypothesis',
    discarded: 'Discarded',
  },
  necessityLabels: {
    necessary: 'Necessary',
    possible: 'Possible',
  },
  findingTitles: {
    'missing-cause': 'Jump without cause',
    'dangling-consequence': 'Dangling consequence',
    'coincidence-stack': 'Coincidences accumulate',
    'vanishing-cost': 'Cost disappears',
  },
  findingDescription: (finding, title) => `${title}: ${finding.count} linked assertions`,
  addCause: 'Add a possible cause',
  declareCoincidence: 'Make coincidence deliberate',
  convertFinding: 'Turn gap into…',
  convertFindingLabel: (title) => `Turn ${title} into a story entity`,
  conversionTargetLabels: {
    beat: 'Beat',
    event: 'Event',
    rule: 'Rule',
    seed: 'Seed',
    question: 'Open question',
  },
};

function testAccessibleUiContract(): string {
  const graph = diagnosticGraph();
  const noopEntity = (_entity: CausalEntityReference): void => undefined;
  const noopState = (_relation: CausalRelation, _state: CausalCanonState): void => undefined;
  const noopNecessity = (_relation: CausalRelation, _state: CausalNecessity): void => undefined;
  const markup = renderToStaticMarkup(createElement(CausalConsequencesMap, {
    graph,
    copy: COPY,
    onOpenEntity: noopEntity,
    onAddCause: noopEntity,
    onChangeCanonState: noopState,
    onChangeNecessity: noopNecessity,
    onDeclareCoincidence: () => undefined,
    onConvertFinding: () => undefined,
  }));
  assert(markup.includes('aria-labelledby=') && markup.includes('Causal map'), 'map has no accessible name');
  assert(markup.includes('aria-current="location"'), 'selected source is not exposed');
  assert(markup.includes('role="progressbar"'), 'certainty is not exposed to assistive technology');
  assert(markup.includes('Open source Current Decision A'), 'root does not open the fresh source reference');
  assert(markup.includes('Change canonical state for'), 'canonical controls have no accessible name');
  assert(markup.includes('Turn Uncaused jump into a story entity'), 'finding conversion is not keyboard-native');
  assert(!/<button(?![^>]*\btype="button")/i.test(markup), 'a button can submit an enclosing form');

  const emptyMarkup = renderToStaticMarkup(createElement(CausalConsequencesMap, {
    graph: buildCausalGraph({ projectId: PROJECT_ID, root: ref('empty', 'Empty source'), relations: [] }),
    copy: COPY,
    onOpenEntity: noopEntity,
  }));
  assert(emptyMarkup.includes(COPY.notAssessed), 'empty graph was announced as structurally correct');
  assert(!emptyMarkup.includes(COPY.noDiagnostics), 'unassessed graph claimed to have no warnings');
  return 'causal map exposes source navigation, state, certainty and callback actions accessibly';
}

export function runCausalGraphTests(): string[] {
  return [
    testVocabularyAndStorageShape(),
    testExistingSourceAdapters(),
    testGraphTraversalAndDiagnostics(),
    testAccessibleUiContract(),
  ];
}
