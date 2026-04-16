import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useProject } from '@/hooks/useProjects';
import { getEnginesByIds } from '@/engines';
import TopBar from '@/components/layout/TopBar';
import EngineManager from '@/components/project/EngineManager';
import { updateProject } from '@/db/operations';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppStore } from '@/stores/appStore';

export default function ProjectDetail() {
  const { t } = useTranslation();
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const { project, loading, refresh } = useProject(id);
  const { showEngineManager, setShowEngineManager } = useAppStore();

  // Get enabled engines from project — deduplicate to heal any corrupt data
  const rawOrder = project?.engineOrder || project?.enabledEngines || [];
  const rawEnabled = project?.enabledEngines || [];
  const engineIds = [...new Set(rawOrder)];
  const engines = getEnginesByIds(engineIds);

  // Auto-heal: if duplicates detected in DB, clean them up silently
  useEffect(() => {
    if (!project || !id) return;
    const hasDuplicateOrder = rawOrder.length !== new Set(rawOrder).size;
    const hasDuplicateEnabled = rawEnabled.length !== new Set(rawEnabled).size;
    if (hasDuplicateOrder || hasDuplicateEnabled) {
      updateProject(id, {
        enabledEngines: [...new Set(rawEnabled)],
        engineOrder: [...new Set(rawOrder)],
      }).then(() => refresh());
    }
  }, [project, id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redirect to first engine if no tab in URL
  useEffect(() => {
    if (id && engines.length > 0 && !tab) {
      navigate(`/project/${id}/${engines[0].id}`, { replace: true });
    }
  }, [id, engines, tab, navigate]);

  // Active engine is fully URL-driven
  const activeEngine = engines.find((e) => e.id === tab);

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
        {/* Engine content — no more tab bar */}
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
            await refresh();
            setShowEngineManager(false);
          }
        }}
      />
    </>
  );
}
