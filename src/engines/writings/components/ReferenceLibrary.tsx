import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookMarked,
  FileText,
  LoaderCircle,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { db } from '@/db';
import { ConfirmDialog } from '@/engines/_shared';
import { useTranslation } from '@/i18n/useTranslation';
import {
  deleteReferenceDocument,
  createReferenceLens,
  ingestReferenceFile,
  inspectReferenceDelete,
  listReferenceLibrary,
  listProjectReferenceLinks,
  relinkProjectReference,
  setProjectLensActive,
  updateReferenceLens,
  type ReferenceCriterion,
  type ReferenceDeleteImpact,
  type ReferenceLens,
  type ReferenceLibraryEntry,
  type ReferenceSection,
  type ProjectReferenceLink,
} from '@/services/judge';
import { generateId } from '@/utils/idGenerator';

function errorKey(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code.includes('unsupported-reference-format')) return 'judge.library.error.format';
  if (code.includes('reference-too-large')) return 'judge.library.error.size';
  if (code.includes('pdf-has-no-text-layer')) return 'judge.library.error.ocr';
  if (code.includes('reference-is-empty') || code.includes('reference-lens-empty')) return 'judge.library.error.empty';
  return 'judge.library.error.generic';
}

function LensEditor({
  lens,
  documentId,
  onSaved,
}: {
  lens: ReferenceLens;
  documentId: string;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [sections, setSections] = useState<ReferenceSection[]>([]);
  const [name, setName] = useState(lens.name);
  const [selected, setSelected] = useState(() => new Set(lens.sectionIds));
  const [criteria, setCriteria] = useState<ReferenceCriterion[]>(lens.criteria);
  const [criterion, setCriterion] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void db.referenceSections.where('documentId').equals(documentId).sortBy('order').then(rows => {
      if (alive) setSections(rows);
    });
    return () => { alive = false; };
  }, [documentId]);

  const save = async () => {
    if (!name.trim() || selected.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      await updateReferenceLens(lens.id, {
        name: name.trim(),
        sectionIds: [...selected],
        criteria,
      });
      onSaved();
    } catch (reason) {
      setError(t(errorKey(reason)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-border/70 bg-deep/45 p-3">
      <label className="block text-[11px] text-text-muted">
        <span className="mb-1 block">{t('judge.library.lensName')}</span>
        <input
          value={name}
          onChange={event => setName(event.target.value)}
          className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-text-primary outline-none transition-colors focus-visible:border-accent-gold focus-visible:ring-2 focus-visible:ring-accent-gold/20"
        />
      </label>

      <fieldset>
        <legend className="mb-1 text-[11px] text-text-muted">{t('judge.library.sections')}</legend>
        <div className="max-h-36 space-y-1 overflow-y-auto overscroll-contain pr-1">
          {sections.map(section => (
            <label key={section.id} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-[11px] text-text-muted hover:bg-elevated/60">
              <input
                type="checkbox"
                checked={selected.has(section.id)}
                onChange={event => {
                  setSelected(current => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(section.id);
                    else next.delete(section.id);
                    return next;
                  });
                }}
                className="mt-0.5 accent-[var(--color-accent-gold)]"
              />
              <span>
                {section.page ? `${t('judge.citation.page')} ${section.page}` : section.heading || `${t('judge.library.section')} ${section.order + 1}`}
                <span className="ml-1 text-text-dim">{section.text.slice(0, 52)}{section.text.length > 52 ? '…' : ''}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-[11px] text-text-muted">{t('judge.library.criteria')}</legend>
        <div className="space-y-1.5">
          {criteria.map(item => (
            <div key={item.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={item.approved}
                onChange={event => setCriteria(rows => rows.map(row => row.id === item.id ? { ...row, approved: event.target.checked } : row))}
                aria-label={t('judge.library.criterionApproved')}
                className="mt-1 accent-[var(--color-accent-gold)]"
              />
              <input
                value={item.text}
                onChange={event => setCriteria(rows => rows.map(row => row.id === item.id ? { ...row, text: event.target.value } : row))}
                className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-[11px] text-text-primary outline-none focus-visible:border-accent-gold"
              />
              <button
                type="button"
                onClick={() => setCriteria(rows => rows.filter(row => row.id !== item.id))}
                aria-label={t('common.delete')}
                className="rounded p-1 text-text-dim hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <input
              value={criterion}
              onChange={event => setCriterion(event.target.value)}
              placeholder={t('judge.library.criterionPlaceholder')}
              className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-[11px] text-text-primary outline-none placeholder:text-text-dim focus-visible:border-accent-gold"
              onKeyDown={event => {
                if (event.key !== 'Enter' || !criterion.trim()) return;
                event.preventDefault();
                setCriteria(rows => [...rows, { id: generateId('criterion'), text: criterion.trim(), approved: false }]);
                setCriterion('');
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (!criterion.trim()) return;
                setCriteria(rows => [...rows, { id: generateId('criterion'), text: criterion.trim(), approved: false }]);
                setCriterion('');
              }}
              disabled={!criterion.trim()}
              className="rounded border border-border p-1 text-text-muted hover:border-accent-gold/50 hover:text-accent-gold disabled:opacity-40"
              aria-label={t('common.add')}
            >
              <Plus size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      </fieldset>

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !name.trim() || selected.size === 0}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent-gold/15 px-2 py-1.5 text-xs font-semibold text-accent-gold transition-colors hover:bg-accent-gold/25 disabled:opacity-40"
      >
        {saving ? <LoaderCircle size={13} className="animate-spin" aria-hidden="true" /> : <Save size={13} aria-hidden="true" />}
        {t('common.save')}
      </button>
      {error && <p role="alert" className="text-[10px] leading-relaxed text-danger">{error}</p>}
    </div>
  );
}

export default function ReferenceLibrary({
  projectId,
  onChange,
}: {
  projectId: string;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [entries, setEntries] = useState<ReferenceLibraryEntry[]>([]);
  const [pendingLinks, setPendingLinks] = useState<ProjectReferenceLink[]>([]);
  const [expandedLens, setExpandedLens] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [indexing, setIndexing] = useState<{ name: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<ReferenceDeleteImpact | null>(null);

  const load = useCallback(async () => {
    const [rows, links] = await Promise.all([
      listReferenceLibrary(projectId),
      listProjectReferenceLinks(projectId),
    ]);
    setEntries(rows);
    setPendingLinks(links.filter(link => link.status !== 'ready'));
    setLoading(false);
    onChange();
  }, [onChange, projectId]);

  useEffect(() => {
    let alive = true;
    void Promise.all([listReferenceLibrary(projectId), listProjectReferenceLinks(projectId)]).then(([rows, links]) => {
      if (!alive) return;
      setEntries(rows);
      setPendingLinks(links.filter(link => link.status !== 'ready'));
      setLoading(false);
    });
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [projectId]);

  const upload = async (file: File) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setIndexing({ name: file.name, done: 0, total: 1 });
    try {
      await ingestReferenceFile(projectId, file, {
        signal: controller.signal,
        onProgress: (done, total) => setIndexing({ name: file.name, done, total }),
      });
      await load();
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(t(errorKey(reason)));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIndexing(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const relink = async (link: ProjectReferenceLink, file: File) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setIndexing({ name: file.name, done: 0, total: 1 });
    try {
      await relinkProjectReference(projectId, link.id, file, {
        signal: controller.signal,
        onProgress: (done, total) => setIndexing({ name: file.name, done, total }),
      });
      await load();
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        const mismatch = reason instanceof Error && reason.message.includes('reference-relink-hash-mismatch');
        setError(t(mismatch ? 'judge.library.error.relinkMismatch' : errorKey(reason)));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIndexing(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
            <BookMarked size={14} className="text-accent-gold" aria-hidden="true" />
            {t('judge.library.title')}
          </p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-text-dim">{t('judge.library.privateHint')}</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
          className="sr-only"
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={Boolean(indexing)}
          className="flex shrink-0 items-center gap-1 rounded-md border border-accent-gold/35 px-2 py-1 text-[11px] font-semibold text-accent-gold transition-colors hover:bg-accent-gold/10 disabled:opacity-45"
        >
          <Upload size={12} aria-hidden="true" />
          {t('judge.library.add')}
        </button>
      </div>

      {indexing && (
        <div role="status" className="rounded-lg border border-accent-gold/25 bg-accent-gold/5 p-2.5 text-[11px] text-text-muted">
          <div className="flex items-center gap-2">
            <LoaderCircle size={13} className="animate-spin text-accent-gold" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{t('judge.library.indexing')} {indexing.name}</span>
            <button type="button" onClick={() => abortRef.current?.abort()} className="text-text-muted hover:text-text-primary">
              {t('common.cancel')}
            </button>
          </div>
          {indexing.total > 1 && (
            <progress className="mt-2 h-1.5 w-full accent-[var(--color-accent-gold)]" value={indexing.done} max={indexing.total} />
          )}
        </div>
      )}
      {error && <p role="alert" className="rounded-md border border-danger/25 bg-danger/5 px-2.5 py-2 text-[11px] text-danger">{error}</p>}

      {pendingLinks.length > 0 && (
        <div className="space-y-2">
          {pendingLinks.map(link => (
            <div key={link.id} className="rounded-lg border border-accent-amber/30 bg-accent-amber/5 p-2.5">
              <p className="text-xs font-medium text-text-primary">{link.documentName}</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-accent-amber">{t('judge.library.relinkNeeded')}</p>
              <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-accent-amber/35 px-2 py-1 text-[10px] font-semibold text-accent-amber hover:bg-accent-amber/10">
                <Upload size={11} aria-hidden="true" />
                {t('judge.library.relink')}
                <input
                  type="file"
                  accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
                  className="sr-only"
                  onChange={event => {
                    const file = event.target.files?.[0];
                    if (file) void relink(link, file);
                    event.target.value = '';
                  }}
                />
              </label>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <p className="text-[11px] text-text-dim">{t('common.loading')}</p>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center">
          <FileText size={20} className="mx-auto mb-1.5 text-text-dim" aria-hidden="true" />
          <p className="text-[11px] text-text-muted">{t('judge.library.empty')}</p>
          <p className="mt-1 text-[10px] text-text-dim">{t('judge.library.formats')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map(entry => (
            <section key={entry.document.id} className="rounded-lg border border-border bg-surface/70 p-2.5">
              <div className="flex items-start gap-2">
                <FileText size={14} className="mt-0.5 shrink-0 text-text-dim" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-text-primary" title={entry.document.name}>{entry.document.name}</p>
                  <p className="text-[10px] text-text-dim">
                    v{entry.document.version} · {entry.document.status === 'ready' ? t('judge.library.ready') : t('judge.library.unavailable')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void inspectReferenceDelete(entry.document.id).then(setDeleteImpact)}
                  className="rounded p-1 text-text-dim hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
                  aria-label={t('judge.library.delete')}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => void createReferenceLens(projectId, entry.document.id).then(async lens => {
                  setExpandedLens(lens.id);
                  await load();
                })}
                className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-accent-gold hover:underline"
              >
                <Plus size={11} aria-hidden="true" />
                {t('judge.library.newLens')}
              </button>
              <div className="mt-2 space-y-1.5">
                {entry.lenses.map(lens => {
                  const linked = entry.linkedLensIds.has(lens.id);
                  return (
                    <div key={lens.id}>
                      <div className="flex items-center gap-2">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-[11px] text-text-muted">
                          <input
                            type="checkbox"
                            checked={linked}
                            onChange={event => {
                              void setProjectLensActive(projectId, lens.id, event.target.checked).then(load);
                            }}
                            className="accent-[var(--color-accent-gold)]"
                          />
                          <span className="truncate">{lens.name}</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => setExpandedLens(current => current === lens.id ? null : lens.id)}
                          aria-expanded={expandedLens === lens.id}
                          className="rounded px-1.5 py-0.5 text-[10px] text-text-dim hover:bg-elevated hover:text-text-primary"
                        >
                          {t('common.edit')}
                        </button>
                      </div>
                      {expandedLens === lens.id && (
                        <LensEditor lens={lens} documentId={entry.document.id} onSaved={() => void load()} />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteImpact)}
        title={t('judge.library.deleteTitle')}
        message={deleteImpact
          ? t('judge.library.deleteMessage')
            .replace('{name}', deleteImpact.document.name)
            .replace('{projects}', String(deleteImpact.projects.length))
            .replace('{runs}', String(deleteImpact.runCount))
          : ''}
        confirmLabel={t('common.delete')}
        destructive
        onCancel={() => setDeleteImpact(null)}
        onConfirm={async () => {
          if (!deleteImpact) return;
          await deleteReferenceDocument(deleteImpact.document.id);
          setDeleteImpact(null);
          await load();
        }}
      />
    </div>
  );
}
