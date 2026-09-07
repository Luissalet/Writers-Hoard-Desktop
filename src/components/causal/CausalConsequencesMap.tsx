import * as React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  GitBranch,
  Link2,
  Plus,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react';
import type {
  CausalCanonState,
  CausalEntityReference,
  CausalFinding,
  CausalFindingKind,
  CausalGraph,
  CausalGraphNode,
  CausalNecessity,
  CausalRelation,
  CausalRelationKind,
} from '@/services/causalGraph';

export type CausalConversionTarget = 'beat' | 'event' | 'rule' | 'seed' | 'question';

export interface CausalConsequencesMapCopy {
  title: string;
  description: string;
  root: string;
  because: string;
  therefore: string;
  but: string;
  noCauses: string;
  noConsequences: string;
  noTensions: string;
  consequences: string;
  directConsequences: string;
  indirectConsequences: (depth: number) => string;
  diagnostics: string;
  noDiagnostics: string;
  notAssessed: string;
  canonCount: (count: number) => string;
  hypothesisCount: (count: number) => string;
  unresolvedCount: (count: number) => string;
  hiddenRelations: (count: number) => string;
  certainty: (percentage: number) => string;
  openSource: (title: string) => string;
  changeCanonState: (title: string) => string;
  changeNecessity: (title: string) => string;
  relationLabels: Record<CausalRelationKind, string>;
  canonStateLabels: Record<CausalCanonState, string>;
  necessityLabels: Record<CausalNecessity, string>;
  findingTitles: Record<CausalFindingKind, string>;
  findingDescription: (finding: CausalFinding, nodeTitle: string) => string;
  addCause: string;
  declareCoincidence: string;
  convertFinding: string;
  convertFindingLabel: (nodeTitle: string) => string;
  conversionTargetLabels: Record<CausalConversionTarget, string>;
}

export interface CausalConsequencesMapProps {
  graph: CausalGraph;
  copy: CausalConsequencesMapCopy;
  onOpenEntity: (entity: CausalEntityReference) => void;
  onAddCause?: (entity: CausalEntityReference) => void;
  onChangeCanonState?: (relation: CausalRelation, state: CausalCanonState) => void;
  onChangeNecessity?: (relation: CausalRelation, necessity: CausalNecessity) => void;
  onDeclareCoincidence?: (finding: CausalFinding) => void;
  onConvertFinding?: (finding: CausalFinding, target: CausalConversionTarget) => void;
  className?: string;
}

const RELATION_TONE: Readonly<Record<CausalRelationKind, string>> = {
  cause: 'bg-amber-500/10 text-amber-300',
  consequence: 'bg-blue-500/10 text-blue-300',
  obstacle: 'bg-red-500/10 text-red-300',
  enables: 'bg-emerald-500/10 text-emerald-300',
  contradicts: 'bg-rose-500/10 text-rose-300',
  cost: 'bg-orange-500/10 text-orange-300',
  hypothesis: 'bg-violet-500/10 text-violet-300',
};

const CONVERSION_TARGETS: readonly CausalConversionTarget[] = [
  'beat',
  'event',
  'rule',
  'seed',
  'question',
];

function relationStateClass(state: CausalCanonState): string {
  if (state === 'hypothesis') return 'border-dashed border-accent-plum/70 bg-accent-plum/5';
  if (state === 'discarded') return 'border-border/60 bg-deep/50 opacity-60';
  return 'border-border bg-surface';
}

