import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BookOpenCheck,
  FlaskConical,
  Globe2,
  GitBranch,
  Lightbulb,
  Loader2,
  Network,
  Plus,
  ScanText,
  Sparkles,
  Users,
  Waypoints,
} from 'lucide-react';
import { db } from '@/db';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import { useTranslation } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';
import {
  SceneLab,
  buildCreativeSources,
  creativeSourceKey,
  type CreativeSourceCitation,
} from './creative-lab';
import PersistentCreativeLab from './creative-lab/PersistentCreativeLab';
import BranchLab from './creative-lab/BranchLab';
import StoryStateLab from './creative-lab/StoryStateLab';
import CharacterPressureChamber from '@/components/character-pressure/CharacterPressureChamber';
import type { CharacterPressurePromotionDraft } from '@/services/characterPressureChamber';
import { getCharacterPressureCopy } from '@/services/characterPressureCopy';
import CausalConsequencesMap, {
  type CausalConsequencesMapCopy,
  type CausalConversionTarget,
} from '@/components/causal/CausalConsequencesMap';
import {
  CAUSAL_RELATION_KINDS,
  type CausalEntityReference,
  type CausalFinding,
  type CausalRelation,
  type CausalRelationKind,
} from '@/services/causalGraph';
import { loadProjectCausalGraph, saveCausalRelation } from '@/services/causalRelations';
import {
  promoteCharacterPressureDraft,
  promoteCreativePossibility,
  promoteDevelopmentDraft,
} from '@/services/creativePromotion';
import { createStoryClaim } from '@/services/storyState';
import type { StoryWorldRuleClaim } from '@/services/storyState';
import type { HubEntity } from '@/services/projectIntelligence';
import { buildStoryLensesReadModel, type StoryLensEntity } from '@/services/storyLenses';
import { StoryLensesLab, getStoryLensesCopy } from '@/components/story-lenses';
import SharedUniverseLab from './SharedUniverseLab';
import { NarrativeXray } from '@/components/narrative-xray';
import { buildNarrativeXray } from '@/services/narrativeXray';
import {
  stageSceneVariantAsBranch,
  type SceneLabSource,
  type SceneLabStructuralTarget,
} from '@/services/sceneLab';

type LabView = 'ideas' | 'branches' | 'causal' | 'pressure' | 'state' | 'lenses' | 'scenes' | 'xray' | 'universe';

interface CreativeDevelopmentLabProps {
  projectId: string;
  entities: readonly HubEntity[];
}

const LAB_VIEWS: ReadonlyArray<{ id: LabView; icon: typeof Lightbulb }> = [
  { id: 'ideas', icon: Lightbulb },
  { id: 'causal', icon: Waypoints },
  { id: 'pressure', icon: Users },
  { id: 'branches', icon: GitBranch },
  { id: 'state', icon: BookOpenCheck },
  { id: 'lenses', icon: Network },
  { id: 'scenes', icon: FlaskConical },
  { id: 'xray', icon: ScanText },
  { id: 'universe', icon: Globe2 },
];

const SOURCE_ENGINE_BY_KIND: Readonly<Record<CreativeSourceCitation['kind'], {
  engineId: string;
  entityType: string;
}>> = {
  note: { engineId: 'notes', entityType: 'note' },
  board: { engineId: 'board', entityType: 'board-node' },
  codex: { engineId: 'codex', entityType: 'codex-entry' },
  gallery: { engineId: 'gallery', entityType: 'inspiration-image' },
  seed: { engineId: 'seeds', entityType: 'seed' },
};

function asCausalRef(entity: HubEntity): CausalEntityReference {
  return {
    engineId: entity.engineId,
    entityType: entity.entityType,
    entityId: entity.id,
    title: entity.title,
    subtitle: entity.subtitle,
  };
}

function relationMutationDraft(relation: CausalRelation) {
  return {
    ...(relation.origin.kind === 'entity-link' ? { id: relation.origin.id } : {}),
    projectId: relation.projectId,
    kind: relation.kind,
    source: relation.source,
    target: relation.target,
    certainty: relation.certainty,
    canonState: relation.canonState,
    necessity: relation.necessity,
    deliberateCoincidence: relation.deliberateCoincidence,
    notes: relation.notes,
  };
}

