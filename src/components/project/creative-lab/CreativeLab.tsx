import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  BookOpen,
  CircleDollarSign,
  CircleHelp,
  Eye,
  GitMerge,
  Image,
  Layers3,
  Lightbulb,
  Lock,
  MapPin,
  Maximize2,
  RefreshCw,
  Search,
  Sprout,
  StickyNote,
  Unlock,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { generateId } from '@/utils/idGenerator';
import { getCreativeLabCopy } from './copy';
import type { CreativeLabCopy } from './copy';
import {
  buildCreativePromotionRequest,
  createCreativePossibility,
  createDeckPossibility,
  dealConstraintDeck,
  getConstraintDeckIssue,
  getCreativeOperationIssue,
  groupCreativePossibilities,
  toggleComparison,
} from './core';
import type {
  ConstraintDeck,
  ConstraintDeckLocks,
  CreativeOperation,
  CreativeOperationRequest,
  CreativePossibility,
  CreativePossibilityStatus,
  CreativePromotionResult,
  CreativePromotionRequest,
  CreativePromotionTarget,
  CreativeSource,
  CreativeSourceCitation,
  CreativeSourceKind,
} from './types';

export interface CreativeLabProps {
  projectId: string;
  sources: readonly CreativeSource[];
  onPromote: (request: CreativePromotionRequest) => Promise<CreativePromotionResult>;
  onOpenSource?: (source: CreativeSourceCitation) => void;
  initialPossibilities?: readonly CreativePossibility[];
  initialDeckSeed?: number;
  createPossibilityId?: () => string;
  now?: () => number;
  /** Used only when `copy` is omitted. Any locale beginning with `es` selects Spanish. */
  locale?: string;
  /** Complete injectable copy contract, including deterministic text templates. */
  copy?: CreativeLabCopy;
  className?: string;
}

const SOURCE_ICONS: Record<CreativeSourceKind, LucideIcon> = {
  note: StickyNote,
  board: Layers3,
  codex: BookOpen,
  gallery: Image,
  seed: Sprout,
};

const SOURCE_FILTERS: readonly (CreativeSourceKind | 'all')[] = [
  'all',
  'note',
  'board',
  'codex',
  'gallery',
  'seed',
];

const OPERATION_ICONS: Record<CreativeOperation, LucideIcon> = {
  combine: GitMerge,
  invert: RefreshCw,
  remove: Archive,
  scale: Maximize2,
  relocate: MapPin,
  pov: Eye,
  cost: CircleDollarSign,
  truth: CircleHelp,
};

const FOCUS_CLASS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const FIELD_CLASS = `w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-dim transition focus:border-accent-gold ${FOCUS_CLASS}`;
const QUIET_BUTTON_CLASS = `inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-muted transition hover:border-accent-gold/50 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_CLASS}`;
const PRIMARY_BUTTON_CLASS = `inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-accent-gold px-3 py-2 text-xs font-semibold text-deep transition hover:bg-accent-amber disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_CLASS}`;

interface OperationFields {
  focus: string;
  element: string;
  scale: string;
  place: string;
  era: string;
  pointOfView: string;
  cost: string;
}

const EMPTY_OPERATION_FIELDS: OperationFields = {
  focus: '',
  element: '',
  scale: '',
  place: '',
  era: '',
  pointOfView: '',
  cost: '',
};

function operationRequest(operation: CreativeOperation, fields: OperationFields): CreativeOperationRequest {
  switch (operation) {
    case 'combine': return { operation };
    case 'invert': return { operation, focus: fields.focus };
    case 'remove': return { operation, element: fields.element };
    case 'scale': return { operation, scale: fields.scale };
    case 'relocate': return { operation, place: fields.place, era: fields.era };
    case 'pov': return { operation, pointOfView: fields.pointOfView };
    case 'cost': return { operation, cost: fields.cost };
    case 'truth': return { operation };
  }
}

function sourceCitation(source: CreativeSource): CreativeSourceCitation {
  return {
    kind: source.kind,
    id: source.id,
    projectId: source.projectId,
    title: source.title,
    ...(source.revision === undefined ? {} : { revision: source.revision }),
  };
}

