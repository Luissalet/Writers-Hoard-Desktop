import { useState, useMemo } from 'react';
import { Map } from 'lucide-react';
import type { EngineComponentProps } from '@/engines/_types';
import { useAutoSelect, useEnsureDefault, EngineSpinner, CollectionDashboard } from '@/engines/_shared';
import { useWorldMaps, useMapPins } from '@/hooks/useMaps';
import MapView from '@/components/maps/MapView';
import { generateId } from '@/utils/idGenerator';

export default function MapsEngine({ projectId }: EngineComponentProps) {
  const { maps, addMap, editMap, removeMap } = useWorldMaps(projectId);
  const [activeMapId, setActiveMapId] = useState<string>('');
  const { pins, addPin, removePin } = useMapPins(activeMapId);

  useAutoSelect(maps, activeMapId, setActiveMapId);

  useEnsureDefault({
    items: maps,
    loading: false,
    createDefault: () => ({
      id: generateId('map'),
      projectId,
      title: 'World Map',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    addItem: addMap,
    onCreated: setActiveMapId,
  });

  const loading = useMemo(() => maps.length === 0, [maps.length]);

  if (loading) return <EngineSpinner />;

  const handleCreateMap = async (name: string) => {
    const map = {
      id: generateId('map'),
      projectId,
      title: name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await addMap(map);
    setActiveMapId(map.id);
  };

  const handleDeleteMap = async (id: string) => {
    await removeMap(id);
    if (activeMapId === id) {
      const remaining = maps.filter((m) => m.id !== id);
      if (remaining.length > 0) {
        setActiveMapId(remaining[0].id);
      } else {
        setActiveMapId('');
      }
    }
  };

  return (
    <div className="space-y-4">
      {activeMapId && (
        <MapView
          projectId={projectId}
          mapId={activeMapId}
          backgroundImage={maps.find((m) => m.id === activeMapId)?.backgroundImage}
          pins={pins}
          onUploadBackground={(img) => editMap(activeMapId, { backgroundImage: img })}
          onAddPin={addPin}
          onDeletePin={removePin}
        />
      )}

      <CollectionDashboard
        icon={Map}
        title="Your Maps"
        itemNoun="Map"
        items={maps}
        activeId={activeMapId}
        onSelect={setActiveMapId}
        onCreate={handleCreateMap}
        onDelete={handleDeleteMap}
        placeholder="Map name..."
      />
    </div>
  );
}
