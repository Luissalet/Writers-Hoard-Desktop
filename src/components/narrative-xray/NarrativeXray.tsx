import * as React from 'react';
import {
  Activity,
  ArrowUpRight,
  BookOpenText,
  Gauge,
  MessageSquareText,
  Route,
  ScanText,
  Tags,
} from 'lucide-react';
import type {
  NarrativeEnergyUnit,
  NarrativeEvidence,
  NarrativeRhythmUnit,
  NarrativeXrayModel,
} from '@/services/narrativeXray';
import { narrativeXrayCopy, type NarrativeXrayCopy, type NarrativeXrayView } from './copy';

export interface NarrativeXrayProps {
  model: NarrativeXrayModel;
  locale?: string;
  copy?: NarrativeXrayCopy;
  initialView?: NarrativeXrayView;
  onOpenEvidence: (evidence: NarrativeEvidence) => void;
  className?: string;
}

const VIEW_ICONS = {
  voice: MessageSquareText,
  rhythm: Activity,
  energy: Gauge,
  threads: Route,
} satisfies Record<NarrativeXrayView, typeof Activity>;

const VIEW_ORDER: readonly NarrativeXrayView[] = ['voice', 'rhythm', 'energy', 'threads'];

function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
      <p className="font-serif text-sm font-semibold text-text-primary">{title}</p>
      {body && <p className="mx-auto mt-2 max-w-[65ch] text-sm leading-relaxed text-text-muted">{body}</p>}
    </div>
  );
}

function EvidenceButton({
  evidence,
  copy,
  onOpen,
  compact = false,
}: {
  evidence: NarrativeEvidence;
  copy: NarrativeXrayCopy;
  onOpen: (evidence: NarrativeEvidence) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(evidence)}
      aria-label={copy.common.openEvidence(evidence.title)}
      className={`group inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg text-left text-sm text-text-muted outline-none transition hover:bg-elevated hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent-gold focus-visible:ring-offset-2 focus-visible:ring-offset-deep ${compact ? 'px-2' : 'px-3 py-2'}`}
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{evidence.title}</span>
        {!compact && evidence.excerpt && (
          <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-text-dim">{evidence.excerpt}</span>
        )}
      </span>
      <ArrowUpRight aria-hidden="true" size={14} className="shrink-0 text-text-dim transition group-hover:text-accent-gold" />
    </button>
  );
}

function SectionHeading({ id, icon: Icon, title, description }: {
  id?: string;
  icon: typeof Activity;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <Icon aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-accent-gold" />
      <div>
        <h3 id={id} className="font-serif text-lg font-semibold text-text-primary">{title}</h3>
        <p className="mt-1 max-w-[72ch] text-sm leading-relaxed text-text-muted">{description}</p>
      </div>
    </div>
  );
}

function NumberCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-[6rem]">
      <dt className="text-xs leading-tight text-text-dim">{label}</dt>
      <dd className="mt-1 font-mono text-sm tabular-nums text-text-primary">{value}</dd>
    </div>
  );
}

