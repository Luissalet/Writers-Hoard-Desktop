import { useRef, useState } from 'react';
import type { MapFeature, MapLayerVisibility, MapPoint, MapNamedLayer } from '@/types';
import { generateId } from '@/utils/idGenerator';
import { useTranslation } from '@/i18n/useTranslation';
import { mapFeatureCopy } from './mapFeatureCopy';
import { DEFAULT_MAP_LAYERS, EMPTY_MAP_FEATURES, EMPTY_MAP_NAMED_LAYERS, mapPoint, minimumMapPoints, rebaseMapFeatures } from './mapGeometry';

export interface MapFeatureOptions {
  features?: MapFeature[];
  layerVisibility?: MapLayerVisibility;
  onChangeFeatures?: (features: MapFeature[], baseline?:MapFeature[]) => void | MapFeature[] | Promise<void|MapFeature[]>;
  onChangeLayers?: (layers: MapLayerVisibility, baseline?:MapLayerVisibility) => void | Promise<void>;
  namedLayers?: MapNamedLayer[];
  onChangeNamedLayers?: (layers: MapNamedLayer[], baseline?:MapNamedLayer[]) => void | Promise<void>;
  readOnly?: boolean;
  featureDrafts?: Map<string, MapFeature>;
}

interface HistoryStep { before: MapFeature[]; after: MapFeature[] }

