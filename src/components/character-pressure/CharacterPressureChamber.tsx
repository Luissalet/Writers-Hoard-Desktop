import { useId, useState } from 'react';
import {
  ArrowRight,
  Clock3,
  Coins,
  Gauge,
  Handshake,
  HelpCircle,
  Link2,
  Loader2,
  LockKeyhole,
  NotebookPen,
  Scale,
  Sparkles,
  Swords,
  Theater,
  Users,
} from 'lucide-react';
import type { CharacterArc } from '@/engines/character-arc/types';
import type { Relationship } from '@/engines/relationships/types';
import {
  buildCharacterPressureSession,
  createCharacterPressurePromotionDraft,
  type CharacterPressureDimension,
  type CharacterPressureInsight,
  type CharacterPressureInsightKind,
  type CharacterPressureLocale,
  type CharacterPressurePromotionDraft,
  type CharacterPressurePromotionTarget,
  type CharacterPressureSession,
  type CharacterPressureSituation,
  type CharacterPressureValidationCode,
  CharacterPressureValidationError,
} from '@/services/characterPressureChamber';
import type { CodexEntry } from '@/types';

type PromotionHandler<T extends CharacterPressurePromotionTarget> = (
  draft: CharacterPressurePromotionDraft<T>,
) => void | Promise<void>;

export interface CharacterPressureChamberCopy {
  title: string;
  subtitle: string;
  nonCanon: string;
  charactersLegend: string;
  charactersHint: string;
  noCharacters: string;
  selectedCount: (count: number) => string;
  profilesTitle: string;
  profilesHint: string;
  pressureTitle: string;
  pressureHint: string;
  labels: Record<keyof Required<CharacterPressureSituation>, string>;
  placeholders: Record<keyof Required<CharacterPressureSituation>, string>;
  run: string;
  rerun: string;
  resultsTitle: string;
  resultsHint: string;
  resultCount: (count: number) => string;
  categories: Record<CharacterPressureInsightKind | 'all', string>;
  dimensions: Record<CharacterPressureDimension, string>;
  explicitSignal: string;
  adjacentSignal: string;
  missingSignal: string;
  evidenceTitle: string;
  promotionsTitle: string;
  promotionUnavailable: string;
  promote: Record<CharacterPressurePromotionTarget, string>;
  promotionRequested: (target: CharacterPressurePromotionTarget) => string;
  promotionFailed: string;
  validation: Record<
    Extract<CharacterPressureValidationCode, 'character-count' | 'situation-required' | 'pressure-required'>,
    string
  >;
}

const DEFAULT_CHARACTER_PRESSURE_COPY: CharacterPressureChamberCopy = {
  title: 'Character pressure chamber',
  subtitle: 'Put existing motives and relationships under pressure to discover questions—not answers.',
  nonCanon: 'Exploration only · never changes canon',
  charactersLegend: 'Choose 2–4 characters',
  charactersHint: 'The chamber reads their Codex entries, latest linked arcs, and recorded relationships.',
  noCharacters: 'Add character entries to the Codex before opening this chamber.',
  selectedCount: (count) => `${count} selected`,
  profilesTitle: 'Signals in play',
  profilesHint: 'Adjacent signals are prompts, not facts. Missing signals remain visibly open.',
  pressureTitle: 'Set the pressure',
  pressureHint: 'Describe the situation, then add at least one constraint.',
  labels: {
    situation: 'Situation',
    scarceResource: 'Scarce resource',
    timeLimit: 'Time limit',
    secret: 'Secret',
    cost: 'Cost',
  },
  placeholders: {
    situation: 'The group is trapped somewhere that makes neutrality impossible…',
    scarceResource: 'One seat, a single dose, the last safe route…',
    timeLimit: 'Before dawn, ten minutes, one final vote…',
    secret: 'What one person knows and cannot safely reveal…',
    cost: 'What success would consume, expose, or break…',
  },
  run: 'Open the chamber',
  rerun: 'Run again',
  resultsTitle: 'Possibilities under pressure',
  resultsHint: 'Every result is an open question grounded in the selected source rows.',
  resultCount: (count) => `${count} possibilities`,
  categories: {
    all: 'All',
    question: 'Questions',
    friction: 'Frictions',
    alliance: 'Alliances',
    decision: 'Decisions',
  },
  dimensions: {
    objective: 'Objective',
    need: 'Need',
    fear: 'Fear',
    power: 'Power',
    debt: 'Debt',
    relationship: 'Relationship',
  },
  explicitSignal: 'Recorded directly',
  adjacentSignal: 'Possible pressure inferred from an adjacent field',
  missingSignal: 'Still open',
  evidenceTitle: 'Why this question appeared',
  promotionsTitle: 'Turn this possibility into a draft',
  promotionUnavailable: 'Connect a destination callback to promote this possibility.',
  promote: {
    beat: 'Draft beat',
    scene: 'Draft scene',
    'relationship-change': 'Draft relationship change',
    note: 'Draft note',
  },
  promotionRequested: (target) => `Draft handed to the ${target} destination with provenance.`,
  promotionFailed: 'The destination did not accept the draft. Nothing was changed here.',
  validation: {
    'character-count': 'Choose between two and four characters.',
    'situation-required': 'Describe the situation before opening the chamber.',
    'pressure-required': 'Add a scarce resource, time limit, secret, or cost.',
  },
};

