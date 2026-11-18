import { useWorldEraScope } from '@/services/worldEras/hooks';
import { worldgenScopeOperations, worldRuntimeKey } from '../era';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEraNavigate } from '@/services/worldEras/navigation';
import MapToolWorkspace from '@/engines/local/mapTools/MapToolWorkspace';
import { localMapTargetPath } from '@/engines/local/mapTools/catalog';
import { useSearchParams } from 'react-router-dom';
import { Mountain } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { useAutoSelect, useEnsureDefault, EngineSpinner, CollectionDashboard } from '@/engines/_shared';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';
import { generateId } from '@/utils/idGenerator';
import { DEFAULT_PARAMS } from '../core/types';
import { createWorldAlternative, freshWorldEdits } from '../recipe';
import { worldWorkspaceCopy } from '../workspaceCopy';
import ReadErrorNotice from '@/components/common/ReadErrorNotice';
import { saveWorldRegionChanges } from '../sheets/store';
import { useGeneratedWorlds } from '../hooks';
import WorldView, {
  type RegionFocus,
  type SpatialFocus,
  type WaypointFocus,
} from './WorldView';
import WorldDomainCreatePanel from './WorldDomainCreatePanel';
import WorldCoverPanel from './WorldCoverPanel';
import { worldCoverCopy } from '../worldCoverCopy';

const InWorldMapPanel = lazy(() => import('../inWorldMaps/InWorldMapPanel'));

