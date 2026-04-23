import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Home,
  ChevronLeft,
  ChevronRight,
  Feather,
  Settings2,
  Download,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useProject } from '@/hooks/useProjects';
import { getEnginesByIds } from '@/engines';

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
  const activeTab = tab || (engines.length > 0 ? engines[0].id : '');

  const handleExport = async () => {
    if (!projectId) return;
    try {
      const { exportProjectData } = await import('@/db/operations');
      const data = await exportProjectData(projectId);
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project?.title || 'project'}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
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

        {/* Dynamic engine list — only when inside a project */}
        {projectId && engines.length > 0 && (
          <>
            <div className="pt-3 pb-1 px-3">
              {sidebarOpen && (
                <span className="text-xs font-semibold text-text-dim uppercase tracking-wider">
                  {t('sidebar.project')}
                </span>
              )}
              {!sidebarOpen && <div className="border-t border-border" />}
            </div>
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
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-muted hover:text-text-primary hover:bg-elevated transition"
            title={t('project.exportProject')}
          >
            <Download size={18} className="flex-shrink-0" />
            {sidebarOpen && <span className="whitespace-nowrap">{t('project.export')}</span>}
          </button>
        </div>
      )}

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="flex items-center justify-center py-3 border-t border-border text-text-muted hover:text-text-primary transition"
      >
        {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </button>
    </motion.aside>
  );
}
