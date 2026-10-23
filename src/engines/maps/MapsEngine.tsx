import { useEraNavigate } from '@/services/worldEras/navigation';
import { useWorldEraScope } from '@/services/worldEras/hooks';
import { readEraRow, listEraRows } from '@/services/worldEras/store';
import type { MapPin, WorldMap } from '@/types';
import { useState, useEffect, useRef } from 'react';
import { ExternalLink, Link2, Map } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { useAutoSelect, useEnsureDefault, EngineSpinner, CollectionDashboard, useDeepLinkParam } from '@/engines/_shared';
import { useWorldMaps, useMapPins } from './hooks';
import MapView, { type PinDraft } from '@/components/maps/MapView';
import { generateId } from '@/utils/idGenerator';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';
import { useCodexEntries } from '@/engines/codex/hooks';
import { createLocalDraftStore, deleteWithDraftCleanup } from '@/hooks/localDraftStore';
import type { MapFeature } from '@/types';
import MapVersionHistory from '@/components/maps/MapVersionHistory';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db';
import { resolveWorldCalendar } from '@/engines/timeline/worldCalendarStore';
import type { TimelineEvent } from '@/types';
import { createEntryFromMap } from './codexLink';
import { useProject } from '@/hooks/useProjects';
import type { AnnotationAnchor } from '@/engines/annotations/types';
import { worldMapOps, mapPinOps, captureMapVersion, updateMapVersion, deleteMapVersion, restoreMapVersion, changeMapGround } from './operations';
import ChangeGroundDialog from '@/components/maps/ChangeGroundDialog';
import { remapMapContent, type GroundFitMode, type GroundSize } from '@/components/maps/mapGround';
import { mapGroundCopy } from '@/components/maps/mapGroundCopy';

