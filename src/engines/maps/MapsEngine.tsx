import { useState } from 'react';
import { ExternalLink, Link2, Map } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { useAutoSelect, useEnsureDefault, EngineSpinner, CollectionDashboard } from '@/engines/_shared';
import { useWorldMaps, useMapPins } from './hooks';
import MapView from '@/components/maps/MapView';
import { generateId } from '@/utils/idGenerator';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';
import { useCodexEntries } from '@/engines/codex/hooks';

export default function MapsEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { items: maps, loading: mapsLoading, addItem: addMap, editItem: editMap, removeItem: removeMap } = useWorldMaps(projectId);
  const [activeMapId, setActiveMapId] = useState<string>('');
  const { items: pins, addItem: addPin, editItem: editPin, removeItem: removePin } = useMapPins(activeMapId);
  const { items: codexEntries } = useCodexEntries(projectId);

  useAutoSelect(maps, activeMapId, setActiveMapId);

  useEnsureDefault({
    items: maps,
    loading: mapsLoading,
    createDefault: () => ({
      id: generateId('map'),
      projectId,
      title: t('mapsEngine.defaultName'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    addItem: addMap,
    onCreated: setActiveMapId,
  });

  if (mapsLoading && maps.length === 0) return <EngineSpinner />;
  const activeMap = maps.find((map) => map.id === activeMapId);

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
        <>
          {activeMap?.source === 'worldgen' && activeMap.sourceWorldId && (
            <div className="flex items-center gap-2 rounded-lg border border-accent-gold/25 bg-accent-gold/8 px-3 py-2 text-xs text-text-primary">
              <Link2 size={13} className="text-accent-gold" />
              <span className="min-w-0 flex-1">
                Vinculado a Worldgen · revisión {activeMap.sourceRevision ?? 0}
              </span>
              <button
                type="button"
                onClick={() => navigate(`/project/${projectId}/worldgen`)}
                className="flex items-center gap-1 rounded border border-border bg-elevated px-2 py-1 text-[11px] hover:border-accent-gold/40"
              >
                <ExternalLink size={11} /> Abrir mundo
              </button>
            </div>
          )}
          <MapView
            key={activeMapId}
            projectId={projectId}
            mapId={activeMapId}
            backgroundImage={activeMap?.backgroundImage}
            pins={pins}
            codexEntries={codexEntries}
            onUploadBackground={(img) => editMap(activeMapId, {
              backgroundImage: img,
              source: 'uploaded',
              sourceWorldId: undefined,
              sourceRevision: undefined,
            })}
            onAddPin={addPin}
            onEditPin={editPin}
            onDeletePin={removePin}
          />
          {/* Annotation surface — margin notes + backlinks for the active map */}
          <div className="pt-2 border-t border-border">
            <AnnotationSurface
              projectId={projectId}
              engineId="maps"
              entityId={activeMapId}
              layout="stack"
            />
          </div>
        </>
      )}

      <CollectionDashboard
        icon={Map}
        title={t('maps.yourMaps')}
        itemNoun={t('maps.itemNoun')}
        items={maps}
        activeId={activeMapId}
        onSelect={setActiveMapId}
        onCreate={handleCreateMap}
        onDelete={handleDeleteMap}
        placeholder={t('mapsEngine.namePlaceholder')}
      />
    </div>
  );
}
