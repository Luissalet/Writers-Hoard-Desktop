import {useLocalToolAtomPending} from '@/engines/local/blocks/pending';
import { useState, useRef, useCallback, useEffect } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import {
  Plus,
  Upload,
  Trash2,
  MapPin as MapPinIcon,
  Mountain,
  Trees,
  Castle,
  Anchor,
  Landmark,
  Church,
  Images,
  Link2,
  Move,
  Download,
} from 'lucide-react';
import { saveAs } from 'file-saver';
import { useEmbeddedToolCloseGuard } from '@/components/editor/toolBlocks/EmbeddedToolCloseContext';
import type { CodexEntry, CodexEntryType, MapPin, MapPoint } from '@/types';
import { generateId } from '@/utils/idGenerator';
import Modal from '@/components/common/Modal';
import EmptyState from '@/components/common/EmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import GalleryAssetPicker from '@/components/gallery/GalleryAssetPicker';
import { ConfirmDialog } from '@/engines/_shared';
import { useMapFeatures, type MapFeatureOptions } from './useMapFeatures';
import { MapFeatureCanvas, MapFeatureInspector, MapFeatureToolbar } from './MapFeatureEditor';
import { exportMapSvg, mapItemLayers, mapItemVisible, withMapLayers } from './mapGeometry';
import MapViewportControls from './MapViewportControls';
import CodexEntryPicker from './CodexEntryPicker';
import MapContextMenu, { type MapMenuAt } from './MapContextMenu';
import MapCommentMarks from './MapCommentMarks';
import MapScalePanel from './MapScalePanel';
import MapScaleOverlay from './MapScaleOverlay';
import { outlineOnPicture, pictureAspect } from './mapScale';
import { loadBasemap } from '@/engines/real-atlas/basemap';
import { referenceRings, SCALE_REFERENCES } from '@/engines/worldgen/core/scaleReference';

const PIN_ICONS: Record<string, { icon: typeof MapPinIcon; color: string }> = {
  city: { icon: MapPinIcon, color: '#c4973b' },
  mountain: { icon: Mountain, color: '#8a8690' },
  forest: { icon: Trees, color: '#4a9e6d' },
  castle: { icon: Castle, color: '#c4463a' },
  port: { icon: Anchor, color: '#4a7ec4' },
  ruins: { icon: Landmark, color: '#7c5cbf' },
  temple: { icon: Church, color: '#d4a843' },
  village: { icon: MapPinIcon, color: '#9b7ed8' },
  cave: { icon: Mountain, color: '#5a5665' },
  custom: { icon: MapPinIcon, color: '#e8e5e0' },
};

interface MapViewProps extends MapFeatureOptions {
  projectId: string;
  mapId: string;
  backgroundImage?: string;
  pins: MapPin[];
  codexEntries?: CodexEntry[];
  onUploadBackground: (imageData: string) => void;
  onAddPin: (pin: MapPin) => void | Promise<void>;
  onEditPin: (id: string, changes: Partial<MapPin>, baseline?:MapPin) => void | MapPin | Promise<void|MapPin>;
  onDeletePin: (id: string) => void | Promise<void>;
  /**
   * Pin to open on mount, from a `?pin=` deep link (search hit, backlink).
   * Handled here rather than by the caller because pin selection also seeds
   * the editor draft.
   */
  focusPinId?: string | null;
  /** Owned by the engine so a map switch retains another pin's draft. */
  drafts?: Map<string, PinDraft>;
  onOpenEntry?: (entryId: string) => void;
  /** Creates a Codex entry from the map (link picker, right-click "new entry here"); resolves with its id. */
  onCreateEntry?: (title: string, type: CodexEntryType) => Promise<string>;
  /** Opens a comment anchored at a spot on the map (right-click "comment here"). */
  onCommentAt?: (at: { x: number; y: number }) => void;
  /** Kilometres the picture spans from left to right; unset means no scale. */
  widthKm?: number;
  onChangeScale?: (widthKm: number | undefined) => void | Promise<void>;
}

/** Pin icon for an entry created from the map, by the kind of entry. */
const ENTRY_PIN_ICON: Partial<Record<CodexEntryType, MapPin['icon']>> = { location: 'city', faction: 'castle', magic: 'temple', item: 'ruins' };

export interface PinDraft {
  /** Rejected drag remains a recoverable explicit pending edit. */
  position?:MapPin['position'];
  baseline?:MapPin;
  name: string;
  description: string;
  icon: MapPin['icon'];
  color?: string;
  linkedEntryId?: string;
  layerId?: string;
  size?: MapPin['size'];
  hideIcon?: boolean;
  layerIds?: string[];
}

