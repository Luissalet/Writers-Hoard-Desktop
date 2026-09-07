import { useState, useEffect, useCallback } from 'react';
import type { EngineComponentProps } from '@/engines/_types';
import { EngineSpinner, useDeepLinkParam } from '@/engines/_shared';
import { useScenes } from '../hooks';
import { autoNumberScenes } from '../operations';
import SceneListView from './SceneListView';
import SceneEditor from './SceneEditor';
import { toast } from '@/components/common/toast';
import { useTranslation } from '@/i18n/useTranslation';

export default function DialogSceneEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { items: scenes, loading, addItem: addScene, editItem: editScene, removeItem: removeScene, reorder, refresh } =
    useScenes(projectId);
  const [activeSceneId, setActiveSceneId] = useState<string>('');
  const deepLinkedSceneId = useDeepLinkParam('entity');
  const [appliedDeepLink, setAppliedDeepLink] = useState<string | null>(null);

  if (
    deepLinkedSceneId
    && deepLinkedSceneId !== appliedDeepLink
    && scenes.some((scene) => scene.id === deepLinkedSceneId)
  ) {
    setAppliedDeepLink(deepLinkedSceneId);
    setActiveSceneId(deepLinkedSceneId);
  }

  // NOTE: No useAutoSelect here — Dialog engine uses explicit list→editor navigation.
  // useAutoSelect would immediately re-select a scene after Back, preventing the list view.

  // The operations commit order and numbering together; no timing guesses.
  const handleReorder = useCallback(async (orderedIds: string[]) => {
    await reorder(orderedIds);
  }, [reorder]);

  const handleCreateScene = useCallback(async (scene: Parameters<typeof addScene>[0]) => {
    await addScene({ ...scene, projectId });
    setActiveSceneId(scene.id);
  }, [addScene, projectId]);

  const handleDeleteScene = useCallback(async (sceneId: string) => {
    await removeScene(sceneId);
  }, [removeScene]);

  // After a script import: number the new scenes (locks from `#N#` numbers
  // are respected) and refresh. No 50 ms timer — the import's transaction has
  // already committed by the time this runs.
  const handleImported = useCallback(async () => {
    await autoNumberScenes(projectId);
    await refresh();
  }, [projectId, refresh]);

  // Auto-number on initial load if any scene lacks a number
  useEffect(() => {
    if (!loading && scenes.some((s) => !s.isLocked && s.sceneNumber === undefined)) {
      void autoNumberScenes(projectId).then(refresh).catch(() => toast.error(t('dialogScene.saveError')));
    }
  }, [loading, scenes, projectId, refresh, t]);

  if (loading && scenes.length === 0) return <EngineSpinner className="flex items-center justify-center h-full bg-deep" />;

  const activeScene = scenes.find((s) => s.id === activeSceneId);

  return (
    <div className="h-full">
      {activeScene ? (
        <SceneEditor
          key={activeScene.id}
          scene={activeScene}
          scenes={scenes}
          onUpdateScene={(changes) => editScene(activeScene.id, changes)}
          onBack={() => setActiveSceneId('')}
        />
      ) : (
        <SceneListView
          projectId={projectId}
          scenes={scenes}
          onSelectScene={setActiveSceneId}
          onCreateScene={handleCreateScene}
          onUpdateScene={editScene}
          onDeleteScene={handleDeleteScene}
          onReorderScenes={handleReorder}
          onImported={handleImported}
        />
      )}
    </div>
  );
}