export interface CharacterPressureChamberProps {
  projectId: string;
  codexEntries: readonly CodexEntry[];
  characterArcs: readonly CharacterArc[];
  relationships: readonly Relationship[];
  locale?: CharacterPressureLocale;
  copy?: CharacterPressureChamberCopy;
  initialCharacterIds?: readonly string[];
  initialPressure?: Partial<CharacterPressureSituation>;
  onPromoteBeat?: PromotionHandler<'beat'>;
  onPromoteScene?: PromotionHandler<'scene'>;
  onPromoteRelationshipChange?: PromotionHandler<'relationship-change'>;
  onPromoteNote?: PromotionHandler<'note'>;
}

const KIND_ICONS: Record<CharacterPressureInsightKind, typeof HelpCircle> = {
  question: HelpCircle,
  friction: Swords,
  alliance: Handshake,
  decision: Scale,
};

const KIND_STYLES: Record<CharacterPressureInsightKind, string> = {
  question: 'bg-blue-500/10 text-blue-300',
  friction: 'bg-red-500/10 text-red-300',
  alliance: 'bg-green-500/10 text-green-300',
  decision: 'bg-amber-500/10 text-amber-300',
};

const SIGNAL_DIMENSIONS: Array<Exclude<CharacterPressureDimension, 'relationship'>> = [
  'objective',
  'need',
  'fear',
  'power',
  'debt',
];

function validInitialSelection(
  projectId: string,
  entries: readonly CodexEntry[],
  initial: readonly string[],
): string[] {
  const available = new Set(
    entries
      .filter((entry) => entry.projectId === projectId && entry.type === 'character')
      .map((entry) => entry.id),
  );
  return [...new Set(initial)].filter((id) => available.has(id)).slice(0, 4);
}

function signalStatusLabel(
  confidence: 'explicit' | 'adjacent' | 'missing',
  copy: CharacterPressureChamberCopy,
): string {
  if (confidence === 'explicit') return copy.explicitSignal;
  if (confidence === 'adjacent') return copy.adjacentSignal;
  return copy.missingSignal;
}

function PromotionIcon({ target }: { target: CharacterPressurePromotionTarget }) {
  const Icon = target === 'beat'
    ? ArrowRight
    : target === 'scene'
      ? Theater
      : target === 'relationship-change'
        ? Link2
        : NotebookPen;
  return <Icon size={14} aria-hidden="true" />;
}

