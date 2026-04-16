import { useState, useEffect, useCallback } from 'react';
import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useScenes } from '../hooks';
import { autoNumberScenes } from '../operations';
import SceneListView from './SceneListView';
import SceneEditor from './SceneEditor';

export default function DialogSceneEngine({ projectId }: EngineComponentProps) {
  const { items: scenes, loading, addItem: addScene, editItem: editScene, removeItem: removeScene, reorder, refresh } =
    useScenes(projectId);
  const [activeSceneId, setActiveSceneId] = useState<string>('');

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
          scenes={scenes}
          onSelectScene={setActiveSceneId}
          onCreateScene={handleCreateScene}
          onUpdateScene={editScene}
          onDeleteScene={handleDeleteScene}
          onReorderScenes={handleReorder}
        />
      )}
    </div>
  );
}
