import { useState, useEffect } from 'react';
import { ExternalLink, Link2, Map } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { useAutoSelect, useEnsureDefault, EngineSpinner, CollectionDashboard, useDeepLinkParam } from '@/engines/_shared';
import { db } from '@/db';
import { useWorldMaps, useMapPins } from './hooks';
import MapView, { type PinDraft } from '@/components/maps/MapView';
import { generateId } from '@/utils/idGenerator';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';
import { useCodexEntries } from '@/engines/codex/hooks';
import { createLocalDraftStore, deleteWithDraftCleanup } from '@/hooks/localDraftStore';

export default function MapsEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { items: maps, loading: mapsLoading, addItem: addMap, editItem: editMap, removeItem: removeMap } = useWorldMaps(projectId);
  const [activeMapId, setActiveMapId] = useState<string>('');
  const [pinDrafts] = useState(() => createLocalDraftStore<PinDraft>(`wh.maps-drafts.v1.${projectId}`, (value): value is PinDraft => {
    if (!value || typeof value !== 'object') return false;
    const draft = value as Partial<PinDraft>;
    return typeof draft.name === 'string' && typeof draft.description === 'string' && typeof draft.icon === 'string';
  }));
  const { items: pins, addItem: addPin, editItem: editPin, removeItem: removePin } = useMapPins(activeMapId);
  const { items: codexEntries } = useCodexEntries(projectId);

  useAutoSelect(maps, activeMapId, setActiveMapId);

  // Deep link: `/project/:id/maps?pin=<id>`. A pin belongs to a map, so the
  // engine first has to switch to the owning map; MapView then opens the pin.
  const deepLinkedPinId = useDeepLinkParam('pin');
  useEffect(() => {
    if (!deepLinkedPinId) return;
    let cancelled = false;
    void db.mapPins.get(deepLinkedPinId).then((pin) => {
      if (!cancelled && pin?.mapId) setActiveMapId(pin.mapId);
    });
    return () => { cancelled = true; };
  }, [deepLinkedPinId]);

  // Deep link: `/project/:id/maps?map=<id>` — what the anchor adapter emits for
  // a note anchored on the map itself (`AnnotationSurface` uses the map id).
  // Checked against the table so a stale link can't strand the engine on a map
  // that no longer exists.
  const deepLinkedMapId = useDeepLinkParam('map');
  useEffect(() => {
    if (!deepLinkedMapId) return;
    let cancelled = false;
    void db.worldMaps.get(deepLinkedMapId).then((map) => {
      if (!cancelled && map) setActiveMapId(map.id);
    });
    return () => { cancelled = true; };
  }, [deepLinkedMapId]);

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
    const pinIds = await db.mapPins.where('mapId').equals(id).primaryKeys();
    await deleteWithDraftCleanup(pinDrafts, pinIds, () => removeMap(id));
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
                onClick={() => navigate(`/project/${projectId}/worldgen?world=${encodeURIComponent(activeMap.sourceWorldId!)}`)}
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
            drafts={pinDrafts}
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
            focusPinId={deepLinkedPinId}
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