function EntityButton({
  node,
  label,
  onOpen,
  root = false,
}: {
  node: CausalGraphNode;
  label: string;
  onOpen: (entity: CausalEntityReference) => void;
  root?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={root ? 'location' : undefined}
      onClick={() => onOpen(node.ref)}
      className={`group flex min-h-11 w-full items-start justify-between gap-3 rounded-xl text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold focus-visible:ring-offset-2 focus-visible:ring-offset-deep ${
        root
          ? 'border border-accent-gold/50 bg-elevated px-5 py-4 hover:border-accent-gold'
          : 'px-3 py-2 hover:bg-elevated'
      }`}
    >
      <span className="min-w-0">
        <span className={`block break-words font-semibold text-text-primary ${root ? 'font-serif text-base' : 'text-sm'}`}>
          {node.ref.title}
        </span>
        <span className="mt-0.5 block break-words text-xs text-text-dim">
          {node.ref.subtitle ?? node.ref.entityType}
        </span>
      </span>
      <ExternalLink
        size={root ? 17 : 15}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-text-dim transition group-hover:text-accent-gold"
      />
    </button>
  );
}

function RelationCard({
  relation,
  source,
  target,
  copy,
  onOpenEntity,
  onChangeCanonState,
  onChangeNecessity,
}: {
  relation: CausalRelation;
  source: CausalGraphNode;
  target: CausalGraphNode;
  copy: CausalConsequencesMapCopy;
  onOpenEntity: (entity: CausalEntityReference) => void;
  onChangeCanonState?: CausalConsequencesMapProps['onChangeCanonState'];
  onChangeNecessity?: CausalConsequencesMapProps['onChangeNecessity'];
}) {
  const certainty = Math.round(relation.certainty * 100);
  return (
    <li className={`rounded-xl border p-3 ${relationStateClass(relation.canonState)}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${RELATION_TONE[relation.kind]}`}>
          {copy.relationLabels[relation.kind]}
        </span>
        <span className="rounded-full bg-elevated px-2 py-0.5 text-xs text-text-muted">
          {copy.canonStateLabels[relation.canonState]}
        </span>
        <span className="ml-auto tabular-nums text-xs text-text-dim">
          {copy.certainty(certainty)}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label={copy.certainty(certainty)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={certainty}
        className="mt-2 h-1 overflow-hidden rounded-full bg-border"
      >
        <span
          className="block h-full rounded-full bg-accent-gold transition-[width] motion-reduce:transition-none"
          style={{ width: `${certainty}%` }}
        />
      </div>

      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
        <EntityButton node={source} label={copy.openSource(source.ref.title)} onOpen={onOpenEntity} />
        <ArrowRight size={15} aria-hidden="true" className="text-text-dim" />
        <EntityButton node={target} label={copy.openSource(target.ref.title)} onOpen={onOpenEntity} />
      </div>

      {relation.notes && <p className="mt-2 text-sm leading-relaxed text-text-muted">{relation.notes}</p>}

      {(onChangeCanonState || onChangeNecessity) && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border/70 pt-3">
          {onChangeCanonState && (
            <select
              aria-label={copy.changeCanonState(target.ref.title)}
              value={relation.canonState}
              onChange={(event) => onChangeCanonState(relation, event.target.value as CausalCanonState)}
              className="min-h-10 rounded-lg border border-border bg-elevated px-2 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
            >
              {(Object.keys(copy.canonStateLabels) as CausalCanonState[]).map((state) => (
                <option key={state} value={state}>{copy.canonStateLabels[state]}</option>
              ))}
            </select>
          )}
          {onChangeNecessity && relation.canonState !== 'discarded' && (
            <select
              aria-label={copy.changeNecessity(target.ref.title)}
              value={relation.necessity}
              onChange={(event) => onChangeNecessity(relation, event.target.value as CausalNecessity)}
              className="min-h-10 rounded-lg border border-border bg-elevated px-2 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
            >
              {(Object.keys(copy.necessityLabels) as CausalNecessity[]).map((necessity) => (
                <option key={necessity} value={necessity}>{copy.necessityLabels[necessity]}</option>
              ))}
            </select>
          )}
        </div>
      )}
    </li>
  );
}