function RecurringTerms({
  terms,
  copy,
  onOpen,
}: {
  terms: Array<{ term: string; count: number; evidence: NarrativeEvidence[] }>;
  copy: NarrativeXrayCopy;
  onOpen: (evidence: NarrativeEvidence) => void;
}) {
  if (terms.length === 0) return <p className="text-xs text-text-dim">{copy.voice.noRecurringTerms}</p>;
  return (
    <ul aria-label={copy.voice.recurringTerms} className="flex flex-wrap gap-2">
      {terms.map((term) => (
        <li key={term.term}>
          <button
            type="button"
            onClick={() => onOpen(term.evidence[0])}
            aria-label={copy.common.openEvidence(`${term.term}, ${copy.common.occurrences(term.count)}`)}
            className="inline-flex min-h-10 items-center gap-2 rounded-full bg-elevated px-3 text-sm text-text-muted outline-none transition hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent-gold"
          >
            <span>{term.term}</span>
            <span className="font-mono text-xs tabular-nums text-accent-gold">{term.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function VoiceView({ model, copy, onOpen }: {
  model: NarrativeXrayModel;
  copy: NarrativeXrayCopy;
  onOpen: (evidence: NarrativeEvidence) => void;
}) {
  return (
    <div className="space-y-10">
      <section aria-labelledby="xray-prose-title">
        <SectionHeading id="xray-prose-title" icon={BookOpenText} title={copy.voice.proseTitle} description={copy.voice.proseDescription} />
        {model.voice.prose.length === 0 ? <EmptyState title={copy.voice.emptyProse} /> : (
          <ol className="divide-y divide-border/80 border-y border-border/80">
            {model.voice.prose.map((profile) => (
              <li key={profile.writingId} className="grid gap-4 py-5 lg:grid-cols-[minmax(12rem,0.75fr)_minmax(0,1.8fr)]">
                <div className="min-w-0">
                  <EvidenceButton evidence={profile.evidence[0]} copy={copy} onOpen={onOpen} />
                </div>
                <div className="space-y-4">
                  <dl className="flex flex-wrap gap-x-6 gap-y-3">
                    <NumberCell label={copy.common.words} value={profile.measure.words} />
                    <NumberCell label={copy.common.averageSentence} value={profile.measure.averageSentenceWords} />
                    <NumberCell label={copy.common.medianSentence} value={profile.measure.medianSentenceWords} />
                    <NumberCell label={copy.common.averageParagraph} value={profile.measure.averageParagraphWords} />
                  </dl>
                  <div>
                    <p className="mb-2 text-xs text-text-dim">{copy.voice.markersPerThousand}</p>
                    <dl className="flex flex-wrap gap-x-6 gap-y-3">
                      <NumberCell label={copy.voice.firstPerson} value={profile.referenceMarkers.firstPerson} />
                      <NumberCell label={copy.voice.secondPerson} value={profile.referenceMarkers.secondPerson} />
                      <NumberCell label={copy.voice.thirdPerson} value={profile.referenceMarkers.thirdPerson} />
                    </dl>
                  </div>
                  <div>
                    <p className="mb-2 text-xs text-text-dim">{copy.voice.recurringTerms}</p>
                    <RecurringTerms terms={profile.recurringTerms} copy={copy} onOpen={onOpen} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="xray-character-voice-title">
        <SectionHeading id="xray-character-voice-title" icon={MessageSquareText} title={copy.voice.charactersTitle} description={copy.voice.charactersDescription} />
        {model.voice.characters.length === 0 ? <EmptyState title={copy.voice.emptyCharacters} /> : (
          <ul className="divide-y divide-border/80 border-y border-border/80">
            {model.voice.characters.map((profile) => (
              <li key={profile.characterKey} className="grid gap-4 py-5 lg:grid-cols-[minmax(12rem,0.75fr)_minmax(0,1.8fr)]">
                <div>
                  <h4 className="font-serif text-base font-semibold text-text-primary">{profile.characterName}</h4>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {profile.evidence.slice(0, 3).map((evidence) => (
                      <EvidenceButton key={evidence.id} evidence={evidence} copy={copy} onOpen={onOpen} compact />
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  <dl className="flex flex-wrap gap-x-6 gap-y-3">
                    <NumberCell label={copy.common.lines} value={profile.lineCount} />
                    <NumberCell label={copy.common.words} value={profile.words} />
                    <NumberCell label={copy.common.medianSentence} value={profile.medianLineWords} />
                    <NumberCell label={copy.common.questions} value={profile.questions} />
                    <NumberCell label={copy.common.exclamations} value={profile.exclamations} />
                  </dl>
                  <RecurringTerms terms={profile.recurringTerms} copy={copy} onOpen={onOpen} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RhythmMeasure({ unit, copy }: { unit: NarrativeRhythmUnit; copy: NarrativeXrayCopy }) {
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-3">
      <NumberCell label={copy.common.words} value={unit.measure.words} />
      <NumberCell label={copy.common.sentences} value={unit.measure.sentences} />
      <NumberCell label={copy.common.paragraphs} value={unit.measure.paragraphs} />
      <NumberCell label={copy.common.averageSentence} value={unit.measure.averageSentenceWords} />
    </dl>
  );
}

function RhythmView({ model, copy, onOpen }: {
  model: NarrativeXrayModel;
  copy: NarrativeXrayCopy;
  onOpen: (evidence: NarrativeEvidence) => void;
}) {
  const sources: NarrativeRhythmUnit['source'][] = ['writing', 'scene', 'outline-beat'];
  const maxWords = Math.max(1, ...model.rhythm.narrative.map((unit) => unit.measure.words));
  return (
    <div className="space-y-10">
      <section aria-labelledby="xray-reading-rhythm-title">
        <SectionHeading id="xray-reading-rhythm-title" icon={ScanText} title={copy.rhythm.readingTitle} description={copy.rhythm.readingDescription} />
        {model.rhythm.narrative.length === 0 ? <EmptyState title={copy.rhythm.emptyNarrative} /> : (
          <div className="space-y-8">
            {sources.map((source) => {
              const units = model.rhythm.narrative.filter((unit) => unit.source === source);
              if (units.length === 0) return null;
              return (
                <section key={source} aria-label={copy.sourceLabels[source]}>
                  <h4 className="mb-3 text-sm font-semibold text-text-primary">{copy.sourceLabels[source]}</h4>
                  <ol className="divide-y divide-border/80 border-y border-border/80">
                    {units.map((unit) => (
                      <li key={unit.id} className="grid gap-4 py-4 lg:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1.5fr)]">
                        <EvidenceButton evidence={unit.evidence} copy={copy} onOpen={onOpen} />
                        <div>
                          <div aria-hidden="true" className="mb-4 h-1.5 overflow-hidden rounded-full bg-elevated">
                            <span className="block h-full rounded-full bg-accent-gold" style={{ width: `${(unit.measure.words / maxWords) * 100}%` }} />
                          </div>
                          <RhythmMeasure unit={unit} copy={copy} />
                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-dim">
                            {unit.plannedWords !== undefined && <span>{copy.rhythm.plannedWords(unit.plannedWords)}</span>}
                            {unit.explicitDialogBlocks !== undefined && <span>{copy.rhythm.dialogBlocks(unit.explicitDialogBlocks)}</span>}
                            {unit.explicitActionBlocks !== undefined && <span>{copy.rhythm.actionBlocks(unit.explicitActionBlocks)}</span>}
                            {unit.annotationCount > 0 && <span>{copy.rhythm.annotations(unit.annotationCount)}</span>}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="xray-creation-rhythm-title">
        <SectionHeading id="xray-creation-rhythm-title" icon={Activity} title={copy.rhythm.creationTitle} description={copy.rhythm.creationDescription} />
        {model.rhythm.creation.length === 0 ? <EmptyState title={copy.rhythm.emptyCreation} /> : (
          <ol className="divide-y divide-border/80 border-y border-border/80">
            {model.rhythm.creation.map((day) => (
              <li key={day.date} className="grid items-center gap-3 py-4 sm:grid-cols-[8rem_minmax(0,1fr)_auto]">
                <time dateTime={day.date} className="font-mono text-sm tabular-nums text-text-primary">{day.date}</time>
                <dl className="flex flex-wrap gap-x-6 gap-y-3">
                  <NumberCell label={copy.common.words} value={day.words} />
                  <NumberCell label={copy.rhythm.sessions(day.sessionCount)} value={copy.rhythm.minutes(Math.round(day.durationSeconds / 60))} />
                  <NumberCell label={copy.rhythm.sessionTypes} value={day.sessionTypes.join(' · ')} />
                </dl>
                <div className="flex flex-wrap justify-end gap-1">
                  {day.evidence.map((evidence) => (
                    <EvidenceButton key={evidence.id} evidence={evidence} copy={copy} onOpen={onOpen} compact />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function EnergyBar({ label, value, max, format }: { label: string; value: number; max: number; format: (value: number) => string }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,0.7fr)_minmax(7rem,1fr)_4.5rem] items-center gap-3">
      <span className="text-xs text-text-muted">{label}</span>
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-elevated">
        <span className="block h-full rounded-full bg-accent-plum-light" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
      </div>
      <span className="text-right font-mono text-xs tabular-nums text-text-primary">{format(value)}</span>
    </div>
  );
}

function EnergyUnitRows({ unit, maxima, copy }: {
  unit: NarrativeEnergyUnit;
  maxima: { short: number; questions: number; exclamations: number };
  copy: NarrativeXrayCopy;
}) {
  const rows = [
    { label: copy.energy.shortSentences, value: unit.shortSentencesPer100Words, max: maxima.short, format: copy.common.perHundredWords },
    { label: copy.energy.questions, value: unit.questionsPer100Words, max: maxima.questions, format: copy.common.perHundredWords },
    { label: copy.energy.exclamations, value: unit.exclamationsPer100Words, max: maxima.exclamations, format: copy.common.perHundredWords },
  ];
  return (
    <div className="space-y-2">
      {rows.map((row) => <EnergyBar key={row.label} {...row} />)}
      {unit.explicitDialogShare !== undefined && (
        <EnergyBar label={copy.energy.dialogShare} value={unit.explicitDialogShare} max={100} format={copy.common.percent} />
      )}
      {unit.explicitActionShare !== undefined && (
        <EnergyBar label={copy.energy.actionShare} value={unit.explicitActionShare} max={100} format={copy.common.percent} />
      )}
    </div>
  );
}

function EnergyView({ model, copy, onOpen }: {
  model: NarrativeXrayModel;
  copy: NarrativeXrayCopy;
  onOpen: (evidence: NarrativeEvidence) => void;
}) {
  const units = model.energy.filter((unit) => unit.words > 0);
  const maxima = {
    short: Math.max(0, ...units.map((unit) => unit.shortSentencesPer100Words)),
    questions: Math.max(0, ...units.map((unit) => unit.questionsPer100Words)),
    exclamations: Math.max(0, ...units.map((unit) => unit.exclamationsPer100Words)),
  };
  return (
    <section aria-labelledby="xray-energy-title">
      <SectionHeading id="xray-energy-title" icon={Gauge} title={copy.energy.title} description={copy.energy.description} />
      {units.length === 0 ? <EmptyState title={copy.energy.empty} /> : (
        <>
          <p className="mb-3 text-xs text-text-dim">{copy.energy.markerScale}</p>
          <ol className="divide-y divide-border/80 border-y border-border/80">
            {units.map((unit) => (
              <li key={unit.id} className="grid gap-4 py-5 lg:grid-cols-[minmax(12rem,0.65fr)_minmax(18rem,1.6fr)]">
                <div>
                  <span className="mb-1 block text-xs text-text-dim">{copy.sourceLabels[unit.source]}</span>
                  <EvidenceButton evidence={unit.evidence[0]} copy={copy} onOpen={onOpen} />
                </div>
                <EnergyUnitRows unit={unit} maxima={maxima} copy={copy} />
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function ThreadsView({ model, copy, onOpen }: {
  model: NarrativeXrayModel;
  copy: NarrativeXrayCopy;
  onOpen: (evidence: NarrativeEvidence) => void;
}) {
  return (
    <section aria-labelledby="xray-threads-title">
      <SectionHeading id="xray-threads-title" icon={Tags} title={copy.threads.title} description={copy.threads.description} />
      {model.threads.length === 0 ? <EmptyState title={copy.threads.empty} body={copy.threads.emptyHint} /> : (
        <ul className="divide-y divide-border/80 border-y border-border/80">
          {model.threads.map((thread) => (
            <li key={thread.id} className="grid gap-4 py-5 lg:grid-cols-[minmax(12rem,0.65fr)_minmax(0,1.6fr)]">
              <div>
                <div className="flex items-center gap-2">
                  {thread.color && <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: thread.color }} />}
                  <h4 className="font-serif text-base font-semibold text-text-primary">{thread.label}</h4>
                </div>
                <p className="mt-1 text-xs text-text-dim">
                  {copy.threadOrigins[thread.origin]} · {copy.threads.entityCount(thread.entityKeys.length)}
                </p>
              </div>
              <div>
                <p className="mb-2 text-xs text-text-dim">{copy.threads.evidenceCount(thread.evidence.length)}</p>
                <div className="flex flex-wrap gap-1">
                  {thread.evidence.map((evidence) => (
                    <EvidenceButton key={evidence.id} evidence={evidence} copy={copy} onOpen={onOpen} compact />
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function NarrativeXray({
  model,
  locale,
  copy: injectedCopy,
  initialView = 'voice',
  onOpenEvidence,
  className = '',
}: NarrativeXrayProps) {
  const copy = injectedCopy ?? narrativeXrayCopy(locale ?? model.locale);
  const [view, setView] = React.useState<NarrativeXrayView>(initialView);
  const coverage = model.coverage;
  const selectAdjacentView = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = VIEW_ORDER.indexOf(view);
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? VIEW_ORDER.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + VIEW_ORDER.length) % VIEW_ORDER.length;
    const nextView = VIEW_ORDER[next];
    setView(nextView);
    requestAnimationFrame(() => document.getElementById(`narrative-xray-tab-${nextView}`)?.focus());
  };

  return (
    <section aria-labelledby="narrative-xray-title" className={`min-w-0 ${className}`}>
      <header className="border-b border-border pb-6">
        <div className="flex items-start gap-3">
          <ScanText aria-hidden="true" size={24} className="mt-1 shrink-0 text-accent-gold" />
          <div className="min-w-0">
            <h2 id="narrative-xray-title" className="text-balance font-serif text-2xl font-semibold text-text-primary">{copy.title}</h2>
            <p className="mt-2 max-w-[72ch] text-sm leading-relaxed text-text-muted">{copy.description}</p>
            <p className="mt-2 max-w-[72ch] text-xs leading-relaxed text-text-dim">{copy.measurementNotice}</p>
          </div>
        </div>
        <div aria-label={copy.coverage.label} className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-text-muted">
          <span>{copy.coverage.writings(coverage.writings)}</span>
          <span>{copy.coverage.scenes(coverage.scenes)}</span>
          <span>{copy.coverage.beats(coverage.outlineBeats)}</span>
          <span>{copy.coverage.annotations(coverage.annotations)}</span>
        </div>
      </header>

      <div
        role="tablist"
        aria-label={copy.navigationLabel}
        onKeyDown={selectAdjacentView}
        className="my-6 flex max-w-full gap-1 overflow-x-auto rounded-xl bg-elevated p-1"
      >
        {VIEW_ORDER.map((candidate) => {
          const Icon = VIEW_ICONS[candidate];
          const active = candidate === view;
          return (
            <button
              key={candidate}
              type="button"
              role="tab"
              id={`narrative-xray-tab-${candidate}`}
              aria-controls={`narrative-xray-panel-${candidate}`}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setView(candidate)}
              className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent-gold ${active ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
            >
              <Icon aria-hidden="true" size={16} />
              {copy.views[candidate]}
            </button>
          );
        })}
      </div>

      {VIEW_ORDER.map((candidate) => (
        <div
          key={candidate}
          id={`narrative-xray-panel-${candidate}`}
          role="tabpanel"
          aria-labelledby={`narrative-xray-tab-${candidate}`}
          hidden={view !== candidate}
          tabIndex={view === candidate ? 0 : -1}
          className="outline-none focus-visible:ring-2 focus-visible:ring-accent-gold"
        >
          {view === candidate && candidate === 'voice' && <VoiceView model={model} copy={copy} onOpen={onOpenEvidence} />}
          {view === candidate && candidate === 'rhythm' && <RhythmView model={model} copy={copy} onOpen={onOpenEvidence} />}
          {view === candidate && candidate === 'energy' && <EnergyView model={model} copy={copy} onOpen={onOpenEvidence} />}
          {view === candidate && candidate === 'threads' && <ThreadsView model={model} copy={copy} onOpen={onOpenEvidence} />}
        </div>
      ))}
    </section>
  );
}
