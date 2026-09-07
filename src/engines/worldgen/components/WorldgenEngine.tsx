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
import { createWorldAlternative, freshWorldEdits } from '../recipe';
import { worldWorkspaceCopy } from '../workspaceCopy';
import ReadErrorNotice from '@/components/common/ReadErrorNotice';
import { useGeneratedWorlds } from '../hooks';
import WorldView, {
  type RegionFocus,
  type SpatialFocus,
  type WaypointFocus,
} from './WorldView';

export default function WorldgenEngine({ projectId }: EngineComponentProps) {
  const { t, locale } = useTranslation();
  const {
    items: worlds,
    loading,
    error, refresh, refetching,
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

  useEffect(() => {
    const worldId = searchParams.get('world');
    if (!worldId || !worlds.some((candidate) => candidate.id === worldId)) return;
    const timer = window.setTimeout(() => {
      setActiveWorldId(worldId);
      const next = new URLSearchParams(searchParams);
      next.delete('world');
      setSearchParams(next, { replace: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [searchParams, setSearchParams, worlds]);

  useEnsureDefault({
    items: worlds,
    loading: loading || !!error,
    createDefault: () => ({
      id: generateId('world'),
      projectId,
      title: t('worldgenEngine.defaultName'),
      params: { ...DEFAULT_PARAMS, seed: generateId('seed').slice(-8) },
      edits: freshWorldEdits(),
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
      edits: freshWorldEdits(),
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
      {error && <ReadErrorNotice onRetry={refresh} retrying={refetching} />}
      {worlds.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-w-0 items-center gap-2 text-text-primary">
          <Mountain size={19} className="shrink-0 text-accent-gold" />
          <span className="sr-only">{t('worldgen.itemNoun')}</span>
          <select value={activeWorldId} onChange={event => setActiveWorldId(event.target.value)} className="min-w-0 max-w-full rounded-lg border border-border bg-surface px-3 py-2 text-base font-semibold">
            {worlds.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        {activeWorld?.originWorldId && worlds.some(item => item.id === activeWorld.originWorldId) &&
          <button onClick={() => setActiveWorldId(activeWorld.originWorldId!)} className="text-sm text-accent-gold underline underline-offset-4">{worldWorkspaceCopy(locale).openOriginal}</button>}
      </div>}
      {activeWorld && (
        <>
          <WorldView
            key={activeWorld.id}
            projectId={projectId}
            world={activeWorld}
            onRefreshWorld={refresh}
            onCreateAlternative={async (params) => {
              const alternative = await createWorldAlternative(activeWorld.id, params, `${worldWorkspaceCopy(locale).alternativeName} ${activeWorld.title}`);
              await refresh();
              setActiveWorldId(alternative.id);
            }}
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
