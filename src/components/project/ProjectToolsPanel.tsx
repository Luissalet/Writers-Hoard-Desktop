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
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { db } from '@/db';
import { captureNote } from '@/engines/notes/operations';
import { useAiStore } from '@/stores/aiStore';
import {
  applyProjectRecipe,
  citationFromSnapshot,
  deleteCitation,
  deleteCustomRecipe,
  deletePublishingProfile,
  exportBibliography,
  exportPublishingProfile,
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
  savePublishingProfile,
  undoConversion,
  type GroundedAiPrivacy,
  type GroundedAiResult,
  type ProjectRecipe,
} from '@/services/projectTools';
import type { Project } from '@/types';
import type { Citation, ConversionReceipt, PublishingFormat, PublishingProfile } from '@/types/projectTools';
import type { Note } from '@/engines/notes/types';
import type { DiaryEntry } from '@/engines/diary/types';
import type { Snapshot } from '@/engines/scrapper/types';
import { toast } from '@/components/common/toast';

export type ProjectToolView = 'workflows' | 'research' | 'templates' | 'publishing' | 'ai';

interface ToolsData {
  project: Project;
  recipes: ProjectRecipe[];
  citations: Citation[];
  profiles: PublishingProfile[];
  notes: Note[];
  diary: DiaryEntry[];
  snapshots: Snapshot[];
  receipts: ConversionReceipt[];
}

const fieldClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-gold';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-primary transition hover:border-accent-gold hover:text-accent-gold disabled:opacity-50';
const primaryClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-accent-gold px-3 py-2 text-sm font-medium text-background transition hover:brightness-110 disabled:opacity-50';

