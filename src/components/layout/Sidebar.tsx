import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
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
import { getEnginesByIds } from '@/engines';
import { useInboxNoteCount } from '@/engines/notes/hooks';
import { isDesktop } from '@/utils/platform';
import { toast } from '@/components/common/toast';

export default function Sidebar() {
  const { t } = useTranslation();
  const { sidebarOpen, toggleSidebar, setShowEngineManager } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();
  const { id: projectId, tab } = useParams<{ id?: string; tab?: string }>();

  // Fetch project data to get dynamic engine list
  const { project } = useProject(projectId);

  const rawOrder = project?.engineOrder || project?.enabledEngines || [];
  const engineIds = [...new Set(rawOrder)];
  const engines = getEnginesByIds(engineIds);

  const isHome = location.pathname === '/';
  const isMediaDownloader = location.pathname === '/media-downloader';
  const isNotesInbox = location.pathname === '/notes';
  const isAiSettings = location.pathname === '/settings/ai';
  const desktop = isDesktop();
  const inboxCount = useInboxNoteCount();
  const activeTab = tab || 'overview';
  const [exporting, setExporting] = useState(false);

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
    <motion.aside
      className="h-full bg-surface border-r border-border flex flex-col overflow-hidden"
      animate={{ width: sidebarOpen ? 220 : 60 }}
      transition={{ duration: 0.2 }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-accent-gold/20 flex items-center justify-center flex-shrink-0">
          <Feather size={18} className="text-accent-gold" />
        </div>
        {sidebarOpen && (
          <motion.span
            className="font-serif font-bold text-accent-gold text-sm whitespace-nowrap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
          >
            {t('sidebar.brand')}
          </motion.span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {/* Home */}
        <button
          onClick={() => navigate('/')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition text-sm ${
            isHome
              ? 'bg-accent-gold/15 text-accent-gold'
              : 'text-text-muted hover:text-text-primary hover:bg-elevated'
          }`}
        >
          <Home size={18} className="flex-shrink-0" />
          {sidebarOpen && <span className="whitespace-nowrap">{t('sidebar.home')}</span>}
        </button>

        {/* Notes inbox — project-less quick captures, always reachable. */}
        <button
          onClick={() => navigate('/notes')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition text-sm ${
            isNotesInbox
              ? 'bg-accent-gold/15 text-accent-gold'
              : 'text-text-muted hover:text-text-primary hover:bg-elevated'
          }`}
          title={t('sidebar.notes')}
        >
          <StickyNote size={18} className="flex-shrink-0" />
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
        </button>

        {/* Media Downloader — desktop only (bundled yt-dlp backend). */}
        {desktop && (
          <button
            onClick={() => navigate('/media-downloader')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition text-sm ${
              isMediaDownloader
                ? 'bg-accent-gold/15 text-accent-gold'
                : 'text-text-muted hover:text-text-primary hover:bg-elevated'
            }`}
          >
            <Download size={18} className="flex-shrink-0" />
            {sidebarOpen && (
              <span className="whitespace-nowrap">{t('sidebar.mediaDownloader')}</span>
            )}
          </button>
        )}

        {/* AI settings — connections by IP, local models, copilot defaults. */}
        <button
          onClick={() => navigate('/settings/ai')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition text-sm ${
            isAiSettings
              ? 'bg-accent-gold/15 text-accent-gold'
              : 'text-text-muted hover:text-text-primary hover:bg-elevated'
          }`}
          title={t('sidebar.aiSettings')}
        >
          <Bot size={18} className="flex-shrink-0" />
          {sidebarOpen && <span className="whitespace-nowrap">{t('sidebar.aiSettings')}</span>}
        </button>

        {/* Dynamic engine list — only when inside a project */}
        {projectId && (
          <>
            <div className="pt-3 pb-1 px-3">
              {sidebarOpen && (
                <span className="text-xs font-semibold text-text-dim uppercase tracking-wider">
                  {t('sidebar.project')}
                </span>
              )}
              {!sidebarOpen && <div className="border-t border-border" />}
            </div>
            <button
              onClick={() => navigate(`/project/${projectId}/overview`)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition text-sm ${
                activeTab === 'overview'
                  ? 'bg-accent-gold/15 text-accent-gold font-semibold'
                  : 'text-text-muted hover:text-text-primary hover:bg-elevated'
              }`}
            >
              <LayoutDashboard size={18} className="flex-shrink-0" />
              {sidebarOpen && <span className="whitespace-nowrap">{t('sidebar.overview')}</span>}
            </button>
            {engines.map((engine) => {
              const Icon = engine.icon;
              const isActive = activeTab === engine.id;
              const Badge = engine.SidebarBadge;
              return (
                <button
                  key={engine.id}
                  onClick={() => navigate(`/project/${projectId}/${engine.id}`)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition text-sm ${
                    isActive
                      ? 'bg-accent-gold/15 text-accent-gold font-semibold'
                      : 'text-text-muted hover:text-text-primary hover:bg-elevated'
                  }`}
                >
                  <Icon size={18} className="flex-shrink-0" />
                  {sidebarOpen && (
                    <>
                      <span className="whitespace-nowrap">{t(`engines.${engine.id}.name`)}</span>
                      {Badge && projectId && <Badge projectId={projectId} />}
                    </>
                  )}
                </button>
              );
            })}
          </>
        )}
      </nav>

      {/* Bottom actions — only when inside a project */}
      {projectId && (
        <div className="px-2 py-2 border-t border-border space-y-1">
          <button
            onClick={() => setShowEngineManager(true)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-muted hover:text-text-primary hover:bg-elevated transition"
            title={t('project.manageEngines')}
          >
            <Settings2 size={18} className="flex-shrink-0" />
            {sidebarOpen && <span className="whitespace-nowrap">{t('project.manageEngines')}</span>}
          </button>
          <button
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
        onClick={toggleSidebar}
        className="flex items-center justify-center py-3 border-t border-border text-text-muted hover:text-text-primary transition"
        title={sidebarOpen ? t('common.collapse') : t('common.expand')}
        aria-label={sidebarOpen ? t('common.collapse') : t('common.expand')}
      >
        {sidebarOpen ? <ChevronLeft size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
      </button>
    </motion.aside>
  );
}