interface PinDragState {
  id: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
  position: MapPin['position'];
  baseline:MapPin;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export default function MapView({
  projectId,
  mapId,
  backgroundImage,
  pins,
  codexEntries = [],
  onUploadBackground,
  onAddPin,
  onEditPin,
  onDeletePin,
  focusPinId,
  drafts: suppliedDrafts,
  features,
  layerVisibility,
  onChangeFeatures,
  onChangeLayers,
  onOpenEntry,
  namedLayers,
  onChangeNamedLayers,
  readOnly = false,
  featureDrafts,
  onCreateEntry,
  onCommentAt,
  widthKm,
  onChangeScale,
}: MapViewProps) {
  const { t } = useTranslation();
  const [placingPin, setPlacingPin] = useState(false);
  const [pinType, setPinType] = useState<MapPin['icon']>('city');
  const [showPinForm, setShowPinForm] = useState(false);
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null);
  const [pinName, setPinName] = useState('');
  const [pinDescription, setPinDescription] = useState('');
  const [hoveredPin, setHoveredPin] = useState<string | null>(null);
  const [showGallery, setShowGallery] = useState(false);
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState<PinDraft | null>(null);
  const [pendingDeletePin, setPendingDeletePin] = useState<MapPin | null>(null);
  const [dragState, setDragState] = useState<PinDragState | null>(null);
  const [savingPin, setSavingPin] = useState(false);
  const [creatingPin, setCreatingPin] = useState(false);
  const [createPinFailed, setCreatePinFailed] = useState(false);
  const [editPinFailedId, setEditPinFailedId] = useState<string | null>(null);
  const [localDrafts] = useState(() => new Map<string, PinDraft>());
  const drafts = suppliedDrafts ?? localDrafts;
  const mapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageSize, setImageSize] = useState({ width: 1000, height: 600 });
  const [menu, setMenu] = useState<MapMenuAt | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const madeEntry = useRef<{ key: string; id: string } | null>(null);
  // Measuring: null when off, the points marked so far when on.
  const [measure, setMeasure] = useState<MapPoint[] | null>(null);
  // A real place's outline laid on the map at its scale.
  const [realId, setRealId] = useState('');
  const [realCenter, setRealCenter] = useState<MapPoint>({ x: 50, y: 50 });
  const [realRings, setRealRings] = useState<{ id: string; rings: number[][][] } | null>(null);
  const [outlineDragging, setOutlineDragging] = useState(false);
  const aspect = pictureAspect(imageSize.width, imageSize.height);
  useEffect(() => {
    const ref = SCALE_REFERENCES.find(item => item.id === realId);
    if (!ref) return;
    let live = true;
    void loadBasemap().then(basemap => { if (live) setRealRings({ id: ref.id, rings: referenceRings(basemap, ref) }); });
    return () => { live = false; };
  }, [realId]);
  const realOutline = widthKm && realRings && realRings.id === realId ? outlineOnPicture(realRings.rings, realCenter, widthKm, aspect) : null;
  const featureEditor = useMapFeatures({ features, layerVisibility, onChangeFeatures, onChangeLayers, namedLayers, onChangeNamedLayers, readOnly, featureDrafts });

  const selectedPin = pins.find((pin) => pin.id === selectedPinId) ?? null;
  useEmbeddedToolCloseGuard(()=>{
    if(readOnly)return true;
    if(savingPin||creatingPin||featureEditor.busy||showPinForm||featureEditor.dirty||featureEditor.drawing&&featureEditor.points.length>0)return false;
    return !pinDraft||!selectedPin||JSON.stringify({...pinDraft,baseline:undefined})===JSON.stringify({name:selectedPin.name,description:selectedPin.description??'',icon:selectedPin.icon,color:selectedPin.color,linkedEntryId:selectedPin.linkedEntryId,layerId:selectedPin.layerId,layerIds:selectedPin.layerIds,size:selectedPin.size,hideIcon:selectedPin.hideIcon});
  });
  useLocalToolAtomPending(!readOnly&&(savingPin||creatingPin||featureEditor.busy||showPinForm||featureEditor.dirty||featureEditor.drawing&&featureEditor.points.length>0||!!pinDraft&&!!selectedPin&&JSON.stringify({...pinDraft,baseline:undefined})!==JSON.stringify({name:selectedPin.name,description:selectedPin.description??'',icon:selectedPin.icon,color:selectedPin.color,linkedEntryId:selectedPin.linkedEntryId,layerId:selectedPin.layerId,layerIds:selectedPin.layerIds,size:selectedPin.size,hideIcon:selectedPin.hideIcon})));
  const linkedEntry = selectedPin?.linkedEntryId
    ? codexEntries.find((entry) => entry.id === selectedPin.linkedEntryId)
    : null;
  const sortedCodexEntries = [...codexEntries].sort((a, b) => {
    if (a.type === 'location' && b.type !== 'location') return -1;
    if (a.type !== 'location' && b.type === 'location') return 1;
    return a.title.localeCompare(b.title);
  });

  const selectPin = useCallback((pin: MapPin) => {
    setSelectedPinId(pin.id);
    const recovered=drafts.get(pin.id);
    if (recovered) {
      // The submitted object must remain the journal owner so a successful
      // retry retires it without deleting a newer edit made during the save.
      const normalized = recovered.baseline ? recovered : { ...recovered, baseline: structuredClone(pin) };
      if (normalized !== recovered) drafts.set(pin.id, normalized);
      setPinDraft(normalized);
      return;
    }
    setPinDraft({
      baseline:structuredClone(pin),
      name: pin.name,
      description: pin.description ?? '',
      icon: pin.icon,
      color: pin.color,
      linkedEntryId: pin.linkedEntryId,
      layerId: pin.layerId,
      layerIds: pin.layerIds,
      size: pin.size,
      hideIcon: pin.hideIcon,
    });
  }, [drafts]);

  const patchPinDraft = (next: PinDraft) => {
    if (selectedPinId) drafts.set(selectedPinId, next);
    setPinDraft(next);
  };

  // Open the pin a `?pin=` deep link asked for, once its row has landed.
  const focusedPin = useRef<string | null>(null);
  useEffect(() => {
    if (!focusPinId || focusedPin.current === focusPinId) return;
    const pin = pins.find((p) => p.id === focusPinId);
    if (!pin) return;
    focusedPin.current = focusPinId;
    selectPin(pin);
  }, [focusPinId, pins, selectPin]);

  const getMapPosition = (clientX: number, clientY: number): MapPin['position'] | null => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: clampPercentage(((clientX - rect.left) / rect.width) * 100),
      y: clampPercentage(((clientY - rect.top) / rect.height) * 100),
    };
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      onUploadBackground(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleMapClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (measure && backgroundImage) {
      const rect = e.currentTarget.getBoundingClientRect();
      setMeasure([...measure, { x: clampPercentage(((e.clientX - rect.left) / rect.width) * 100), y: clampPercentage(((e.clientY - rect.top) / rect.height) * 100) }]);
      return;
    }
    if (!placingPin || !backgroundImage) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPendingPosition({ x, y });
    setCreatePinFailed(false);
    setShowPinForm(true);
  }, [placingPin, backgroundImage, measure]);

  const handleSavePin = async () => {
    if (!pendingPosition || !pinName.trim() || creatingPin) return;
    setCreatingPin(true);
    setCreatePinFailed(false);
    try {
    await onAddPin({
      id: generateId('pin'),
      projectId,
      mapId,
      name: pinName.trim(),
      icon: pinType,
      position: pendingPosition,
      description: pinDescription,
      layerId: featureEditor.activeLayerId || undefined,
    });
    setShowPinForm(false);
    setPinName('');
    setPinDescription('');
    setPendingPosition(null);
    setPlacingPin(false);
    } catch {
      setCreatePinFailed(true);
    } finally {
      setCreatingPin(false);
    }
  };

  const handleSavePinEdits = async () => {
    if (!selectedPin || !pinDraft?.name.trim() || savingPin) return;
    const id = selectedPin.id;
    const submitted = pinDraft;
    setSavingPin(true);
    setEditPinFailedId(null);
    try {
      const changes:Partial<MapPin>={
        name: pinDraft.name.trim(),
        description: pinDraft.description.trim(),
        icon: pinDraft.icon,
        color: pinDraft.color,
        linkedEntryId: pinDraft.linkedEntryId || undefined,
        layerId: pinDraft.layerId || undefined,
        layerIds: pinDraft.layerIds,
        size: pinDraft.size,
        hideIcon: pinDraft.hideIcon || undefined,
        ...(pinDraft.position?{position:pinDraft.position}:{}),
      };
      const before=submitted.baseline??selectedPin,initial={name:before.name,description:before.description??'',icon:before.icon,color:before.color,linkedEntryId:before.linkedEntryId||undefined,layerId:before.layerId||undefined,layerIds:before.layerIds,size:before.size,hideIcon:before.hideIcon||undefined,position:before.position},changed=Object.fromEntries(Object.entries(changes).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(initial[key as keyof typeof initial])));
      const saved=await onEditPin(id,changed,submitted.baseline),confirmed=saved??{...selectedPin,...changes};
      if (drafts.get(id) === submitted) drafts.delete(id);
      setPinDraft(current=>current===submitted?{name:confirmed.name,description:confirmed.description??'',icon:confirmed.icon,color:confirmed.color,linkedEntryId:confirmed.linkedEntryId,layerId:confirmed.layerId,layerIds:confirmed.layerIds,size:confirmed.size,hideIcon:confirmed.hideIcon,baseline:confirmed}:current);
    } catch {
      setEditPinFailedId(id);
    } finally {
      setSavingPin(false);
    }
  };

  const handlePinPointerDown = (e: React.PointerEvent<HTMLDivElement>, pin: MapPin) => {
    e.stopPropagation();
    // Sólo si es OTRO pin. `selectPin` reinicia el borrador con lo último
    // guardado, y esto se ejecuta en cada `pointerdown` —antes incluso de saber
    // si el gesto va a ser un clic o un arrastre—, así que reseleccionar el pin
    // que ya estabas editando te borraba la descripción recién escrita: abrías
    // el pin, escribías, y lo arrastrabas para recolocarlo antes de guardar.
    if (pin.id !== selectedPinId) selectPin(pin);
    if (readOnly || placingPin || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({
      id: pin.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
      position: pin.position,baseline:structuredClone(pin),
    });
  };

  const handlePinPointerMove = (e: React.PointerEvent<HTMLDivElement>, pinId: string) => {
    if (!dragState || dragState.id !== pinId || dragState.pointerId !== e.pointerId) return;
    e.stopPropagation();
    const position = getMapPosition(e.clientX, e.clientY);
    if (!position) return;
    const moved =
      dragState.moved ||
      Math.hypot(e.clientX - dragState.startClientX, e.clientY - dragState.startClientY) >= 3;
    setDragState({ ...dragState, moved, position });
  };

  const finishPinDrag = async (e: React.PointerEvent<HTMLDivElement>, pinId: string) => {
    if (!dragState || dragState.id !== pinId || dragState.pointerId !== e.pointerId) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const position = getMapPosition(e.clientX, e.clientY) ?? dragState.position;
    const moved =
      dragState.moved ||
      Math.hypot(e.clientX - dragState.startClientX, e.clientY - dragState.startClientY) >= 3;
    if (moved) {
      try {
        await onEditPin(pinId, { position },dragState.baseline);
      } catch {
        const original=dragState.baseline,recovered=drafts.get(pinId)??pinDraft??{name:original.name,description:original.description??'',icon:original.icon,color:original.color,linkedEntryId:original.linkedEntryId,layerId:original.layerId};
        const pending={...recovered,position,baseline:recovered.baseline??original};drafts.set(pinId,pending);setPinDraft(pending);setEditPinFailedId(pinId);
      } finally {
        setDragState(null);
      }
      return;
    }
    setDragState(null);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeletePin) return;
    const id = pendingDeletePin.id;
    await onDeletePin(id);
    drafts.delete(id);
    if (selectedPinId === id) {
      setSelectedPinId(null);
      setPinDraft(null);
    }
    setPendingDeletePin(null);
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      {!readOnly && <div className="flex items-center gap-3 flex-wrap">
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-4 py-2 bg-elevated border border-border rounded-lg text-sm text-text-muted hover:text-text-primary transition"
        >
          <Upload size={16} />
          {backgroundImage ? t('maps.changeMap') : t('maps.uploadMapImage')}
        </button>
        <button
          type="button"
          onClick={() => setShowGallery(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-elevated border border-border rounded-lg text-sm text-text-muted hover:text-text-primary transition"
        >
          <Images size={16} />
          {t('sidebar.gallery')}
        </button>

        {backgroundImage && (
          <>
            <div className="w-px h-6 bg-border" />
            <button
              onClick={() => { featureEditor.changeTool('select'); setPlacingPin(!placingPin); }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm transition ${
                placingPin
                  ? 'bg-accent-gold text-deep font-semibold'
                  : 'bg-elevated border border-border text-text-muted hover:text-text-primary'
              }`}
            >
              <Plus size={16} />
              {placingPin ? t('maps.clickToPlace') : t('maps.addPin')}
            </button>

            {placingPin && (
              <div className="flex gap-1">
                {Object.entries(PIN_ICONS).map(([key, val]) => {
                  const Icon = val.icon;
                  return (
                    <button
                      key={key}
                      onClick={() => setPinType(key as MapPin['icon'])}
                      className={`p-1.5 rounded transition ${pinType === key ? 'bg-elevated ring-1 ring-accent-gold' : 'hover:bg-elevated'}`}
                      title={key}
                    >
                      <Icon size={16} style={{ color: val.color }} />
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>}

      {backgroundImage && <MapFeatureToolbar editor={featureEditor} onToolChange={() => { setPlacingPin(false); setMeasure(null); }} />}
      {backgroundImage && <MapScalePanel widthKm={widthKm} aspect={aspect} readOnly={readOnly} onSetScale={onChangeScale} measure={measure} onMeasure={points => { setMeasure(points); if (points) { setPlacingPin(false); if (featureEditor.drawing) featureEditor.changeTool('select'); } }} realId={realId} onRealId={id => { setRealId(id); setRealCenter({ x: 50, y: 50 }); }} realSize={realOutline ? { widthKm: realOutline.widthKm, heightKm: realOutline.heightKm } : null} pins={pins}
        onRenamePins={readOnly ? undefined : async matches => { for (const match of matches) { const pin = pins.find(item => item.id === match.pinId); if (pin) await onEditPin(pin.id, { name: match.to }, pin); } }} />}
      {backgroundImage && featureEditor.enabled && <button type="button" className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-accent-gold" onClick={() => saveAs(new Blob([exportMapSvg(backgroundImage, imageSize.width, imageSize.height, featureEditor.features, pins, featureEditor.layers, featureEditor.namedLayers, widthKm)], { type: 'image/svg+xml;charset=utf-8' }), `map-${mapId}.svg`)}><Download size={14} />{featureEditor.copy.export}</button>}

      {/* Map Canvas */}
      <div className={featureEditor.selected ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]' : 'space-y-4'}>
      {!backgroundImage ? (
        <EmptyState
          icon={<MapPinIcon size={40} />}
          title={t('maps.empty.title')}
          message={t('maps.empty.message')}
          action={readOnly ? undefined : { label: t('maps.empty.action'), onClick: () => fileInputRef.current?.click() }}
        />
      ) : (
        <div className="relative min-w-0 rounded-xl overflow-hidden border border-border bg-deep">
          <TransformWrapper
            initialScale={1}
            minScale={0.05}
            maxScale={5}
            panning={{ disabled: placingPin || featureEditor.drawing || dragState !== null || outlineDragging }}
            doubleClick={{ disabled: placingPin || featureEditor.drawing }}
          >
            <MapViewportControls mapRef={mapRef} imageWidth={imageSize.width} imageHeight={imageSize.height} />
            <TransformComponent wrapperStyle={{ width: '100%', height: '500px' }}>
              <div ref={mapRef} className="relative inline-block" onClick={handleMapClick} onContextMenu={event => { if (readOnly || featureEditor.busy) return; const at = getMapPosition(event.clientX, event.clientY); if (!at) return; event.preventDefault(); setMenu({ clientX: event.clientX, clientY: event.clientY, x: at.x, y: at.y }); }} data-testid="map-surface">
                <img src={backgroundImage} alt={featureEditor.copy.mapAlt} draggable={false} onLoad={event => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} className="max-w-none block" style={{ maxHeight: '800px' }} />
                <MapFeatureCanvas editor={featureEditor} aspectRatio={imageSize.width / imageSize.height} />

                {/* Pins */}
                {featureEditor.layers.pins && pins.filter(pin => mapItemVisible(pin, featureEditor.namedLayers)).map(pin => {
                  const config = PIN_ICONS[pin.icon] || PIN_ICONS.custom;
                  const Icon = config.icon;
                  const isSelected = selectedPinId === pin.id;
                  const position = dragState?.id === pin.id ? dragState.position : pin.position;
                  return (
                    <div
                      key={pin.id}
                      className="absolute group"
                      data-map-pin-id={pin.id}
                      style={{
                        left: `${position.x}%`,
                        top: `${position.y}%`,
                        transform: 'translate(-50%, -100%)',
                        touchAction: 'none',
                        pointerEvents: featureEditor.drawing ? 'none' : undefined,
                      }}
                      onMouseEnter={() => setHoveredPin(pin.id)}
                      onMouseLeave={() => setHoveredPin(null)}
                      onPointerDown={(e) => handlePinPointerDown(e, pin)}
                      onPointerMove={(e) => handlePinPointerMove(e, pin.id)}
                      onPointerUp={(e) => void finishPinDrag(e, pin.id)}
                      onPointerCancel={() => setDragState(null)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="relative">
                        <div
                          data-testid={`map-pin-marker-${pin.id}`}
                          data-size={pin.size ?? 'M'}
                          className={`${pin.size === 'S' ? 'w-5 h-5' : pin.size === 'L' ? 'w-11 h-11' : 'w-8 h-8'} rounded-full flex items-center justify-center shadow-lg ${readOnly ? 'cursor-pointer' : 'cursor-move'} border-2 transition-transform hover:scale-125 ${
                            isSelected
                              ? 'border-white ring-2 ring-accent-gold ring-offset-2 ring-offset-deep'
                              : 'border-white/20'
                          }`}
                          style={{ backgroundColor: pin.color ?? config.color }}
                        >
                          {!pin.hideIcon && <Icon size={pin.size === 'S' ? 11 : pin.size === 'L' ? 22 : 16} className="text-white" />}
                        </div>

                        {/* Tooltip */}
                        {hoveredPin === pin.id && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-surface border border-border rounded-lg px-3 py-2 shadow-xl whitespace-nowrap z-10 min-w-[120px]">
                            <h4 className="font-serif font-bold text-accent-gold text-sm">{pin.name}</h4>
                            {pin.description && <p className="text-xs text-text-muted mt-0.5">{pin.description}</p>}
                            {linkedEntry && isSelected && (
                              <p className="text-[10px] text-text-dim mt-1 flex items-center gap-1">
                                <Link2 size={10} />
                                {linkedEntry.title}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* Comments sit on the current picture; an old era being previewed may not match it. */}
                {!readOnly && <MapCommentMarks projectId={projectId} mapId={mapId} toPicture={getMapPosition} onDragging={setOutlineDragging} />}
                <MapScaleOverlay aspect={aspect} widthKm={widthKm} measure={measure} outline={realOutline ? { rings: realOutline.rings, center: realCenter } : null} toPicture={getMapPosition} onMoveOutline={setRealCenter} onDragOutline={setOutlineDragging} />
              </div>

            </TransformComponent>
          </TransformWrapper>
        </div>
      )}

      {backgroundImage && <MapFeatureInspector editor={featureEditor} entries={sortedCodexEntries} onOpenEntry={onOpenEntry} onCreateEntry={onCreateEntry} scale={widthKm ? { widthKm, aspect } : undefined} />}
      </div>

      {/* Pin sidebar */}
      {pins.length > 0 && (
        <div className={`grid gap-4 ${selectedPin && pinDraft ? 'lg:grid-cols-[minmax(220px,0.8fr)_minmax(320px,1.2fr)]' : ''}`}>
          <div className="bg-surface border border-border rounded-xl p-4 min-w-0">
            <h4 className="font-serif font-bold text-accent-gold text-sm mb-3">
              {t('maps.markers')} ({pins.length})
            </h4>
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
              {pins.map(pin => {
                const config = PIN_ICONS[pin.icon] || PIN_ICONS.custom;
                const Icon = config.icon;
                const isSelected = selectedPinId === pin.id;
                return (
                  <div
                    key={pin.id}
                    className={`flex items-center gap-1 rounded transition group ${
                      isSelected ? 'bg-accent-gold/10 ring-1 ring-accent-gold/30' : 'hover:bg-elevated'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => selectPin(pin)}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
                    >
                      <Icon size={14} style={{ color: pin.color ?? config.color }} />
                      <span className="text-sm text-text-primary flex-1 truncate">{pin.name}</span>
                      {!readOnly && <Move size={12} className="text-text-dim opacity-0 group-hover:opacity-100" />}
                    </button>
                    {!readOnly && <button
                      type="button"
                      onClick={() => setPendingDeletePin(pin)}
                      className="p-1.5 mr-1 opacity-0 group-hover:opacity-100 hover:bg-danger/20 rounded transition"
                      title={t('common.delete')}
                    >
                      <Trash2 size={12} className="text-danger" />
                    </button>}
                  </div>
                );
              })}
            </div>
          </div>

          {selectedPin && readOnly && <div className="rounded-xl border border-border bg-surface p-4"><h4 className="font-serif text-accent-gold">{selectedPin.name}</h4><p className="mt-2 text-sm text-text-muted whitespace-pre-wrap">{selectedPin.description}</p>{linkedEntry && onOpenEntry && <button type="button" className="mt-3 text-sm text-accent-gold" onClick={() => onOpenEntry(linkedEntry.id)}>{featureEditor.copy.openEntry}: {linkedEntry.title}</button>}</div>}
          {selectedPin && pinDraft && !readOnly && (
            <div className="bg-surface border border-border rounded-xl p-4 min-w-0">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h4 className="font-serif font-bold text-accent-gold text-sm truncate">
                  {t('common.edit')}: {selectedPin.name}
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPinId(null);
                    setPinDraft(null);
                  }}
                  className="text-xs text-text-muted hover:text-text-primary transition"
                >
                  {t('common.close')}
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">{t('common.name')}</label>
                  <input
                    value={pinDraft.name}
                    onChange={(e) => patchPinDraft({ ...pinDraft, name: e.target.value })}
                    className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition"
                  />
                </div>
                <div>
                  <span className="block text-xs text-text-muted mb-1.5">{t('gallery.linkEntries')}</span>
                  <CodexEntryPicker entries={sortedCodexEntries} value={pinDraft.linkedEntryId} onChange={id => patchPinDraft({ ...pinDraft, linkedEntryId: id })} onCreate={onCreateEntry} testId="map-pin-link" disabled={savingPin} />
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-xs text-text-muted mb-1.5">{t('common.description')}</label>
                <textarea
                  value={pinDraft.description}
                  onChange={(e) => patchPinDraft({ ...pinDraft, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition resize-none"
                />
              </div>

              {!!featureEditor.namedLayers.length && <fieldset className="mt-4 text-xs text-text-muted" data-testid="map-pin-layers"><legend>{featureEditor.copy.layersOf}</legend><div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">{featureEditor.namedLayers.map(layer => { const ids = mapItemLayers(pinDraft); return <label key={layer.id} className="flex items-center gap-1.5"><input type="checkbox" className="accent-accent-gold" checked={ids.includes(layer.id)} onChange={event => patchPinDraft({ ...pinDraft, ...withMapLayers(event.target.checked ? [...ids, layer.id] : ids.filter(id => id !== layer.id)) })} data-testid={`map-pin-layer-${layer.id}`} />{layer.name}</label>; })}</div></fieldset>}
              {linkedEntry && onOpenEntry && <button type="button" onClick={() => onOpenEntry(linkedEntry.id)} className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent-gold hover:underline"><Link2 size={14} />{featureEditor.copy.openEntry}: {linkedEntry.title}</button>}

              <div className="mt-4">
                <label className="block text-xs text-text-muted mb-2">{t('common.changeIcon')}</label>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(PIN_ICONS).map(([key, config]) => {
                    const Icon = config.icon;
                    const isActive = pinDraft.icon === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => patchPinDraft({ ...pinDraft, icon: key as MapPin['icon'] })}
                        className={`p-2 rounded-lg border transition ${
                          isActive
                            ? 'bg-accent-gold/10 border-accent-gold'
                            : 'bg-elevated border-border hover:border-text-dim'
                        }`}
                        title={key}
                        aria-label={key}
                      >
                        <Icon size={16} style={{ color: pinDraft.color ?? config.color }} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3" data-testid="map-pin-look">
                <span className="text-xs text-text-muted">{t('maps.pinSize')}</span>
                {(['S', 'M', 'L'] as const).map(size => <button key={size} type="button" data-testid={`map-pin-size-${size}`} onClick={() => patchPinDraft({ ...pinDraft, size: size === 'M' ? undefined : size })} className={`px-2.5 py-1 rounded-lg border text-xs ${(pinDraft.size ?? 'M') === size ? 'bg-accent-gold/10 border-accent-gold text-accent-gold' : 'bg-elevated border-border'}`}>{size}</button>)}
                <label className="flex items-center gap-1.5 text-xs text-text-muted"><input type="checkbox" checked={!!pinDraft.hideIcon} onChange={event => patchPinDraft({ ...pinDraft, hideIcon: event.target.checked || undefined })} className="accent-accent-gold" data-testid="map-pin-hide-icon" />{t('maps.hideIcon')}</label>
              </div>

              {drafts.has(selectedPin.id) && <p className="mt-3 text-xs text-text-muted">{t('maps.draftKept')}</p>}
              {editPinFailedId === selectedPin.id && <p role="alert" className="mt-3 text-sm text-danger">{t('common.saveFailed')}</p>}
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">{t('common.changeColor')}</label>
                  <input
                    type="color"
                    value={pinDraft.color ?? (PIN_ICONS[pinDraft.icon] || PIN_ICONS.custom).color}
                    onChange={(e) => patchPinDraft({ ...pinDraft, color: e.target.value })}
                    className="block h-9 w-14 cursor-pointer rounded border border-border bg-elevated p-1"
                  />
                </div>
                {pinDraft.color && (
                  <button
                    type="button"
                    onClick={() => patchPinDraft({ ...pinDraft, color: undefined })}
                    className="mb-0.5 px-3 py-2 text-xs text-text-muted hover:text-text-primary transition"
                  >
                    {t('common.resetDefault')}
                  </button>
                )}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => setPendingDeletePin(selectedPin)}
                  className="px-3 py-2 text-sm text-danger hover:bg-danger/10 rounded-lg transition"
                >
                  {t('common.delete')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSavePinEdits()}
                  data-testid="map-pin-save"
                  disabled={savingPin || !pinDraft.name.trim()}
                  className="px-4 py-2 bg-accent-gold text-deep text-sm font-semibold rounded-lg hover:bg-accent-amber transition disabled:opacity-50"
                >
                  {savingPin ? t('common.saving') : t('common.save')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pin creation modal */}
      <Modal open={showPinForm} busy={creatingPin} onClose={() => { if (!creatingPin) { setShowPinForm(false); setPendingPosition(null); } }} title={t('maps.newPin')}>
        <fieldset disabled={creatingPin} className="space-y-4">
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('common.name')}</label>
            <input
              value={pinName}
              onChange={(e) => setPinName(e.target.value)}
              placeholder={t('maps.locationName')}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('common.description')}</label>
            <textarea
              value={pinDescription}
              onChange={(e) => setPinDescription(e.target.value)}
              placeholder={t('maps.briefDescription')}
              rows={2}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition resize-none"
            />
          </div>
          {createPinFailed && <p role="alert" className="text-sm text-danger">{t('common.saveFailed')}</p>}
          <div className="flex gap-3 pt-2">
            <button onClick={handleSavePin} disabled={creatingPin} className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition disabled:opacity-50">
              {t(creatingPin ? 'common.saving' : 'maps.placePin')}
            </button>
            <button onClick={() => { setShowPinForm(false); setPendingPosition(null); }} className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition">
              {t('common.cancel')}
            </button>
          </div>
        </fieldset>
      </Modal>
      <GalleryAssetPicker
        projectId={projectId}
        open={showGallery}
        onClose={() => setShowGallery(false)}
        onSelect={selection => onUploadBackground(selection.imageData)}
      />
      <ConfirmDialog
        open={pendingDeletePin !== null}
        destructive
        message={pendingDeletePin ? `${t('common.delete')} "${pendingDeletePin.name}"?` : ''}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeletePin(null)}
      />
      {menu && <MapContextMenu at={menu} onClose={closeMenu}
        onNewEntry={onCreateEntry ? async (title, type) => {
          // If the entry was made but its pin failed, a retry reuses it instead of making a second one.
          const key = JSON.stringify([title, type, menu.x, menu.y]);
          const entryId = madeEntry.current?.key === key ? madeEntry.current.id : await onCreateEntry(title, type);
          madeEntry.current = { key, id: entryId };
          const pin: MapPin = { id: generateId('pin'), projectId, mapId, name: title, icon: ENTRY_PIN_ICON[type] ?? 'custom', position: { x: menu.x, y: menu.y }, description: '', linkedEntryId: entryId, layerId: featureEditor.activeLayerId || undefined };
          await onAddPin(pin);
          madeEntry.current = null;
          setPlacingPin(false);
          selectPin(pin);
        } : undefined}
        onAddPin={() => { setPlacingPin(false); setPendingPosition({ x: menu.x, y: menu.y }); setCreatePinFailed(false); setShowPinForm(true); }}
        onDraw={featureEditor.enabled ? kind => { setPlacingPin(false); featureEditor.beginAt(kind, { x: menu.x, y: menu.y }); } : undefined}
        onComment={onCommentAt ? () => onCommentAt({ x: menu.x, y: menu.y }) : undefined} />}
    </div>
  );
}