async function loadToolsData(projectId: string): Promise<ToolsData> {
  const [project, recipes, citations, profiles, notes, diary, snapshots, receipts] = await Promise.all([
    db.projects.get(projectId),
    getProjectRecipes(),
    getCitations(projectId),
    getPublishingProfiles(projectId),
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
    notes: notes.slice(0, 12),
    diary: diary.slice(0, 12),
    snapshots: snapshots.slice(0, 12),
    receipts: receipts.slice(0, 12),
  };
}

function useToolsData(projectId: string) {
  const [state, setState] = useState<{ data: ToolsData | null; error: Error | null }>({
    data: null,
    error: null,
  });
  useEffect(() => {
    const subscription = liveQuery(() => loadToolsData(projectId)).subscribe({
      next: data => setState({ data, error: null }),
      error: reason => setState({
        data: null,
        error: reason instanceof Error ? reason : new Error(String(reason)),
      }),
    });
    return () => subscription.unsubscribe();
  }, [projectId]);
  return state;
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
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await action();
      toast.success(success);
    } catch (error) {
      console.error('Workflow action failed', error);
      toast.error(error instanceof Error ? error.message : 'Workflow failed');
    } finally {
      setBusy(null);
    }
  };
  const captureClipboard = async () => {
    setBusy('clipboard');
    try {
      const text = await navigator.clipboard.readText();
      const note = await captureNote({ projectId, text, source: 'Clipboard' });
      if (!note) throw new Error('Clipboard does not contain text');
      toast.success('Clipboard captured as a project note');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Clipboard access failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-surface p-5">
        <h3 className="font-serif font-semibold text-text-primary">Secure capture</h3>
        <p className="mt-1 text-sm text-text-muted">Capture is explicit and local. Clipboard text is read only after you click.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {window.electronAPI?.quickNote.open && (
            <button type="button" onClick={() => void window.electronAPI?.quickNote.open()} className={primaryClass}>
              <Plus size={15} /> Open quick capture
            </button>
          )}
          <button type="button" disabled={busy !== null} onClick={() => void captureClipboard()} className={buttonClass}>
            <Clipboard size={15} /> Capture clipboard to Notes
          </button>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-3">
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <h3 className="border-b border-border px-4 py-3 font-serif font-semibold text-text-primary">Notes → draft</h3>
          {data.notes.length === 0 && <p className="p-4 text-sm text-text-muted">No project notes yet.</p>}
          {data.notes.map(note => (
            <SourceRow
              key={note.id}
              title={note.text.split('\n')[0] || 'Note'}
              subtitle={note.kind}
              disabled={busy !== null}
              action={() => void run(`note:${note.id}`, () => promoteNoteToWriting(note.id), 'Note promoted to a writing')}
              actionLabel={busy === `note:${note.id}` ? 'Promoting…' : 'Promote'}
            />
          ))}
        </section>
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <h3 className="border-b border-border px-4 py-3 font-serif font-semibold text-text-primary">Diary → draft</h3>
          {data.diary.length === 0 && <p className="p-4 text-sm text-text-muted">No diary entries yet.</p>}
          {data.diary.map(entry => (
            <SourceRow
              key={entry.id}
              title={entry.title || entry.entryDate}
              subtitle={entry.entryDate}
              disabled={busy !== null}
              action={() => void run(`diary:${entry.id}`, () => promoteDiaryToWriting(entry.id), 'Diary entry promoted to a writing')}
              actionLabel={busy === `diary:${entry.id}` ? 'Promoting…' : 'Promote'}
            />
          ))}
        </section>
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <h3 className="border-b border-border px-4 py-3 font-serif font-semibold text-text-primary">Research → draft</h3>
          {data.snapshots.length === 0 && <p className="p-4 text-sm text-text-muted">No research snapshots yet.</p>}
          {data.snapshots.map(snapshot => (
            <SourceRow
              key={snapshot.id}
              title={snapshot.title || snapshot.url}
              subtitle={snapshot.source}
              disabled={busy !== null}
              action={() => void run(`snapshot:${snapshot.id}`, () => promoteSnapshotToWriting(snapshot.id), 'Research promoted to a writing')}
              actionLabel={busy === `snapshot:${snapshot.id}` ? 'Promoting…' : 'Promote'}
            />
          ))}
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <h3 className="border-b border-border px-4 py-3 font-serif font-semibold text-text-primary">Conversion history and undo</h3>
        {data.receipts.length === 0 && <p className="p-4 text-sm text-text-muted">Promotions create a provenance record here.</p>}
        {data.receipts.map(receipt => (
          <div key={receipt.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-text-primary">{receipt.preview}</p>
              <p className="text-xs text-text-dim">{receipt.sourceEngineId} · {new Date(receipt.createdAt).toLocaleString()}</p>
            </div>
            <button
              type="button"
              disabled={Boolean(receipt.undoneAt) || busy !== null}
              onClick={() => void run(`undo:${receipt.id}`, () => undoConversion(receipt.id), 'Conversion undone')}
              className={buttonClass}
            >
              <RotateCcw size={13} /> {receipt.undoneAt ? 'Undone' : 'Undo'}
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

function Research({ data }: { data: ToolsData }) {
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
        accessedAt: new Date().toISOString().slice(0, 10),
        url: url.trim() || undefined,
        writingIds: [],
        tags: [],
      });
      setTitle('');
      setUrl('');
      setAuthors('');
      toast.success('Citation added');
    } catch {
      toast.error('Citation could not be saved');
    } finally {
      setBusy(false);
    }
  };
  const citedSnapshotIds = new Set(data.citations.map(citation => citation.snapshotId).filter(Boolean));

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1.4fr]">
      <div className="space-y-5">
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="font-serif font-semibold text-text-primary">Add citation</h3>
          <div className="mt-4 space-y-3">
            <input value={title} onChange={event => setTitle(event.target.value)} placeholder="Source title" className={fieldClass} />
            <input value={authors} onChange={event => setAuthors(event.target.value)} placeholder="Authors, comma separated" className={fieldClass} />
            <input value={url} onChange={event => setUrl(event.target.value)} placeholder="URL (optional)" className={fieldClass} />
            <button type="button" disabled={busy || !title.trim()} onClick={() => void add()} className={primaryClass}>
              <Plus size={14} /> Add citation
            </button>
          </div>
        </section>
        <section className="rounded-xl border border-border bg-surface p-5">
          <h3 className="font-serif font-semibold text-text-primary">Bibliography</h3>
          <div className="mt-4 flex gap-2">
            <select value={style} onChange={event => setStyle(event.target.value as PublishingProfile['citationStyle'])} className={fieldClass}>
              <option value="apa">APA</option><option value="mla">MLA</option><option value="chicago">Chicago</option>
            </select>
            <button
              type="button"
              onClick={() => void exportBibliography(data.project.id, style, data.project.title)}
              className={buttonClass}
            >
              <Download size={14} /> Export
            </button>
          </div>
        </section>
        <section className="overflow-hidden rounded-xl border border-border bg-surface">
          <h3 className="border-b border-border px-4 py-3 font-serif font-semibold text-text-primary">Uncited research</h3>
          {data.snapshots.filter(snapshot => !citedSnapshotIds.has(snapshot.id)).slice(0, 8).map(snapshot => (
            <SourceRow
              key={snapshot.id}
              title={snapshot.title || snapshot.url}
              subtitle={snapshot.url}
              action={() => void citationFromSnapshot(snapshot.id).then(() => toast.success('Citation created from research'))}
              actionLabel="Cite"
            />
          ))}
        </section>
      </div>
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <h3 className="border-b border-border px-4 py-3 font-serif font-semibold text-text-primary">Source library ({data.citations.length})</h3>
        {data.citations.length === 0 && <p className="p-6 text-center text-sm text-text-muted">Add sources manually or turn Scrapper research into citations.</p>}
        {data.citations.map(citation => (
          <div key={citation.id} className="flex items-start gap-3 border-b border-border px-4 py-4 last:border-b-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-primary">{citation.title}</p>
              <p className="mt-1 text-xs text-text-muted">{citation.authors.join(', ') || 'Unknown author'} · {citation.accessedAt}</p>
              {citation.url && <p className="mt-1 truncate text-xs text-accent-gold">{citation.url}</p>}
            </div>
            <button type="button" onClick={() => void deleteCitation(citation.id)} className="p-2 text-text-dim hover:text-red-400">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

function Templates({ data }: { data: ToolsData }) {
  const [name, setName] = useState('');
  const apply = async (recipe: ProjectRecipe, mode: 'merge' | 'replace') => {
    try {
      await applyProjectRecipe(data.project.id, recipe, mode);
      toast.success(`${recipe.name} applied`);
    } catch {
      toast.error('Template could not be applied');
    }
  };
  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 sm:flex-row">
        <div className="flex-1">
          <h3 className="font-serif font-semibold text-text-primary">Save this setup</h3>
          <p className="mt-1 text-sm text-text-muted">Reuse the current mode, enabled engines, and ordering in other projects.</p>
        </div>
        <input value={name} onChange={event => setName(event.target.value)} placeholder="Template name" className={`${fieldClass} sm:max-w-xs`} />
        <button
          type="button"
          onClick={() => void saveProjectAsRecipe(data.project, name).then(() => {
            setName('');
            toast.success('Project template saved');
          })}
          className={primaryClass}
        >
          <Save size={14} /> Save
        </button>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.recipes.map(recipe => (
          <section key={recipe.id} className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-start gap-3">
              <BookTemplate className="text-accent-gold" size={20} />
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-text-primary">{recipe.name}</h3>
                <p className="mt-1 text-sm text-text-muted">{recipe.description}</p>
                <p className="mt-3 text-xs text-text-dim">{recipe.enabledEngines.length} engines · {recipe.mode}</p>
              </div>
              {recipe.custom && (
                <button type="button" onClick={() => void deleteCustomRecipe(recipe.id)} className="p-2 text-text-dim hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => void apply(recipe, 'merge')} className={primaryClass}>Add tools</button>
              <button type="button" onClick={() => void apply(recipe, 'replace')} className={buttonClass}>Replace setup</button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Publishing({ data }: { data: ToolsData }) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState<PublishingFormat>('manuscript');
  const create = async () => {
    if (!name.trim()) return;
    await savePublishingProfile({
      projectId: data.project.id,
      name: name.trim(),
      format,
      includeTitlePage: true,
      includeSynopsis: false,
      includeBibliography: format === 'research' || format === 'biography',
      citationStyle: 'apa',
      selectedWritingIds: [],
    });
    setName('');
    toast.success('Publishing profile created');
  };
  const publish = async (profile: PublishingProfile, output: 'markdown' | 'html' | 'pdf') => {
    const result = await exportPublishingProfile(data.project, profile, output);
    if (!result.ok) toast.error(result.error ?? 'Export failed');
    else toast.success(`${profile.name} exported`);
  };
  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 md:flex-row">
        <input value={name} onChange={event => setName(event.target.value)} placeholder="Profile name" className={fieldClass} />
        <select value={format} onChange={event => setFormat(event.target.value as PublishingFormat)} className={`${fieldClass} md:max-w-xs`}>
          <option value="manuscript">Manuscript</option>
          <option value="screenplay">Screenplay</option>
          <option value="research">Research</option>
          <option value="biography">Biography</option>
          <option value="video">Video</option>
        </select>
        <button type="button" disabled={!name.trim()} onClick={() => void create()} className={primaryClass}>
          <Plus size={14} /> New profile
        </button>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.profiles.map(profile => (
          <section key={profile.id} className="rounded-xl border border-border bg-surface p-5">
            <div className="flex items-start gap-3">
              <FileOutput className="text-accent-gold" size={20} />
              <div className="flex-1">
                <h3 className="font-medium text-text-primary">{profile.name}</h3>
                <p className="mt-1 text-sm capitalize text-text-muted">{profile.format} · {profile.selectedWritingIds.length || 'all'} writings</p>
              </div>
              <button type="button" onClick={() => void deletePublishingProfile(profile.id)} className="p-2 text-text-dim hover:text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => void publish(profile, 'markdown')} className={buttonClass}>Markdown</button>
              <button type="button" onClick={() => void publish(profile, 'html')} className={buttonClass}>HTML</button>
              <button type="button" onClick={() => void publish(profile, 'pdf')} className={primaryClass}>PDF</button>
            </div>
          </section>
        ))}
        {data.profiles.length === 0 && <p className="text-sm text-text-muted">Create a reusable export profile for this project.</p>}
      </div>
    </div>
  );
}

function GroundedAi({ projectId }: { projectId: string }) {
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
      toast.error(error instanceof Error ? error.message : 'Grounded analysis failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center gap-2"><Bot className="text-accent-gold" size={20} /><h3 className="font-serif font-semibold text-text-primary">Privacy controls</h3></div>
        <p className="mt-2 text-sm text-text-muted">Nothing is sent until both switches below are enabled and you ask a question.</p>
        <div className="mt-5 space-y-4">
          {[
            ['enabled', 'Enable grounded AI for this project'],
            ['allowRemoteRequests', 'Allow selected excerpts to leave this device'],
            ['includeDrafts', 'Include writing excerpts'],
            ['includeResearch', 'Include research excerpts'],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-3 text-sm text-text-primary">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={Boolean(privacy[key as keyof GroundedAiPrivacy])}
                onChange={event => void update({ [key]: event.target.checked })}
                className="accent-accent-gold"
              />
            </label>
          ))}
          <label className="block text-sm text-text-muted">
            Context limit
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
        <h3 className="font-serif font-semibold text-text-primary">Ask your project</h3>
        <textarea
          value={question}
          onChange={event => setQuestion(event.target.value)}
          placeholder="Which unresolved setup has the strongest evidence in my draft?"
          rows={4}
          className={`${fieldClass} mt-4 resize-y`}
        />
        <button type="button" disabled={busy || !question.trim()} onClick={() => void ask()} className={`${primaryClass} mt-3`}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Analyze with citations
        </button>
        {result && (
          <div className="mt-5 rounded-lg border border-border bg-background p-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary">{result.answer}</p>
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-dim">Sources sent</p>
              {result.sources.map(source => <p key={source.id} className="mt-1 text-xs text-text-muted">[{source.id}] {source.engineId} · {source.title}</p>)}
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
  const { data, error } = useToolsData(projectId);
  if (error) return <p className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-300">{error.message}</p>;
  if (!data) return <div className="flex min-h-[20rem] items-center justify-center"><Loader2 className="animate-spin text-accent-gold" /></div>;
  if (view === 'workflows') return <Workflows projectId={projectId} data={data} />;
  if (view === 'research') return <Research data={data} />;
  if (view === 'templates') return <Templates data={data} />;
  if (view === 'publishing') return <Publishing data={data} />;
  return <GroundedAi projectId={projectId} />;
}