/** History holds only lightweight vector annotations; background images never enter it. */
export function useMapFeatures({ features = EMPTY_MAP_FEATURES, layerVisibility = DEFAULT_MAP_LAYERS, onChangeFeatures, onChangeLayers, namedLayers = EMPTY_MAP_NAMED_LAYERS, onChangeNamedLayers, readOnly = false, featureDrafts }: MapFeatureOptions) {
  const { locale } = useTranslation();
  const copy = mapFeatureCopy[locale];
  const [tool, setTool] = useState<'select' | MapFeature['kind']>('select');
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MapFeature | null>(null);
  const [localDrafts] = useState(() => new Map<string, MapFeature>());
  const drafts = featureDrafts ?? localDrafts;
  // Each step keeps the list before and after it, so undo and redo take back only that step
  // and keep shapes added elsewhere since.
  const [past, setPast] = useState<HistoryStep[]>([]);
  const [future, setFuture] = useState<HistoryStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MapFeature | null>(null);
  const [query, setQuery] = useState('');
  const [activeLayerId, setActiveLayerId] = useState('');
  const lock = useRef(false);
  const baseline = useRef<MapFeature[]|null>(null);
  const savedFeatures=useRef<MapFeature[]>(features);
  const [preview, setPreview] = useState<MapPoint | null>(null);
  const selected = features.find(feature => feature.id === selectedId) ?? null;
  const layers = { ...DEFAULT_MAP_LAYERS, ...layerVisibility };
  const enabled = !!onChangeFeatures || readOnly;
  const drawing = enabled && !readOnly && tool !== 'select';
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(selected);

  const select = (feature: MapFeature) => {
    if (busy || drawing) return;
    const recovered=!readOnly?drafts.get(feature.id) as (MapFeature&{__editBaseline?:MapFeature[]})|undefined:undefined;
    baseline.current=structuredClone(recovered?.__editBaseline??features);
    setSelectedId(feature.id);
    if(recovered){const {__editBaseline:ignored,...value}=recovered;void ignored;setDraft(value);}else setDraft({ ...feature, points: feature.points.map(point => ({ ...point })) });
  };
  const patch = (changes: Partial<MapFeature>) => {
    if (!draft || busy || readOnly) return;
    const next = { ...draft, ...changes };
    const retained={...next,__editBaseline:baseline.current??features};
    drafts.set(next.id, retained);
    setDraft(next);
  };
  const persist = async (proposed: MapFeature[], history: 'edit' | 'undo' | 'redo' = 'edit', proposedBefore:MapFeature[]=features): Promise<boolean> => {
    if (!onChangeFeatures || lock.current || readOnly) return false;
    // An edit built from the snapshot taken when the shape was picked lands on the
    // list as it is now, so shapes added elsewhere meanwhile are kept.
    const rebased = history === 'edit' && proposedBefore !== features;
    const next = rebased ? rebaseMapFeatures(features, proposedBefore, proposed) : proposed, before = rebased ? features : proposedBefore;
    lock.current = true;
    setBusy(true);
    setFailed(false);
    try {
      savedFeatures.current=(await onChangeFeatures(next,before))??next;
      if (history === 'edit') {
        const step = { before, after: savedFeatures.current };
        setPast(previous => [...previous.slice(-39), step]);
        setFuture([]);
      }
      // Undo and redo move their step between the stacks themselves (see `undo`).
      return true;
    } catch {
      setFailed(true);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const changeTool = (next: typeof tool) => {
    if (busy) return;
    baseline.current=structuredClone(features);
    setTool(next);
    setPoints([]);
    setPreview(null);
    setFailed(false);
  };
  const finishAs = async (kind: MapFeature['kind'], at: MapPoint[]) => {
    if (at.length < minimumMapPoints(kind)) return;
    const feature: MapFeature = { id: generateId('map-feature'), kind, name: copy[kind], color: kind === 'path' ? '#e4a853' : '#d5b575', opacity: .22, points: at, layerId: activeLayerId || undefined };
    if (await persist([...(baseline.current??features), feature],'edit',baseline.current??features)) {
      baseline.current = structuredClone(savedFeatures.current);
      setTool('select');
      setPoints([]);
      setPreview(null);
      setSelectedId(feature.id);
      setDraft(feature);
    }
  };
  const finish = async (at = points) => { if (tool !== 'select') await finishAs(tool, at); };
  /** Starts a shape from a point picked elsewhere (the map's right-click menu). A label is placed at once. */
  const beginAt = (kind: MapFeature['kind'], point: MapPoint) => {
    if (busy || readOnly) return;
    baseline.current = structuredClone(features);
    const at = [mapPoint(point.x, point.y)];
    setFailed(false);
    setPreview(null);
    if (kind === 'label') { setTool('label'); setPoints(at); void finishAs('label', at); return; }
    setTool(kind);
    setPoints(at);
  };
  const addPoint = (point: MapPoint) => {
    if (!drawing || busy) return;
    const next = [...points, mapPoint(point.x, point.y)];
    setPoints(next);
    if (tool === 'label') void finish(next);
  };
  const save = async () => {
    if (!draft?.name.trim()) return;
    const submitted = { ...draft, name: draft.name.trim(), points: draft.points.map(point => mapPoint(point.x, point.y)) };
    if (await persist((baseline.current??features).map(feature => feature.id === submitted.id ? submitted : feature),'edit',baseline.current??features)) {
      drafts.delete(submitted.id);
      baseline.current=structuredClone(savedFeatures.current);
      setDraft(savedFeatures.current.find(feature=>feature.id===submitted.id)??submitted);
    }
  };
  const undo = async (redo = false) => {
    const stack = redo ? future : past;
    if (!stack.length || busy) return;
    const step = stack[stack.length - 1];
    const target = redo ? rebaseMapFeatures(features, step.before, step.after) : rebaseMapFeatures(features, step.after, step.before);
    if (await persist(target, redo ? 'redo' : 'undo')) {
      if (redo) { setFuture(previous => previous.slice(0, -1)); setPast(previous => [...previous.slice(-39), step]); }
      else { setPast(previous => previous.slice(0, -1)); setFuture(previous => [...previous, step]); }
      setSelectedId(null);
      setDraft(null);
    }
  };
  const remove = async () => {
    if (!pendingDelete) return;
    if (await persist(features.filter(feature => feature.id !== pendingDelete.id))) {
      drafts.delete(pendingDelete.id);
      setSelectedId(null);
      setDraft(null);
      setPendingDelete(null);
    }
  };
  const toggleLayer = async (key: keyof MapLayerVisibility) => {
    if (!onChangeLayers || lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailed(false);
    try { await onChangeLayers({ ...layers, [key]: !layers[key] },layers); }
    catch { setFailed(true); }
    finally { lock.current = false; setBusy(false); }
  };
  const discard = () => {
    if (!selected || busy) return;
    baseline.current=structuredClone(features);
    drafts.delete(selected.id);
    setDraft({ ...selected, points: selected.points.map(point => ({ ...point })) });
    setFailed(false);
  };
  const changeNamedLayers = async (next: MapNamedLayer[], before:MapNamedLayer[]=namedLayers) => {
    if (!onChangeNamedLayers || lock.current) return false;
    lock.current = true; setBusy(true); setFailed(false);
    try { await onChangeNamedLayers(next,before); return true; }
    catch { setFailed(true); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  return { enabled, readOnly, copy, features, layers, namedLayers, changeNamedLayers, activeLayerId, setActiveLayerId, tool, drawing, points, preview, setPreview, selected, draft, dirty, busy, failed, past, future, pendingDelete, setPendingDelete, query, setQuery, select, patch, persist, changeTool, beginAt, finish, addPoint, save, undo, remove, toggleLayer, discard, back: () => setPoints(previous => previous.slice(0, -1)) };
}

export type MapFeatureEditor = ReturnType<typeof useMapFeatures>;
