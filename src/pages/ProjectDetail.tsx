import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Download, Settings2 } from 'lucide-react';
import { useProject } from '@/hooks/useProjects';
import { getEnginesByIds } from '@/engines';
import TopBar from '@/components/layout/TopBar';
import EngineManager from '@/components/project/EngineManager';
import { updateProject } from '@/db/operations';
import { useTranslation } from '@/i18n/useTranslation';

export default function ProjectDetail() {
  const { t } = useTranslation();
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const { project, loading } = useProject(id);
  const [showEngineManager, setShowEngineManager] = useState(false);

  // Get enabled engines from project
  const engines = project
    ? getEnginesByIds(project.engineOrder || project.enabledEngines || [])
    : [];

  // Active tab state
  const [activeEngineId, setActiveEngineId] = useState<string>('');

  // Set initial active engine from URL or first engine
  useEffect(() => {
    if (engines.length > 0 && !activeEngineId) {
      setActiveEngineId(tab || engines[0].id);
    }
  }, [engines, activeEngineId, tab]);

  const activeEngine = engines.find((e) => e.id === activeEngineId);

  const handleExport = async () => {
    if (!id) return;
    try {
      // Dynamically import to avoid issues in non-browser contexts
      const { exportProjectData } = await import('@/db/operations');
      const data = await exportProjectData(id);
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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-text-muted">{t('project.notFound')}</p>
      </div>
    );
  }

  return (
    <>
      <TopBar
        title={project.title}
        subtitle={`${project.type} · ${project.status}`}
      />

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Tab bar */}
        <div className="flex items-center gap-1 px-6 py-2 border-b border-border bg-surface/50 overflow-x-auto flex-shrink-0">
          {engines.map((engine) => {
            const Icon = engine.icon;
            return (
              <button
                key={engine.id}
                onClick={() => setActiveEngineId(engine.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm whitespace-nowrap transition ${
                  activeEngineId === engine.id
                    ? 'bg-accent-gold/15 text-accent-gold font-semibold'
                    : 'text-text-muted hover:text-text-primary hover:bg-elevated'
                }`}
              >
                <Icon size={16} />
                {engine.name}
              </button>
            );
          })}

          <div className="flex-1" />

          {/* Engine Manager button */}
          <button
            onClick={() => setShowEngineManager(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted hover:text-text-primary transition"
            title={t('project.manageEngines')}
          >
            <Settings2 size={14} />
          </button>

          {/* Export button */}
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted hover:text-text-primary transition"
            title={t('project.exportProject')}
          >
            <Download size={14} />
            {t('project.export')}
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeEngine ? (
            <activeEngine.component projectId={id!} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-text-muted">{t('project.noEngines')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Engine Manager Modal */}
      <EngineManager
        open={showEngineManager}
        onClose={() => setShowEngineManager(false)}
        project={project}
        onUpdate={async (enabledEngines, engineOrder) => {
          if (id) {
            await updateProject(id, {
              enabledEngines,
              engineOrder,
            });
            setShowEngineManager(false);
          }
        }}
      />
    </>
  );
}
