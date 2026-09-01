import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Search, Undo2 } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { toast } from '@/components/common/toast';
import { ConfirmDialog } from '@/engines/_shared';
import { useTranslation } from '@/i18n/useTranslation';
import {
  REPLACE_SCOPES,
  applyProjectReplace,
  countSelectedInDocument,
  countSelectedReplacements,
  forgetReplaceUndo,
  replaceScopeLabelKey,
  scanProjectReplace,
  undoProjectReplace,
  type MatchOptions,
  type ReplaceDocument,
  type ReplaceOccurrence,
  type ReplaceOutcome,
  type ReplacePlan,
  type ReplaceScopeId,
  type ReplaceSelection,
} from '@/services/projectReplace';

/**
 * Project-wide find and replace.
 *
 * The shape of the screen is the safety argument: SEARCH, then REVIEW, then
 * one button that writes. Nothing here touches Dexie until that button is
 * pressed and confirmed, and the button says exactly how much it is about to
 * change. Everything the engine cannot rewrite safely (a match with a
 * formatting boundary through the middle of it) is shown rather than hidden,
 * because a rename that quietly missed three occurrences is worse than one
 * that says where they are.
 */

interface ProjectReplaceModalProps {
  open: boolean;
  projectId: string;
  onClose: () => void;
}

/** Documents beyond this many start collapsed; a rename can hit hundreds. */
const AUTO_EXPAND_LIMIT = 10;

const fieldClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-gold';
const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary transition hover:border-accent-gold hover:text-accent-gold disabled:opacity-50';
const primaryClass =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-accent-gold px-3 py-2 text-sm font-medium text-background transition hover:brightness-110 disabled:opacity-50';