function SourceGlyph({ source, size = 'regular' }: { source: CreativeSource; size?: 'small' | 'regular' }) {
  const Icon = SOURCE_ICONS[source.kind];
  const dimensions = size === 'small' ? 'h-8 w-8 rounded-md' : 'h-11 w-11 rounded-lg';
  if (source.thumbnail) {
    return <img src={source.thumbnail} alt="" className={`${dimensions} shrink-0 object-cover`} />;
  }
  return (
    <span className={`${dimensions} flex shrink-0 items-center justify-center bg-elevated text-text-muted`} aria-hidden="true">
      <Icon size={size === 'small' ? 14 : 17} />
    </span>
  );
}

interface SourcePickerProps {
  copy: CreativeLabCopy;
  sources: readonly CreativeSource[];
  selectedKeys: readonly string[];
  onToggle: (key: string) => void;
  onOpenSource?: CreativeLabProps['onOpenSource'];
}

function SourcePicker({ copy, sources, selectedKeys, onToggle, onOpenSource }: SourcePickerProps) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<CreativeSourceKind | 'all'>('all');
  const selected = new Set(selectedKeys);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return sources.filter(source => {
      if (kind !== 'all' && source.kind !== kind) return false;
      if (!needle) return true;
      return `${source.title} ${source.excerpt} ${source.tags.join(' ')}`.toLocaleLowerCase().includes(needle);
    });
  }, [kind, query, sources]);

  return (
    <aside className="flex min-h-0 flex-col border-b border-border bg-surface/55 xl:border-b-0 xl:border-r" aria-labelledby="creative-sources-title">
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="creative-sources-title" className="font-serif text-base font-semibold text-text-primary">{copy.sources.title}</h3>
          <span className="text-xs tabular-nums text-text-dim">{copy.sources.selectedCount(selected.size)}</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{copy.sources.description}</p>
        <label className="relative mt-3 block">
          <span className="sr-only">{copy.sources.searchLabel}</span>
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={copy.sources.searchPlaceholder}
            className={`${FIELD_CLASS} pl-9`}
          />
        </label>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2" aria-label={copy.sources.filterLabel}>
        {SOURCE_FILTERS.map(sourceKind => {
          const active = kind === sourceKind;
          const label = sourceKind === 'all' ? copy.sources.all : copy.sourceKinds[sourceKind];
          return (
            <button
              key={sourceKind}
              type="button"
              aria-pressed={active}
              onClick={() => setKind(sourceKind)}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs transition ${FOCUS_CLASS} ${
                active ? 'bg-accent-gold/15 font-semibold text-accent-gold' : 'text-text-muted hover:bg-elevated hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 xl:max-h-none" data-testid="creative-source-list">
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Lightbulb size={22} className="mx-auto text-text-dim" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium text-text-primary">{copy.sources.noMatchesTitle}</p>
            <p className="mt-1 text-xs text-text-muted">{copy.sources.noMatchesDescription}</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {filtered.map(source => {
              const isSelected = selected.has(source.key);
              return (
                <li key={source.key} className={`group flex items-stretch rounded-lg border transition ${
                  isSelected ? 'border-accent-gold/50 bg-accent-gold/10' : 'border-transparent hover:border-border hover:bg-elevated/70'
                }`}>
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onToggle(source.key)}
                    className={`flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left ${FOCUS_CLASS}`}
                  >
                    <SourceGlyph source={source} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-text-primary">{source.title}</span>
                        {source.usageCount === 0 && (
                          <span className="shrink-0 rounded bg-accent-gold/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent-gold">{copy.sources.unused}</span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-text-muted">{source.excerpt || copy.sourceKinds[source.kind]}</span>
                    </span>
                  </button>
                  {onOpenSource && (
                    <button
                      type="button"
                      onClick={() => onOpenSource(sourceCitation(source))}
                      aria-label={copy.sources.open(source.title)}
                      className={`m-1.5 self-center rounded-md p-2 text-text-dim opacity-70 transition hover:bg-surface hover:text-accent-gold group-hover:opacity-100 ${FOCUS_CLASS}`}
                    >
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

interface OperationComposerProps {
  copy: CreativeLabCopy;
  sources: readonly CreativeSource[];
  onRemoveSource: (key: string) => void;
  onCreate: (request: CreativeOperationRequest) => void;
}

function OperationComposer({ copy, sources, onRemoveSource, onCreate }: OperationComposerProps) {
  const [operation, setOperation] = useState<CreativeOperation>('combine');
  const [fields, setFields] = useState<OperationFields>(EMPTY_OPERATION_FIELDS);
  const request = operationRequest(operation, fields);
  const issue = getCreativeOperationIssue(request, sources.length);
  const meta = copy.operations[operation];

  const setField = (field: keyof OperationFields, value: string) => {
    setFields(current => ({ ...current, [field]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!issue) onCreate(request);
  };

  return (
    <form onSubmit={handleSubmit} className="border-b border-border bg-surface/30 px-4 py-5 sm:px-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-serif text-lg font-semibold text-text-primary">{copy.composer.title}</h3>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-muted">{copy.composer.description}</p>
        </div>
        <span className="self-start rounded-md bg-elevated px-2 py-1 text-[11px] font-medium text-text-muted">{copy.composer.offlineBadge}</span>
      </div>

      {sources.length > 0 ? (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label={copy.sources.selectedLabel}>
          {sources.map(source => (
            <button
              key={source.key}
              type="button"
              onClick={() => onRemoveSource(source.key)}
              aria-label={copy.sources.remove(source.title)}
              className={`flex max-w-56 shrink-0 items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-left transition hover:border-accent-gold/50 ${FOCUS_CLASS}`}
            >
              <SourceGlyph source={source} size="small" />
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-text-primary">{source.title}</span>
                <span className="block text-[10px] text-text-dim">{copy.sources.removeHint}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-4 border-y border-dashed border-border py-3 text-sm text-text-muted">{copy.composer.noSelection}</p>
      )}

      <fieldset className="mt-4">
        <legend className="sr-only">{copy.composer.operationLegend}</legend>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {(Object.keys(OPERATION_ICONS) as CreativeOperation[]).map(value => {
            const candidate = copy.operations[value];
            const Icon = OPERATION_ICONS[value];
            const active = operation === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setOperation(value)}
                className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${FOCUS_CLASS} ${
                  active
                    ? 'border-accent-gold/60 bg-accent-gold/10 font-semibold text-accent-gold'
                    : 'border-border text-text-muted hover:border-accent-gold/30 hover:bg-elevated hover:text-text-primary'
                }`}
              >
                <Icon size={15} className="shrink-0" aria-hidden="true" />
                <span>{candidate.label}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <p className="mb-2 text-xs leading-relaxed text-text-muted">{meta.hint}</p>
          {operation === 'combine' && <p className="min-h-10 py-2 text-sm text-text-primary">{copy.composer.combineInstruction}</p>}
          {operation === 'invert' && (
            <label className="block text-xs font-medium text-text-muted">
              {copy.composer.focusLabel} <span className="font-normal text-text-dim">{copy.composer.optional}</span>
              <input value={fields.focus} onChange={event => setField('focus', event.target.value)} placeholder={copy.composer.focusPlaceholder} className={`${FIELD_CLASS} mt-1.5`} />
            </label>
          )}
          {operation === 'remove' && (
            <label className="block text-xs font-medium text-text-muted">
              {copy.composer.removeLabel}
              <input value={fields.element} onChange={event => setField('element', event.target.value)} placeholder={copy.composer.removePlaceholder} className={`${FIELD_CLASS} mt-1.5`} />
            </label>
          )}
          {operation === 'scale' && (
            <label className="block text-xs font-medium text-text-muted">
              {copy.composer.scaleLabel}
              <input value={fields.scale} onChange={event => setField('scale', event.target.value)} placeholder={copy.composer.scalePlaceholder} className={`${FIELD_CLASS} mt-1.5`} />
            </label>
          )}
          {operation === 'relocate' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs font-medium text-text-muted">
                {copy.composer.placeLabel}
                <input value={fields.place} onChange={event => setField('place', event.target.value)} placeholder={copy.composer.placePlaceholder} className={`${FIELD_CLASS} mt-1.5`} />
              </label>
              <label className="block text-xs font-medium text-text-muted">
                {copy.composer.eraLabel}
                <input value={fields.era} onChange={event => setField('era', event.target.value)} placeholder={copy.composer.eraPlaceholder} className={`${FIELD_CLASS} mt-1.5`} />
              </label>
            </div>
          )}
          {operation === 'pov' && (
            <label className="block text-xs font-medium text-text-muted">
              {copy.composer.povLabel}
              <input value={fields.pointOfView} onChange={event => setField('pointOfView', event.target.value)} placeholder={copy.composer.povPlaceholder} className={`${FIELD_CLASS} mt-1.5`} />
            </label>
          )}
          {operation === 'cost' && (
            <label className="block text-xs font-medium text-text-muted">
              {copy.composer.costLabel}
              <input value={fields.cost} onChange={event => setField('cost', event.target.value)} placeholder={copy.composer.costPlaceholder} className={`${FIELD_CLASS} mt-1.5`} />
            </label>
          )}
          {operation === 'truth' && <p className="min-h-10 py-2 text-sm text-text-primary">{copy.composer.truthInstruction}</p>}
        </div>
        <div className="sm:pb-px">
          <button type="submit" disabled={Boolean(issue)} className={`${PRIMARY_BUTTON_CLASS} w-full sm:w-auto`}>
            <Lightbulb size={15} aria-hidden="true" />
            {copy.composer.add}
          </button>
          <p className={`mt-1.5 min-h-4 text-[11px] sm:text-right ${issue ? 'text-amber-400' : 'text-text-dim'}`} aria-live="polite">
            {issue ? copy.issues[issue] : copy.composer.ready}
          </p>
        </div>
      </div>
    </form>
  );
}

interface PromotionUiState {
  pending: boolean;
  error?: string;
}

interface PossibilityRowProps {
  copy: CreativeLabCopy;
  possibility: CreativePossibility;
  compared: boolean;
  promotionTarget: CreativePromotionTarget;
  promotionState?: PromotionUiState;
  onChange: (patch: Partial<Pick<CreativePossibility, 'title' | 'text' | 'group'>>) => void;
  onToggleCompare: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onPromotionTarget: (target: CreativePromotionTarget) => void;
  onPromote: () => void;
  onOpenSource?: CreativeLabProps['onOpenSource'];
}

function PossibilityRow(props: PossibilityRowProps) {
  const { possibility } = props;
  return (
    <article className="border-t border-border px-4 py-4 first:border-t-0 sm:px-6" data-testid={`creative-possibility-${possibility.id}`}>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded bg-accent-gold/10 px-2 py-1 font-semibold text-accent-gold">{props.copy.moves[possibility.provenance.move]}</span>
        <span className="text-text-dim">{props.copy.possibility.from}</span>
        {possibility.provenance.sources.map(source => (
          props.onOpenSource ? (
            <button
              key={`${source.kind}:${source.id}`}
              type="button"
              onClick={() => props.onOpenSource?.(source)}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-text-muted transition hover:bg-elevated hover:text-accent-gold ${FOCUS_CLASS}`}
            >
              {source.title}<ArrowUpRight size={11} aria-hidden="true" />
            </button>
          ) : (
            <span key={`${source.kind}:${source.id}`} className="text-text-muted">{source.title}</span>
          )
        ))}
        {possibility.status === 'active' && (
          <button
            type="button"
            aria-pressed={props.compared}
            onClick={props.onToggleCompare}
            className={`ml-auto rounded-md px-2 py-1 transition ${FOCUS_CLASS} ${
              props.compared ? 'bg-elevated font-semibold text-text-primary' : 'text-text-dim hover:bg-elevated hover:text-text-primary'
            }`}
          >
            {props.compared ? props.copy.possibility.comparing : props.copy.possibility.compare}
          </button>
        )}
      </div>

      <label className="mt-3 block">
        <span className="sr-only">{props.copy.possibility.titleLabel}</span>
        <input
          value={possibility.title}
          onChange={event => props.onChange({ title: event.target.value })}
          placeholder={props.copy.possibility.titlePlaceholder}
          className={`w-full bg-transparent font-serif text-base font-semibold text-text-primary placeholder:text-text-dim ${FOCUS_CLASS}`}
        />
      </label>
      <label className="mt-2 block">
        <span className="sr-only">{props.copy.possibility.textLabel}</span>
        <textarea
          value={possibility.text}
          onChange={event => props.onChange({ text: event.target.value })}
          rows={3}
          className={`${FIELD_CLASS} resize-y leading-relaxed`}
        />
      </label>

      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <label className="block max-w-xs flex-1 text-[11px] font-medium text-text-muted">
          {props.copy.possibility.groupLabel}
          <input
            key={`${possibility.id}:${possibility.group}`}
            defaultValue={possibility.group}
            onBlur={event => {
              if (event.target.value !== possibility.group) props.onChange({ group: event.target.value });
            }}
            placeholder={props.copy.possibility.groupPlaceholder}
            className={`${FIELD_CLASS} mt-1 py-1.5 text-xs`}
          />
        </label>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {possibility.status === 'active' && (
            <>
              <button type="button" onClick={props.onArchive} className={QUIET_BUTTON_CLASS}>
                <Archive size={14} aria-hidden="true" />{props.copy.possibility.archive}
              </button>
              <label>
                <span className="sr-only">{props.copy.possibility.promotionDestination}</span>
                <select
                  value={props.promotionTarget}
                  onChange={event => props.onPromotionTarget(event.target.value as CreativePromotionTarget)}
                  className={`${FIELD_CLASS} min-h-9 py-1.5 text-xs`}
                >
                  {(Object.keys(props.copy.promotionTargets) as CreativePromotionTarget[]).map(target => (
                    <option key={target} value={target}>{props.copy.promotionTargets[target]}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={props.onPromote}
                disabled={props.promotionState?.pending || !possibility.text.trim()}
                className={PRIMARY_BUTTON_CLASS}
              >
                <ArrowUpRight size={14} aria-hidden="true" />
                {props.promotionState?.pending ? props.copy.possibility.promoting : props.copy.possibility.promote}
              </button>
            </>
          )}
          {possibility.status === 'archived' && (
            <button type="button" onClick={props.onRestore} className={QUIET_BUTTON_CLASS}>
              <ArchiveRestore size={14} aria-hidden="true" />{props.copy.possibility.restore}
            </button>
          )}
          {possibility.status === 'promoted' && possibility.promotion && (
            <p className="text-xs text-emerald-400">{props.copy.possibility.promoted(
              props.copy.promotionTargets[possibility.promotion.target],
              possibility.promotion.label,
            )}</p>
          )}
        </div>
      </div>
      {props.promotionState?.error && (
        <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
          {props.promotionState.error} {props.copy.possibility.retryAfterFailure}
        </p>
      )}
    </article>
  );
}

interface ConstraintDeckPanelProps {
  copy: CreativeLabCopy;
  sources: readonly CreativeSource[];
  initialSeed: number;
  onCreate: (deck: ConstraintDeck) => void;
  onOpenSource?: CreativeLabProps['onOpenSource'];
}

function ConstraintDeckPanel({ copy, sources, initialSeed, onCreate, onOpenSource }: ConstraintDeckPanelProps) {
  const [deckState, setDeckState] = useState<ConstraintDeck>(() => dealConstraintDeck({ sources, seed: initialSeed }));
  const [locks, setLocks] = useState<ConstraintDeckLocks>({ verb: false, sourceSlots: [false, false] });
  const deck = useMemo(() => dealConstraintDeck({
    sources,
    seed: deckState.seed,
    previous: deckState,
    locks: { verb: true, sourceSlots: deckState.sourceKeys.map(() => true) },
  }), [deckState, sources]);
  const sourceByKey = useMemo(() => new Map(sources.map(source => [source.key, source])), [sources]);
  const deckSources = deck.sourceKeys
    .map(key => key ? sourceByKey.get(key) : undefined)
    .filter((source): source is CreativeSource => source !== undefined);
  const issue = getConstraintDeckIssue(deck, deckSources.length);

  const reroll = () => {
    setDeckState(dealConstraintDeck({
      sources,
      seed: deck.seed + 1,
      previous: deck,
      locks,
    }));
  };

  return (
    <aside className="border-t border-border bg-surface/55 xl:border-l xl:border-t-0" aria-labelledby="constraint-deck-title">
      <div className="border-b border-border px-4 py-4">
        <h3 id="constraint-deck-title" className="font-serif text-base font-semibold text-text-primary">{copy.deck.title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{copy.deck.description}</p>
      </div>

      <div className="space-y-3 p-4" data-testid="constraint-deck">
        <div className="rounded-xl bg-elevated p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">{copy.deck.move}</p>
              <p className="mt-1 font-serif text-lg font-semibold text-accent-gold">{copy.moves[deck.verb]}</p>
            </div>
            <button
              type="button"
              aria-pressed={locks.verb}
              onClick={() => setLocks(current => ({ ...current, verb: !current.verb }))}
              className={`rounded-md p-2 transition ${FOCUS_CLASS} ${locks.verb ? 'bg-accent-gold/15 text-accent-gold' : 'text-text-dim hover:bg-surface hover:text-text-primary'}`}
              aria-label={locks.verb ? copy.deck.unlockMove : copy.deck.lockMove}
            >
              {locks.verb ? <Lock size={14} aria-hidden="true" /> : <Unlock size={14} aria-hidden="true" />}
            </button>
          </div>
        </div>

        {deck.sourceKeys.map((key, index) => {
          const source = key ? sourceByKey.get(key) : undefined;
          const locked = locks.sourceSlots[index] ?? false;
          return (
            <div key={`deck-slot-${index}`} className="rounded-xl border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-text-dim">{copy.deck.material(index + 1)}</p>
                <button
                  type="button"
                  aria-pressed={locked}
                  onClick={() => setLocks(current => ({
                    ...current,
                    sourceSlots: current.sourceSlots.map((value, slot) => slot === index ? !value : value),
                  }))}
                  className={`rounded-md p-2 transition ${FOCUS_CLASS} ${locked ? 'bg-accent-gold/15 text-accent-gold' : 'text-text-dim hover:bg-elevated hover:text-text-primary'}`}
                  aria-label={locked ? copy.deck.unlockMaterial(index + 1) : copy.deck.lockMaterial(index + 1)}
                  disabled={!source}
                >
                  {locked ? <Lock size={14} aria-hidden="true" /> : <Unlock size={14} aria-hidden="true" />}
                </button>
              </div>
              {source ? (
                <div className="mt-1 flex items-center gap-3">
                  <SourceGlyph source={source} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">{source.title}</p>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      {copy.sourceKinds[source.kind]} · {source.usageCount === 0 ? copy.deck.unused : copy.deck.used(source.usageCount)}
                    </p>
                  </div>
                  {onOpenSource && (
                    <button
                      type="button"
                      onClick={() => onOpenSource(sourceCitation(source))}
                      className={`rounded-md p-2 text-text-dim transition hover:bg-elevated hover:text-accent-gold ${FOCUS_CLASS}`}
                      aria-label={copy.sources.open(source.title)}
                    >
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm text-text-muted">{copy.deck.missingMaterial}</p>
              )}
            </div>
          );
        })}

        <button type="button" onClick={reroll} disabled={sources.length === 0} className={`${QUIET_BUTTON_CLASS} w-full`}>
          <RefreshCw size={14} aria-hidden="true" />{copy.deck.reroll}
        </button>
        <button type="button" onClick={() => onCreate(deck)} disabled={Boolean(issue)} className={`${PRIMARY_BUTTON_CLASS} w-full`}>
          <Lightbulb size={14} aria-hidden="true" />{copy.deck.send}
        </button>
        <p className={`text-center text-[11px] ${issue ? 'text-amber-400' : 'text-text-dim'}`} aria-live="polite">
          {issue === 'select-source' && copy.deck.needsSource}
          {issue === 'select-two-sources' && copy.deck.needsTwoSources}
          {!issue && copy.deck.ready(deck.seed)}
        </p>
      </div>
    </aside>
  );
}

function promotionError(reason: unknown, copy: CreativeLabCopy): string {
  if (reason instanceof Error && reason.message.trim()) return reason.message;
  return copy.possibility.promotionFailed;
}

export function CreativeLab({
  projectId,
  sources,
  onPromote,
  onOpenSource,
  initialPossibilities = [],
  initialDeckSeed = 1,
  createPossibilityId = () => generateId('possibility'),
  now = Date.now,
  locale = 'en',
  copy: injectedCopy,
  className = '',
}: CreativeLabProps) {
  const copy = injectedCopy ?? getCreativeLabCopy(locale);
  const scopedSources = useMemo(() => sources.filter(source => source.projectId === projectId), [projectId, sources]);
  const sourceByKey = useMemo(() => new Map(scopedSources.map(source => [source.key, source])), [scopedSources]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [possibilities, setPossibilities] = useState<CreativePossibility[]>(() =>
    initialPossibilities.filter(possibility => possibility.projectId === projectId).map(possibility => ({ ...possibility })),
  );
  const [status, setStatus] = useState<CreativePossibilityStatus>('active');
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [promotionTargets, setPromotionTargets] = useState<Record<string, CreativePromotionTarget>>({});
  const [promotionStates, setPromotionStates] = useState<Record<string, PromotionUiState>>({});

  const selectedSources = selectedKeys
    .map(key => sourceByKey.get(key))
    .filter((source): source is CreativeSource => source !== undefined);
  const groups = groupCreativePossibilities(possibilities, status);
  const compared = comparisonIds
    .map(id => possibilities.find(possibility => possibility.id === id && possibility.status === 'active'))
    .filter((possibility): possibility is CreativePossibility => possibility !== undefined);
  const counts = useMemo(() => ({
    active: possibilities.filter(possibility => possibility.status === 'active').length,
    archived: possibilities.filter(possibility => possibility.status === 'archived').length,
    promoted: possibilities.filter(possibility => possibility.status === 'promoted').length,
  }), [possibilities]);

  const toggleSource = (key: string) => {
    setSelectedKeys(current => current.includes(key) ? current.filter(value => value !== key) : [...current, key]);
  };

  const addPossibility = (request: CreativeOperationRequest) => {
    const possibility = createCreativePossibility({
      id: createPossibilityId(),
      createdAt: now(),
      sources: selectedSources,
      request,
      generation: copy.generation,
      generationLocale: copy.locale,
    });
    setPossibilities(current => [possibility, ...current]);
    setStatus('active');
  };

  const addDeckPossibility = (deck: ConstraintDeck) => {
    const possibility = createDeckPossibility({
      id: createPossibilityId(),
      createdAt: now(),
      sources: scopedSources,
      deck,
      generation: copy.generation,
      generationLocale: copy.locale,
    });
    setPossibilities(current => [possibility, ...current]);
    setStatus('active');
  };

  const patchPossibility = (
    id: string,
    patch: Partial<Pick<CreativePossibility, 'title' | 'text' | 'group' | 'status' | 'promotion'>>,
  ) => {
    setPossibilities(current => current.map(possibility => possibility.id === id
      ? { ...possibility, ...patch, updatedAt: now() }
      : possibility));
  };

  const movePossibility = (id: string, nextStatus: CreativePossibilityStatus) => {
    patchPossibility(id, { status: nextStatus });
    setComparisonIds(current => current.filter(value => value !== id));
  };

  const promotePossibility = async (possibility: CreativePossibility) => {
    const target = promotionTargets[possibility.id] ?? 'note';
    setPromotionStates(current => ({ ...current, [possibility.id]: { pending: true } }));
    try {
      const result = await onPromote(buildCreativePromotionRequest(possibility, target));
      const promotedAt = now();
      setPossibilities(current => current.map(candidate => candidate.id === possibility.id
        ? {
            ...candidate,
            status: 'promoted',
            promotion: { target, entityId: result.entityId, ...(result.label ? { label: result.label } : {}), promotedAt },
            updatedAt: promotedAt,
          }
        : candidate));
      setComparisonIds(current => current.filter(value => value !== possibility.id));
      setPromotionStates(current => ({ ...current, [possibility.id]: { pending: false } }));
    } catch (reason) {
      setPromotionStates(current => ({
        ...current,
        [possibility.id]: { pending: false, error: promotionError(reason, copy) },
      }));
    }
  };

  return (
    <section
      className={`flex min-h-[44rem] flex-col overflow-hidden rounded-xl border border-border bg-background text-text-primary selection:bg-accent-gold/30 selection:text-text-primary ${className}`}
      aria-labelledby="creative-lab-title"
      data-testid="creative-lab"
    >
      <header className="flex flex-col gap-3 border-b border-border bg-surface px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 id="creative-lab-title" className="font-serif text-xl font-semibold tracking-[-0.02em] text-text-primary">{copy.header.title}</h2>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">{copy.header.description}</p>
        </div>
        <div className="flex items-center gap-3 text-xs tabular-nums text-text-muted" aria-label={copy.header.countsLabel}>
          <span>{copy.header.activeCount(counts.active)}</span>
          <span>{copy.header.archivedCount(counts.archived)}</span>
          <span>{copy.header.promotedCount(counts.promoted)}</span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        <SourcePicker copy={copy} sources={scopedSources} selectedKeys={selectedKeys} onToggle={toggleSource} onOpenSource={onOpenSource} />

        <main className="min-w-0 bg-background" aria-label={copy.workspace.label}>
          <OperationComposer copy={copy} sources={selectedSources} onRemoveSource={toggleSource} onCreate={addPossibility} />

          {compared.length > 0 && (
            <section className="border-b border-border bg-elevated/35 px-4 py-4 sm:px-6" aria-labelledby="creative-comparison-title">
              <div className="flex items-center justify-between gap-3">
                <h3 id="creative-comparison-title" className="font-serif text-sm font-semibold text-text-primary">{copy.comparison.title}</h3>
                <button type="button" onClick={() => setComparisonIds([])} className={`text-xs text-text-muted hover:text-text-primary ${FOCUS_CLASS}`}>{copy.comparison.clear}</button>
              </div>
              {compared.length === 1 ? (
                <p className="mt-2 text-xs text-text-muted">{copy.comparison.chooseAnother}</p>
              ) : (
                <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
                  {compared.map(possibility => (
                    <div key={possibility.id} className="bg-background p-3">
                      <p className="text-xs font-semibold text-accent-gold">{possibility.title || copy.moves[possibility.provenance.move]}</p>
                      <p className="mt-1 text-xs leading-relaxed text-text-muted">{possibility.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <nav className="flex items-center gap-1 border-b border-border px-4 py-2 sm:px-6" aria-label={copy.workspace.statusNavigationLabel}>
            {(Object.keys(copy.statuses) as CreativePossibilityStatus[]).map(value => (
              <button
                key={value}
                type="button"
                aria-current={status === value ? 'page' : undefined}
                onClick={() => setStatus(value)}
                className={`rounded-md px-3 py-1.5 text-xs transition ${FOCUS_CLASS} ${
                  status === value ? 'bg-elevated font-semibold text-text-primary' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {copy.statuses[value]} <span className="ml-1 tabular-nums text-text-dim">{counts[value]}</span>
              </button>
            ))}
          </nav>

          <div data-testid="creative-possibility-list">
            {groups.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <Lightbulb size={24} className="mx-auto text-text-dim" aria-hidden="true" />
                <p className="mt-3 font-serif text-base font-semibold text-text-primary">
                  {copy.workspace.emptyTitles[status]}
                </p>
                <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-text-muted">
                  {copy.workspace.emptyBodies[status]}
                </p>
              </div>
            ) : groups.map(group => (
              <section key={group.id} aria-label={group.label || copy.workspace.ungrouped}>
                <div className="flex items-center gap-3 bg-surface/45 px-4 py-2 sm:px-6">
                  <h3 className="text-xs font-semibold text-text-muted">{group.label || copy.workspace.ungrouped}</h3>
                  <span className="text-[11px] tabular-nums text-text-dim">{group.possibilities.length}</span>
                </div>
                {group.possibilities.map(possibility => (
                  <PossibilityRow
                    key={possibility.id}
                    copy={copy}
                    possibility={possibility}
                    compared={comparisonIds.includes(possibility.id)}
                    promotionTarget={promotionTargets[possibility.id] ?? 'note'}
                    promotionState={promotionStates[possibility.id]}
                    onChange={patch => patchPossibility(possibility.id, patch)}
                    onToggleCompare={() => setComparisonIds(current => toggleComparison(current, possibility.id))}
                    onArchive={() => movePossibility(possibility.id, 'archived')}
                    onRestore={() => movePossibility(possibility.id, 'active')}
                    onPromotionTarget={target => setPromotionTargets(current => ({ ...current, [possibility.id]: target }))}
                    onPromote={() => void promotePossibility(possibility)}
                    onOpenSource={onOpenSource}
                  />
                ))}
              </section>
            ))}
          </div>
        </main>

        <ConstraintDeckPanel
          copy={copy}
          sources={scopedSources}
          initialSeed={initialDeckSeed}
          onCreate={addDeckPossibility}
          onOpenSource={onOpenSource}
        />
      </div>
    </section>
  );
}
