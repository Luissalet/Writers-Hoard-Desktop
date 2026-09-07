import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Feather,
  Upload,
  Download,
  Database,
  Clock,
  ShieldAlert,
  FolderOpen,
  Settings2,
  Search,
} from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import ReadErrorNotice from '@/components/common/ReadErrorNotice';
import ProjectCard from '@/components/bubbles/ProjectCard';
import EmptyState from '@/components/common/EmptyState';
import { StoragePersistenceWarning } from '@/components/common/StorageStatus';
import TopBar from '@/components/layout/TopBar';
import CreateProjectModal from '@/components/dashboard/CreateProjectModal';
import ImportCollisionDialog from '@/components/dashboard/ImportCollisionDialog';
import { importProjectData, importFullDatabase } from '@/db/operations';
import {
  describeBackupError,
  exportFullZip,
  importFullZip,
  importProjectZip,
  previewProjectZipImport,
  type ProjectZipImportPreview,
} from '@/services/zipBackup';
import { cleanupProjectMedia } from '@/services/scrapperMedia';
import { archiveProjectBeforeDelete } from '@/services/deleteSafetyNet';
import {
  backUpNow,
  openBackupFolder,
  setAutomaticBackupCopies,
  setAutomaticBackupEnabled,
  setAutomaticBackupInterval,
  subscribeBackupStatus,
  type BackupFailure,
  type BackupFailureCode,
  type BackupStatus,
} from '@/services/autoBackup';
import {
  forgetProjectRoute,
  loadAllProjectProgress,
  localDaysSince,
  readProjectRoute,
  rememberProjectRoute,
  type ProjectProgress,
  type ProjectResume,
} from '@/services/projectIntelligence';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';
import { getAnchorAdapter } from '@/engines/_shared/anchoring';
import type { Project } from '@/types';
import { getEngine } from '@/engines';

/** The chapter a card's "Continue" would open, and what to call the button. */
interface ResumeTarget {
  engineId: string;
  entityId?: string;
  title: string;
}

/** What the backup settings offer. A stored value outside the list is kept. */
const BACKUP_INTERVAL_CHOICES = [1, 3, 7, 14, 30];
const BACKUP_COPY_CHOICES = [1, 2, 3, 5, 10];

/**
 * The offered values plus whatever is stored, so a setting restored from an
 * older archive still shows itself instead of rendering an empty select.
 */
