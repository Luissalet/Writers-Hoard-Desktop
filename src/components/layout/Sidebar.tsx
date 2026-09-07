import { useState } from 'react';
import { NavLink, useParams } from 'react-router-dom';
import {
  Home,
  ChevronLeft,
  ChevronRight,
  Feather,
  Settings2,
  Download,
  StickyNote,
  LayoutDashboard,
  Bot,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useProject } from '@/hooks/useProjects';
import { getEngine, getEnginesByIds } from '@/engines';
import { useInboxNoteCount } from '@/engines/notes/hooks';
import { isDesktop } from '@/utils/platform';
import { toast } from '@/components/common/toast';

export default function Sidebar() {
  const { t } = useTranslation();
  const { sidebarOpen, toggleSidebar, setShowEngineManager } = useAppStore();
  const { id: projectId } = useParams<{ id?: string }>();

  // Fetch project data to get dynamic engine list
  const { project } = useProject(projectId);

  const rawOrder = project?.engineOrder || project?.enabledEngines || [];
  const enabled = new Set(project?.enabledEngines ?? []);
  const engineIds = [...new Set([...rawOrder, ...enabled])].filter(id => enabled.has(id) && getEngine(id));
  const engines = getEnginesByIds(engineIds);

  const desktop = isDesktop();
  const inboxCount = useInboxNoteCount();
  const [exporting, setExporting] = useState(false);

  const navClass = (active: boolean, strong = false) =>
    `w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm ${
      active
        ? `bg-accent-gold/15 text-accent-gold${strong ? ' font-semibold' : ''}`
        : 'text-text-muted hover:text-text-primary hover:bg-elevated'
    }`;

  const handleExport = async () => {
    if (!projectId || exporting) return;
    setExporting(true);
    try {
      // ZIP export covers EVERY engine's tables via the backup registry —
      // the old JSON export silently dropped everything added after the
      // original 13-table schema.
      const { exportProjectZip } = await import('@/services/zipBackup');
      await exportProjectZip(projectId);
      toast.success(t('project.exportDone'));
    } catch (error) {
      console.error('Export failed:', error);
      const { describeBackupError } = await import('@/services/zipBackup');
      toast.error(describeBackupError(error, t('project.exportError')), 10000);
    } finally {
      setExporting(false);
    }
  };

  return (
    <aside
      className={`app-sidebar h-full shrink-0 bg-surface border-r border-border flex flex-col overflow-hidden transition-[width] duration-200 ${sidebarOpen ? 'w-[220px]' : 'w-[60px]'}`}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-accent-gold/20 flex items-center justify-center flex-shrink-0">
          <Feather size={18} className="text-accent-gold" />
        </div>
        {sidebarOpen && (
          <span
            className="font-serif font-bold text-accent-gold text-sm whitespace-nowrap"
          >
            {t('sidebar.brand')}
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {/* Home */}
        <NavLink
          to="/"
          end
          className={({ isActive }) => navClass(isActive)}
          title={t('sidebar.home')}
          aria-label={t('sidebar.home')}
        >
          <Home size={18} className="flex-shrink-0" aria-hidden="true" />
          {sidebarOpen && <span className="whitespace-nowrap">{t('sidebar.home')}</span>}
        </NavLink>

        {/* Notes inbox — project-less quick captures, always reachable. */}
        <NavLink
          to="/notes"
          className={({ isActive }) => navClass(isActive)}
          title={t('sidebar.notes')}
          aria-label={t('sidebar.notes')}
        >
          <StickyNote size={18} className="flex-shrink-0" aria-hidden="true" />
          {sidebarOpen && (
            <>
              <span className="whitespace-nowrap">{t('sidebar.notes')}</span>
              {inboxCount > 0 && (
                <span className="ml-auto px-1.5 py-0.5 rounded-full bg-accent-gold/20 text-accent-gold text-[10px] font-semibold">
                  {inboxCount}
                </span>
              )}
            </>
          )}
        </NavLink>

        {/* Media Downloader — desktop only (bundled yt-dlp backend). */}
        {desktop && (
          <NavLink
            to="/media-downloader"
            className={({ isActive }) => navClass(isActive)}
            title={t('sidebar.mediaDownloader')}
            aria-label={t('sidebar.mediaDownloader')}
          >
            <Download size={18} className="flex-shrink-0" aria-hidden="true" />
            {sidebarOpen && (
              <span className="whitespace-nowrap">{t('sidebar.mediaDownloader')}</span>
            )}
          </NavLink>
        )}

        {/* AI settings — connections by IP, local models, copilot defaults. */}
        <NavLink
          to="/settings/ai"
          className={({ isActive }) => navClass(isActive)}
          title={t('sidebar.aiSettings')}
          aria-label={t('sidebar.aiSettings')}
        >
          <Bot size={18} className="flex-shrink-0" aria-hidden="true" />
          {sidebarOpen && <span className="whitespace-nowrap">{t('sidebar.aiSettings')}</span>}
        </NavLink>

        {/* Dynamic engine list — only when inside a project */}
        {projectId && (
          <>
            <div className="pt-3 pb-1 px-3">
              {sidebarOpen && (
                <span className="block truncate text-xs font-semibold text-text-dim" title={project?.title}>
                  {project?.title ?? t('sidebar.project')}
                </span>
              )}
              {!sidebarOpen && <div className="border-t border-border" />}
            </div>
            <NavLink
              to={`/project/${projectId}/overview`}
              className={({ isActive }) => navClass(isActive, true)}
              title={t('sidebar.overview')}
              aria-label={t('sidebar.overview')}
            >
              <LayoutDashboard size={18} className="flex-shrink-0" aria-hidden="true" />
              {sidebarOpen && <span className="whitespace-nowrap">{t('sidebar.overview')}</span>}
            </NavLink>
            {engines.map((engine) => {
              const Icon = engine.icon;
              const Badge = engine.SidebarBadge;
              return (
                <NavLink
                  key={engine.id}
                  to={`/project/${projectId}/${engine.id}`}
                  className={({ isActive }) => navClass(isActive, true)}
                  title={t(`engines.${engine.id}.name`)}
                  aria-label={t(`engines.${engine.id}.name`)}
                >
                  <Icon size={18} className="flex-shrink-0" aria-hidden="true" />
                  {sidebarOpen && (
                    <>
                      <span className="whitespace-nowrap">{t(`engines.${engine.id}.name`)}</span>
                      {Badge && projectId && <Badge projectId={projectId} />}
                    </>
                  )}
                </NavLink>
              );
            })}
          </>
        )}
      </nav>

      {/* Bottom actions — only when inside a project */}
      {projectId && (
        <div className="px-2 py-2 border-t border-border space-y-1">
          <button
            type="button"
            onClick={() => setShowEngineManager(true)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-muted hover:text-text-primary hover:bg-elevated transition"
            title={t('project.manageEngines')}
          >
            <Settings2 size={18} className="flex-shrink-0" />
            {sidebarOpen && <span className="whitespace-nowrap">{t('project.manageEngines')}</span>}
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-muted hover:text-text-primary hover:bg-elevated transition"
            title={t('project.exportProject')}
          >
            <Download size={18} className="flex-shrink-0" />
            {sidebarOpen && (
              <span className="whitespace-nowrap">
                {exporting ? t('project.exporting') : t('project.export')}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={toggleSidebar}
        className="flex items-center justify-center py-3 border-t border-border text-text-muted hover:text-text-primary transition"
        title={sidebarOpen ? t('common.collapse') : t('common.expand')}
        aria-label={sidebarOpen ? t('common.collapse') : t('common.expand')}
      >
        {sidebarOpen ? <ChevronLeft size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
      </button>
    </aside>
  );
}
