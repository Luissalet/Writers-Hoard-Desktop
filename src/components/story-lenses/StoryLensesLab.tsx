import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  ArrowRight,
  CircleDashed,
  ExternalLink,
  FileClock,
  GitBranch,
  History,
  Link2,
  Search,
  Tags,
} from 'lucide-react';
import {
  traceIdeaArchaeology,
  type ArchaeologyRevision,
  type ArchaeologyTransition,
  type MotifEcho,
  type StoryLensAvailability,
  type StoryLensEntityNode,
  type StoryLensesReadModel,
} from '@/services/storyLenses';

export type StoryLensesView = 'motifs' | 'archaeology';

export interface StoryLensesLabCopy {
  title: string;
  description: string;
  viewsLabel: string;
  motifsView: string;
  archaeologyView: string;
  groundedNotice: string;
  searchMotifs: string;
  searchMotifsPlaceholder: string;
  motifListLabel: string;
  noMotifs: string;
  appearances: string;
  appearanceCount: (count: number) => string;
  echoesAndTransformations: string;
  noEchoes: string;
  relatedMotifs: string;
  noRelatedMotifs: string;
  sequenceGaps: string;
  noSequenceGaps: string;
  gapDescription: (scope: string, before: string, after: string, missingCount: number) => string;
  echoKind: Record<MotifEcho['kind'], string>;
  evidenceKind: Record<MotifEcho['evidenceKind'], string>;
  orphanedAnnotation: string;
  openEntity: (title: string) => string;
  searchTrail: string;
  searchTrailPlaceholder: string;
  entityListLabel: string;
  noEntities: string;
  trailFor: (title: string) => string;
  originPath: string;
  noOrigins: string;
  laterForms: string;
  noLaterForms: string;
  evidenceTrail: string;
  noEvidenceTrail: string;
  undoneEvidence: string;
  revisions: string;
  noRevisions: string;
  transitionKind: Record<ArchaeologyTransition['kind'], string>;
  transitionLabel: (kind: string, detail?: string) => string;
  depthLabel: (depth: number) => string;
  availability: Record<StoryLensAvailability, string>;
  referenceOnlyNotice: string;
  snapshotSummary: (title: string, wordCount: number, reason: ArchaeologyRevision['reason']) => string;
  openSnapshot: (title: string) => string;
  formatTimestamp: (timestamp: number) => string;
}

export interface StoryLensesLabProps {
  model: StoryLensesReadModel;
  copy: StoryLensesLabCopy;
  initialView?: StoryLensesView;
  initialMotifId?: string;
  initialEntityKey?: string;
  onOpenEntity?: (entity: StoryLensEntityNode) => void;
  onOpenSnapshot?: (snapshotId: string, writingEntity: StoryLensEntityNode) => void;
  className?: string;
}

const FOCUS_CLASS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const SEARCH_CLASS = `min-h-11 w-full rounded-lg border border-border bg-background py-2 pl-10 pr-3 text-sm text-text-primary placeholder:text-text-dim transition focus:border-accent-gold ${FOCUS_CLASS}`;
const QUIET_BUTTON_CLASS = `inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm text-text-muted transition hover:border-accent-gold/50 hover:text-text-primary ${FOCUS_CLASS}`;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function EntityButton({
  entity,
  copy,
  onOpen,
  compact = false,
}: {
  entity: StoryLensEntityNode;
  copy: StoryLensesLabCopy;
  onOpen?: (entity: StoryLensEntityNode) => void;
  compact?: boolean;
}) {
  const canOpen = entity.availability === 'live' && onOpen !== undefined;
  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-text-primary">{entity.title}</span>
        {!compact && (
          <span className="mt-0.5 block text-xs text-text-dim">
            {entity.engineId} · {copy.availability[entity.availability]}
          </span>
        )}
      </span>
      {canOpen && <ExternalLink size={14} className="shrink-0" aria-hidden="true" />}
    </>
  );
  if (!canOpen) {
    return (
      <span className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-elevated/30 px-3 py-2 text-left text-sm">
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-story-lens-open={entity.key}
      aria-label={copy.openEntity(entity.title)}
      onClick={() => onOpen(entity)}
      className={`${QUIET_BUTTON_CLASS} min-w-0`}
    >
      {content}
    </button>
  );
}