function RelationGroup({
  title,
  empty,
  relations,
  nodeByKey,
  copy,
  onOpenEntity,
  onChangeCanonState,
  onChangeNecessity,
}: {
  title: string;
  empty: string;
  relations: CausalRelation[];
  nodeByKey: ReadonlyMap<string, CausalGraphNode>;
  copy: CausalConsequencesMapCopy;
  onOpenEntity: CausalConsequencesMapProps['onOpenEntity'];
  onChangeCanonState?: CausalConsequencesMapProps['onChangeCanonState'];
  onChangeNecessity?: CausalConsequencesMapProps['onChangeNecessity'];
}) {
  return (
    <section aria-label={title} className="min-w-0">
      <h3 className="mb-3 flex items-center gap-2 font-serif text-sm font-bold text-accent-gold">
        <Link2 size={15} aria-hidden="true" />
        {title}
      </h3>
      {relations.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-5 text-sm leading-relaxed text-text-muted">
          {empty}
        </p>
      ) : (
        <ul className="space-y-3">
          {relations.flatMap((relation) => {
            const source = nodeByKey.get(`${relation.source.engineId}:${relation.source.entityId}`);
            const target = nodeByKey.get(`${relation.target.engineId}:${relation.target.entityId}`);
            if (!source || !target) return [];
            return [
              <RelationCard
                key={relation.id}
                relation={relation}
                source={source}
                target={target}
                copy={copy}
                onOpenEntity={onOpenEntity}
                onChangeCanonState={onChangeCanonState}
                onChangeNecessity={onChangeNecessity}
              />,
            ];
          })}
        </ul>
      )}
    </section>
  );
}

