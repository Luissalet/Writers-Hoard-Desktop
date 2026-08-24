import { Suspense, useEffect, useMemo, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useProject } from '@/hooks/useProjects';
import { getEngine, getEnginesByIds } from '@/engines';
import TopBar from '@/components/layout/TopBar';
import EngineManager from '@/components/project/EngineManager';
import EngineErrorBoundary from '@/components/common/EngineErrorBoundary';
import ProjectCockpit from '@/components/project/ProjectCockpit';
import EditProjectModal from '@/components/project/EditProjectModal';
import { updateProject } from '@/db/operations';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppStore } from '@/stores/appStore';

export default function ProjectDetail() {
  const { t } = useTranslation();
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { project, loading, refresh } = useProject(id);
  const { showEngineManager, setShowEngineManager } = useAppStore();
  const [showProjectEditor, setShowProjectEditor] = useState(false);
  const editRequested = tab === 'overview' && searchParams.get('edit') === '1';
  const manageRequested = tab === 'overview' && searchParams.get('manage') === '1';

  const clearCommandParam = (name: 'edit' | 'manage') => {
    const next = new URLSearchParams(searchParams);
    next.delete(name);
    setSearchParams(next, { replace: true });
  };

  const closeProjectEditor = () => {
    setShowProjectEditor(false);
    if (editRequested) clearCommandParam('edit');
  };

  const closeEngineManager = () => {
    setShowEngineManager(false);
    if (manageRequested) clearCommandParam('manage');
  };

  // Get enabled engines from project — deduplicate to heal any corrupt data
  const rawOrder = useMemo(
    () => project?.engineOrder || project?.enabledEngines || [],
    [project],
  );
  const rawEnabled = useMemo(
    () => project?.enabledEngines || [],
    [project],
  );
  const engineIds = useMemo(() => {
    const enabled = [...new Set(rawEnabled)].filter(engineId => Boolean(getEngine(engineId)));
    const enabledSet = new Set(enabled);
    const ordered = [...new Set(rawOrder)].filter(engineId => enabledSet.has(engineId));
    const orderedSet = new Set(ordered);
    return [...ordered, ...enabled.filter(engineId => !orderedSet.has(engineId))];
  }, [rawEnabled, rawOrder]);
  const engines = useMemo(() => getEnginesByIds(engineIds), [engineIds]);

  // Auto-heal: if duplicates detected in DB, clean them up silently
  useEffect(() => {
    if (!project || !id) return;
    const normalizedEnabled = [...new Set(rawEnabled)].filter(engineId => Boolean(getEngine(engineId)));
    const needsRepair =
      JSON.stringify(rawEnabled) !== JSON.stringify(normalizedEnabled) ||
      JSON.stringify(rawOrder) !== JSON.stringify(engineIds);
    if (needsRepair) {
      updateProject(id, {
        enabledEngines: normalizedEnabled,
        engineOrder: engineIds,
      }).then(() => refresh()).catch(error => {
        console.error('Failed to repair project engine preferences', error);
      });
    }
  }, [engineIds, id, project, rawEnabled, rawOrder, refresh]);

  // Never validate a deep engine route against the hook's pre-hydration empty
  // arrays. Doing so turns every cold `/project/:id/:engine` load into a silent
  // redirect to Overview before IndexedDB has returned the project.
  useEffect(() => {
    if (loading || !project || !id) return;
    if (!tab || (tab !== 'overview' && !engineIds.includes(tab))) {
      navigate(`/project/${encodeURIComponent(id)}/overview`, { replace: true });
    }
  }, [id, engineIds, loading, project, tab, navigate]);

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
        subtitle={`${t(`project.type.${project.type}`)} · ${t(`project.status.${project.status}`)}`}
      />

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Engine content — no more tab bar */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'overview' ? (
            <ProjectCockpit
              projectId={id!}
              onManageEngines={() => setShowEngineManager(true)}
              onEditProject={() => setShowProjectEditor(true)}
            />
          ) : activeEngine ? (
            <EngineErrorBoundary
              resetKey={`${id}:${activeEngine.id}`}
              title={t('project.engineError.title')}
              message={t('project.engineError.message')}
              retryLabel={t('project.engineError.retry')}
              detailsLabel={t('project.engineError.details')}
            >
              <Suspense
                fallback={(
                  <div className="flex min-h-[22rem] items-center justify-center">
                    <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-gold border-t-transparent" />
                  </div>
                )}
              >
                <activeEngine.component projectId={id!} />
              </Suspense>
            </EngineErrorBoundary>
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="max-w-sm text-center">
                <p className="text-text-muted">{t('project.noEngines')}</p>
                <button
                  type="button"
                  onClick={() => setShowEngineManager(true)}
                  className="mx-auto mt-4 flex items-center gap-2 rounded-lg bg-accent-gold px-4 py-2 text-sm font-medium text-background transition hover:brightness-110"
                >
                  <Settings2 size={16} />
                  {t('project.manageEngines')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Engine Manager Modal */}
      <EngineManager
        open={showEngineManager || manageRequested}
        onClose={closeEngineManager}
        project={project}
        onUpdate={async (enabledEngines, engineOrder) => {
          if (id) {
            await updateProject(id, {
              enabledEngines,
              engineOrder,
            });
            await refresh();
            closeEngineManager();
          }
        }}
      />

      {(showProjectEditor || editRequested) && (
        <EditProjectModal
          project={project}
          onClose={closeProjectEditor}
          onSave={async changes => {
            await updateProject(project.id, changes);
            await refresh();
          }}
        />
      )}
    </>
  );
}