function SearchField({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="block text-xs font-medium text-text-muted">
      {label}
      <span className="relative mt-2 block">
        <Search
          size={15}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-text-dim"
          aria-hidden="true"
        />
        <input
          id={id}
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={SEARCH_CLASS}
        />
      </span>
    </label>
  );
}

function MotifSurface({
  model,
  copy,
  initialMotifId,
  onOpenEntity,
}: Pick<StoryLensesLabProps, 'model' | 'copy' | 'initialMotifId' | 'onOpenEntity'>) {
  const [query, setQuery] = useState('');
  const [requestedMotifId, setRequestedMotifId] = useState(initialMotifId ?? '');
  const motifById = useMemo(
    () => new Map(model.constellation.motifs.map((motif) => [motif.id, motif])),
    [model.constellation.motifs],
  );
  const entityByKey = useMemo(
    () => new Map(model.entities.map((entity) => [entity.key, entity])),
    [model.entities],
  );
  const filteredMotifs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return model.constellation.motifs;
    return model.constellation.motifs.filter((motif) =>
      `${motif.label} ${motif.aliases.join(' ')}`.toLowerCase().includes(needle),
    );
  }, [model.constellation.motifs, query]);
  const selected = motifById.get(requestedMotifId)
    ?? model.constellation.motifs[0]
    ?? null;
  const selectedGaps = selected
    ? model.constellation.gaps.filter((gap) => gap.motifId === selected.id)
    : [];

  return (
    <div className="grid min-h-0 gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="min-h-0 rounded-xl border border-border bg-surface p-3" aria-label={copy.motifListLabel}>
        <SearchField
          id="story-lenses-motif-search"
          label={copy.searchMotifs}
          placeholder={copy.searchMotifsPlaceholder}
          value={query}
          onChange={setQuery}
        />
        <div className="mt-3 max-h-[32rem] space-y-1 overflow-y-auto pr-1">
          {filteredMotifs.map((motif) => (
            <button
              key={motif.id}
              type="button"
              aria-pressed={selected?.id === motif.id}
              onClick={() => setRequestedMotifId(motif.id)}
              className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${FOCUS_CLASS} ${
                selected?.id === motif.id
                  ? 'bg-accent-gold/12 text-accent-gold'
                  : 'text-text-muted hover:bg-elevated/60 hover:text-text-primary'
              }`}
            >
              <Tags size={15} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{motif.label}</span>
              <span className="text-xs tabular-nums text-text-dim">{motif.appearances.length}</span>
            </button>
          ))}
          {!filteredMotifs.length && (
            <p role="status" className="px-3 py-8 text-center text-sm text-text-dim">{copy.noMotifs}</p>
          )}
        </div>
      </aside>

      <section aria-live="polite" className="min-w-0">
        {!selected ? (
          <div className="rounded-xl border border-dashed border-border px-5 py-12 text-center">
            <CircleDashed size={22} className="mx-auto text-text-dim" aria-hidden="true" />
            <p className="mt-3 text-sm text-text-muted">{copy.noMotifs}</p>
          </div>
        ) : (
          <div className="space-y-7">
            <header className="border-b border-border pb-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="font-serif text-2xl font-semibold text-text-primary">{selected.label}</h3>
                <span className="text-sm tabular-nums text-text-muted">
                  {copy.appearanceCount(selected.appearances.length)}
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-muted">{copy.groundedNotice}</p>
            </header>

            <section aria-labelledby="story-lenses-appearances-title">
              <h4 id="story-lenses-appearances-title" className="mb-3 text-sm font-semibold text-text-primary">
                {copy.appearances}
              </h4>
              <div className="grid gap-2 md:grid-cols-2">
                {selected.appearances.flatMap((appearance) => {
                  const entity = entityByKey.get(appearance.entityKey);
                  return entity ? [(
                    <EntityButton
                      key={appearance.id}
                      entity={entity}
                      copy={copy}
                      onOpen={onOpenEntity}
                    />
                  )] : [];
                })}
              </div>
            </section>

            <section aria-labelledby="story-lenses-echoes-title">
              <h4 id="story-lenses-echoes-title" className="mb-3 text-sm font-semibold text-text-primary">
                {copy.echoesAndTransformations}
              </h4>
              {selected.echoes.length ? (
                <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
                  {selected.echoes.map((echo) => {
                    const source = entityByKey.get(echo.sourceEntityKey);
                    const target = entityByKey.get(echo.targetEntityKey);
                    if (!source || !target) return null;
                    return (
                      <li key={echo.id} className="p-3 sm:p-4">
                        <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                          <EntityButton entity={source} copy={copy} onOpen={onOpenEntity} compact />
                          <ArrowRight size={15} className="hidden text-text-dim sm:block" aria-hidden="true" />
                          <EntityButton entity={target} copy={copy} onOpen={onOpenEntity} compact />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-dim">
                          <span>{copy.echoKind[echo.kind]}</span>
                          <span>{copy.evidenceKind[echo.evidenceKind]}</span>
                          {echo.relation && <span>{echo.relation}</span>}
                          {echo.orphaned && <span>{copy.orphanedAnnotation}</span>}
                        </div>
                        {echo.note && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-text-muted">{echo.note}</p>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-text-dim">
                  {copy.noEchoes}
                </p>
              )}
            </section>

            <div className="grid gap-7 lg:grid-cols-2">
              <section aria-labelledby="story-lenses-related-title">
                <h4 id="story-lenses-related-title" className="mb-3 text-sm font-semibold text-text-primary">
                  {copy.relatedMotifs}
                </h4>
                {selected.relatedMotifIds.length ? (
                  <div className="flex flex-wrap gap-2">
                    {selected.relatedMotifIds.map((motifId) => {
                      const related = motifById.get(motifId);
                      if (!related) return null;
                      return (
                        <button
                          key={motifId}
                          type="button"
                          onClick={() => setRequestedMotifId(motifId)}
                          className={QUIET_BUTTON_CLASS}
                        >
                          <Link2 size={14} aria-hidden="true" /> {related.label}
                        </button>
                      );
                    })}
                  </div>
                ) : <p className="text-sm text-text-dim">{copy.noRelatedMotifs}</p>}
              </section>

              <section aria-labelledby="story-lenses-gaps-title">
                <h4 id="story-lenses-gaps-title" className="mb-3 text-sm font-semibold text-text-primary">
                  {copy.sequenceGaps}
                </h4>
                {selectedGaps.length ? (
                  <ul className="space-y-2">
                    {selectedGaps.map((gap) => {
                      const before = entityByKey.get(gap.beforeEntityKey);
                      const after = entityByKey.get(gap.afterEntityKey);
                      if (!before || !after) return null;
                      return (
                        <li key={gap.id} className="rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-text-muted">
                          {copy.gapDescription(gap.scopeTitle, before.title, after.title, gap.missingEntityKeys.length)}
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="text-sm text-text-dim">{copy.noSequenceGaps}</p>}
              </section>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function TransitionRow({
  transition,
  entityByKey,
  copy,
  onOpenEntity,
}: {
  transition: ArchaeologyTransition;
  entityByKey: ReadonlyMap<string, StoryLensEntityNode>;
  copy: StoryLensesLabCopy;
  onOpenEntity?: StoryLensesLabProps['onOpenEntity'];
}) {
  const source = entityByKey.get(transition.sourceKey);
  const target = entityByKey.get(transition.targetKey);
  if (!source || !target) return null;
  return (
    <li className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] sm:items-center">
      <EntityButton entity={source} copy={copy} onOpen={onOpenEntity} compact />
      <ArrowRight size={15} className="hidden text-text-dim sm:block" aria-hidden="true" />
      <EntityButton entity={target} copy={copy} onOpen={onOpenEntity} compact />
      <span className="text-xs text-text-dim sm:text-right">
        <span className="block">{copy.transitionLabel(copy.transitionKind[transition.kind], transition.label)}</span>
        <time dateTime={new Date(transition.createdAt).toISOString()} className="mt-0.5 block tabular-nums">
          {copy.formatTimestamp(transition.createdAt)}
        </time>
      </span>
    </li>
  );
}

function ArchaeologySurface({
  model,
  copy,
  initialEntityKey,
  onOpenEntity,
  onOpenSnapshot,
}: Pick<
  StoryLensesLabProps,
  'model' | 'copy' | 'initialEntityKey' | 'onOpenEntity' | 'onOpenSnapshot'
>) {
  const [query, setQuery] = useState('');
  const [requestedEntityKey, setRequestedEntityKey] = useState(initialEntityKey ?? '');
  const entityByKey = useMemo(
    () => new Map(model.archaeology.nodes.map((entity) => [entity.key, entity])),
    [model.archaeology.nodes],
  );
  const relevantKeys = useMemo(() => new Set([
    ...model.archaeology.transitions.flatMap((transition) => [transition.sourceKey, transition.targetKey]),
    ...model.archaeology.revisions.map((revision) => revision.entityKey),
  ]), [model.archaeology.revisions, model.archaeology.transitions]);
  const trailEntities = useMemo(() => {
    const candidates = relevantKeys.size
      ? model.archaeology.nodes.filter((node) => relevantKeys.has(node.key))
      : model.archaeology.nodes.filter((node) => node.availability === 'live');
    return candidates.slice().sort((left, right) =>
      compareText(left.title.toLowerCase(), right.title.toLowerCase()) || compareText(left.key, right.key),
    );
  }, [model.archaeology.nodes, relevantKeys]);
  const filteredEntities = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return trailEntities;
    return trailEntities.filter((entity) =>
      `${entity.title} ${entity.engineId} ${entity.entityType}`.toLowerCase().includes(needle),
    );
  }, [query, trailEntities]);
  const selectedKey = entityByKey.has(requestedEntityKey)
    ? requestedEntityKey
    : trailEntities[0]?.key ?? '';
  const trace = selectedKey ? traceIdeaArchaeology(model.archaeology, selectedKey) : null;

  return (
    <div className="grid min-h-0 gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="min-h-0 rounded-xl border border-border bg-surface p-3" aria-label={copy.entityListLabel}>
        <SearchField
          id="story-lenses-archaeology-search"
          label={copy.searchTrail}
          placeholder={copy.searchTrailPlaceholder}
          value={query}
          onChange={setQuery}
        />
        <div className="mt-3 max-h-[32rem] space-y-1 overflow-y-auto pr-1">
          {filteredEntities.map((entity) => (
            <button
              key={entity.key}
              type="button"
              aria-pressed={selectedKey === entity.key}
              onClick={() => setRequestedEntityKey(entity.key)}
              className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${FOCUS_CLASS} ${
                selectedKey === entity.key
                  ? 'bg-accent-gold/12 text-accent-gold'
                  : 'text-text-muted hover:bg-elevated/60 hover:text-text-primary'
              }`}
            >
              <GitBranch size={15} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{entity.title}</span>
                <span className="block truncate text-xs text-text-dim">{copy.availability[entity.availability]}</span>
              </span>
            </button>
          ))}
          {!filteredEntities.length && (
            <p role="status" className="px-3 py-8 text-center text-sm text-text-dim">{copy.noEntities}</p>
          )}
        </div>
      </aside>

      <section aria-live="polite" className="min-w-0">
        {!trace ? (
          <div className="rounded-xl border border-dashed border-border px-5 py-12 text-center">
            <CircleDashed size={22} className="mx-auto text-text-dim" aria-hidden="true" />
            <p className="mt-3 text-sm text-text-muted">{copy.noEntities}</p>
          </div>
        ) : (
          <div className="space-y-7">
            <header className="border-b border-border pb-4">
              <h3 className="font-serif text-2xl font-semibold text-text-primary">{copy.trailFor(trace.selected.title)}</h3>
              <p className="mt-2 text-sm text-text-muted">
                {trace.selected.availability === 'reference-only'
                  ? copy.referenceOnlyNotice
                  : copy.availability[trace.selected.availability]}
              </p>
            </header>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <section aria-labelledby="story-lenses-origins-title">
                <h4 id="story-lenses-origins-title" className="mb-3 text-sm font-semibold text-text-primary">
                  {copy.originPath}
                </h4>
                {trace.ancestors.length ? (
                  <ol className="space-y-2">
                    {trace.ancestors.map(({ node, depth }) => (
                      <li key={node.key} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                        <span className="text-xs tabular-nums text-text-dim">{copy.depthLabel(depth)}</span>
                        <EntityButton entity={node} copy={copy} onOpen={onOpenEntity} />
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-text-dim">{copy.noOrigins}</p>}
              </section>

              <section aria-labelledby="story-lenses-later-title">
                <h4 id="story-lenses-later-title" className="mb-3 text-sm font-semibold text-text-primary">
                  {copy.laterForms}
                </h4>
                {trace.descendants.length ? (
                  <ol className="space-y-2">
                    {trace.descendants.map(({ node, depth }) => (
                      <li key={node.key} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                        <span className="text-xs tabular-nums text-text-dim">{copy.depthLabel(depth)}</span>
                        <EntityButton entity={node} copy={copy} onOpen={onOpenEntity} />
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-text-dim">{copy.noLaterForms}</p>}
              </section>
            </div>

            <section aria-labelledby="story-lenses-evidence-title">
              <h4 id="story-lenses-evidence-title" className="mb-3 text-sm font-semibold text-text-primary">
                {copy.evidenceTrail}
              </h4>
              {trace.activeTransitions.length ? (
                <ol className="divide-y divide-border rounded-xl border border-border bg-surface">
                  {trace.activeTransitions.map((transition) => (
                    <TransitionRow
                      key={transition.id}
                      transition={transition}
                      entityByKey={entityByKey}
                      copy={copy}
                      onOpenEntity={onOpenEntity}
                    />
                  ))}
                </ol>
              ) : <p className="text-sm text-text-dim">{copy.noEvidenceTrail}</p>}
            </section>

            {trace.undoneTransitions.length > 0 && (
              <section aria-labelledby="story-lenses-undone-title">
                <h4 id="story-lenses-undone-title" className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
                  <History size={15} aria-hidden="true" /> {copy.undoneEvidence}
                </h4>
                <ol className="divide-y divide-border rounded-xl border border-border bg-surface opacity-75">
                  {trace.undoneTransitions.map((transition) => (
                    <TransitionRow
                      key={transition.id}
                      transition={transition}
                      entityByKey={entityByKey}
                      copy={copy}
                      onOpenEntity={onOpenEntity}
                    />
                  ))}
                </ol>
              </section>
            )}

            <section aria-labelledby="story-lenses-revisions-title">
              <h4 id="story-lenses-revisions-title" className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
                <FileClock size={15} aria-hidden="true" /> {copy.revisions}
              </h4>
              {trace.revisions.length ? (
                <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
                  {trace.revisions.map((revision) => {
                    const writing = entityByKey.get(revision.entityKey);
                    if (!writing) return null;
                    return (
                      <li key={revision.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <span className="min-w-0">
                          <span className="block text-sm text-text-primary">
                            {copy.snapshotSummary(revision.title, revision.wordCount, revision.reason)}
                          </span>
                          <time dateTime={new Date(revision.createdAt).toISOString()} className="mt-0.5 block text-xs tabular-nums text-text-dim">
                            {copy.formatTimestamp(revision.createdAt)}
                          </time>
                        </span>
                        {onOpenSnapshot && (
                          <button
                            type="button"
                            aria-label={copy.openSnapshot(revision.title)}
                            onClick={() => onOpenSnapshot(revision.snapshotId, writing)}
                            className={QUIET_BUTTON_CLASS}
                          >
                            <FileClock size={14} aria-hidden="true" /> {copy.availability['snapshot-only']}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-sm text-text-dim">{copy.noRevisions}</p>}
            </section>
          </div>
        )}
      </section>
    </div>
  );
}

export default function StoryLensesLab({
  model,
  copy,
  initialView = 'motifs',
  initialMotifId,
  initialEntityKey,
  onOpenEntity,
  onOpenSnapshot,
  className = '',
}: StoryLensesLabProps) {
  const [view, setView] = useState<StoryLensesView>(initialView);
  const motifPanelId = 'story-lenses-panel-motifs';
  const archaeologyPanelId = 'story-lenses-panel-archaeology';
  const activateView = (nextView: StoryLensesView, moveFocus = false): void => {
    setView(nextView);
    if (moveFocus) {
      document.getElementById(`story-lenses-tab-${nextView}`)?.focus();
    }
  };
  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextView = event.key === 'ArrowLeft' || event.key === 'Home'
      ? 'motifs'
      : 'archaeology';
    activateView(nextView, true);
  };
  return (
    <section className={`space-y-5 ${className}`} aria-labelledby="story-lenses-title">
      <header className="max-w-3xl">
        <h2 id="story-lenses-title" className="font-serif text-2xl font-semibold text-text-primary">{copy.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">{copy.description}</p>
      </header>

      <div role="tablist" aria-label={copy.viewsLabel} className="inline-flex rounded-xl border border-border bg-surface p-1">
        <button
          id="story-lenses-tab-motifs"
          type="button"
          role="tab"
          aria-selected={view === 'motifs'}
          aria-controls={motifPanelId}
          tabIndex={view === 'motifs' ? 0 : -1}
          onClick={() => activateView('motifs')}
          onKeyDown={handleTabKey}
          className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${FOCUS_CLASS} ${
            view === 'motifs' ? 'bg-elevated text-accent-gold' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <Tags size={15} aria-hidden="true" /> {copy.motifsView}
        </button>
        <button
          id="story-lenses-tab-archaeology"
          type="button"
          role="tab"
          aria-selected={view === 'archaeology'}
          aria-controls={archaeologyPanelId}
          tabIndex={view === 'archaeology' ? 0 : -1}
          onClick={() => activateView('archaeology')}
          onKeyDown={handleTabKey}
          className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${FOCUS_CLASS} ${
            view === 'archaeology' ? 'bg-elevated text-accent-gold' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <GitBranch size={15} aria-hidden="true" /> {copy.archaeologyView}
        </button>
      </div>

      <div
        id={motifPanelId}
        role="tabpanel"
        aria-labelledby="story-lenses-tab-motifs"
        hidden={view !== 'motifs'}
      >
        {view === 'motifs' && (
          <MotifSurface
            model={model}
            copy={copy}
            initialMotifId={initialMotifId}
            onOpenEntity={onOpenEntity}
          />
        )}
      </div>
      <div
        id={archaeologyPanelId}
        role="tabpanel"
        aria-labelledby="story-lenses-tab-archaeology"
        hidden={view !== 'archaeology'}
      >
        {view === 'archaeology' && (
          <ArchaeologySurface
            model={model}
            copy={copy}
            initialEntityKey={initialEntityKey}
            onOpenEntity={onOpenEntity}
            onOpenSnapshot={onOpenSnapshot}
          />
        )}
      </div>
    </section>
  );
}
