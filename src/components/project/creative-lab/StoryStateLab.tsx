import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDown,
  ArrowUp,
  BookOpenCheck,
  Brain,
  ExternalLink,
  MapPin,
  Plus,
  Scale,
  ScrollText,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { db } from '@/db';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import {
  createNarrativeMoment,
  createStoryClaim,
  deleteNarrativeMoment,
  deleteStoryClaim,
  reorderNarrativeMoments,
  storyStateAtMoment,
  stressWorldRule,
  type BeliefMode,
  type ContinuityFactType,
  type NarrativeAnchorKind,
  type StoryBeliefClaim,
  type StoryEntityRef,
  type StoryFactClaim,
  type StoryWorldRuleClaim,
} from '@/services/storyState';

interface StoryStateLabProps {
  projectId: string;
}

type View = 'state' | 'axis' | 'facts' | 'knowledge' | 'rules';

const inputClass = 'min-h-11 w-full rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-accent-gold';

const FACT_TYPES: ContinuityFactType[] = [
  'location', 'age', 'injury', 'possession', 'relationship', 'resource', 'biography', 'custom',
];
const BELIEF_MODES: BeliefMode[] = ['knows', 'believes', 'suspects', 'misled', 'keeps-secret'];

export default function StoryStateLab({ projectId }: StoryStateLabProps) {
  const { t, locale } = useTranslation();
  const [view, setView] = useState<View>('state');
  const [momentId, setMomentId] = useState('');
  const [anchorValue, setAnchorValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [subjectId, setSubjectId] = useState('');
  const [factType, setFactType] = useState<ContinuityFactType>('location');
  const [factValue, setFactValue] = useState('');
  const [factHypothesis, setFactHypothesis] = useState(false);
  const [beliefActorId, setBeliefActorId] = useState('');
  const [beliefMode, setBeliefMode] = useState<BeliefMode>('knows');
  const [proposition, setProposition] = useState('');
  const [ruleTitle, setRuleTitle] = useState('');
  const [ruleCondition, setRuleCondition] = useState('');
  const [ruleEffect, setRuleEffect] = useState('');
  const [ruleCost, setRuleCost] = useState('');
  const [ruleLimit, setRuleLimit] = useState('');
  const [stressRuleId, setStressRuleId] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    const [moments, claims, beats, scenes, events, entries] = await Promise.all([
      db.narrativeMoments.where('projectId').equals(projectId).sortBy('order'),
      db.storyClaims.where('projectId').equals(projectId).sortBy('createdAt'),
      db.outlineBeats.where('projectId').equals(projectId).sortBy('order'),
      db.scenes.where('projectId').equals(projectId).sortBy('createdAt'),
      db.timelineEvents.where('projectId').equals(projectId).sortBy('order'),
      db.codexEntries.where('projectId').equals(projectId).sortBy('title'),
    ]);
    return { moments, claims, beats, scenes, events, entries };
  }, [projectId]);

  const anchorOptions = useMemo(() => {
    if (!data) return [];
    return [
      ...data.beats.map((row) => ({ kind: 'beat' as const, id: row.id, title: row.title })),
      ...data.scenes.map((row) => ({ kind: 'scene' as const, id: row.id, title: row.title })),
      ...data.events.map((row) => ({ kind: 'event' as const, id: row.id, title: row.title })),
    ];
  }, [data]);

  useEffect(() => {
    if (!data?.moments.length) {
      setMomentId('');
      return;
    }
    if (!momentId || !data.moments.some((moment) => moment.id === momentId)) {
      setMomentId(data.moments[0].id);
    }
  }, [data?.moments, momentId]);
  useEffect(() => {
    if (!anchorValue && anchorOptions[0]) setAnchorValue(`${anchorOptions[0].kind}:${anchorOptions[0].id}`);
  }, [anchorOptions, anchorValue]);
  useEffect(() => {
    if (!data?.entries.length) return;
    if (!subjectId) setSubjectId(data.entries[0].id);
    if (!beliefActorId) setBeliefActorId(data.entries[0].id);
  }, [beliefActorId, data?.entries, subjectId]);

  const snapshot = useLiveQuery(
    async () => momentId ? storyStateAtMoment(projectId, momentId) : null,
    [projectId, momentId, data?.claims.length, data?.moments.length],
    null,
  );
  const currentMoment = data?.moments.find((moment) => moment.id === momentId);
  const stressedRule = data?.claims.find((claim): claim is StoryWorldRuleClaim =>
    claim.kind === 'world-rule' && claim.id === stressRuleId,
  );

  const run = async (operation: () => Promise<void>, success?: string) => {
    setBusy(true);
    try {
      await operation();
      if (success) toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const sourceAtCurrentMoment = (): StoryEntityRef | undefined => currentMoment ? {
    engineId: currentMoment.anchorEngineId,
    entityType: currentMoment.anchorKind === 'beat' ? 'outline-beat' : currentMoment.anchorKind,
    entityId: currentMoment.anchorEntityId,
    title: currentMoment.anchorTitle,
  } : undefined;

  const selectedEntry = (id: string): StoryEntityRef | null => {
    const entry = data?.entries.find((candidate) => candidate.id === id);
    return entry ? {
      engineId: 'codex', entityType: entry.type, entityId: entry.id, title: entry.title,
    } : null;
  };

  const addMoment = () => run(async () => {
    const separator = anchorValue.indexOf(':');
    const kind = anchorValue.slice(0, separator) as NarrativeAnchorKind;
    const entityId = anchorValue.slice(separator + 1);
    const moment = await createNarrativeMoment({ projectId, anchorKind: kind, anchorEntityId: entityId });
    setMomentId(moment.id);
  }, t('creativeLab.story.momentAdded'));

  const addFact = () => run(async () => {
    const subject = selectedEntry(subjectId);
    if (!subject || !momentId) throw new Error(t('creativeLab.story.error.factNeedsContext'));
    await createStoryClaim<StoryFactClaim>({
      projectId,
      kind: 'fact',
      status: factHypothesis ? 'hypothesis' : 'canonical',
      subject,
      factType,
      value: factValue,
      fromMomentId: momentId,
      source: sourceAtCurrentMoment(),
    });
    setFactValue('');
  }, t('creativeLab.story.factAdded'));

  const addBelief = () => run(async () => {
    const actor = selectedEntry(beliefActorId);
    if (!actor || !momentId) throw new Error(t('creativeLab.story.error.beliefNeedsContext'));
    await createStoryClaim<StoryBeliefClaim>({
      projectId,
      kind: 'belief',
      status: 'canonical',
      actor,
      proposition,
      mode: beliefMode,
      acquiredAtMomentId: momentId,
      confidence: 'medium',
      source: sourceAtCurrentMoment(),
    });
    setProposition('');
  }, t('creativeLab.story.beliefAdded'));

  const addRule = () => run(async () => {
    await createStoryClaim<StoryWorldRuleClaim>({
      projectId,
      kind: 'world-rule',
      status: 'canonical',
      title: ruleTitle,
      condition: ruleCondition,
      effect: ruleEffect,
      cost: ruleCost,
      limit: ruleLimit,
      exceptions: [],
      evidence: sourceAtCurrentMoment() ? [sourceAtCurrentMoment()!] : [],
      fromMomentId: momentId || undefined,
    });
    setRuleTitle('');
    setRuleCondition('');
    setRuleEffect('');
    setRuleCost('');
    setRuleLimit('');
  }, t('creativeLab.story.ruleAdded'));

  const moveMoment = (id: string, direction: -1 | 1) => run(async () => {
    if (!data) return;
    const ids = data.moments.map((moment) => moment.id);
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await reorderNarrativeMoments(projectId, ids);
  });

  const views: Array<{ id: View; icon: typeof Brain }> = [
    { id: 'state', icon: BookOpenCheck },
    { id: 'axis', icon: MapPin },
    { id: 'facts', icon: Scale },
    { id: 'knowledge', icon: Brain },
    { id: 'rules', icon: ScrollText },
  ];

  if (!data) return <p role="status" className="py-8 text-center text-sm text-text-muted">{t('common.loading')}</p>;

  return (
    <div className="space-y-5">
      <nav aria-label={t('creativeLab.story.views')} className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1">
        {views.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={view === id ? 'page' : undefined}
            onClick={() => setView(id)}
            className={`flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold ${view === id ? 'bg-elevated text-accent-gold' : 'text-text-muted hover:text-text-primary'}`}
          >
            <Icon size={15} aria-hidden="true" /> {t(`creativeLab.story.view.${id}`)}
          </button>
        ))}
      </nav>

      {view !== 'axis' && (
        <label className="block max-w-xl text-xs text-text-muted">
          {t('creativeLab.story.atMoment')}
          <select className={`${inputClass} mt-1`} value={momentId} onChange={(event) => setMomentId(event.target.value)}>
            <option value="">{t('creativeLab.story.noMoment')}</option>
            {data.moments.map((moment) => <option key={moment.id} value={moment.id}>{moment.label}</option>)}
          </select>
        </label>
      )}

      {view === 'axis' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-1 font-serif font-semibold text-text-primary">{t('creativeLab.story.axisTitle')}</h3>
            <p className="mb-4 text-sm text-text-muted">{t('creativeLab.story.axisHint')}</p>
            <ol className="space-y-2">
              {data.moments.map((moment, index) => (
                <li key={moment.id} className="flex items-center gap-3 rounded-lg border border-border bg-elevated/30 p-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-deep text-xs text-text-muted">{index + 1}</span>
                  <button type="button" onClick={() => getAnchorAdapter(moment.anchorEngineId)?.navigateToEntity(moment.anchorEntityId, projectId)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium text-text-primary">{moment.label}</span>
                    <span className="block text-xs text-text-muted">{t(`creativeLab.story.anchor.${moment.anchorKind}`)}</span>
                  </button>
                  <button type="button" disabled={index === 0 || busy} onClick={() => void moveMoment(moment.id, -1)} aria-label={t('creativeLab.story.moveEarlier')} className="grid size-10 place-items-center rounded-lg text-text-muted disabled:opacity-30"><ArrowUp size={15} aria-hidden="true" /></button>
                  <button type="button" disabled={index === data.moments.length - 1 || busy} onClick={() => void moveMoment(moment.id, 1)} aria-label={t('creativeLab.story.moveLater')} className="grid size-10 place-items-center rounded-lg text-text-muted disabled:opacity-30"><ArrowDown size={15} aria-hidden="true" /></button>
                  <button type="button" disabled={busy} onClick={() => void run(() => deleteNarrativeMoment(moment.id))} aria-label={t('creativeLab.story.deleteMoment')} className="grid size-10 place-items-center rounded-lg text-text-muted hover:text-danger"><Trash2 size={15} aria-hidden="true" /></button>
                </li>
              ))}
              {data.moments.length === 0 && <li className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-muted">{t('creativeLab.story.axisEmpty')}</li>}
            </ol>
          </section>
          <section className="h-fit rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-primary">{t('creativeLab.story.addMoment')}</h3>
            {anchorOptions.length ? (
              <div className="space-y-3">
                <select aria-label={t('creativeLab.story.anchorLabel')} className={inputClass} value={anchorValue} onChange={(event) => setAnchorValue(event.target.value)}>
                  {anchorOptions.map((option) => <option key={`${option.kind}:${option.id}`} value={`${option.kind}:${option.id}`}>{t(`creativeLab.story.anchor.${option.kind}`)} · {option.title}</option>)}
                </select>
                <button type="button" disabled={busy || !anchorValue} onClick={addMoment} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent-gold px-3 text-sm font-semibold text-deep disabled:opacity-50"><Plus size={15} aria-hidden="true" /> {t('creativeLab.story.add')}</button>
              </div>
            ) : <p className="text-sm text-text-muted">{t('creativeLab.story.noAnchors')}</p>}
          </section>
        </div>
      )}

      {view === 'state' && (
        !snapshot ? <EmptyState text={t('creativeLab.story.stateNeedsMoment')} /> : (
          <div className="space-y-4">
            {snapshot.incomplete && <div role="status" className="rounded-lg border border-accent-amber/40 bg-accent-amber/10 p-3 text-sm text-accent-amber">{t('creativeLab.story.incomplete')}</div>}
            {snapshot.contradictions.map((contradiction) => (
              <div key={contradiction.id} role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-4">
                <div className="flex items-center gap-2 text-danger"><TriangleAlert size={17} aria-hidden="true" /><strong>{t('creativeLab.story.contradiction')}</strong></div>
                <p className="mt-2 text-sm text-text-primary">{contradiction.subject.title} · {t(`creativeLab.story.factType.${contradiction.factType}`)}</p>
                <p className="mt-1 text-sm text-text-muted">{contradiction.values.join(' ↔ ')}</p>
              </div>
            ))}
            <div className="grid gap-4 lg:grid-cols-3">
              <StateColumn title={t('creativeLab.story.facts')} empty={t('creativeLab.story.missing')}>
                {snapshot.facts.map((claim) => <ClaimRow key={claim.id} title={claim.subject.title} detail={`${t(`creativeLab.story.factType.${claim.factType}`)} · ${claim.value}`} hypothesis={claim.status === 'hypothesis'} onDelete={() => void run(() => deleteStoryClaim(claim.id))} />)}
              </StateColumn>
              <StateColumn title={t('creativeLab.story.knowledge')} empty={t('creativeLab.story.missing')}>
                {snapshot.beliefs.map((claim) => <ClaimRow key={claim.id} title={`${claim.actor.title} · ${t(`creativeLab.story.beliefMode.${claim.mode}`)}`} detail={claim.proposition} hypothesis={claim.status === 'hypothesis'} onDelete={() => void run(() => deleteStoryClaim(claim.id))} />)}
              </StateColumn>
              <StateColumn title={t('creativeLab.story.rules')} empty={t('creativeLab.story.missing')}>
                {snapshot.rules.map((claim) => <ClaimRow key={claim.id} title={claim.title} detail={claim.effect} hypothesis={claim.status === 'hypothesis'} onOpen={() => { setStressRuleId(claim.id); setView('rules'); }} onDelete={() => void run(() => deleteStoryClaim(claim.id))} />)}
              </StateColumn>
            </div>
          </div>
        )
      )}

      {view === 'facts' && (
        <EditorCard title={t('creativeLab.story.addFact')} hint={t('creativeLab.story.factHint')}>
          <div className="grid gap-3 md:grid-cols-2">
            <select aria-label={t('creativeLab.story.subject')} className={inputClass} value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>{data.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select>
            <select aria-label={t('creativeLab.story.factTypeLabel')} className={inputClass} value={factType} onChange={(event) => setFactType(event.target.value as ContinuityFactType)}>{FACT_TYPES.map((kind) => <option key={kind} value={kind}>{t(`creativeLab.story.factType.${kind}`)}</option>)}</select>
            <input aria-label={t('creativeLab.story.value')} className={`${inputClass} md:col-span-2`} value={factValue} onChange={(event) => setFactValue(event.target.value)} placeholder={t('creativeLab.story.factPlaceholder')} />
            <label className="flex min-h-11 items-center gap-2 text-sm text-text-muted"><input type="checkbox" checked={factHypothesis} onChange={(event) => setFactHypothesis(event.target.checked)} /> {t('creativeLab.story.asHypothesis')}</label>
            <button type="button" disabled={busy || !momentId || !subjectId || !factValue.trim()} onClick={addFact} className="min-h-11 rounded-lg bg-accent-gold px-4 text-sm font-semibold text-deep disabled:opacity-50">{t('creativeLab.story.add')}</button>
          </div>
        </EditorCard>
      )}

      {view === 'knowledge' && (
        <EditorCard title={t('creativeLab.story.addBelief')} hint={t('creativeLab.story.beliefHint')}>
          <div className="grid gap-3 md:grid-cols-2">
            <select aria-label={t('creativeLab.story.actor')} className={inputClass} value={beliefActorId} onChange={(event) => setBeliefActorId(event.target.value)}>{data.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select>
            <select aria-label={t('creativeLab.story.beliefModeLabel')} className={inputClass} value={beliefMode} onChange={(event) => setBeliefMode(event.target.value as BeliefMode)}>{BELIEF_MODES.map((mode) => <option key={mode} value={mode}>{t(`creativeLab.story.beliefMode.${mode}`)}</option>)}</select>
            <textarea aria-label={t('creativeLab.story.proposition')} className={`${inputClass} min-h-28 resize-y md:col-span-2`} value={proposition} onChange={(event) => setProposition(event.target.value)} placeholder={t('creativeLab.story.propositionPlaceholder')} />
            <button type="button" disabled={busy || !momentId || !beliefActorId || !proposition.trim()} onClick={addBelief} className="min-h-11 rounded-lg bg-accent-gold px-4 text-sm font-semibold text-deep disabled:opacity-50 md:col-start-2">{t('creativeLab.story.add')}</button>
          </div>
        </EditorCard>
      )}

      {view === 'rules' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
          <EditorCard title={t('creativeLab.story.addRule')} hint={t('creativeLab.story.ruleHint')}>
            <div className="space-y-3">
              <input aria-label={t('creativeLab.story.ruleTitle')} className={inputClass} value={ruleTitle} onChange={(event) => setRuleTitle(event.target.value)} placeholder={t('creativeLab.story.ruleTitle')} />
              <textarea aria-label={t('creativeLab.story.condition')} className={`${inputClass} min-h-20 resize-y`} value={ruleCondition} onChange={(event) => setRuleCondition(event.target.value)} placeholder={t('creativeLab.story.condition')} />
              <textarea aria-label={t('creativeLab.story.effect')} className={`${inputClass} min-h-20 resize-y`} value={ruleEffect} onChange={(event) => setRuleEffect(event.target.value)} placeholder={t('creativeLab.story.effect')} />
              <div className="grid gap-3 md:grid-cols-2">
                <input aria-label={t('creativeLab.story.cost')} className={inputClass} value={ruleCost} onChange={(event) => setRuleCost(event.target.value)} placeholder={t('creativeLab.story.cost')} />
                <input aria-label={t('creativeLab.story.limit')} className={inputClass} value={ruleLimit} onChange={(event) => setRuleLimit(event.target.value)} placeholder={t('creativeLab.story.limit')} />
              </div>
              <button type="button" disabled={busy || !ruleTitle.trim() || !ruleEffect.trim()} onClick={addRule} className="min-h-11 rounded-lg bg-accent-gold px-4 text-sm font-semibold text-deep disabled:opacity-50">{t('creativeLab.story.add')}</button>
            </div>
          </EditorCard>
          <section className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold text-text-primary">{t('creativeLab.story.stressTitle')}</h3>
            <div className="mb-4 flex flex-wrap gap-2">
              {data.claims.filter((claim): claim is StoryWorldRuleClaim => claim.kind === 'world-rule').map((rule) => <button key={rule.id} type="button" onClick={() => setStressRuleId(rule.id)} className={`min-h-10 rounded-lg border px-3 text-sm ${stressRuleId === rule.id ? 'border-accent-gold text-accent-gold' : 'border-border text-text-muted'}`}>{rule.title}</button>)}
            </div>
            {stressedRule ? (
              <ul className="space-y-2">
                {stressWorldRule(stressedRule, locale).map((question) => <li key={question.id} className="rounded-lg border border-border bg-elevated/30 p-3 text-sm text-text-primary">{question.question}</li>)}
              </ul>
            ) : <p className="text-sm text-text-muted">{t('creativeLab.story.stressEmpty')}</p>}
          </section>
        </div>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-border bg-surface p-8 text-center text-sm text-text-muted">{text}</p>;
}

function EditorCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return <section className="mx-auto max-w-3xl rounded-xl border border-border bg-surface p-5"><h3 className="font-serif font-semibold text-text-primary">{title}</h3><p className="mb-4 mt-1 text-sm text-text-muted">{hint}</p>{children}</section>;
}

function StateColumn({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return <section className="rounded-xl border border-border bg-surface p-4"><h3 className="mb-3 text-sm font-semibold text-text-primary">{title}</h3><div className="space-y-2">{items.length && items.some(Boolean) ? children : <p className="text-sm text-text-dim">{empty}</p>}</div></section>;
}

function ClaimRow({ title, detail, hypothesis, onOpen, onDelete }: { title: string; detail: string; hypothesis: boolean; onOpen?: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  return <div className="rounded-lg border border-border bg-elevated/30 p-3"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="text-sm font-medium text-text-primary">{title}</p><p className="mt-1 text-xs leading-relaxed text-text-muted">{detail}</p>{hypothesis && <span className="mt-2 inline-block rounded-full bg-accent-amber/10 px-2 py-0.5 text-[11px] text-accent-amber">?</span>}</div>{onOpen && <button type="button" onClick={onOpen} aria-label={t('creativeLab.story.showStress')} title={t('creativeLab.story.showStress')} className="grid size-10 place-items-center rounded-lg text-text-muted hover:text-accent-gold"><ExternalLink size={14} aria-hidden="true" /></button>}<button type="button" onClick={onDelete} aria-label={`${t('creativeLab.story.deleteClaim')}: ${title}`} title={t('creativeLab.story.deleteClaim')} className="grid size-10 place-items-center rounded-lg text-text-muted hover:text-danger"><Trash2 size={14} aria-hidden="true" /></button></div></div>;
}
