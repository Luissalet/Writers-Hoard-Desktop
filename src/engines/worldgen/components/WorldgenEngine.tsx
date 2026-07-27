import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mountain } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { useAutoSelect, useEnsureDefault, EngineSpinner, CollectionDashboard } from '@/engines/_shared';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';
import { generateId } from '@/utils/idGenerator';
import { DEFAULT_PARAMS } from '../core/types';
import { worldWaypointOps } from '../operations';
import { useGeneratedWorlds } from '../hooks';
import WorldView, {
  type RegionFocus,
  type SpatialFocus,
  type WaypointFocus,
} from './WorldView';

export default function WorldgenEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const {
    items: worlds,
    loading,
    addItem: addWorld,
    editItem: editWorld,
    removeItem: removeWorld,
  } = useGeneratedWorlds(projectId);
  const [activeWorldId, setActiveWorldId] = useState<string>('');
  const [focusWaypoint, setFocusWaypoint] = useState<WaypointFocus | null>(null);
  const [focusSpatial, setFocusSpatial] = useState<SpatialFocus | null>(null);
  const [focusRegion, setFocusRegion] = useState<RegionFocus | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useAutoSelect(worlds, activeWorldId, setActiveWorldId);

  useEnsureDefault({
    items: worlds,
    loading,
    createDefault: () => ({
      id: generateId('world'),
      projectId,
      title: t('worldgenEngine.defaultName'),
      params: { ...DEFAULT_PARAMS, seed: generateId('seed').slice(-8) },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    addItem: addWorld,
    onCreated: setActiveWorldId,
  });

  // Deep link: /project/:id/worldgen?waypoint=<id> (from annotations/search).
  useEffect(() => {
    const wpId = searchParams.get('waypoint');
    if (!wpId) return;
    let alive = true;
    worldWaypointOps.getOne(wpId).then((wp) => {
      if (!alive || !wp) return;
      setActiveWorldId(wp.worldId);
      setFocusWaypoint({ id: wp.id, token: Date.now() });
      // Consume the param so refreshes don't re-trigger.
      const next = new URLSearchParams(searchParams);
      next.delete('waypoint');
      setSearchParams(next, { replace: true });
    });
    return () => {
      alive = false;
    };
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const placeId = searchParams.get('place');
    if (!placeId) return;
    const split = placeId.indexOf('::');
    if (split < 1) return;
    const timer = window.setTimeout(() => {
      setActiveWorldId(placeId.slice(0, split));
      setFocusSpatial({ id: placeId.slice(split + 2), token: Date.now() });
      const next = new URLSearchParams(searchParams);
      next.delete('place');
      setSearchParams(next, { replace: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const regionId = searchParams.get('region');
    if (!regionId) return;
    const owner = worlds.find((candidate) =>
      candidate.regions?.some((region) => region.id === regionId));
    if (!owner) return;
    const timer = window.setTimeout(() => {
      setActiveWorldId(owner.id);
      setFocusRegion({ id: regionId, token: Date.now() });
      const next = new URLSearchParams(searchParams);
      next.delete('region');
      setSearchParams(next, { replace: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [searchParams, setSearchParams, worlds]);

  if (loading && worlds.length === 0) return <EngineSpinner />;

  const activeWorld = worlds.find((w) => w.id === activeWorldId);

  const handleCreate = async (name: string) => {
    const world = {
      id: generateId('world'),
      projectId,
      title: name,
      params: { ...DEFAULT_PARAMS, seed: name.toLowerCase().replace(/\s+/g, '-') },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await addWorld(world);
    setActiveWorldId(world.id);
  };

  const handleDelete = async (id: string) => {
    await removeWorld(id);
    if (activeWorldId === id) {
      const remaining = worlds.filter((w) => w.id !== id);
      setActiveWorldId(remaining.length > 0 ? remaining[0].id : '');
    }
  };

  return (
    <div className="space-y-4" data-testid="worldgen-engine">
      {activeWorld && (
        <>
          <WorldView
            key={activeWorld.id}
            projectId={projectId}
            world={activeWorld}
            onSaveParams={(params) => editWorld(activeWorld.id, { params })}
            onSaveEdits={(edits) => editWorld(activeWorld.id, { edits })}
            onSaveRegions={(regions) => editWorld(activeWorld.id, { regions })}
            onThumbnail={(thumbnail) => editWorld(activeWorld.id, { thumbnail })}
            focusWaypoint={focusWaypoint && focusWaypoint.id ? focusWaypoint : null}
            focusSpatial={focusSpatial}
            focusRegion={focusRegion}
          />
          <div className="pt-2 border-t border-border">
            <AnnotationSurface
              projectId={projectId}
              engineId="worldgen"
              entityId={activeWorld.id}
              layout="stack"
            />
          </div>
        </>
      )}

      <CollectionDashboard
        icon={Mountain}
        title={t('worldgen.yourWorlds')}
        itemNoun={t('worldgen.itemNoun')}
        items={worlds}
        activeId={activeWorldId}
        onSelect={setActiveWorldId}
        onCreate={handleCreate}
        onDelete={handleDelete}
        placeholder={t('worldgenEngine.namePlaceholder')}
      />
    </div>
  );
}