export default function MapsEngine({ projectId }: EngineComponentProps) {
  const { t, locale } = useTranslation();
  const scope = useWorldEraScope(projectId);
  // Timeline moments map eras can stand for. A map stays usable when the
  // timeline cannot be read: the history then simply offers no events.
  const projectEvents = useLiveQuery(() => (scope.eraId ? listEraRows<TimelineEvent>(scope, 'timelineEvents') : db.timelineEvents.where('projectId').equals(projectId).toArray()).catch(() => [] as TimelineEvent[]), [projectId, scope.eraId]) ?? [];
  // Each event is dated in its own timeline's calendar (or the project's).
  const timelineIds = [...new Set(projectEvents.map((event) => event.timelineId))].sort().join('|');
  const calendars = useLiveQuery(async () => {
    const ids = timelineIds ? timelineIds.split('|') : [];
    const entries = await Promise.all(ids.map(async (id) => [id, (await resolveWorldCalendar(projectId, id, scope.eraId).catch(() => null))?.calendar ?? null] as const));
    return { project: (await resolveWorldCalendar(projectId, undefined, scope.eraId).catch(() => null))?.calendar ?? null, byTimeline: Object.fromEntries(entries) };
  }, [projectId, scope.eraId, timelineIds]);
  const navigate = useEraNavigate();
  const { items: maps, loading: mapsLoading, addItem: addMap, editItem: editMap, removeItem: removeMap, refresh: refreshMaps } = useWorldMaps(projectId);
  const [activeMapId, setActiveMapId] = useState<string>('');
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [restoreEpoch, setRestoreEpoch] = useState(0);
  // A replacement image waiting for the author's confirmation (only when the map already has one).
  const [pendingGround, setPendingGround] = useState<string | null>(null);
  const [featureDrafts] = useState(() => createLocalDraftStore<MapFeature>(`wh.map-features-drafts.v1.${projectId}${scope.eraId ? `.era:${scope.eraId}` : ''}`, (value): value is MapFeature => {
    if (!value || typeof value !== 'object') return false;
    const draft = value as Partial<MapFeature>;
    return typeof draft.id === 'string' && typeof draft.name === 'string' && typeof draft.color === 'string' && ['region', 'path', 'label'].includes(draft.kind ?? '') && Array.isArray(draft.points) && draft.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  }));
  const [pinDrafts] = useState(() => createLocalDraftStore<PinDraft>(`wh.maps-drafts.v1.${projectId}${scope.eraId ? `.era:${scope.eraId}` : ''}`, (value): value is PinDraft => {
    if (!value || typeof value !== 'object') return false;
    const draft = value as Partial<PinDraft>;
    return typeof draft.name === 'string' && typeof draft.description === 'string' && typeof draft.icon === 'string';
  }));
  const { items: pins, addItem: addPin, editItem: editPin, removeItem: removePin, refresh: refreshPins } = useMapPins(activeMapId);
  const { items: codexEntries } = useCodexEntries(projectId);
  const { project } = useProject(projectId);
  const codexOn = project?.enabledEngines.includes('codex') ?? false;
  // A comment started from a spot on the map; the notes panel below opens its composer.
  const [mapCommentAnchor, setMapCommentAnchor] = useState<{ mapId: string; anchor: AnnotationAnchor } | null>(null);
  const notesRef = useRef<HTMLDivElement>(null);

  useAutoSelect(maps, activeMapId, setActiveMapId);

  // Deep link: `/project/:id/maps?pin=<id>`. A pin belongs to a map, so the
  // engine first has to switch to the owning map; MapView then opens the pin.
  const deepLinkedPinId = useDeepLinkParam('pin');
  useEffect(() => {
    if (!deepLinkedPinId) return;
    let cancelled = false;
    void (scope.eraId ? readEraRow<MapPin>(scope, 'mapPins', deepLinkedPinId) : mapPinOps.getOne(deepLinkedPinId)).then((pin) => {
      if (!cancelled && pin?.mapId && pin.projectId === projectId) setActiveMapId(pin.mapId);
    });
    return () => { cancelled = true; };
  }, [deepLinkedPinId, projectId, scope]);

  // Deep link: `/project/:id/maps?map=<id>` — what the anchor adapter emits for
  // a note anchored on the map itself (`AnnotationSurface` uses the map id).
  // Checked against the table so a stale link can't strand the engine on a map
  // that no longer exists.
  const deepLinkedMapId = useDeepLinkParam('map');
  useEffect(() => {
    if (!deepLinkedMapId) return;
    let cancelled = false;
    void (scope.eraId ? readEraRow<WorldMap>(scope, 'worldMaps', deepLinkedMapId) : worldMapOps.getOne(deepLinkedMapId)).then((map) => {
      if (!cancelled && map?.projectId === projectId) setActiveMapId(map.id);
    });
    return () => { cancelled = true; };
  }, [deepLinkedMapId, projectId, scope]);

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
  const previewVersion = activeMap?.versions?.find(version => version.id === previewVersionId);

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
    const featureIds = maps.find(map => map.id === id)?.features?.map(feature => feature.id) ?? [];
    const pinIds = (await listEraRows<MapPin>(scope, 'mapPins')).filter(pin => pin.mapId === id).map(pin => pin.id);
    await deleteWithDraftCleanup(pinDrafts, pinIds, () => removeMap(id));
    featureIds.forEach(featureId => featureDrafts.delete(featureId));
    if (activeMapId === id) {
      const remaining = maps.filter((m) => m.id !== id);
      if (remaining.length > 0) {
        setActiveMapId(remaining[0].id);
      } else {
        setActiveMapId('');
      }
    }
  };

  const applyGround = async (image: string, change: { mode: GroundFitMode; oldSize: GroundSize | null; newSize: GroundSize }) => {
    await changeMapGround(activeMapId, { image, ...change, versionName: mapGroundCopy[locale].versionName }, scope);
    // Unsaved shape drafts are in the old picture's coordinates: move them with the saved shapes.
    if (change.mode === 'keep' && change.oldSize && featureDrafts.size) {
      const moved = remapMapContent({ features: [...featureDrafts.values()], pins: [] }, change.oldSize, change.newSize, 'keep').features;
      moved.forEach(feature => featureDrafts.set(feature.id, feature));
    }
    await Promise.all([refreshMaps(), refreshPins()]);
    setPendingGround(null);
    setPreviewVersionId(null);
    setRestoreEpoch(value => value + 1);
  };

  const handleUploadBackground = (image: string) => {
    // With no image yet there is nothing to compare or move: apply it at once.
    if (!activeMap?.backgroundImage) {
      void editMap(activeMapId, { backgroundImage: image, source: 'uploaded', sourceWorldId: undefined, sourceRevision: undefined });
      return;
    }
    setPendingGround(image);
  };

  return (
    <div className="space-y-4">
      {activeMapId && (
        <>
          {activeMap && <MapVersionHistory
            key={activeMap.id}
            versions={activeMap.versions ?? []}
            selectedId={previewVersion?.id ?? null}
            onSelect={setPreviewVersionId}
            onCapture={async metadata => { await captureMapVersion(activeMapId, metadata, scope); await refreshMaps(); }}
            onUpdate={async (id, metadata) => { await updateMapVersion(activeMapId, id, metadata, scope); await refreshMaps(); }}
            onDelete={async id => { await deleteMapVersion(activeMapId, id, scope); await refreshMaps(); }}
            events={projectEvents}
            calendar={(event: TimelineEvent) => calendars?.byTimeline[event.timelineId] ?? calendars?.project ?? null}
            onRestore={async (id, recoveryName) => {
              await restoreMapVersion(activeMapId, id, recoveryName, scope);
              await Promise.all([refreshMaps(), refreshPins()]);
              pins.forEach(pin => pinDrafts.delete(pin.id));
              (activeMap.features ?? []).forEach(feature => featureDrafts.delete(feature.id));
              setPreviewVersionId(null);
              setRestoreEpoch(value => value + 1);
            }}
          />}
          {activeMap?.source === 'worldgen' && activeMap.sourceWorldId && (
            <div className="flex items-center gap-2 rounded-lg border border-accent-gold/25 bg-accent-gold/8 px-3 py-2 text-xs text-text-primary">
              <Link2 size={13} className="text-accent-gold" />
              <span className="min-w-0 flex-1">
                {t('mapsEngine.worldgenLinked').replace('{revision}', String(activeMap.sourceRevision ?? 0))}
              </span>
              <button
                type="button"
                onClick={() => navigate(`/project/${projectId}/worldgen?world=${encodeURIComponent(activeMap.sourceWorldId!)}`)}
                className="flex items-center gap-1 rounded border border-border bg-elevated px-2 py-1 text-[11px] hover:border-accent-gold/40"
              >
                <ExternalLink size={11} /> {t('mapsEngine.openWorld')}
              </button>
            </div>
          )}
          <MapView
            key={`${activeMapId}:${previewVersion?.id ?? 'current'}:${restoreEpoch}`}
            projectId={projectId}
            mapId={activeMapId}
            backgroundImage={previewVersion ? previewVersion.backgroundImage : activeMap?.backgroundImage}
            pins={previewVersion?.pins ?? pins}
            features={previewVersion?.features ?? activeMap?.features}
            layerVisibility={previewVersion ? previewVersion.layerVisibility : activeMap?.layerVisibility}
            namedLayers={previewVersion ? previewVersion.layers : activeMap?.layers}
            readOnly={!!previewVersion}
            featureDrafts={featureDrafts}
            onChangeNamedLayers={(layers) => editMap(activeMapId, { layers })}
            onChangeFeatures={(features) => editMap(activeMapId, { features })}
            onChangeLayers={(layerVisibility) => editMap(activeMapId, { layerVisibility })}
            onOpenEntry={(entryId) => navigate(`/project/${projectId}/codex?entry=${encodeURIComponent(entryId)}`)}
            drafts={pinDrafts}
            codexEntries={codexEntries}
            onUploadBackground={handleUploadBackground}
            onAddPin={addPin}
            onEditPin={editPin}
            onDeletePin={removePin}
            focusPinId={deepLinkedPinId}
            widthKm={activeMap?.widthKm}
            onChangeScale={previewVersion ? undefined : async widthKm => { await editMap(activeMapId, { widthKm }); }}
            onCreateEntry={previewVersion || !codexOn ? undefined : (title, type) => createEntryFromMap(scope, title, type)}
            onCommentAt={previewVersion ? undefined : at => { setMapCommentAnchor({ mapId: activeMapId, anchor: { type: 'map_point', x: at.x, y: at.y } }); requestAnimationFrame(() => notesRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })); }}
          />
          {activeMap?.backgroundImage && pendingGround && (
            <ChangeGroundDialog
              open
              oldImage={activeMap.backgroundImage}
              newImage={pendingGround}
              features={activeMap.features ?? []}
              pins={pins}
              onCancel={() => setPendingGround(null)}
              onChooseAnother={setPendingGround}
              onConfirm={change => applyGround(pendingGround, change)}
            />
          )}
          {/* Annotation surface — margin notes + backlinks for the active map */}
          <div ref={notesRef} className="pt-2 border-t border-border">
            <AnnotationSurface
              projectId={projectId}
              engineId="maps"
              entityId={activeMapId}
              layout="stack"
              pendingAnchor={mapCommentAnchor?.mapId === activeMapId ? mapCommentAnchor.anchor : null}
              onPendingAnchorConsumed={() => setMapCommentAnchor(null)}
            />
          </div>
        </>
      )}

      <CollectionDashboard
        tourAnchor="maps-list"
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