function causalCopy(t: (key: string) => string): CausalConsequencesMapCopy {
  const findingDescription = (finding: CausalFinding, title: string) => t(
    `creativeLab.causal.finding.${finding.kind}.description`,
  ).replace('{title}', title).replace('{count}', String(finding.count));
  return {
    title: t('creativeLab.causal.title'),
    description: t('creativeLab.causal.description'),
    root: t('creativeLab.causal.root'),
    because: t('creativeLab.causal.because'),
    therefore: t('creativeLab.causal.therefore'),
    but: t('creativeLab.causal.but'),
    noCauses: t('creativeLab.causal.noCauses'),
    noConsequences: t('creativeLab.causal.noConsequences'),
    noTensions: t('creativeLab.causal.noTensions'),
    consequences: t('creativeLab.causal.consequences'),
    directConsequences: t('creativeLab.causal.direct'),
    indirectConsequences: (depth) => t('creativeLab.causal.indirect').replace('{depth}', String(depth)),
    diagnostics: t('creativeLab.causal.diagnostics'),
    noDiagnostics: t('creativeLab.causal.noDiagnostics'),
    notAssessed: t('creativeLab.causal.notAssessed'),
    canonCount: (count) => `${count} ${t('creativeLab.causal.count.canon')}`,
    hypothesisCount: (count) => `${count} ${t('creativeLab.causal.count.hypothesis')}`,
    unresolvedCount: (count) => `${count} ${t('creativeLab.causal.count.unresolved')}`,
    hiddenRelations: (count) => t('creativeLab.causal.hidden').replace('{count}', String(count)),
    certainty: (percentage) => t('creativeLab.causal.certainty').replace('{value}', String(percentage)),
    openSource: (title) => t('creativeLab.causal.open').replace('{title}', title),
    changeCanonState: (title) => t('creativeLab.causal.changeCanon').replace('{title}', title),
    changeNecessity: (title) => t('creativeLab.causal.changeNecessity').replace('{title}', title),
    relationLabels: {
      cause: t('creativeLab.causal.relation.cause'),
      consequence: t('creativeLab.causal.relation.consequence'),
      obstacle: t('creativeLab.causal.relation.obstacle'),
      enables: t('creativeLab.causal.relation.enables'),
      contradicts: t('creativeLab.causal.relation.contradicts'),
      cost: t('creativeLab.causal.relation.cost'),
      hypothesis: t('creativeLab.causal.relation.hypothesis'),
    },
    canonStateLabels: {
      canon: t('creativeLab.causal.state.canon'),
      hypothesis: t('creativeLab.causal.state.hypothesis'),
      discarded: t('creativeLab.causal.state.discarded'),
    },
    necessityLabels: {
      necessary: t('creativeLab.causal.necessity.necessary'),
      possible: t('creativeLab.causal.necessity.possible'),
    },
    findingTitles: {
      'missing-cause': t('creativeLab.causal.finding.missing-cause.title'),
      'dangling-consequence': t('creativeLab.causal.finding.dangling-consequence.title'),
      'coincidence-stack': t('creativeLab.causal.finding.coincidence-stack.title'),
      'vanishing-cost': t('creativeLab.causal.finding.vanishing-cost.title'),
    },
    findingDescription,
    addCause: t('creativeLab.causal.addCause'),
    declareCoincidence: t('creativeLab.causal.declareCoincidence'),
    convertFinding: t('creativeLab.causal.convert'),
    convertFindingLabel: (title) => t('creativeLab.causal.convertLabel').replace('{title}', title),
    conversionTargetLabels: {
      beat: t('creativeLab.causal.target.beat'),
      event: t('creativeLab.causal.target.event'),
      rule: t('creativeLab.causal.target.rule'),
      seed: t('creativeLab.causal.target.seed'),
      question: t('creativeLab.causal.target.question'),
    },
  };
}