function withCurrentChoice(choices: readonly number[], current: number): number[] {
  return Array.from(new Set([...choices, current])).sort((left, right) => left - right);
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { projects, loading, error, addProject, editProject, removeProject, refresh } = useProjects();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const filteredProjects = projects.filter(project =>
    `${project.title} ${project.description}`.toLocaleLowerCase().includes(projectQuery.trim().toLocaleLowerCase()),
  );
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const fullImportRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  // Stash the picked file until the user explicitly confirms the destructive
  // full-database restore. We deliberately do NOT use native `window.confirm()`
  // here — it can auto-resolve to `true` after tab suspend/resume on some
  // browser/OS combos, which has caused real data loss. See tasks/lessons.md.
  const [pendingFullImportFile, setPendingFullImportFile] = useState<File | null>(null);
  // Same React-owned confirmation for project deletion — a single hover-click
  // must never wipe a whole project.
  const [pendingDeleteProject, setPendingDeleteProject] = useState<Project | null>(null);
  const [pendingProjectImport, setPendingProjectImport] = useState<{
    file: File;
    preview: ProjectZipImportPreview;
  } | null>(null);
  // The backup line. On the desktop this is the real thing: the app writes an
  // archive into its own data folder on a schedule, and this reports what it
  // actually did — including when it could not. On the web build there is no
  // door to the disk, so the same line falls back to the manual export.
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [backupSettingsOpen, setBackupSettingsOpen] = useState(false);
  const [pendingDisableAutoBackup, setPendingDisableAutoBackup] = useState(false);
  const backupBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeBackupStatus(setBackup), []);

  // A panel that cannot be dismissed is a trap. Escape and any click outside
  // close it, which is what every other menu in the app does.
  useEffect(() => {
    if (!backupSettingsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!backupBoxRef.current?.contains(event.target as Node)) setBackupSettingsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBackupSettingsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [backupSettingsOpen]);

  // Word totals, last-edited stamps and whatever each project was last left on.
  // ONE query for the whole grid — reading it per card meant twenty round trips
  // to draw twenty numbers — refreshed whenever the project list itself is.
  const [progress, setProgress] = useState<Map<string, ProjectProgress>>(() => new Map());
  const [resumeRoutes, setResumeRoutes] = useState<Map<string, ProjectResume>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    const remembered = new Map<string, ProjectResume>();
    for (const project of projects) {
      const route = readProjectRoute(project.id);
      if (route) remembered.set(project.id, route);
    }
    setResumeRoutes(remembered);
    loadAllProjectProgress()
      .then((rows) => {
        if (!cancelled) setProgress(rows);
      })
      .catch((err) => console.error('[dashboard] project progress failed', err));
    return () => {
      cancelled = true;
    };
  }, [projects]);

  /**
   * The chapter "Continue" opens for a project.
   *
   * The remembered chapter wins — it is where the writer actually was — but
   * only while it still exists: one deleted since has no title to show and
   * falls through to the most recently edited chapter, which is also the best
   * answer available before anything has been remembered at all. Titles come
   * from the row and never from the stored route, so renaming a chapter renames
   * the button with it.
   */
  const resumeTargetFor = (project: Project): ResumeTarget | null => {
    const stats = progress.get(project.id);
    const remembered = resumeRoutes.get(project.id);
    // Concept work is a resume target too, regardless of manuscript edits.
    if (remembered && remembered.engineId !== 'writings' &&
      project.enabledEngines.includes(remembered.engineId) && getEngine(remembered.engineId)) {
      return { engineId: remembered.engineId, entityId: remembered.entityId, title: t(`engines.${remembered.engineId}.name`) };
    }
    if (!project.enabledEngines.includes('writings')) return null;
    const rememberedId = remembered?.engineId === 'writings' ? remembered.entityId : undefined;
    const rememberedTitle = rememberedId ? stats?.writingTitles.get(rememberedId) : undefined;
    // A remembered route that predates the newest edit is stale: the writer has
    // been working somewhere the route never saw (an AI write, a Docs sync, an
    // import). Prefer what the manuscript itself says.
    const staleRoute = (stats?.lastWrittenAt ?? 0) > (remembered?.savedAt ?? 0);
    if (rememberedId && rememberedTitle && !staleRoute) {
      return { engineId: 'writings', entityId: rememberedId, title: rememberedTitle };
    }
    const newestId = stats?.lastWritingId ?? undefined;
    const newestTitle = newestId ? stats?.writingTitles.get(newestId) : undefined;
    if (newestId && newestTitle) return { engineId: 'writings', entityId: newestId, title: newestTitle };
    return null;
  };

  const openResume = (project: Project, target: ResumeTarget) => {
    rememberProjectRoute(project.id, { engineId: target.engineId, entityId: target.entityId });
    // The same jump global search and annotation backlinks make.
    const adapter = getAnchorAdapter(target.engineId);
    if (adapter && target.entityId) adapter.navigateToEntity(target.entityId, project.id);
    else {
      navigate(
        `/project/${encodeURIComponent(project.id)}/${encodeURIComponent(target.engineId)}`,
      );
    }
  };

  /**
   * Why the last automatic attempt produced nothing. Written as a switch over
   * literal keys on purpose: a composed `t(`...${code}`)` cannot be checked by
   * the conformance gate, and an unresolved key renders as its own name.
   */
  const backupFailureLabel = (code: BackupFailureCode): string => {
    switch (code) {
      case 'unsupported':
        return t('dashboard.autoBackup.failed.unsupported');
      case 'insufficient-space':
        return t('dashboard.autoBackup.failed.space');
      default:
        return t('dashboard.autoBackup.failed.generic');
    }
  };

  /**
   * The line under a failure. The disk shortfall is phrased here, in the
   * writer's language, from the numbers the service recorded; anything else is
   * the failing layer's own message and can only be passed through.
   */
  const backupFailureDetail = (failure: BackupFailure): string => {
    if (failure.code !== 'insufficient-space') return failure.detail ?? '';
    if (typeof failure.freeBytes !== 'number' || typeof failure.requiredBytes !== 'number') {
      return '';
    }
    const megabytes = (bytes: number): string =>
      String(Math.max(1, Math.round(bytes / (1024 * 1024))));
    return t('dashboard.autoBackup.failed.spaceDetail')
      .replace('{free}', megabytes(failure.freeBytes))
      .replace('{needed}', megabytes(failure.requiredBytes));
  };

  /**
   * What the line says, and it only ever says what the app can actually know:
   * an archive it wrote and saw land. A download it handed to the browser is
   * not one of those — the save dialog comes after `saveAs` returns and a
   * Cancel there is invisible from here — so a build with no write door reports
   * that it cannot verify backups rather than counting days since a file that
   * may never have been written.
   */
  const backupAgeLabel = (state: BackupStatus): string => {
    if (state.unavailable) return t('dashboard.backupAge.unavailable');
    if (state.running) return t('dashboard.autoBackup.running');
    if (state.failure) return backupFailureLabel(state.failure.code);
    if (!state.supported) return t('dashboard.backupAge.unverifiable');
    if (!state.automaticEnabled) return t('dashboard.autoBackup.off');
    if (state.lastBackupAt === null) return t('dashboard.backupAge.neverVerified');
    if (state.lastWasAutomatic) {
      if (state.daysSince === 0) return t('dashboard.autoBackup.age.today');
      if (state.daysSince === 1) return t('dashboard.autoBackup.age.yesterday');
      return t('dashboard.autoBackup.age.days').replace('{days}', String(state.daysSince));
    }
    if (state.daysSince === 0) return t('dashboard.backupAge.today');
    if (state.daysSince === 1) return t('dashboard.backupAge.yesterday');
    return t('dashboard.backupAge.days').replace('{days}', String(state.daysSince));
  };

  const backupIntervalLabel = (days: number): string =>
    days === 1
      ? t('dashboard.autoBackup.settings.everyDay')
      : t('dashboard.autoBackup.settings.everyDays').replace('{days}', String(days));

  const backupCopiesLabel = (count: number): string =>
    count === 1
      ? t('dashboard.autoBackup.settings.oneCopy')
      : t('dashboard.autoBackup.settings.copiesCount').replace('{count}', String(count));

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      if (file.name.endsWith('.zip')) {
        // New format: single-project ZIP (merge/restore — no DB wipe)
        const preview = await previewProjectZipImport(file);
        if (preview.collisions.length > 0) {
          setPendingProjectImport({ file, preview });
          return;
        }
        const ids = await importProjectZip(file);
        await refresh();
        toast.success(t('dashboard.import.success'));
        if (ids.length === 1) navigate(`/project/${ids[0]}`);
      } else {
        // Legacy format: 13-table project JSON
        const text = await file.text();
        const data = JSON.parse(text);
        const newId = await importProjectData(data);
        await refresh();
        toast.success(t('dashboard.import.success'));
        navigate(`/project/${newId}`);
      }
    } catch (err) {
      console.error('Import failed:', err);
      toast.error(describeBackupError(err, t('dashboard.import.error')), 10000);
    } finally {
      setImporting(false);
      if (importRef.current) importRef.current.value = '';
    }
  };

  const cancelProjectImport = () => {
    if (importing) return;
    setPendingProjectImport(null);
  };

  const runProjectImportReplace = async () => {
    const pending = pendingProjectImport;
    if (!pending) return;
    setImporting(true);
    try {
      const ids = await importProjectZip(pending.file, {
        replaceProjectIds: pending.preview.collisions.map(
          (collision) => collision.projectId,
        ),
      });
      await refresh();
      setPendingProjectImport(null);
      toast.success(t('dashboard.import.success'));
      if (ids.length === 1) navigate(`/project/${ids[0]}`);
    } catch (err) {
      console.error('Project replacement import failed:', err);
      toast.error(describeBackupError(err, t('dashboard.import.error')), 10000);
    } finally {
      setImporting(false);
    }
  };

  /**
   * The "Full Backup" button: build the archive and hand it to the browser as a
   * download, which is what the writer asked for — a file of their own, where
   * they choose to put it.
   *
   * Nothing is stamped here, and the toast says only what happened. `saveAs`
   * starts a download; the shell's save dialog comes after it, and a Cancel
   * there leaves no file and no signal this side can read. A completed backup
   * is recorded only from a write the app watched land — the verified archive
   * behind the reminder line and the scheduler (src/services/autoBackup.ts).
   */
  const handleFullExport = async () => {
    setExporting(true);
    try {
      await exportFullZip();
      toast.success(t('dashboard.fullExport.started'));
    } catch (err) {
      console.error('Full export failed:', err);
      toast.error(describeBackupError(err, t('dashboard.export.error')), 10000);
    } finally {
      setExporting(false);
    }
  };

  /**
   * The backup line's one click. On the desktop it produces the same archive
   * the scheduler produces and writes it into the app's own data folder — a
   * write that reports back, and the only thing that can turn this line green.
   * On the web build, where nothing reaches the disk without a dialog nobody
   * here can watch, it falls back to the manual export that has always been
   * there, and the line goes on saying it cannot verify the result.
   */
  const runBackupNow = async () => {
    if (!backup || backup.running) return;
    if (!backup.supported) {
      await handleFullExport();
      return;
    }
    const next = await backUpNow();
    if (next.unavailable) toast.error(t('dashboard.autoBackup.failed.generic'), 10000);
    else if (next.failure) toast.error(backupFailureLabel(next.failure.code), 10000);
    else toast.success(t('dashboard.autoBackup.done'));
  };

  const revealBackupFolder = async () => {
    if (!(await openBackupFolder())) toast.error(t('dashboard.autoBackup.openFolder.error'));
  };

  const changeAutomaticBackup = (enabled: boolean) => {
    // Switching the safety net off is the one setting here worth confirming.
    if (!enabled) {
      setPendingDisableAutoBackup(true);
      return;
    }
    void setAutomaticBackupEnabled(true);
  };

  const confirmDisableAutomaticBackup = async () => {
    setPendingDisableAutoBackup(false);
    await setAutomaticBackupEnabled(false);
  };

  const handleFullImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Stash the file and open the React-owned confirmation dialog. The actual
    // restore runs in `runFullImport` only after the user clicks the confirm
    // button explicitly.
    setPendingFullImportFile(file);
  };

  const cancelFullImport = () => {
    setPendingFullImportFile(null);
    if (fullImportRef.current) fullImportRef.current.value = '';
  };

  const runFullImport = async () => {
    const file = pendingFullImportFile;
    setPendingFullImportFile(null);
    if (!file) {
      if (fullImportRef.current) fullImportRef.current.value = '';
      return;
    }
    setImporting(true);
    try {
      if (file.name.endsWith('.zip')) {
        // Structured ZIP backup
        await importFullZip(file);
        await refresh();
        window.location.reload();
      } else if (file.name.endsWith('.json')) {
        // Legacy JSON backup
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.fullExport) {
          await importFullDatabase(data);
          await refresh();
          window.location.reload();
        } else {
          const newId = await importProjectData(data);
          await refresh();
          navigate(`/project/${newId}`);
        }
      } else {
        toast.error(t('dashboard.unsupportedFormat'));
      }
    } catch (err) {
      console.error('Full import failed:', err);
      toast.error(describeBackupError(err, t('dashboard.import.fullError')), 10000);
    } finally {
      setImporting(false);
      if (fullImportRef.current) fullImportRef.current.value = '';
    }
  };

  const runDeleteProject = async () => {
    const project = pendingDeleteProject;
    setPendingDeleteProject(null);
    if (!project) return;
    try {
      // The copy is written BEFORE anything is destroyed, and the delete goes
      // ahead either way — the writer asked for it. What changes is which of
      // the two sentences they are told, because a writer who believes a copy
      // exists when it does not is worse off than one who knows it does not.
      const archived = await archiveProjectBeforeDelete(project.id);
      if (!archived.saved) {
        console.warn('[delete] no farewell copy was written', archived.error);
      }
      // Best-effort: wipe the project's downloaded media library (desktop).
      await cleanupProjectMedia(project.id);
      await removeProject(project.id);
      forgetProjectRoute(project.id);
      if (archived.saved) {
        toast.success(
          t('dashboard.deleteProject.doneWithCopy').replace('{name}', project.title),
          8000,
        );
      } else {
        toast.success(t('dashboard.deleteProject.done').replace('{name}', project.title));
      }
    } catch (err) {
      console.error('Project delete failed:', err);
      toast.error(t('dashboard.deleteProject.error'));
    }
  };

  const handleCreate = async (project: Project) => {
    await addProject(project);
    // Essentials mode goes straight into the writings engine — the whole
    // point of the preset is "start writing immediately, no extra clicks".
    // Other modes land on the project detail page so users can browse tabs.
    if (project.mode === 'essentials') {
      navigate(`/project/${project.id}/writings`);
    } else {
      navigate(`/project/${project.id}`);
    }
  };

  return (
    <>
      <TopBar title={t('sidebar.home')} />
      <div className="flex-1 overflow-y-auto p-4 lg:p-8">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-5 mb-8">
          <div>
            <h2 className="text-3xl font-serif font-semibold text-text-primary">{t('dashboard.projects')}</h2>
            <p className="mt-2 text-sm text-text-muted">{t('creative.libraryHint')}</p>
            <p className="text-text-muted mt-1">
              {projects.length} {projects.length === 1 ? t('dashboard.worldCount.singular') : t('dashboard.worldCount.plural')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input ref={importRef} type="file" accept=".json,.zip" className="hidden" onChange={handleImport} />
            <input ref={fullImportRef} type="file" accept=".zip,.json" className="hidden" onChange={handleFullImport} />

            {/* What the automatic backup actually did. Amber once it is due,
                red when the last attempt failed — and the label is the button
                that runs one now. */}
            {backup && projects.length > 0 && (
              <div ref={backupBoxRef} className="relative flex items-center">
                <button
                  type="button"
                  onClick={runBackupNow}
                  disabled={exporting || backup.running}
                  className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition disabled:opacity-60 ${
                    backup.failure
                      ? 'text-danger hover:bg-danger/10'
                      : backup.overdue
                        ? 'text-warning hover:bg-warning/10'
                        : 'text-text-dim hover:bg-elevated hover:text-text-primary'
                  }`}
                  title={
                    (backup.failure && backupFailureDetail(backup.failure)) ||
                    t('dashboard.autoBackup.action')
                  }
                >
                  {backup.failure || backup.overdue ? <ShieldAlert size={13} /> : <Clock size={13} />}
                  {backupAgeLabel(backup)}
                </button>

                {backup.supported && (
                  <>
                    <button
                      type="button"
                      onClick={revealBackupFolder}
                      className="rounded-lg p-1.5 text-text-dim transition hover:bg-elevated hover:text-text-primary"
                      title={t('dashboard.autoBackup.openFolder')}
                      aria-label={t('dashboard.autoBackup.openFolder')}
                    >
                      <FolderOpen size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setBackupSettingsOpen(open => !open)}
                      aria-expanded={backupSettingsOpen}
                      className="rounded-lg p-1.5 text-text-dim transition hover:bg-elevated hover:text-text-primary"
                      title={t('dashboard.autoBackup.settings.title')}
                      aria-label={t('dashboard.autoBackup.settings.title')}
                    >
                      <Settings2 size={13} />
                    </button>
                  </>
                )}

                {backup.supported && backupSettingsOpen && (
                  <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border border-border bg-surface p-4 text-left shadow-lg">
                    <p className="mb-3 text-xs font-semibold text-text-primary">
                      {t('dashboard.autoBackup.settings.title')}
                    </p>

                    <label className="flex cursor-pointer items-center justify-between gap-3 text-xs text-text-muted">
                      {t('dashboard.autoBackup.settings.enabled')}
                      <input
                        type="checkbox"
                        checked={backup.automaticEnabled}
                        onChange={event => changeAutomaticBackup(event.target.checked)}
                        className="h-4 w-4 accent-accent-gold"
                      />
                    </label>

                    <label className="mt-3 flex items-center justify-between gap-3 text-xs text-text-muted">
                      {t('dashboard.autoBackup.settings.interval')}
                      <select
                        value={backup.intervalDays}
                        disabled={!backup.automaticEnabled}
                        onChange={event =>
                          void setAutomaticBackupInterval(Number(event.target.value))
                        }
                        className="rounded-lg border border-border bg-elevated px-2 py-1 text-xs text-text-primary disabled:opacity-50"
                      >
                        {withCurrentChoice(BACKUP_INTERVAL_CHOICES, backup.intervalDays).map(days => (
                          <option key={days} value={days}>
                            {backupIntervalLabel(days)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="mt-3 flex items-center justify-between gap-3 text-xs text-text-muted">
                      {t('dashboard.autoBackup.settings.copies')}
                      <select
                        value={backup.copies}
                        onChange={event => void setAutomaticBackupCopies(Number(event.target.value))}
                        className="rounded-lg border border-border bg-elevated px-2 py-1 text-xs text-text-primary"
                      >
                        {withCurrentChoice(BACKUP_COPY_CHOICES, backup.copies).map(count => (
                          <option key={count} value={count}>
                            {backupCopiesLabel(count)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <p className="mt-3 text-[11px] leading-relaxed text-text-dim">
                      {t('dashboard.autoBackup.settings.explain')}
                    </p>

                    {backup.lastArchivePath && (
                      <p
                        className="mt-2 break-all text-[11px] text-text-dim"
                        title={backup.lastArchivePath}
                      >
                        {t('dashboard.autoBackup.settings.lastArchive')} {backup.lastArchivePath}
                      </p>
                    )}
                    {backup.failure && backupFailureDetail(backup.failure) && (
                      <p className="mt-2 break-words text-[11px] text-danger">
                        {backupFailureDetail(backup.failure)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Full backup controls */}
            <button
              onClick={handleFullExport}
              disabled={exporting}
              className="flex items-center gap-2 px-3 py-2.5 border border-accent-plum/30 text-accent-plum-light rounded-xl hover:bg-accent-plum/10 transition text-sm"
              title={t('dashboard.fullExport.title')}
            >
              <Database size={14} />
              <Download size={14} />
              {exporting ? t('dashboard.fullExport.exporting') : t('dashboard.fullExport.button')}
            </button>
            <button
              onClick={() => fullImportRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-2 px-3 py-2.5 border border-accent-plum/30 text-accent-plum-light rounded-xl hover:bg-accent-plum/10 transition text-sm"
              title={t('dashboard.fullImport.title')}
            >
              <Database size={14} />
              <Upload size={14} />
              {importing ? t('dashboard.fullImport.restoring') : t('dashboard.fullImport.button')}
            </button>

            <div className="w-px h-8 bg-border" />

            <button
              onClick={() => importRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-2 px-4 py-2.5 border border-border text-text-muted rounded-xl hover:text-text-primary hover:bg-elevated transition"
            >
              <Upload size={16} />
              {importing ? t('dashboard.import.importing') : t('dashboard.import.button')}
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:brightness-110 transition"
            >
              <Plus size={18} />
              {t('dashboard.newProject')}
            </button>
          </div>
        </div>

        {/* The browser has not promised to keep any of this. */}
        <StoragePersistenceWarning />

        {error && <ReadErrorNotice onRetry={refresh} retrying={loading} />}
        {projects.length > 0 && <div className="relative mb-5 max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3 top-3 text-text-dim" aria-hidden="true" />
          <input type="search" value={projectQuery} onChange={event => setProjectQuery(event.target.value)} aria-label={t('creative.filter')} placeholder={t('creative.filter')} className="h-10 w-full rounded-lg border border-border bg-surface pl-10 pr-3 text-sm text-text-primary" />
        </div>}

        {/* Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-accent-gold border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error && projects.length === 0 ? null : projects.length === 0 ? (
          <EmptyState
            icon={<Feather size={48} />}
            title={t('dashboard.empty.title')}
            message={t('dashboard.empty.message')}
            action={{ label: t('dashboard.empty.action'), onClick: () => setShowCreate(true) }}
          />
        ) : filteredProjects.length === 0 ? (
          <div className="py-12 text-center text-text-muted"><p>{t('creative.noResults')}</p><button type="button" onClick={() => setProjectQuery('')} className="mt-3 text-accent-gold hover:underline">{t('creative.clearFilter')}</button></div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-5">
            {filteredProjects.map((project, i) => {
              const stats = progress.get(project.id);
              const resume = resumeTargetFor(project);
              return (
                <ProjectCard
                  key={project.id}
                  project={project}
                  index={i}
                  onClick={() => navigate(`/project/${project.id}`)}
                  onDelete={() => setPendingDeleteProject(project)}
                  onColorChange={(color) => editProject(project.id, { color })}
                  onIconChange={(icon) => editProject(project.id, { icon: icon || undefined })}
                  totalWords={stats?.totalWords ?? 0}
                  daysSinceEdit={
                    stats?.lastWrittenAt != null ? localDaysSince(stats.lastWrittenAt) : null
                  }
                  resumeLabel={resume?.title}
                  onResume={resume ? () => openResume(project, resume) : undefined}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Create Modal */}
      <CreateProjectModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={handleCreate}
      />

      <ConfirmDialog
        open={pendingFullImportFile !== null}
        destructive
        message={t('dashboard.fullImport.confirm')}
        onConfirm={runFullImport}
        onCancel={cancelFullImport}
      />

      <ConfirmDialog
        open={pendingDisableAutoBackup}
        destructive
        title={t('dashboard.autoBackup.disable.title')}
        message={t('dashboard.autoBackup.disable.message')}
        confirmLabel={t('dashboard.autoBackup.disable.confirm')}
        onConfirm={confirmDisableAutomaticBackup}
        onCancel={() => setPendingDisableAutoBackup(false)}
      />

      <ConfirmDialog
        open={pendingDeleteProject !== null}
        destructive
        message={t('dashboard.deleteProject.confirm').replace('{name}', pendingDeleteProject?.title ?? '')}
        onConfirm={runDeleteProject}
        onCancel={() => setPendingDeleteProject(null)}
      />

      <ImportCollisionDialog
        open={pendingProjectImport !== null}
        collisions={pendingProjectImport?.preview.collisions ?? []}
        busy={importing}
        onReplace={runProjectImportReplace}
        onCancel={cancelProjectImport}
      />
    </>
  );
}