export default function WorldgenEngine({ projectId }: EngineComponentProps) {
  const scope = useWorldEraScope(projectId);
  const navigate = useEraNavigate();
  const guardRef = useRef<(action: () => void | Promise<void>) => Promise<boolean>>(async () => false);
  const requestChange = useCallback((action: () => void | Promise<void>) => guardRef.current(action), []);
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
  const queryRef = useRef(searchParams);
  useLayoutEffect(() => { queryRef.current = searchParams; }, [searchParams]);

  useAutoSelect(worlds, activeWorldId, setActiveWorldId);

  useEffect(() => {
    const worldId = searchParams.get('world');
    if (!worldId || !worlds.some((candidate) => candidate.id === worldId)) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void requestChange(() => {
      if (!alive || queryRef.current.get('world') !== worldId) return;
      setActiveWorldId(worldId);
      const next = new URLSearchParams(queryRef.current);
      next.delete('world');
      setSearchParams(next, { replace: true });
      });
    }, 0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [searchParams, setSearchParams, worlds, requestChange]);

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
    worldgenScopeOperations(scope).waypoints.getOne(wpId).then((wp) => {
      if (!alive || !wp || wp.projectId !== projectId || !worlds.some(world => world.id === wp.worldId)) return;
      void requestChange(() => {
      if (!alive || queryRef.current.get('waypoint') !== wpId) return;
      setActiveWorldId(wp.worldId);
      setFocusWaypoint({ id: wp.id, token: Date.now() });
      // Consume the param so refreshes don't re-trigger.
      const next = new URLSearchParams(queryRef.current);
      next.delete('waypoint');
      setSearchParams(next, { replace: true });
      });
    });
    return () => {
      alive = false;
    };
  }, [searchParams, setSearchParams, scope, projectId, worlds, requestChange]);

  useEffect(() => {
    const placeId = searchParams.get('place');
    if (!placeId) return;
    const split = placeId.indexOf('::');
    if (split < 1) return;
    const ownerId = placeId.slice(0, split);
    let alive = true;
    void worldgenScopeOperations(scope).worlds.getOne(ownerId).then(owner => {
      if (!alive || owner?.projectId !== projectId) return;
      void requestChange(() => {
      if (!alive || queryRef.current.get('place') !== placeId) return;
      setActiveWorldId(ownerId);
      setFocusSpatial({ id: placeId.slice(split + 2), token: Date.now() });
      const next = new URLSearchParams(queryRef.current);
      next.delete('place');
      setSearchParams(next, { replace: true });
      });
    });
    return () => { alive = false; };
  }, [searchParams, setSearchParams, scope, projectId, requestChange]);

  useEffect(() => {
    const regionId = searchParams.get('region');
    if (!regionId) return;
    const owner = worlds.find((candidate) =>
      candidate.regions?.some((region) => region.id === regionId));
    if (!owner) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void requestChange(() => {
      if (!alive || queryRef.current.get('region') !== regionId) return;
      setActiveWorldId(owner.id);
      setFocusRegion({ id: regionId, token: Date.now() });
      const next = new URLSearchParams(queryRef.current);
      next.delete('region');
      setSearchParams(next, { replace: true });
      });
    }, 0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [searchParams, setSearchParams, worlds, requestChange]);

  const activeWorld = worlds.find((w) => w.id === activeWorldId);
  const requestedPlate = searchParams.get('inWorldMap');
  const dismissPlateTarget = () => {
    if (!requestedPlate) return;
    const next = new URLSearchParams(queryRef.current);
    next.delete('inWorldMap');
    setSearchParams(next, { replace: true });
  };

  const handleCreate = async (name: string) => {
    await requestChange(async () => {
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
    await requestChange(() => setActiveWorldId(world.id));
    });
  };

  const handleDelete = async (id: string) => {
    await requestChange(async () => {
    await removeWorld(id);
    if (activeWorldId === id) {
      const remaining = worlds.filter((w) => w.id !== id);
      await requestChange(() => setActiveWorldId(remaining.length > 0 ? remaining[0].id : ''));
    }
    });
  };

  return (
    <MapToolWorkspace scope={scope} kind="worldgen" target={activeWorld ? { kind: 'worldgen', documentId: activeWorld.id } : null} onSelectTarget={(target, selection) => {
      if (target.kind === 'worldgen') { setActiveWorldId(target.documentId); return; }
      const [pathname, search] = localMapTargetPath(scope, target).split('?');
      const query = new URLSearchParams(search);
      if (selection) { query.set('mapTool', selection.namespace); query.set('mapDocument', selection.documentId); query.set('mapRelease', selection.expectedContentHash ?? 'development'); }
      navigate(pathname + '?' + query);
    }}>
    {({ requestChange: guard }) => { guardRef.current = guard; return <div className="space-y-4" data-testid="worldgen-engine">
      {loading && worlds.length === 0 && <EngineSpinner />}
      {error && <ReadErrorNotice onRetry={refresh} retrying={refetching} />}
      {worlds.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-w-0 items-center gap-2 text-text-primary">
          <Mountain size={19} className="shrink-0 text-accent-gold" />
          <span className="sr-only">{t('worldgen.itemNoun')}</span>
          <select value={activeWorldId} onChange={event => { const id = event.target.value; void requestChange(() => setActiveWorldId(id)); }} className="min-w-0 max-w-full rounded-lg border border-border bg-surface px-3 py-2 text-base font-semibold">
            {worlds.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        {activeWorld?.originWorldId && worlds.some(item => item.id === activeWorld.originWorldId) &&
          <button onClick={() => { void requestChange(() => setActiveWorldId(activeWorld.originWorldId!)); }} className="text-sm text-accent-gold underline underline-offset-4">{worldWorkspaceCopy(locale).openOriginal}</button>}
      </div>}
      <WorldDomainCreatePanel
        key={`create:${projectId}:${scope.eraId ?? ''}:${activeWorldId}`}
        scope={scope}
        onCreated={async (worldId, isCurrent) => { await refresh(); if (isCurrent()) await requestChange(() => { if (isCurrent()) setActiveWorldId(worldId); }); }}
      />
      {activeWorld && (
        <>
          <WorldCoverPanel scope={scope} world={activeWorld} onSaved={refresh} />
          <Suspense fallback={null}>
            <InWorldMapPanel key={worldRuntimeKey(activeWorld.id, scope.eraId)} scope={scope} row={activeWorld}
              target={activeWorld.inWorldMaps?.some(map => map.id === requestedPlate) ? requestedPlate : null} clearTarget={dismissPlateTarget} />
          </Suspense>
          <WorldView
            key={worldRuntimeKey(activeWorld.id, scope.eraId)}
            projectId={projectId}
            world={activeWorld}
            onRefreshWorld={refresh}
            onCreateAlternative={async (params) => {
              await requestChange(async () => {
              const alternative = await createWorldAlternative(activeWorld.id, params, `${worldWorkspaceCopy(locale).alternativeName} ${activeWorld.title}`, scope);
              await refresh();
              await requestChange(() => setActiveWorldId(alternative.id));
              });
            }}
            onSaveEdits={(edits) => editWorld(activeWorld.id, { edits })}
            onSaveRegions={async (regions, baseline) => { await saveWorldRegionChanges(projectId, activeWorld.id, baseline ?? activeWorld.regions ?? [], regions, undefined, scope.eraId); }}
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
        onSelect={id => { void requestChange(() => setActiveWorldId(id)); }}
        onCreate={handleCreate}
        onDelete={handleDelete}
        placeholder={t('worldgenEngine.namePlaceholder')}
        preview={item => item.coverImage || item.thumbnail ? { src: item.coverImage || item.thumbnail!, alt: worldCoverCopy(locale).preview(item.title) } : null}
      />
    </div>; }}
    </MapToolWorkspace>
  );
}