function CausalWorkspace({ projectId, entities, onOpen }: {
  projectId: string;
  entities: readonly HubEntity[];
  onOpen: (entity: CausalEntityReference) => void;
}) {
  const { t } = useTranslation();
  const [rootKey, setRootKey] = useState('');
  const [builderOpen, setBuilderOpen] = useState(false);
  const [sourceKey, setSourceKey] = useState('');
  const [targetKey, setTargetKey] = useState('');
  const [kind, setKind] = useState<CausalRelationKind>('consequence');
  const [saving, setSaving] = useState(false);
  const selectedEntity = entities.find((entity) => entity.key === rootKey) ?? entities[0];
  const selectedRoot = selectedEntity ? asCausalRef(selectedEntity) : null;
  const graph = useLiveQuery(
    () => selectedRoot ? loadProjectCausalGraph(projectId, selectedRoot) : Promise.resolve(null),
    [projectId, selectedRoot?.engineId, selectedRoot?.entityId, selectedRoot?.entityType, selectedRoot?.title],
  );
  const copy = useMemo(() => causalCopy(t), [t]);
  const effectiveSourceKey = sourceKey || selectedEntity?.key || '';
  const effectiveTargetKey = targetKey || entities.find((entity) => entity.key !== effectiveSourceKey)?.key || '';

  const showError = (error: unknown) => toast.error(
    error instanceof Error ? error.message : t('creativeLab.actionError'),
  );

  const persistRelation = async (relation: CausalRelation, changes: Partial<CausalRelation>) => {
    await saveCausalRelation({ ...relationMutationDraft(relation), ...changes });
  };

  const submitRelation = async (event: FormEvent) => {
    event.preventDefault();
    const source = entities.find((entity) => entity.key === effectiveSourceKey);
    const target = entities.find((entity) => entity.key === effectiveTargetKey);
    if (!source || !target || source.key === target.key) return;
    setSaving(true);
    try {
      await saveCausalRelation({
        projectId,
        kind,
        source: asCausalRef(source),
        target: asCausalRef(target),
        certainty: 0.75,
        canonState: 'hypothesis',
        necessity: 'possible',
      });
      setBuilderOpen(false);
      toast.success(t('creativeLab.causal.relationSaved'));
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  };

  const convertFinding = async (finding: CausalFinding, target: CausalConversionTarget) => {
    if (!graph) return;
    const node = graph.nodes.find((row) => row.key === finding.nodeKey);
    if (!node) return;
    const description = copy.findingDescription(finding, node.ref.title);
    try {
      if (target === 'rule') {
        await createStoryClaim<StoryWorldRuleClaim>({
          projectId,
          kind: 'world-rule',
          status: 'hypothesis',
          title: node.ref.title,
          condition: '',
          effect: description,
          cost: '',
          limit: '',
          exceptions: [],
          evidence: [],
        });
      } else {
        const promotionTarget = target === 'beat'
          ? 'outline'
          : target === 'event'
            ? 'timeline'
            : target === 'seed'
              ? 'seed'
              : 'board';
        await promoteDevelopmentDraft({
          projectId,
          target: promotionTarget,
          title: node.ref.title,
          text: description,
          boardRole: target === 'question' ? 'question' : undefined,
          sources: [node.ref],
          origin: 'causal-map',
          provenance: { version: 1, finding, root: graph.nodes.find((row) => row.key === graph.rootKey)?.ref },
        }, {
          boardTitle: t('creativeLab.container.board'),
          outlineTitle: t('creativeLab.container.outline'),
          timelineTitle: t('creativeLab.container.timeline'),
        });
      }
      toast.success(t('creativeLab.promoted'));
    } catch (error) {
      showError(error);
    }
  };

  if (entities.length === 0) {
    return <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-text-muted">{t('creativeLab.causal.empty')}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 md:flex-row md:items-end">
        <label className="min-w-0 flex-1 text-sm text-text-muted">
          <span className="mb-1 block">{t('creativeLab.causal.startFrom')}</span>
          <select
            value={selectedEntity?.key ?? ''}
            onChange={(event) => setRootKey(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-border bg-elevated px-3 text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
          >
            {entities.map((entity) => <option key={entity.key} value={entity.key}>{entity.title}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setBuilderOpen((open) => !open)}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm text-text-primary hover:border-accent-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
          aria-expanded={builderOpen}
        >
          <Plus size={16} aria-hidden="true" />
          {t('creativeLab.causal.addRelation')}
        </button>
      </div>

      {builderOpen && (
        <form onSubmit={(event) => void submitRelation(event)} className="grid gap-3 rounded-xl border border-accent-gold/30 bg-elevated p-4 md:grid-cols-[1fr_180px_1fr_auto] md:items-end">
          <label className="text-sm text-text-muted">
            <span className="mb-1 block">{t('creativeLab.causal.source')}</span>
            <select value={effectiveSourceKey} onChange={(event) => setSourceKey(event.target.value)} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-text-primary">
              {entities.map((entity) => <option key={entity.key} value={entity.key}>{entity.title}</option>)}
            </select>
          </label>
          <label className="text-sm text-text-muted">
            <span className="mb-1 block">{t('creativeLab.causal.relation')}</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as CausalRelationKind)} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-text-primary">
              {CAUSAL_RELATION_KINDS.map((value) => <option key={value} value={value}>{copy.relationLabels[value]}</option>)}
            </select>
          </label>
          <label className="text-sm text-text-muted">
            <span className="mb-1 block">{t('creativeLab.causal.target')}</span>
            <select value={effectiveTargetKey} onChange={(event) => setTargetKey(event.target.value)} className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-text-primary">
              {entities.map((entity) => <option key={entity.key} value={entity.key}>{entity.title}</option>)}
            </select>
          </label>
          <button type="submit" disabled={saving || !effectiveTargetKey || effectiveSourceKey === effectiveTargetKey} className="min-h-11 rounded-lg bg-accent-gold px-4 text-sm font-semibold text-deep disabled:opacity-40">
            {saving ? t('creativeLab.saving') : t('creativeLab.add')}
          </button>
        </form>
      )}

      {graph === undefined && <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-accent-gold" /></div>}
      {graph && (
        <CausalConsequencesMap
          graph={graph}
          copy={copy}
          onOpenEntity={onOpen}
          onAddCause={(entity) => {
            const target = entities.find((row) => row.engineId === entity.engineId && row.id === entity.entityId);
            const cause = entities.find((row) => row.key !== target?.key);
            setTargetKey(target?.key ?? '');
            setSourceKey(cause?.key ?? '');
            setKind('cause');
            setBuilderOpen(true);
          }}
          onChangeCanonState={(relation, canonState) => {
            void persistRelation(relation, { canonState }).catch(showError);
          }}
          onChangeNecessity={(relation, necessity) => {
            void persistRelation(relation, { necessity }).catch(showError);
          }}
          onDeclareCoincidence={(finding) => {
            void Promise.all(finding.relationIds.flatMap((id) => {
              const relation = graph.relations.find((row) => row.id === id);
              return relation ? [persistRelation(relation, { deliberateCoincidence: true })] : [];
            })).then(() => toast.success(t('creativeLab.causal.coincidenceSaved'))).catch(showError);
          }}
          onConvertFinding={(finding, target) => void convertFinding(finding, target)}
        />
      )}
    </div>
  );
}

export default function CreativeDevelopmentLab({ projectId, entities }: CreativeDevelopmentLabProps) {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get('lab');
  const view = LAB_VIEWS.find(candidate => candidate.id === requestedView)?.id ?? 'ideas';
  const setView = (nextView: LabView) => {
    const next = new URLSearchParams(searchParams);
    next.set('panel', 'lab');
    next.set('lab', nextView);
    setSearchParams(next);
  };
  const data = useLiveQuery(async () => {
    const [
      notes,
      boardNodes,
      codexEntries,
      images,
      seeds,
      links,
      characterArcs,
      relationships,
      writings,
      scenes,
      outlines,
      outlineBeats,
      timelines,
      timelineEvents,
      annotations,
      conversionReceipts,
      branchPromotionReceipts,
      writingSnapshots,
      dialogBlocks,
      writingSessions,
      tags,
    ] = await Promise.all([
      db.notes.where('projectId').equals(projectId).toArray(),
      db.boardNodes.where('projectId').equals(projectId).toArray(),
      db.codexEntries.where('projectId').equals(projectId).toArray(),
      db.inspirationImages.where('projectId').equals(projectId).toArray(),
      db.seeds.where('projectId').equals(projectId).toArray(),
      db.entityLinks.where('projectId').equals(projectId).toArray(),
      db.characterArcs.where('projectId').equals(projectId).toArray(),
      db.relationships.where('projectId').equals(projectId).toArray(),
      db.writings.where('projectId').equals(projectId).toArray(),
      db.scenes.where('projectId').equals(projectId).toArray(),
      db.outlines.where('projectId').equals(projectId).toArray(),
      db.outlineBeats.where('projectId').equals(projectId).toArray(),
      db.timelines.where('projectId').equals(projectId).toArray(),
      db.timelineEvents.where('projectId').equals(projectId).toArray(),
      db.annotations.where('projectId').equals(projectId).toArray(),
      db.conversionReceipts.where('projectId').equals(projectId).toArray(),
      db.branchPromotionReceipts.where('projectId').equals(projectId).toArray(),
      db.writingSnapshots.where('projectId').equals(projectId).toArray(),
      db.dialogBlocks.where('projectId').equals(projectId).toArray(),
      db.writingSessions.where('projectId').equals(projectId).toArray(),
      db.tags.toArray(),
    ]);
    const annotationIds = annotations.map((annotation) => annotation.id);
    const annotationReferences = annotationIds.length
      ? await db.annotationReferences.where('annotationId').anyOf(annotationIds).toArray()
      : [];
    const usageCounts: Record<string, number> = {};
    const kindByEngine: Readonly<Record<string, Parameters<typeof creativeSourceKey>[0] | undefined>> = {
      notes: 'note', board: 'board', codex: 'codex', gallery: 'gallery', seeds: 'seed',
    };
    for (const link of links) {
      if (link.relation !== 'developed-into') continue;
      const kind = kindByEngine[link.sourceEngineId];
      if (!kind) continue;
      const key = creativeSourceKey(kind, link.sourceEntityId);
      usageCounts[key] = (usageCounts[key] ?? 0) + 1;
    }
    const outlineById = new Map(outlines.map((outline) => [outline.id, outline]));
    const timelineById = new Map(timelines.map((timeline) => [timeline.id, timeline]));
    const lensEntities: StoryLensEntity[] = [
      ...notes.map((note) => ({
        projectId,
        engineId: 'notes',
        entityType: 'note',
        entityId: note.id,
        title: note.text.split('\n').find((line) => line.trim())?.trim() || note.id,
        tags: note.tags,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      })),
      ...boardNodes.map((node) => ({
        projectId,
        engineId: 'board',
        entityType: 'board-node',
        entityId: node.id,
        title: node.title || node.id,
        tags: node.tags,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      })),
      ...codexEntries.map((entry) => ({
        projectId,
        engineId: 'codex',
        entityType: entry.type,
        entityId: entry.id,
        title: entry.title,
        tags: entry.tags,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
      ...images.map((image) => ({
        projectId,
        engineId: 'gallery',
        entityType: 'inspiration-image',
        entityId: image.id,
        title: image.notes.trim() || image.tags[0] || image.id,
        tags: image.tags,
        createdAt: image.createdAt,
        updatedAt: image.createdAt,
      })),
      ...seeds.map((seed) => ({
        projectId,
        engineId: 'seeds',
        entityType: 'seed',
        entityId: seed.id,
        title: seed.title,
        tags: seed.tags,
        createdAt: seed.createdAt,
        updatedAt: seed.updatedAt,
      })),
      ...writings.map((writing) => ({
        projectId,
        engineId: 'writings',
        entityType: 'writing',
        entityId: writing.id,
        title: writing.title,
        tags: writing.tags,
        createdAt: writing.createdAt,
        updatedAt: writing.updatedAt,
        sequence: {
          scopeId: `${projectId}:writings`,
          scopeTitle: t('creativeLab.lenses.manuscript'),
          order: writing.chapter ?? writing.createdAt,
        },
      })),
      ...scenes.map((scene) => ({
        projectId,
        engineId: 'dialog-scene',
        entityType: 'scene',
        entityId: scene.id,
        title: scene.title,
        tags: scene.tags,
        createdAt: scene.createdAt,
        updatedAt: scene.updatedAt,
        sequence: {
          scopeId: `${projectId}:scenes`,
          scopeTitle: t('creativeLab.lenses.scenes'),
          order: scene.order,
        },
      })),
      ...outlineBeats.map((beat) => ({
        projectId,
        engineId: 'outline',
        entityType: 'outline-beat',
        entityId: beat.id,
        title: beat.title,
        tags: [] as string[],
        createdAt: beat.createdAt,
        updatedAt: beat.updatedAt,
        sequence: {
          scopeId: beat.outlineId,
          scopeTitle: outlineById.get(beat.outlineId)?.title ?? t('creativeLab.lenses.outline'),
          order: beat.storyPosition ?? beat.order,
        },
      })),
      ...timelineEvents.map((event) => ({
        projectId,
        engineId: 'timeline',
        entityType: 'timeline-event',
        entityId: event.id,
        title: event.title,
        tags: [] as string[],
        createdAt: event.createdAt,
        updatedAt: event.updatedAt,
        sequence: {
          scopeId: event.timelineId,
          scopeTitle: timelineById.get(event.timelineId)?.title ?? t('creativeLab.lenses.timeline'),
          order: event.order,
        },
      })),
    ];
    const blocksByScene = new Map<string, typeof dialogBlocks>();
    for (const block of dialogBlocks) {
      const rows = blocksByScene.get(block.sceneId) ?? [];
      rows.push(block);
      blocksByScene.set(block.sceneId, rows);
    }
    const sceneLabSources: SceneLabSource[] = scenes.map((scene) => {
      const blocks = [...(blocksByScene.get(scene.id) ?? [])].sort((a, b) => a.order - b.order);
      const voices = [...new Set(blocks.map((block) => block.characterName.trim()).filter(Boolean))];
      return {
        id: scene.id,
        projectId,
        title: scene.title,
        text: blocks.map((block) => block.content).filter(Boolean).join('\n'),
        intention: scene.description ?? '',
        tension: 0,
        voice: voices.join(', '),
        revision: scene.updatedAt,
      };
    });
    const sceneLabTargets: SceneLabStructuralTarget[] = [
      ...outlineBeats.map((beat) => ({
        kind: 'outline-beat' as const,
        entityId: beat.id,
        projectId,
        title: beat.title,
        description: beat.description,
        revision: beat.updatedAt,
      })),
      ...timelineEvents.map((event) => ({
        kind: 'timeline-event' as const,
        entityId: event.id,
        projectId,
        title: event.title,
        description: event.description,
        revision: event.updatedAt,
      })),
    ];
    return {
      sources: buildCreativeSources({ projectId, notes, boardNodes, codexEntries, images, seeds, usageCounts }),
      characters: codexEntries.filter((entry) => entry.type === 'character'),
      characterArcs,
      relationships,
      storyLenses: buildStoryLensesReadModel({
        projectId,
        entities: lensEntities,
        annotations,
        annotationReferences,
        entityLinks: links,
        conversionReceipts,
        branchPromotionReceipts,
        writingSnapshots,
      }),
      sceneLabSources,
      sceneLabTargets,
      narrativeXray: buildNarrativeXray({
        projectId,
        locale,
        writings,
        outlineBeats,
        scenes,
        dialogBlocks,
        writingSessions,
        annotations,
        tags,
        entityLinks: links,
      }),
    };
  }, [projectId, locale]);

  const openEntity = (entity: CausalEntityReference & { projectId?: string }) => {
    const targetProjectId = entity.projectId ?? projectId;
    const adapter = getAnchorAdapter(entity.engineId);
    if (adapter) adapter.navigateToEntity(entity.entityId, targetProjectId);
    else navigate(`/project/${encodeURIComponent(targetProjectId)}/${encodeURIComponent(entity.engineId)}`);
  };
  const openCreativeSource = (source: CreativeSourceCitation) => {
    openEntity({ ...SOURCE_ENGINE_BY_KIND[source.kind], entityId: source.id, title: source.title });
  };
  const labels = {
    boardTitle: t('creativeLab.container.board'),
    outlineTitle: t('creativeLab.container.outline'),
    timelineTitle: t('creativeLab.container.timeline'),
  };
  const pressurePromotion = async (draft: CharacterPressurePromotionDraft) => {
    try {
      await promoteCharacterPressureDraft(projectId, draft, labels);
      toast.success(t('creativeLab.promoted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('creativeLab.actionError'));
    }
  };

  return (
    <div className="space-y-5">
      <header className="py-1">
        <div className="flex items-start gap-3">
          <Sparkles size={20} className="mt-1 shrink-0 text-accent-gold" aria-hidden="true" />
          <div>
            <h3 className="font-serif text-xl font-semibold text-text-primary">{t('creativeLab.title')}</h3>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-muted">{t('creativeLab.description')}</p>
          </div>
        </div>
      </header>

      <nav aria-label={t('creativeLab.navigation')} className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
        {LAB_VIEWS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={view === id ? 'page' : undefined}
            onClick={() => setView(id)}
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold ${
              view === id ? 'bg-elevated font-medium text-accent-gold' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            <Icon size={15} aria-hidden="true" />
            {t(`creativeLab.view.${id}`)}
          </button>
        ))}
      </nav>

      {!data && <div className="flex min-h-72 items-center justify-center"><Loader2 className="animate-spin text-accent-gold" /></div>}
      {data && view === 'ideas' && (
        <PersistentCreativeLab
          projectId={projectId}
          sources={data.sources}
          focusedSourceKey={searchParams.get('source')}
          locale={locale}
          onOpenSource={openCreativeSource}
          onPromote={(request) => promoteCreativePossibility(request, labels)}
        />
      )}
      {data && view === 'causal' && <CausalWorkspace projectId={projectId} entities={entities} onOpen={openEntity} />}
      {data && view === 'pressure' && (
        <CharacterPressureChamber
          projectId={projectId}
          codexEntries={data.characters}
          characterArcs={data.characterArcs}
          relationships={data.relationships}
          locale={locale}
          copy={getCharacterPressureCopy(locale)}
          onPromoteBeat={pressurePromotion}
          onPromoteScene={pressurePromotion}
          onPromoteRelationshipChange={pressurePromotion}
          onPromoteNote={pressurePromotion}
        />
      )}
      {data && view === 'branches' && <BranchLab projectId={projectId} />}
      {data && view === 'state' && <StoryStateLab projectId={projectId} />}
      {data && view === 'lenses' && (
        <StoryLensesLab
          model={data.storyLenses}
          copy={getStoryLensesCopy(locale)}
          onOpenEntity={openEntity}
        />
      )}
      {data && view === 'scenes' && (
        <SceneLab
          projectId={projectId}
          scenes={data.sceneLabSources}
          structuralTargets={data.sceneLabTargets}
          locale={locale}
          onPromote={stageSceneVariantAsBranch}
        />
      )}
      {data && view === 'xray' && (
        <NarrativeXray
          model={data.narrativeXray}
          locale={locale}
          onOpenEvidence={(evidence) => openEntity(evidence)}
        />
      )}
      {view === 'universe' && (
        <SharedUniverseLab projectId={projectId} locale={locale} onOpenEntity={openEntity} />
      )}
    </div>
  );
}
