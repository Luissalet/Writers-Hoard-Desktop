import { useRef, useState } from 'react';
import type { MapFeature, MapLayerVisibility, MapPoint, MapNamedLayer } from '@/types';
import { generateId } from '@/utils/idGenerator';
import { useTranslation } from '@/i18n/useTranslation';
import { mapFeatureCopy } from './mapFeatureCopy';
import { DEFAULT_MAP_LAYERS, EMPTY_MAP_FEATURES, EMPTY_MAP_NAMED_LAYERS, mapPoint, minimumMapPoints } from './mapGeometry';

export interface MapFeatureOptions {
  features?: MapFeature[];
  layerVisibility?: MapLayerVisibility;
  onChangeFeatures?: (features: MapFeature[]) => void | Promise<void>;
  onChangeLayers?: (layers: MapLayerVisibility) => void | Promise<void>;
  namedLayers?: MapNamedLayer[];
  onChangeNamedLayers?: (layers: MapNamedLayer[]) => void | Promise<void>;
  readOnly?: boolean;
  featureDrafts?: Map<string, MapFeature>;
}

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
  const [past, setPast] = useState<MapFeature[][]>([]);
  const [future, setFuture] = useState<MapFeature[][]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MapFeature | null>(null);
  const [query, setQuery] = useState('');
  const [activeLayerId, setActiveLayerId] = useState('');
  const lock = useRef(false);
  const [preview, setPreview] = useState<MapPoint | null>(null);
  const selected = features.find(feature => feature.id === selectedId) ?? null;
  const layers = { ...DEFAULT_MAP_LAYERS, ...layerVisibility };
  const enabled = !!onChangeFeatures || readOnly;
  const drawing = enabled && !readOnly && tool !== 'select';
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(selected);

  const select = (feature: MapFeature) => {
    if (busy || drawing) return;
    setSelectedId(feature.id);
    setDraft((!readOnly && drafts.get(feature.id)) || { ...feature, points: feature.points.map(point => ({ ...point })) });
  };
  const patch = (changes: Partial<MapFeature>) => {
    if (!draft || busy || readOnly) return;
    const next = { ...draft, ...changes };
    drafts.set(next.id, next);
    setDraft(next);
  };
  const persist = async (next: MapFeature[], history: 'edit' | 'undo' | 'redo' = 'edit'): Promise<boolean> => {
    if (!onChangeFeatures || lock.current || readOnly) return false;
    lock.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await onChangeFeatures(next);
      if (history === 'edit') {
        setPast(previous => [...previous.slice(-39), features]);
        setFuture([]);
      } else if (history === 'undo') {
        setPast(previous => previous.slice(0, -1));
        setFuture(previous => [...previous, features]);
      } else {
        setFuture(previous => previous.slice(0, -1));
        setPast(previous => [...previous.slice(-39), features]);
      }
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
    setTool(next);
    setPoints([]);
    setPreview(null);
    setFailed(false);
  };
  const finish = async (at = points) => {
    if (tool === 'select' || at.length < minimumMapPoints(tool)) return;
    const feature: MapFeature = { id: generateId('map-feature'), kind: tool, name: copy[tool], color: tool === 'path' ? '#e4a853' : '#d5b575', opacity: .22, points: at, layerId: activeLayerId || undefined };
    if (await persist([...features, feature])) {
      setTool('select');
      setPoints([]);
      setPreview(null);
      setSelectedId(feature.id);
      setDraft(feature);
    }
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
    if (await persist(features.map(feature => feature.id === submitted.id ? submitted : feature))) {
      drafts.delete(submitted.id);
      setDraft(submitted);
    }
  };
  const undo = async (redo = false) => {
    const stack = redo ? future : past;
    if (!stack.length || busy) return;
    if (await persist(stack[stack.length - 1], redo ? 'redo' : 'undo')) {
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
    try { await onChangeLayers({ ...layers, [key]: !layers[key] }); }
    catch { setFailed(true); }
    finally { lock.current = false; setBusy(false); }
  };
  const discard = () => {
    if (!selected || busy) return;
    drafts.delete(selected.id);
    setDraft({ ...selected, points: selected.points.map(point => ({ ...point })) });
    setFailed(false);
  };
  const changeNamedLayers = async (next: MapNamedLayer[]) => {
    if (!onChangeNamedLayers || lock.current) return false;
    lock.current = true; setBusy(true); setFailed(false);
    try { await onChangeNamedLayers(next); return true; }
    catch { setFailed(true); return false; }
    finally { lock.current = false; setBusy(false); }
  };
  return { enabled, readOnly, copy, features, layers, namedLayers, changeNamedLayers, activeLayerId, setActiveLayerId, tool, drawing, points, preview, setPreview, selected, draft, dirty, busy, failed, past, future, pendingDelete, setPendingDelete, query, setQuery, select, patch, persist, changeTool, finish, addPoint, save, undo, remove, toggleLayer, discard, back: () => setPoints(previous => previous.slice(0, -1)) };
}

export type MapFeatureEditor = ReturnType<typeof useMapFeatures>;