function PressureResult({
  insight,
  copy,
  promotionTargets,
  promotionBusy,
  busyTarget,
  onPromote,
}: {
  insight: CharacterPressureInsight;
  copy: CharacterPressureChamberCopy;
  promotionTargets: readonly CharacterPressurePromotionTarget[];
  promotionBusy: boolean;
  busyTarget: CharacterPressurePromotionTarget | null;
  onPromote: (target: CharacterPressurePromotionTarget) => void;
}) {
  const Icon = KIND_ICONS[insight.kind];
  const applicableTargets = promotionTargets.filter((target) =>
    target !== 'relationship-change' || insight.characterIds.length >= 2,
  );

  return (
    <article className="border-b border-border px-5 py-5 last:border-b-0">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${KIND_STYLES[insight.kind]}`}
          aria-hidden="true"
        >
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-xs font-semibold text-text-muted">
            {copy.categories[insight.kind]}
          </span>
          <p className="mt-1 max-w-[75ch] text-sm leading-6 text-text-primary">
            {insight.prompt}
          </p>

          <details className="mt-3">
            <summary className="w-fit cursor-pointer text-xs text-text-muted underline decoration-border underline-offset-4 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold">
              {copy.evidenceTitle}
            </summary>
            <ul className="mt-2 flex flex-wrap gap-2" aria-label={copy.evidenceTitle}>
              {insight.evidence.map((evidence, index) => (
                <li
                  key={`${evidence.dimension}:${evidence.characterId ?? 'pair'}:${index}`}
                  className="rounded-md bg-elevated px-2 py-1 text-xs text-text-muted"
                  title={signalStatusLabel(evidence.confidence, copy)}
                >
                  <span className="text-text-primary">{copy.dimensions[evidence.dimension]}</span>
                  {' · '}
                  {signalStatusLabel(evidence.confidence, copy)}
                </li>
              ))}
            </ul>
          </details>

          <div className="mt-4 border-t border-border/70 pt-3">
            <p className="text-xs font-medium text-text-muted">{copy.promotionsTitle}</p>
            {applicableTargets.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {applicableTargets.map((target) => {
                  const busy = busyTarget === target;
                  return (
                    <button
                      key={target}
                      type="button"
                      disabled={promotionBusy}
                      aria-busy={busy || undefined}
                      onClick={() => onPromote(target)}
                      className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-primary transition hover:border-accent-gold hover:text-accent-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <PromotionIcon target={target} />
                      )}
                      {copy.promote[target]}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-2 text-xs text-text-dim">{copy.promotionUnavailable}</p>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function CharacterPressureChamber({
  projectId,
  codexEntries,
  characterArcs,
  relationships,
  locale = 'en',
  copy = DEFAULT_CHARACTER_PRESSURE_COPY,
  initialCharacterIds = [],
  initialPressure,
  onPromoteBeat,
  onPromoteScene,
  onPromoteRelationshipChange,
  onPromoteNote,
}: CharacterPressureChamberProps) {
  const id = useId();
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    validInitialSelection(projectId, codexEntries, initialCharacterIds),
  );
  const [pressure, setPressure] = useState<Required<CharacterPressureSituation>>({
    situation: initialPressure?.situation ?? '',
    scarceResource: initialPressure?.scarceResource ?? '',
    timeLimit: initialPressure?.timeLimit ?? '',
    secret: initialPressure?.secret ?? '',
    cost: initialPressure?.cost ?? '',
  });
  const [session, setSession] = useState<CharacterPressureSession | null>(null);
  const [activeKind, setActiveKind] = useState<CharacterPressureInsightKind | 'all'>('all');
  const [validationMessage, setValidationMessage] = useState('');
  const [promotionState, setPromotionState] = useState<{
    resultId: string;
    target: CharacterPressurePromotionTarget;
  } | null>(null);
  const [promotionMessage, setPromotionMessage] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);

  const characters = codexEntries
    .filter((entry) => entry.projectId === projectId && entry.type === 'character')
    .sort((left, right) =>
      left.title.toLowerCase() < right.title.toLowerCase()
        ? -1
        : left.title.toLowerCase() > right.title.toLowerCase()
          ? 1
          : left.id < right.id ? -1 : 1,
    );
  const selectedSet = new Set(selectedIds);
  const selectedProfiles = session?.characters ?? [];
  const filteredInsights = session?.insights.filter((insight) =>
    activeKind === 'all' || insight.kind === activeKind,
  ) ?? [];
  const promotionTargets = [
    onPromoteBeat && 'beat',
    onPromoteScene && 'scene',
    onPromoteRelationshipChange && 'relationship-change',
    onPromoteNote && 'note',
  ].filter(Boolean) as CharacterPressurePromotionTarget[];
  const canRun = selectedIds.length >= 2
    && selectedIds.length <= 4
    && pressure.situation.trim().length > 0
    && [pressure.scarceResource, pressure.timeLimit, pressure.secret, pressure.cost]
      .some((value) => value.trim().length > 0);

  const clearResult = (): void => {
    setSession(null);
    setValidationMessage('');
    setPromotionMessage(null);
  };

  const toggleCharacter = (characterId: string): void => {
    if (selectedSet.has(characterId)) {
      setSelectedIds(selectedIds.filter((idValue) => idValue !== characterId));
    } else if (selectedIds.length < 4) {
      setSelectedIds([...selectedIds, characterId]);
    }
    clearResult();
  };

  const updatePressure = (
    field: keyof Required<CharacterPressureSituation>,
    value: string,
  ): void => {
    setPressure({ ...pressure, [field]: value });
    clearResult();
  };

  const runChamber = (): void => {
    try {
      const next = buildCharacterPressureSession({
        projectId,
        characterIds: selectedIds,
        codexEntries,
        characterArcs,
        relationships,
        pressure,
        locale,
      });
      setSession(next);
      setActiveKind('all');
      setValidationMessage('');
      setPromotionMessage(null);
    } catch (error) {
      if (error instanceof CharacterPressureValidationError
        && error.code in copy.validation) {
        setValidationMessage(
          copy.validation[error.code as keyof CharacterPressureChamberCopy['validation']],
        );
      } else {
        setValidationMessage(copy.validation['character-count']);
      }
    }
  };

  const promote = async (
    insight: CharacterPressureInsight,
    target: CharacterPressurePromotionTarget,
  ): Promise<void> => {
    if (!session || promotionState) return;
    setPromotionState({ resultId: insight.id, target });
    setPromotionMessage(null);
    try {
      switch (target) {
        case 'beat':
          if (onPromoteBeat) {
            await onPromoteBeat(createCharacterPressurePromotionDraft(session, insight.id, 'beat'));
          }
          break;
        case 'scene':
          if (onPromoteScene) {
            await onPromoteScene(createCharacterPressurePromotionDraft(session, insight.id, 'scene'));
          }
          break;
        case 'relationship-change':
          if (onPromoteRelationshipChange) {
            await onPromoteRelationshipChange(
              createCharacterPressurePromotionDraft(session, insight.id, 'relationship-change'),
            );
          }
          break;
        case 'note':
          if (onPromoteNote) {
            await onPromoteNote(createCharacterPressurePromotionDraft(session, insight.id, 'note'));
          }
          break;
      }
      setPromotionMessage({ kind: 'success', message: copy.promotionRequested(target) });
    } catch (error) {
      console.error('Character pressure promotion callback failed', error);
      setPromotionMessage({ kind: 'error', message: copy.promotionFailed });
    } finally {
      setPromotionState(null);
    }
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="overflow-hidden rounded-xl border border-border bg-surface"
    >
      <header className="flex flex-col gap-3 border-b border-border px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Gauge size={20} className="shrink-0 text-accent-gold" aria-hidden="true" />
            <h2 id={`${id}-title`} className="font-serif text-xl font-semibold text-text-primary">
              {copy.title}
            </h2>
          </div>
          <p className="mt-1 max-w-[70ch] text-sm leading-6 text-text-muted">{copy.subtitle}</p>
        </div>
        <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full bg-accent-gold/10 px-3 py-1 text-xs font-medium text-accent-gold">
          <Sparkles size={13} aria-hidden="true" />
          {copy.nonCanon}
        </span>
      </header>

      <div className="grid lg:grid-cols-[minmax(18rem,0.82fr)_minmax(0,1.18fr)]">
        <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
          <fieldset aria-describedby={`${id}-characters-hint`}>
            <legend className="font-serif font-semibold text-text-primary">
              {copy.charactersLegend}
            </legend>
            <div className="mt-1 flex items-start justify-between gap-3">
              <p id={`${id}-characters-hint`} className="text-xs leading-5 text-text-muted">
                {copy.charactersHint}
              </p>
              <span className="text-xs tabular-nums text-text-muted">
                {copy.selectedCount(selectedIds.length)}
              </span>
            </div>
            <div className="mt-4 max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {characters.length === 0 && (
                <p className="px-3 py-4 text-sm leading-6 text-text-muted">{copy.noCharacters}</p>
              )}
              {characters.map((character) => {
                const selected = selectedSet.has(character.id);
                const disabled = !selected && selectedIds.length >= 4;
                return (
                  <label
                    key={character.id}
                    className={`flex min-h-12 items-center gap-3 px-3 py-2 text-sm transition ${
                      disabled
                        ? 'cursor-not-allowed text-text-dim opacity-50'
                        : 'cursor-pointer text-text-primary hover:bg-elevated'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={disabled}
                      onChange={() => toggleCharacter(character.id)}
                      className="h-4 w-4 shrink-0 accent-accent-gold"
                    />
                    <span className="min-w-0 flex-1 truncate">{character.title}</span>
                    {selected && <Users size={14} className="text-accent-gold" aria-hidden="true" />}
                  </label>
                );
              })}
            </div>
          </fieldset>

          {selectedProfiles.length > 0 && (
            <details className="mt-5 border-t border-border pt-4">
              <summary className="cursor-pointer text-sm font-medium text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold">
                {copy.profilesTitle}
              </summary>
              <p className="mt-1 text-xs leading-5 text-text-muted">{copy.profilesHint}</p>
              <div className="mt-3 space-y-4">
                {selectedProfiles.map((profile) => (
                  <div key={profile.characterId}>
                    <h3 className="text-sm font-semibold text-text-primary">{profile.name}</h3>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      {SIGNAL_DIMENSIONS.map((dimension) => {
                        const signal = profile.signals[dimension];
                        return (
                          <div key={dimension} className="min-w-0">
                            <dt className="text-text-dim">{copy.dimensions[dimension]}</dt>
                            <dd
                              className={signal.value ? 'truncate text-text-primary' : 'text-text-muted italic'}
                              title={signal.value ?? copy.missingSignal}
                            >
                              {signal.value ?? copy.missingSignal}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        <form
          className="p-5"
          onSubmit={(event) => {
            event.preventDefault();
            runChamber();
          }}
        >
          <div className="flex items-start gap-3">
            <Scale size={18} className="mt-0.5 shrink-0 text-accent-gold" aria-hidden="true" />
            <div>
              <h3 className="font-serif font-semibold text-text-primary">{copy.pressureTitle}</h3>
              <p className="mt-1 text-xs leading-5 text-text-muted">{copy.pressureHint}</p>
            </div>
          </div>

          <label className="mt-4 block" htmlFor={`${id}-situation`}>
            <span className="text-xs font-medium text-text-muted">{copy.labels.situation}</span>
            <textarea
              id={`${id}-situation`}
              required
              rows={3}
              value={pressure.situation}
              onChange={(event) => updatePressure('situation', event.target.value)}
              placeholder={copy.placeholders.situation}
              className="mt-1.5 w-full resize-y rounded-lg border border-border bg-elevated px-3 py-2 text-sm leading-6 text-text-primary outline-none placeholder:text-text-dim focus-visible:border-accent-gold focus-visible:ring-2 focus-visible:ring-accent-gold/30"
            />
          </label>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label htmlFor={`${id}-resource`}>
              <span className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
                <Coins size={13} aria-hidden="true" />
                {copy.labels.scarceResource}
              </span>
              <input
                id={`${id}-resource`}
                value={pressure.scarceResource}
                onChange={(event) => updatePressure('scarceResource', event.target.value)}
                placeholder={copy.placeholders.scarceResource}
                className="mt-1.5 min-h-10 w-full rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-dim focus-visible:border-accent-gold focus-visible:ring-2 focus-visible:ring-accent-gold/30"
              />
            </label>
            <label htmlFor={`${id}-time`}>
              <span className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
                <Clock3 size={13} aria-hidden="true" />
                {copy.labels.timeLimit}
              </span>
              <input
                id={`${id}-time`}
                value={pressure.timeLimit}
                onChange={(event) => updatePressure('timeLimit', event.target.value)}
                placeholder={copy.placeholders.timeLimit}
                className="mt-1.5 min-h-10 w-full rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-dim focus-visible:border-accent-gold focus-visible:ring-2 focus-visible:ring-accent-gold/30"
              />
            </label>
            <label htmlFor={`${id}-secret`}>
              <span className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
                <LockKeyhole size={13} aria-hidden="true" />
                {copy.labels.secret}
              </span>
              <input
                id={`${id}-secret`}
                value={pressure.secret}
                onChange={(event) => updatePressure('secret', event.target.value)}
                placeholder={copy.placeholders.secret}
                className="mt-1.5 min-h-10 w-full rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-dim focus-visible:border-accent-gold focus-visible:ring-2 focus-visible:ring-accent-gold/30"
              />
            </label>
            <label htmlFor={`${id}-cost`}>
              <span className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
                <Scale size={13} aria-hidden="true" />
                {copy.labels.cost}
              </span>
              <input
                id={`${id}-cost`}
                value={pressure.cost}
                onChange={(event) => updatePressure('cost', event.target.value)}
                placeholder={copy.placeholders.cost}
                className="mt-1.5 min-h-10 w-full rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-dim focus-visible:border-accent-gold focus-visible:ring-2 focus-visible:ring-accent-gold/30"
              />
            </label>
          </div>

          {validationMessage && (
            <p className="mt-4 text-sm text-red-300" role="alert">{validationMessage}</p>
          )}

          <button
            type="submit"
            disabled={!canRun}
            aria-describedby={`${id}-characters-hint`}
            className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent-gold px-4 py-2.5 text-sm font-semibold text-background transition hover:bg-accent-amber focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Gauge size={16} aria-hidden="true" />
            {session ? copy.rerun : copy.run}
          </button>
        </form>
      </div>

      {session && (
        <section aria-labelledby={`${id}-results-title`} className="border-t border-border">
          <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 id={`${id}-results-title`} className="font-serif text-lg font-semibold text-text-primary">
                {copy.resultsTitle}
              </h3>
              <p className="mt-1 max-w-[70ch] text-xs leading-5 text-text-muted">{copy.resultsHint}</p>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-text-muted">
              {copy.resultCount(filteredInsights.length)}
            </span>
          </div>

          <div
            className="flex gap-1 overflow-x-auto border-y border-border px-5 py-2"
            role="group"
            aria-label={copy.resultsTitle}
          >
            {(['all', 'question', 'friction', 'alliance', 'decision'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={activeKind === kind}
                onClick={() => setActiveKind(kind)}
                className={`min-h-10 shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold ${
                  activeKind === kind
                    ? 'bg-elevated text-accent-gold'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {copy.categories[kind]}
              </button>
            ))}
          </div>

          <div>
            {filteredInsights.map((insight) => (
              <PressureResult
                key={insight.id}
                insight={insight}
                copy={copy}
                promotionTargets={promotionTargets}
                promotionBusy={promotionState !== null}
                busyTarget={promotionState?.resultId === insight.id ? promotionState.target : null}
                onPromote={(target) => void promote(insight, target)}
              />
            ))}
          </div>

          {promotionMessage && (
            <p
              className={`border-t border-border px-5 py-3 text-sm ${
                promotionMessage.kind === 'error' ? 'text-red-300' : 'text-green-300'
              }`}
              role={promotionMessage.kind === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              {promotionMessage.message}
            </p>
          )}
        </section>
      )}
    </section>
  );
}