function Toggle({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`h-7 min-w-[28px] rounded px-1.5 text-[11px] font-semibold leading-none transition ${
        active
          ? 'bg-accent-gold/20 text-accent-gold'
          : 'text-text-dim hover:bg-elevated hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  );
}

/** A checkbox that can also say "some of what is under me". */
function TriStateBox({
  checked,
  partial,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  partial?: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      title={label}
      ref={(element) => {
        if (element) element.indeterminate = Boolean(partial) && !disabled;
      }}
      onChange={onChange}
      className="mt-0.5 flex-shrink-0 accent-accent-gold"
    />
  );
}

export default function ProjectReplaceModal({ open, projectId, onClose }: ProjectReplaceModalProps) {
  const { t } = useTranslation();

  const [term, setTerm] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matchDiacritics, setMatchDiacritics] = useState(false);
  const [scopes, setScopes] = useState<ReplaceScopeId[]>(['writings']);

  const [plan, setPlan] = useState<ReplacePlan | null>(null);
  const [excludedDocuments, setExcludedDocuments] = useState<ReadonlySet<string>>(new Set());
  const [excludedOccurrences, setExcludedOccurrences] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const [busy, setBusy] = useState<'search' | 'apply' | 'undo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ReplaceOutcome | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // A fresh window is a fresh search: carrying a stale plan across an open
  // would let the writer press Replace on a preview built for another session.
  useEffect(() => {
    if (!open) return;
    setTerm('');
    setReplacement('');
    setCaseSensitive(false);
    setWholeWord(false);
    setMatchDiacritics(false);
    setScopes(['writings']);
    setPlan(null);
    setExcludedDocuments(new Set());
    setExcludedOccurrences(new Set());
    setExpanded(new Set());
    setBusy(null);
    setError(null);
    setOutcome(null);
    setConfirming(false);
  }, [open]);

  // The one-click undo has a deadline. When it passes, the button goes rather
  // than staying to fail.
  useEffect(() => {
    if (!outcome?.undoAvailable) {
      setUndoOpen(false);
      return;
    }
    const remaining = outcome.undoExpiresAt - Date.now();
    if (remaining <= 0) {
      setUndoOpen(false);
      return;
    }
    setUndoOpen(true);
    const timer = window.setTimeout(() => setUndoOpen(false), remaining);
    return () => window.clearTimeout(timer);
  }, [outcome]);

  const options = useMemo<MatchOptions>(
    () => ({ caseSensitive, wholeWord, matchDiacritics }),
    [caseSensitive, wholeWord, matchDiacritics],
  );
  const activeScopes = useMemo(
    () => REPLACE_SCOPES.filter((scope) => scopes.includes(scope)),
    [scopes],
  );
  const selection = useMemo<ReplaceSelection>(
    () => ({ excludedDocuments, excludedOccurrences }),
    [excludedDocuments, excludedOccurrences],
  );

  // The preview belongs to the query that produced it. Change the query and it
  // is a description of a search nobody ran.
  const stale =
    plan !== null &&
    (plan.term !== term ||
      plan.options.caseSensitive !== caseSensitive ||
      plan.options.wholeWord !== wholeWord ||
      plan.options.matchDiacritics !== matchDiacritics ||
      plan.scopes.join(',') !== activeScopes.join(','));

  const selected = useMemo(
    () => (plan ? countSelectedReplacements(plan, selection) : { occurrences: 0, documents: 0 }),
    [plan, selection],
  );

  const occurrenceCount = (count: number) =>
    (count === 1
      ? t('projectReplace.count.occurrence')
      : t('projectReplace.count.occurrences')
    ).replace('{count}', String(count));

  const documentCount = (count: number) =>
    (count === 1
      ? t('projectReplace.count.document')
      : t('projectReplace.count.documents')
    ).replace('{count}', String(count));

  const toggleScope = (scope: ReplaceScopeId) => {
    setScopes((current) =>
      current.includes(scope) ? current.filter((id) => id !== scope) : [...current, scope],
    );
  };

  const runSearch = async () => {
    if (!term.trim() || activeScopes.length === 0) return;
    setBusy('search');
    setError(null);
    setOutcome(null);
    try {
      const next = await scanProjectReplace({ projectId, term, options, scopes: activeScopes });
      setPlan(next);
      // Everything starts selected — the writer is here to replace, and
      // unchecking the two exceptions is less work than checking the other 39.
      setExcludedDocuments(new Set());
      setExcludedOccurrences(new Set());
      setExpanded(
        new Set(
          next.documents.length <= AUTO_EXPAND_LIMIT
            ? next.documents.map((group) => group.key)
            : [],
        ),
      );
    } catch (reason) {
      console.error('Project replace search failed', reason);
      setError(t('projectReplace.searchError'));
    } finally {
      setBusy(null);
    }
  };

  const runReplace = async () => {
    if (!plan) return;
    setConfirming(false);
    setBusy('apply');
    setError(null);
    try {
      const result = await applyProjectReplace(plan, replacement, selection);
      setOutcome(result);
      setPlan(null);
    } catch (reason) {
      console.error('Project replace failed', reason);
      setError(t('projectReplace.applyError'));
    } finally {
      setBusy(null);
    }
  };

  const runUndo = async () => {
    if (!outcome) return;
    setBusy('undo');
    setError(null);
    try {
      const restored = await undoProjectReplace(outcome.batchId);
      if (restored === 0) {
        setError(t('projectReplace.undoExpired'));
        setUndoOpen(false);
        return;
      }
      setOutcome(null);
      setUndoOpen(false);
      toast.success(t('projectReplace.undone'));
    } catch (reason) {
      console.error('Project replace undo failed', reason);
      setError(t('projectReplace.undoError'));
    } finally {
      setBusy(null);
    }
  };

  const close = () => {
    if (outcome?.undoAvailable) forgetReplaceUndo(outcome.batchId);
    onClose();
  };

  const toggleDocument = (group: ReplaceDocument) => {
    const active = countSelectedInDocument(group, selection) > 0;
    setExcludedDocuments((current) => {
      const next = new Set(current);
      if (active) next.add(group.key);
      else next.delete(group.key);
      return next;
    });
    if (active) return;
    // Bringing a document back brings all of it back, rather than restoring a
    // half-selection the writer can no longer see.
    setExcludedOccurrences((current) => {
      const next = new Set(current);
      for (const occurrence of group.occurrences) next.delete(occurrence.key);
      return next;
    });
  };

  const toggleOccurrence = (occurrence: ReplaceOccurrence) => {
    setExcludedOccurrences((current) => {
      const next = new Set(current);
      if (next.has(occurrence.key)) next.delete(occurrence.key);
      else next.add(occurrence.key);
      return next;
    });
  };

  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setAllExpanded = (openAll: boolean) => {
    setExpanded(new Set(openAll && plan ? plan.documents.map((group) => group.key) : []));
  };

  const fieldLabel = (occurrence: ReplaceOccurrence) => {
    const label = t(occurrence.fieldLabelKey);
    return occurrence.fieldLabelName ? label.replace('{name}', occurrence.fieldLabelName) : label;
  };

  // An empty replacement is a deletion, and the confirmation has to say so
  // rather than offering to replace the name with a pair of empty quotes.
  const confirmTemplate = replacement
    ? t('projectReplace.confirmMessage')
    : t('projectReplace.confirmRemoveMessage');
  const confirmMessage = confirmTemplate
    .replace('{occurrences}', occurrenceCount(selected.occurrences))
    .replace('{documents}', documentCount(selected.documents))
    .replace('{term}', term)
    .replace('{replacement}', replacement);

  return (
    <>
      <Modal open={open} onClose={close} title={t('projectReplace.title')} wide>
        <div className="space-y-5">
          <section className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {/* A div, not a label: the three toggles are buttons, and a
                  label may not contain other labelable elements. */}
              <div className="block">
                <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-text-dim">
                  {t('projectReplace.find')}
                </span>
                <div className="flex items-center gap-1.5">
                  <input
                    value={term}
                    autoFocus
                    onChange={(event) => setTerm(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      event.preventDefault();
                      void runSearch();
                    }}
                    placeholder={t('projectReplace.findPlaceholder')}
                    aria-label={t('projectReplace.find')}
                    className={`${fieldClass} min-w-0`}
                  />
                  <Toggle
                    active={caseSensitive}
                    label="Aa"
                    title={t('projectReplace.caseSensitive')}
                    onClick={() => setCaseSensitive((on) => !on)}
                  />
                  <Toggle
                    active={wholeWord}
                    label="ab"
                    title={t('projectReplace.wholeWord')}
                    onClick={() => setWholeWord((on) => !on)}
                  />
                  <Toggle
                    active={matchDiacritics}
                    label="Á"
                    title={t('projectReplace.matchDiacritics')}
                    onClick={() => setMatchDiacritics((on) => !on)}
                  />
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-text-dim">
                  {t('projectReplace.replaceWith')}
                </span>
                <input
                  value={replacement}
                  onChange={(event) => setReplacement(event.target.value)}
                  placeholder={t('projectReplace.replacePlaceholder')}
                  className={fieldClass}
                />
              </label>
            </div>

            <div>
              <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wider text-text-dim">
                {t('projectReplace.scopeTitle')}
              </span>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {REPLACE_SCOPES.map((scope) => (
                  <label key={scope} className="flex items-center gap-2 text-sm text-text-primary">
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope)}
                      onChange={() => toggleScope(scope)}
                      className="accent-accent-gold"
                    />
                    {t(replaceScopeLabelKey(scope))}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-text-dim">{t('projectReplace.dialogNote')}</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy !== null || !term.trim() || activeScopes.length === 0}
                onClick={() => void runSearch()}
                className={primaryClass}
              >
                {busy === 'search' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Search size={14} />
                )}
                {t('projectReplace.search')}
              </button>
              {activeScopes.length === 0 && (
                <span className="text-xs text-text-dim">{t('projectReplace.noScope')}</span>
              )}
              {stale && (
                <span className="text-xs text-accent-gold">{t('projectReplace.staleHint')}</span>
              )}
            </div>
          </section>

          {error && (
            <p className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-300">
              {error}
            </p>
          )}

          {outcome && (
            <section className="space-y-3 rounded-xl border border-border bg-background p-4">
              <h3 className="font-serif font-semibold text-text-primary">
                {t('projectReplace.doneTitle')}
              </h3>
              <p className="text-sm text-text-muted">
                {t('projectReplace.doneSummary')
                  .replace('{occurrences}', occurrenceCount(outcome.replaced))
                  .replace('{documents}', documentCount(outcome.documents))}
              </p>
              {outcome.snapshots > 0 && (
                <p className="text-sm text-text-muted">
                  {t('projectReplace.doneSnapshots').replace('{count}', String(outcome.snapshots))}
                </p>
              )}
              {outcome.skippedChanged > 0 && (
                <p className="flex items-start gap-2 text-sm text-amber-300">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                  {t('projectReplace.doneChanged').replace(
                    '{count}',
                    String(outcome.skippedChanged),
                  )}
                </p>
              )}
              {undoOpen ? (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void runUndo()}
                    className={buttonClass}
                  >
                    {busy === 'undo' ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Undo2 size={14} />
                    )}
                    {t('projectReplace.undo')}
                  </button>
                  <span className="text-xs text-text-dim">{t('projectReplace.undoHint')}</span>
                </div>
              ) : (
                <p className="text-xs text-text-dim">{t('projectReplace.undoUnavailable')}</p>
              )}
            </section>
          )}

          {plan && (
            <section className="space-y-3">
              {plan.total === 0 && plan.splitTotal === 0 ? (
                <p className="text-sm text-text-muted">
                  {t('projectReplace.noResults')
                    .replace('{term}', plan.term)
                    .replace('{scanned}', String(plan.scanned))}
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                    <p className="text-sm text-text-primary">
                      {t('projectReplace.summary')
                        .replace('{occurrences}', occurrenceCount(plan.total))
                        .replace('{documents}', documentCount(plan.documents.length))}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAllExpanded(true)}
                        className="text-xs text-text-dim transition hover:text-accent-gold"
                      >
                        {t('projectReplace.expandAll')}
                      </button>
                      <span className="text-text-dim">·</span>
                      <button
                        type="button"
                        onClick={() => setAllExpanded(false)}
                        className="text-xs text-text-dim transition hover:text-accent-gold"
                      >
                        {t('projectReplace.collapseAll')}
                      </button>
                    </div>
                  </div>

                  {plan.splitTotal > 0 && (
                    <p className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
                      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                      {t('projectReplace.splitDetail').replace(
                        '{count}',
                        String(plan.splitTotal),
                      )}
                    </p>
                  )}

                  {plan.unlisted > 0 && (
                    <p className="text-xs text-text-dim">
                      {t('projectReplace.listCapped').replace(
                        '{count}',
                        String(plan.unlisted),
                      )}
                    </p>
                  )}

                  <div className="divide-y divide-border rounded-xl border border-border">
                    {plan.documents.map((group) => {
                      const inDocument = countSelectedInDocument(group, selection);
                      const isOpen = expanded.has(group.key);
                      const listedSelectable = group.occurrences.filter(
                        (occurrence) => !occurrence.split,
                      ).length;
                      const unlisted = group.total - listedSelectable;
                      const documentOff = excludedDocuments.has(group.key);

                      return (
                        <div key={group.key}>
                          <div className="flex items-start gap-2 px-3 py-2">
                            <TriStateBox
                              checked={inDocument > 0}
                              partial={inDocument > 0 && inDocument < group.total}
                              label={group.title}
                              onChange={() => toggleDocument(group)}
                            />
                            <button
                              type="button"
                              onClick={() => toggleExpanded(group.key)}
                              className="flex min-w-0 flex-1 items-start gap-2 text-left"
                            >
                              {isOpen ? (
                                <ChevronDown size={14} className="mt-0.5 flex-shrink-0 text-text-dim" />
                              ) : (
                                <ChevronRight size={14} className="mt-0.5 flex-shrink-0 text-text-dim" />
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-text-primary">
                                  {group.title}
                                </span>
                                <span className="block text-xs text-text-dim">
                                  {t(replaceScopeLabelKey(group.scope))} ·{' '}
                                  {occurrenceCount(group.total)}
                                  {group.splitTotal > 0
                                    ? ` · ${t('projectReplace.splitCount').replace('{count}', String(group.splitTotal))}`
                                    : ''}
                                </span>
                              </span>
                            </button>
                          </div>

                          {isOpen && (
                            <ul className="space-y-1 border-t border-border/60 bg-background/40 px-3 py-2">
                              {group.occurrences.map((occurrence) => (
                                <li key={occurrence.key} className="flex items-start gap-2">
                                  {occurrence.split ? (
                                    <AlertTriangle
                                      size={13}
                                      className="mt-1 flex-shrink-0 text-amber-400"
                                    />
                                  ) : (
                                    <TriStateBox
                                      checked={
                                        !documentOff && !excludedOccurrences.has(occurrence.key)
                                      }
                                      disabled={documentOff}
                                      label={fieldLabel(occurrence)}
                                      onChange={() => toggleOccurrence(occurrence)}
                                    />
                                  )}
                                  <p className="min-w-0 flex-1 text-xs leading-relaxed text-text-muted">
                                    <span className="mr-1.5 text-[10px] uppercase tracking-wide text-text-dim">
                                      {fieldLabel(occurrence)}
                                      {occurrence.rowLabel ? ` · ${occurrence.rowLabel}` : ''}
                                    </span>
                                    <span>{occurrence.before}</span>
                                    <span
                                      className={
                                        occurrence.split
                                          ? 'rounded bg-amber-500/20 px-0.5 text-amber-200'
                                          : 'rounded bg-red-500/15 px-0.5 text-red-200 line-through'
                                      }
                                    >
                                      {occurrence.match}
                                    </span>
                                    {!occurrence.split && replacement && (
                                      <span className="rounded bg-accent-gold/20 px-0.5 text-accent-gold">
                                        {replacement}
                                      </span>
                                    )}
                                    <span>{occurrence.after}</span>
                                  </p>
                                </li>
                              ))}
                              {unlisted > 0 && (
                                <li className="pl-6 text-xs text-text-dim">
                                  {t('projectReplace.moreInDocument').replace(
                                    '{count}',
                                    String(unlisted),
                                  )}
                                </li>
                              )}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
                    <button type="button" onClick={close} className={buttonClass}>
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      disabled={busy !== null || stale || selected.occurrences === 0}
                      onClick={() => setConfirming(true)}
                      className={primaryClass}
                    >
                      {busy === 'apply' ? <Loader2 size={14} className="animate-spin" /> : null}
                      {selected.occurrences === 0
                        ? t('projectReplace.applyNone')
                        : t('projectReplace.apply')
                            .replace('{occurrences}', occurrenceCount(selected.occurrences))
                            .replace('{documents}', documentCount(selected.documents))}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={confirming}
        title={t('projectReplace.confirmTitle')}
        message={confirmMessage}
        confirmLabel={t('projectReplace.confirmAction')}
        onConfirm={() => void runReplace()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
