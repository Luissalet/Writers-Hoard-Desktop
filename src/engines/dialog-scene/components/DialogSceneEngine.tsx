import { useState } from 'react';
import type { EngineComponentProps } from '@/engines/_types';
import EngineSpinner from '@/engines/_shared/components/EngineSpinner';
import { useAutoSelect } from '@/engines/_shared';
import { useScenes } from '../hooks';
import SceneListView from './SceneListView';
import SceneEditor from './SceneEditor';

export default function DialogSceneEngine({ projectId }: EngineComponentProps) {
  const { items: scenes, loading, addItem: addScene, editItem: editScene, removeItem: removeScene, reorder } =
    useScenes(projectId);
  const [activeSceneId, setActiveSceneId] = useState<string>('');

  useAutoSelect(scenes, activeSceneId, setActiveSceneId);

  if (loading && scenes.length === 0) return <EngineSpinner className="flex items-center justify-center h-full bg-deep" />;

  const activeScene = scenes.find((s) => s.id === activeSceneId);

  return (
    <div className="h-full">
      {activeScene ? (
        <SceneEditor
          scene={activeScene}
          onUpdateScene={(changes) => editScene(activeScene.id, changes)}
          onBack={() => setActiveSceneId('')}
        />
      ) : (
        <SceneListView
          scenes={scenes}
          onSelectScene={setActiveSceneId}
          onCreateScene={(scene) =>
            addScene({ ...scene, projectId })
          }
          onDeleteScene={removeScene}
          onReorderScenes={reorder}
        />
      )}
    </div>
  );
}