function FindingCard({
  finding,
  node,
  copy,
  onOpenEntity,
  onAddCause,
  onDeclareCoincidence,
  onConvertFinding,
}: {
  finding: CausalFinding;
  node: CausalGraphNode;
  copy: CausalConsequencesMapCopy;
  onOpenEntity: CausalConsequencesMapProps['onOpenEntity'];
  onAddCause?: CausalConsequencesMapProps['onAddCause'];
  onDeclareCoincidence?: CausalConsequencesMapProps['onDeclareCoincidence'];
  onConvertFinding?: CausalConsequencesMapProps['onConvertFinding'];
}) {
  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <FindingIcon kind={finding.kind} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-text-primary">{copy.findingTitles[finding.kind]}</h3>
          <p className="mt-1 text-sm leading-relaxed text-text-muted">
            {copy.findingDescription(finding, node.ref.title)}
          </p>
          <div className="mt-3">
            <EntityButton node={node} label={copy.openSource(node.ref.title)} onOpen={onOpenEntity} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {finding.kind === 'missing-cause' && onAddCause && (
              <button
                type="button"
                onClick={() => onAddCause(node.ref)}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent-gold px-3 py-2 text-sm font-semibold text-deep transition hover:bg-accent-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold focus-visible:ring-offset-2 focus-visible:ring-offset-deep"
              >
                <Plus size={15} aria-hidden="true" />
                {copy.addCause}
              </button>
            )}
            {finding.kind === 'coincidence-stack' && onDeclareCoincidence && (
              <button
                type="button"
                onClick={() => onDeclareCoincidence(finding)}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-elevated px-3 py-2 text-sm font-semibold text-text-primary transition hover:border-border-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
              >
                <ShieldCheck size={15} aria-hidden="true" />
                {copy.declareCoincidence}
              </button>
            )}
            {onConvertFinding && finding.kind !== 'coincidence-stack' && (
              <select
                aria-label={copy.convertFindingLabel(node.ref.title)}
                value=""
                onChange={(event) => {
                  const target = event.target.value as CausalConversionTarget;
                  if (target) onConvertFinding(finding, target);
                }}
                className="min-h-10 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
              >
                <option value="">{copy.convertFinding}</option>
                {CONVERSION_TARGETS.map((target) => (
                  <option key={target} value={target}>{copy.conversionTargetLabels[target]}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function FindingIcon({ kind }: { kind: CausalFindingKind }) {
  const props = {
    size: 18,
    'aria-hidden': true,
    className: 'mt-0.5 shrink-0 text-amber-300',
  } as const;
  switch (kind) {
    case 'missing-cause': return <CircleDashed {...props} />;
    case 'dangling-consequence': return <GitBranch {...props} />;
    case 'coincidence-stack': return <Sparkles {...props} />;
    case 'vanishing-cost': return <AlertTriangle {...props} />;
  }
}

export default function CausalConsequencesMap({
  graph,
  copy,
  onOpenEntity,
  onAddCause,
  onChangeCanonState,
  onChangeNecessity,
  onDeclareCoincidence,
  onConvertFinding,
  className = '',
}: CausalConsequencesMapProps) {
  const id = React.useId();
  const titleId = `${id}-title`;
  const consequencesTitleId = `${id}-consequences`;
  const diagnosticsTitleId = `${id}-diagnostics`;
  const nodeByKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const relationById = new Map(graph.relations.map((relation) => [relation.id, relation]));
  const root = nodeByKey.get(graph.rootKey);
  if (!root) return null;

  const relationsFor = (ids: readonly string[]): CausalRelation[] => ids.flatMap((id) => {
    const relation = relationById.get(id);
    return relation ? [relation] : [];
  });
  const directNodes = graph.directConsequenceKeys.flatMap((key) => {
    const node = nodeByKey.get(key);
    return node ? [node] : [];
  });
  const hasActiveCause = relationsFor(graph.becauseRelationIds).some(
    (relation) => relation.canonState !== 'discarded',
  );
  const hasActiveAssertions = graph.counts.canon + graph.counts.hypotheses > 0;

  return (
    <section
      aria-labelledby={titleId}
      className={`rounded-2xl border border-border bg-deep p-4 sm:p-6 ${className}`}
    >
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <h2 id={titleId} className="font-serif text-xl font-bold tracking-[-0.02em] text-text-primary">
            {copy.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-muted">{copy.description}</p>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-live="polite" aria-label={copy.diagnostics}>
          <li className="flex items-center gap-2">
            <CheckCircle2 size={15} aria-hidden="true" className="text-emerald-300" />
            <span className="tabular-nums text-text-muted">{copy.canonCount(graph.counts.canon)}</span>
          </li>
          <li className="flex items-center gap-2">
            <CircleDashed size={15} aria-hidden="true" className="text-violet-300" />
            <span className="tabular-nums text-text-muted">{copy.hypothesisCount(graph.counts.hypotheses)}</span>
          </li>
          <li className="flex items-center gap-2">
            <AlertTriangle size={15} aria-hidden="true" className="text-amber-300" />
            <span className="tabular-nums text-text-muted">{copy.unresolvedCount(graph.counts.unresolved)}</span>
          </li>
        </ul>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.8fr)_minmax(0,1fr)] lg:items-start">
        <RelationGroup
          title={copy.because}
          empty={copy.noCauses}
          relations={relationsFor(graph.becauseRelationIds)}
          nodeByKey={nodeByKey}
          copy={copy}
          onOpenEntity={onOpenEntity}
          onChangeCanonState={onChangeCanonState}
          onChangeNecessity={onChangeNecessity}
        />

        <section aria-label={copy.root} className="min-w-0 lg:sticky lg:top-4">
          <h3 className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.12em] text-text-dim">
            {copy.root}
          </h3>
          <EntityButton node={root} label={copy.openSource(root.ref.title)} onOpen={onOpenEntity} root />
          {onAddCause && !hasActiveCause && (
            <button
              type="button"
              onClick={() => onAddCause(root.ref)}
              className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold text-text-primary transition hover:border-border-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
            >
              <Plus size={15} aria-hidden="true" />
              {copy.addCause}
            </button>
          )}
        </section>

        <RelationGroup
          title={copy.therefore}
          empty={copy.noConsequences}
          relations={relationsFor(graph.thereforeRelationIds)}
          nodeByKey={nodeByKey}
          copy={copy}
          onOpenEntity={onOpenEntity}
          onChangeCanonState={onChangeCanonState}
          onChangeNecessity={onChangeNecessity}
        />
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <RelationGroup
          title={copy.but}
          empty={copy.noTensions}
          relations={relationsFor(graph.butRelationIds)}
          nodeByKey={nodeByKey}
          copy={copy}
          onOpenEntity={onOpenEntity}
          onChangeCanonState={onChangeCanonState}
          onChangeNecessity={onChangeNecessity}
        />
      </div>

      <section aria-labelledby={consequencesTitleId} className="mt-8 border-t border-border pt-6">
        <h2 id={consequencesTitleId} className="flex items-center gap-2 font-serif text-lg font-bold text-text-primary">
          <Waypoints size={18} aria-hidden="true" className="text-accent-gold" />
          {copy.consequences}
        </h2>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <section aria-label={copy.directConsequences}>
            <h3 className="mb-2 text-sm font-semibold text-text-muted">{copy.directConsequences}</h3>
            {directNodes.length > 0 ? (
              <ul className="divide-y divide-border rounded-xl border border-border bg-surface px-2 py-1">
                {directNodes.map((node) => (
                  <li key={node.key}>
                    <EntityButton node={node} label={copy.openSource(node.ref.title)} onOpen={onOpenEntity} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-text-muted">{copy.noConsequences}</p>
            )}
          </section>
          <div className="space-y-4">
            {graph.indirectConsequences.length > 0 ? graph.indirectConsequences.map((group) => (
              <section key={group.depth} aria-label={copy.indirectConsequences(group.depth)}>
                <h3 className="mb-2 text-sm font-semibold text-text-muted">
                  {copy.indirectConsequences(group.depth)}
                </h3>
                <ul className="space-y-3">
                  {group.relationIds.flatMap((id) => {
                    const relation = relationById.get(id);
                    if (!relation) return [];
                    const source = nodeByKey.get(`${relation.source.engineId}:${relation.source.entityId}`);
                    const target = nodeByKey.get(`${relation.target.engineId}:${relation.target.entityId}`);
                    return source && target ? [
                      <RelationCard
                        key={relation.id}
                        relation={relation}
                        source={source}
                        target={target}
                        copy={copy}
                        onOpenEntity={onOpenEntity}
                        onChangeCanonState={onChangeCanonState}
                        onChangeNecessity={onChangeNecessity}
                      />,
                    ] : [];
                  })}
                </ul>
              </section>
            )) : (
              <p className="text-sm text-text-muted">{copy.noConsequences}</p>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby={diagnosticsTitleId} className="mt-8 border-t border-border pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={diagnosticsTitleId} className="flex items-center gap-2 font-serif text-lg font-bold text-text-primary">
            <AlertTriangle size={18} aria-hidden="true" className="text-amber-300" />
            {copy.diagnostics}
          </h2>
          {graph.truncatedRelationCount > 0 && (
            <p className="text-xs text-text-dim">{copy.hiddenRelations(graph.truncatedRelationCount)}</p>
          )}
        </div>
        {graph.findings.length === 0 && !hasActiveAssertions ? (
          <div role="status" className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-text-muted">
            <CircleDashed size={17} aria-hidden="true" />
            <span>{copy.notAssessed}</span>
          </div>
        ) : graph.findings.length === 0 ? (
          <div role="status" className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-200">
            <CheckCircle2 size={17} aria-hidden="true" />
            <span>{copy.noDiagnostics}</span>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {graph.findings.flatMap((finding) => {
              const node = nodeByKey.get(finding.nodeKey);
              return node ? [
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  node={node}
                  copy={copy}
                  onOpenEntity={onOpenEntity}
                  onAddCause={onAddCause}
                  onDeclareCoincidence={onDeclareCoincidence}
                  onConvertFinding={onConvertFinding}
                />,
              ] : [];
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
