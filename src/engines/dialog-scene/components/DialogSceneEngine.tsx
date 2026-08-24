import { useState, useEffect, useCallback } from 'react';
import type { EngineComponentProps } from '@/engines/_types';
import { EngineSpinner, useDeepLinkParam } from '@/engines/_shared';
import { useScenes } from '../hooks';
import { autoNumberScenes } from '../operations';
import SceneListView from './SceneListView';
import SceneEditor from './SceneEditor';

export default function DialogSceneEngine({ projectId }: EngineComponentProps) {
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

  // Auto-number scenes whenever the list changes
  const runAutoNumber = useCallback(async () => {
    if (scenes.length === 0) return;
    await autoNumberScenes(projectId);
    await refresh();
  }, [scenes.length, projectId, refresh]);

  // Re-number after reorder or add/delete
  const handleReorder = useCallback(async (orderedIds: string[]) => {
    await reorder(orderedIds);
    // Small delay to let reorder persist, then re-number
    setTimeout(() => autoNumberScenes(projectId).then(refresh), 50);
  }, [reorder, projectId, refresh]);

  const handleCreateScene = useCallback(async (scene: Parameters<typeof addScene>[0]) => {
    await addScene({ ...scene, projectId });
    setTimeout(() => autoNumberScenes(projectId).then(refresh), 50);
  }, [addScene, projectId, refresh]);

  const handleDeleteScene = useCallback(async (sceneId: string) => {
    await removeScene(sceneId);
    setTimeout(() => autoNumberScenes(projectId).then(refresh), 50);
  }, [removeScene, projectId, refresh]);

  // After a script import: number the new scenes (locks from `#N#` numbers
  // are respected) and refresh. No 50 ms timer — the import's transaction has
  // already committed by the time this runs.
  const handleImported = useCallback(async () => {
    await autoNumberScenes(projectId);
    await refresh();
  }, [projectId, refresh]);

  // Auto-number on initial load if any scene lacks a number
  useEffect(() => {
    if (!loading && scenes.length > 0 && scenes.some((s) => s.sceneNumber === undefined)) {
      runAutoNumber();
    }
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && scenes.length === 0) return <EngineSpinner className="flex items-center justify-center h-full bg-deep" />;

  const activeScene = scenes.find((s) => s.id === activeSceneId);

  return (
    <div className="h-full">
      {activeScene ? (
        <SceneEditor
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
