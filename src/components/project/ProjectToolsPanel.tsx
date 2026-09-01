import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import {
  BookTemplate,
  Bot,
  Clipboard,
  Download,
  FileOutput,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { db } from '@/db';
import { captureNote } from '@/engines/notes/operations';
import { toLocalDateKey } from '@/engines/writing-stats/date';
import { useAiStore } from '@/stores/aiStore';
import {
  applyProjectRecipe,
  citationFromSnapshot,
  deleteCitation,
  deleteCustomRecipe,
  deletePublishingProfile,
  exportBibliography,
  getCitations,
  getGroundedAiPrivacy,
  getProjectRecipes,
  getPublishingProfiles,
  promoteDiaryToWriting,
  promoteNoteToWriting,
  promoteSnapshotToWriting,
  runGroundedProjectAnalysis,
  saveCitation,
  saveGroundedAiPrivacy,
  saveProjectAsRecipe,
  undoConversion,
  type GroundedAiPrivacy,
  type GroundedAiResult,
  type ProjectRecipe,
} from '@/services/projectTools';
import type { Project, Writing } from '@/types';
import type { Citation, ConversionReceipt, PublishingProfile } from '@/types/projectTools';
import type { Note } from '@/engines/notes/types';
import type { DiaryEntry } from '@/engines/diary/types';
import type { Snapshot } from '@/engines/scrapper/types';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import ProjectReplaceModal from '@/components/project/ProjectReplaceModal';
import PublishingProfileModal from '@/components/project/PublishingProfileModal';
import { ConfirmDialog } from '@/engines/_shared';

export type ProjectToolView = 'workflows' | 'research' | 'templates' | 'publishing' | 'ai';

interface ToolsData {
  project: Project;
  recipes: ProjectRecipe[];
  citations: Citation[];
  profiles: PublishingProfile[];
  writings: Writing[];
  notes: Note[];
  diary: DiaryEntry[];
  snapshots: Snapshot[];
  receipts: ConversionReceipt[];
}

const fieldClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-gold';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary transition hover:border-accent-gold hover:text-accent-gold disabled:opacity-50';
const primaryClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent-gold px-3 py-2 text-sm font-medium text-background transition hover:brightness-110 disabled:opacity-50';

async function loadToolsData(projectId: string): Promise<ToolsData> {
  const [project, recipes, citations, profiles, writings, notes, diary, snapshots, receipts] = await Promise.all([
    db.projects.get(projectId),
    getProjectRecipes(),
    getCitations(projectId),
    getPublishingProfiles(projectId),
    db.writings.where('projectId').equals(projectId).toArray(),
    db.notes.where('projectId').equals(projectId).reverse().sortBy('updatedAt'),
    db.diaryEntries.where('projectId').equals(projectId).reverse().sortBy('updatedAt'),
    db.snapshots.where('projectId').equals(projectId).reverse().sortBy('createdAt'),
    db.conversionReceipts.where('projectId').equals(projectId).reverse().sortBy('createdAt'),
  ]);
  if (!project) throw new Error('Project not found');
  return {
    project,
    recipes,
    citations,
    profiles,
    writings,
    notes: notes.slice(0, 12),
    diary: diary.slice(0, 12),
    snapshots: snapshots.slice(0, 12),
    receipts: receipts.slice(0, 12),
  };
}

function useToolsData(projectId: string) {
  const [state, setState] = useState<{ projectId: string; data: ToolsData | null; error: Error | null }>({
    projectId,
    data: null,
    error: null,
  });
  useEffect(() => {
    const subscription = liveQuery(() => loadToolsData(projectId)).subscribe({
      next: data => setState({ projectId, data, error: null }),
      error: reason => setState({
        projectId,
        data: null,
        error: reason instanceof Error ? reason : new Error(String(reason)),
      }),
    });
    return () => subscription.unsubscribe();
  }, [projectId]);
  return state.projectId === projectId
    ? { data: state.data, error: state.error }
    : { data: null, error: null };
}

function SourceRow({
  title,
  subtitle,
  action,
  actionLabel,
  disabled,
}: {
  title: string;
  subtitle: string;
  action: () => void;
  actionLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-text-primary">{title}</p>
        <p className="truncate text-xs text-text-dim">{subtitle}</p>
      </div>
      <button type="button" disabled={disabled} onClick={action} className={buttonClass}>
        <Sparkles size={13} />
        {actionLabel}
      </button>
    </div>
  );
}

function Workflows({ projectId, data }: { projectId: string; data: ToolsData }) {
  const { t, locale } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(success);
    } catch (error) {
      console.error('Workflow action failed', error);
      toast.error(t('projectTools.workflows.error'));
    } finally {
      setBusy(null);
    }
  };
  const captureClipboard = async () => {
    setBusy('clipboard');
    try {
      const text = await navigator.clipboard.readText();
      const note = await captureNote({ projectId, text, source: t('projectTools.workflows.clipboardSource') });
      if (!note) throw new Error('Clipboard does not contain text');
      toast.success(t('projectTools.workflows.clipboardCaptured'));
    } catch (error) {
      console.error('Clipboard capture failed', error);
      toast.error(t('projectTools.workflows.clipboardError'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="font-serif font-semibold text-text-primary">{t('projectTools.workflows.captureTitle')}</h3>
        <p className="mt-1 text-sm text-text-muted">{t('projectTools.workflows.captureDetail')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {window.electronAPI?.quickNote.open && (
            <button type="button" onClick={() => void window.electronAPI?.quickNote.open()} className={primaryClass}>
              <Plus size={15} /> {t('projectTools.workflows.quickCapture')}
            </button>
          )}
          <button type="button" disabled={busy !== null} onClick={() => void captureClipboard()} className={buttonClass}>
            <Clipboard size={15} /> {t('projectTools.workflows.captureClipboard')}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="font-serif font-semibold text-text-primary">{t('projectReplace.open')}</h3>
        <p className="mt-1 text-sm text-text-muted">{t('projectReplace.openDetail')}</p>
        <button type="button" onClick={() => setReplaceOpen(true)} className={`${buttonClass} mt-4`}>
          <Search size={15} /> {t('projectReplace.openAction')}
        </button>
      </section>

      <ProjectReplaceModal
        open={replaceOpen}
        projectId={projectId}
        onClose={() => setReplaceOpen(false)}
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <h3 className="border-b border-border px-4 py-3 font-serif font-semibold text-text-primary">{t('projectTools.workflows.notesTitle')}</h3>
          {data.notes.length === 0 && <p className="p-4 text-sm text-text-muted">{t('projectTools.workflows.notesEmpty')}</p>}
          {data.notes.map(note => (
            <SourceRow
              key={note.id}
              title={note.text.split('\n')[0] || t('projectTools.workflows.noteFallback')}
              subtitle={t(`notes.kind.${note.kind}`)}
              disabled={busy !== null}
              action={() => void run(`note:${note.id}`, () => promoteNoteToWriting(note.id), t('projectTools.workflows.notePromoted'))}
              actionLabel={busy === `note:${note.id}` ? t('projectTools.workflows.promoting') : t('projectTools.workflows.promote')}
            />
          ))}
        </section>
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <h3 className="border-b border-border px-4 py-3 font-serif font-semibold text-text-primary">{t('projectTools.workflows.diaryTitle')}</h3>
          {data.diary.length === 0 && <p className="p-4 text-sm text-text-muted">{t('projectTools.workflows.diaryEmpty')}</p>}
          {data.diary.map(entry => (
            <SourceRow
              key={entry.id}
              title={entry.title || entry.entryDate}
              subtitle={entry.entryDate}
              disabled={busy !== null}
              action={() => void run(`diary:${entry.id}`, () => promoteDiaryToWriting(entry.id), t('projectTools.workflows.diaryPromoted'))}
              actionLabel={busy === `diary:${entry.id}` ? t('projectTools.workflows.promoting') : t('projectTools.workflows.promote')}
            />
          ))}
        </section>
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <h3 className="border-b border-border px-4 py-3 font-serif font-semibold text-text-primary">{t('projectTools.workflows.researchTitle')}</h3>
          {data.snapshots.length === 0 && <p className="p-4 text-sm text-text-muted">{t('projectTools.workflows.researchEmpty')}</p>}
          {data.snapshots.map(snapshot => (
            <SourceRow
              key={snapshot.id}
              title={snapshot.title || snapshot.url}
              subtitle={snapshot.source}
              disabled={busy !== null}
              action={() => void run(`snapshot:${snapshot.id}`, () => promoteSnapshotToWriting(snapshot.id), t('projectTools.workflows.researchPromoted'))}
              actionLabel={busy === `snapshot:${snapshot.id}` ? t('projectTools.workflows.promoting') : t('projectTools.workflows.promote')}
            />
          ))}
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <h3 className="border-b border-border px-4 py-3 font-serif font-semibold text-text-primary">{t('projectTools.workflows.historyTitle')}</h3>
        {data.receipts.length === 0 && <p className="p-4 text-sm text-text-muted">{t('projectTools.workflows.historyEmpty')}</p>}
        {data.receipts.map(receipt => (
          <div key={receipt.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-text-primary">{receipt.preview}</p>
              <p className="text-xs text-text-dim">
                {t(`engines.${receipt.sourceEngineId}.name`)} · {new Date(receipt.createdAt).toLocaleString(locale)}
              </p>
            </div>
            <button
              type="button"
              disabled={Boolean(receipt.undoneAt) || busy !== null}
              onClick={() => void run(`undo:${receipt.id}`, () => undoConversion(receipt.id), t('projectTools.workflows.undoneToast'))}
              className={buttonClass}
            >
              <RotateCcw size={13} /> {receipt.undoneAt ? t('projectTools.workflows.undone') : t('projectTools.workflows.undo')}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

function Research({ data }: { data: ToolsData }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [authors, setAuthors] = useState('');
  const [style, setStyle] = useState<PublishingProfile['citationStyle']>('apa');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await saveCitation({
        projectId: data.project.id,
        title: title.trim(),
        authors: authors.split(',').map(value => value.trim()).filter(Boolean),
        accessedAt: toLocalDateKey(new Date()),
        url: url.trim() || undefined,
        writingIds: [],
        tags: [],
      });
      setTitle('');
      setUrl('');
      setAuthors('');
      toast.success(t('projectTools.research.added'));
    } catch {
      toast.error(t('projectTools.research.saveError'));
    } finally {
      setBusy(false);
    }
  };
  const citedSnapshotIds = new Set(data.citations.map(citation => citation.snapshotId).filter(Boolean));

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1.4fr]">
      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="font-serif font-semibold text-text-primary">{t('projectTools.research.addTitle')}</h3>
          <div className="mt-4 space-y-3">
            <input value={title} onChange={event => setTitle(event.target.value)} placeholder={t('projectTools.research.sourceTitle')} className={fieldClass} />
            <input value={authors} onChange={event => setAuthors(event.target.value)} placeholder={t('projectTools.research.authors')} className={fieldClass} />
            <input value={url} onChange={event => setUrl(event.target.value)} placeholder={t('projectTools.research.url')} className={fieldClass} />
            <button type="button" disabled={busy || !title.trim()} onClick={() => void add()} className={primaryClass}>
              <Plus size={14} /> {t('projectTools.research.add')}
            </button>
          </div>
        </section>
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="font-serif font-semibold text-text-primary">{t('projectTools.research.bibliography')}</h3>
          <div className="mt-4 flex gap-2">
            <select value={style} onChange={event => setStyle(event.target.value as PublishingProfile['citationStyle'])} className={fieldClass}>
              <option value="apa">APA</option><option value="mla">MLA</option><option value="chicago">Chicago</option>
            </select>
            <button
              type="button"
              onClick={() => void exportBibliography(data.project.id, style, data.project.title)}
              className={buttonClass}
            >
              <Download size={14} /> {t('projectTools.research.export')}
            </button>
          </div>
        </section>
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <h3 className="border-b border-border px-4 py-3 font-serif font-semibold text-text-primary">{t('projectTools.research.uncited')}</h3>
          {data.snapshots.filter(snapshot => !citedSnapshotIds.has(snapshot.id)).slice(0, 8).map(snapshot => (
            <SourceRow
              key={snapshot.id}
              title={snapshot.title || snapshot.url}
              subtitle={snapshot.url}
              action={() => void citationFromSnapshot(snapshot.id).then(() => toast.success(t('projectTools.research.createdFromResearch')))}
              actionLabel={t('projectTools.research.cite')}
            />
          ))}
        </section>
      </div>
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <h3 className="border-b border-border px-4 py-3 font-serif font-semibold text-text-primary">
          {t('projectTools.research.library').replace('{count}', String(data.citations.length))}
        </h3>
        {data.citations.length === 0 && <p className="p-6 text-center text-sm text-text-muted">{t('projectTools.research.libraryEmpty')}</p>}
        {data.citations.map(citation => (
          <div key={citation.id} className="flex items-start gap-3 border-b border-border px-4 py-4 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary">{citation.title}</p>
              <p className="mt-1 text-xs text-text-muted">{citation.authors.join(', ') || t('projectTools.research.unknownAuthor')} · {citation.accessedAt}</p>
              {citation.url && <p className="mt-1 truncate text-xs text-accent-gold">{citation.url}</p>}
            </div>
            <button
              type="button"
              onClick={() => void deleteCitation(citation.id)}
              aria-label={t('common.delete')}
              title={t('common.delete')}
              className="p-2 text-text-dim hover:text-red-400"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

function Templates({ data }: { data: ToolsData }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const builtInText: Record<string, { name: string; description: string }> = {
    'recipe-novel': {
      name: t('projectTools.templates.recipeNovel.name'),
      description: t('projectTools.templates.recipeNovel.description'),
    },
    'recipe-research': {
      name: t('projectTools.templates.recipeResearch.name'),
      description: t('projectTools.templates.recipeResearch.description'),
    },
    'recipe-screen': {
      name: t('projectTools.templates.recipeScreen.name'),
      description: t('projectTools.templates.recipeScreen.description'),
    },
    'recipe-video': {
      name: t('projectTools.templates.recipeVideo.name'),
      description: t('projectTools.templates.recipeVideo.description'),
    },
  };
  const apply = async (recipe: ProjectRecipe, mode: 'merge' | 'replace') => {
    const displayName = builtInText[recipe.id]?.name ?? recipe.name;
    try {
      await applyProjectRecipe(data.project.id, recipe, mode);
      toast.success(t('projectTools.templates.applied').replace('{name}', displayName));
    } catch {
      toast.error(t('projectTools.templates.applyError'));
    }
  };
  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 sm:flex-row">
        <div className="flex-1">
          <h3 className="font-serif font-semibold text-text-primary">{t('projectTools.templates.saveTitle')}</h3>
          <p className="mt-1 text-sm text-text-muted">{t('projectTools.templates.saveDetail')}</p>
        </div>
        <input value={name} onChange={event => setName(event.target.value)} placeholder={t('projectTools.templates.name')} className={`${fieldClass} sm:max-w-xs`} />
        <button
          type="button"
          onClick={() => void saveProjectAsRecipe(
            data.project,
            name.trim() || t('projectTools.templates.defaultName').replace('{project}', data.project.title),
            t('projectTools.templates.customDescription').replace('{project}', data.project.title),
          ).then(() => {
            setName('');
            toast.success(t('projectTools.templates.saved'));
          })}
          className={primaryClass}
        >
          <Save size={14} /> {t('projectTools.templates.save')}
        </button>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.recipes.map(recipe => (
          <section key={recipe.id} className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-start gap-3">
              <BookTemplate className="text-accent-gold" size={20} />
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-text-primary">{builtInText[recipe.id]?.name ?? recipe.name}</h3>
                <p className="mt-1 text-sm text-text-muted">{builtInText[recipe.id]?.description ?? recipe.description}</p>
                <p className="mt-3 text-xs text-text-dim">
                  {t('projectTools.templates.summary')
                    .replace('{count}', String(recipe.enabledEngines.length))
                    .replace('{mode}', t(`modes.${recipe.mode}.name`))}
                </p>
              </div>
              {recipe.custom && (
                <button
                  type="button"
                  onClick={() => void deleteCustomRecipe(recipe.id)}
                  aria-label={t('common.delete')}
                  title={t('common.delete')}
                  className="p-2 text-text-dim hover:text-red-400"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => void apply(recipe, 'merge')} className={primaryClass}>{t('projectTools.templates.addTools')}</button>
              <button type="button" onClick={() => void apply(recipe, 'replace')} className={buttonClass}>{t('projectTools.templates.replace')}</button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Publishing({ data }: { data: ToolsData }) {
  const { t } = useTranslation();
  const [studio, setStudio] = useState<{ variant: 'new' | 'edit'; profile?: PublishingProfile } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PublishingProfile | null>(null);
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await deletePublishingProfile(pendingDelete.id);
      toast.success(t('projectTools.publishing.deleted'));
    } catch (error) {
      console.error('Publishing profile deletion failed', error);
      toast.error(t('projectTools.publishing.deleteError'));
    } finally {
      setPendingDelete(null);
    }
  };
  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h3 className="font-serif font-semibold text-text-primary">{t('projectTools.publishing.studio.title')}</h3>
          <p className="mt-1 text-sm text-text-muted">{t('projectTools.publishing.studio.detail')}</p>
        </div>
        <button type="button" onClick={() => setStudio({ variant: 'new' })} className={primaryClass}>
          <Plus size={14} /> {t('projectTools.publishing.new')}
        </button>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.profiles.map(profile => (
          <section key={profile.id} className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-start gap-3">
              <FileOutput className="text-accent-gold" size={20} />
              <div className="flex-1">
                <h3 className="font-medium text-text-primary">{profile.name}</h3>
                <p className="mt-1 text-sm text-text-muted">
                  {t('projectTools.publishing.summary')
                    .replace('{format}', t(`projectTools.publishing.format.${profile.format}`))
                    .replace('{count}', profile.selectionMode === 'selected' || (!profile.selectionMode && profile.selectedWritingIds.length > 0)
                      ? String(profile.selectedWritingIds.length)
                      : t('common.all').toLocaleLowerCase())}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingDelete(profile)}
                aria-label={t('common.delete')}
                title={t('common.delete')}
                className="p-2 text-text-dim hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => setStudio({ variant: 'edit', profile })} className={primaryClass}>
                <FileOutput size={14} /> {t('projectTools.publishing.openStudio')}
              </button>
            </div>
          </section>
        ))}
        {data.profiles.length === 0 && <p className="text-sm text-text-muted">{t('projectTools.publishing.empty')}</p>}
      </div>
      {studio && (
        <PublishingProfileModal
          key={`${studio.variant}:${studio.profile?.id ?? 'new'}`}
          open
          onClose={() => setStudio(null)}
          project={data.project}
          writings={data.writings}
          initialProfile={studio.profile}
          variant={studio.variant}
        />
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        title={t('projectTools.publishing.deleteTitle')}
        message={t('projectTools.publishing.deleteMessage').replace('{name}', pendingDelete?.name ?? '')}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function GroundedAi({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const config = useAiStore(state => state.config);
  const [privacy, setPrivacy] = useState<GroundedAiPrivacy | null>(null);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<GroundedAiResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void getGroundedAiPrivacy(projectId).then(setPrivacy);
  }, [projectId]);
  if (!privacy) return <Loader2 className="animate-spin text-accent-gold" />;
  const update = async (changes: Partial<GroundedAiPrivacy>) => {
    const next = { ...privacy, ...changes };
    setPrivacy(next);
    await saveGroundedAiPrivacy(projectId, next);
  };
  const ask = async () => {
    if (!question.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await runGroundedProjectAnalysis(projectId, question, config));
    } catch (error) {
      console.error('Grounded project analysis failed', error);
      toast.error(t('projectTools.ai.analysisError'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2"><Bot className="text-accent-gold" size={20} /><h3 className="font-serif font-semibold text-text-primary">{t('projectTools.ai.privacy')}</h3></div>
        <p className="mt-2 text-sm text-text-muted">{t('projectTools.ai.privacyDetail')}</p>
        <div className="mt-5 space-y-4">
          {[
            ['enabled', 'projectTools.ai.enabled'],
            ['allowRemoteRequests', 'projectTools.ai.remote'],
            ['includeDrafts', 'projectTools.ai.drafts'],
            ['includeResearch', 'projectTools.ai.research'],
          ].map(([key, labelKey]) => (
            <label key={key} className="flex items-center justify-between gap-3 text-sm text-text-primary">
              <span>{t(labelKey)}</span>
              <input
                type="checkbox"
                checked={Boolean(privacy[key as keyof GroundedAiPrivacy])}
                onChange={event => void update({ [key]: event.target.checked })}
                className="accent-accent-gold"
              />
            </label>
          ))}
          <label className="block text-sm text-text-muted">
            {t('projectTools.ai.contextLimit')}
            <input
              type="number"
              min={4000}
              max={80000}
              step={1000}
              value={privacy.maxContextCharacters}
              onChange={event => void update({ maxContextCharacters: Number(event.target.value) })}
              className={`${fieldClass} mt-2`}
            />
          </label>
        </div>
      </section>
      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="font-serif font-semibold text-text-primary">{t('projectTools.ai.askTitle')}</h3>
        <textarea
          value={question}
          onChange={event => setQuestion(event.target.value)}
          placeholder={t('projectTools.ai.placeholder')}
          rows={4}
          className={`${fieldClass} mt-4 resize-y`}
        />
        <button type="button" disabled={busy || !question.trim()} onClick={() => void ask()} className={`${primaryClass} mt-3`}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {t('projectTools.ai.analyze')}
        </button>
        {result && (
          <div className="mt-5 rounded-lg border border-border bg-background p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{result.answer}</p>
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-dim">{t('projectTools.ai.sources')}</p>
              {result.sources.map(source => (
                <p key={source.id} className="mt-1 text-xs text-text-muted">
                  [{source.id}] {t(`engines.${source.engineId}.name`)} · {source.title}
                </p>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default function ProjectToolsPanel({
  projectId,
  view,
}: {
  projectId: string;
  view: ProjectToolView;
}) {
  const { t } = useTranslation();
  const { data, error } = useToolsData(projectId);
  if (error) return <p className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">{t('projectTools.loadError')}</p>;
  if (!data) return <div className="flex min-h-[20rem] items-center justify-center"><Loader2 className="animate-spin text-accent-gold" /></div>;
  if (view === 'workflows') return <Workflows projectId={projectId} data={data} />;
  if (view === 'research') return <Research data={data} />;
  if (view === 'templates') return <Templates data={data} />;
  if (view === 'publishing') return <Publishing data={data} />;
  return <GroundedAi projectId={projectId} />;
}
