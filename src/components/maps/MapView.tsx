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
} from 'lucide-react';
import type { CodexEntry, MapPin } from '@/types';
import { generateId } from '@/utils/idGenerator';
import Modal from '@/components/common/Modal';
import EmptyState from '@/components/common/EmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import GalleryAssetPicker from '@/components/gallery/GalleryAssetPicker';
import { ConfirmDialog } from '@/engines/_shared';

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

interface MapViewProps {
  projectId: string;
  mapId: string;
  backgroundImage?: string;
  pins: MapPin[];
  codexEntries?: CodexEntry[];
  onUploadBackground: (imageData: string) => void;
  onAddPin: (pin: MapPin) => void | Promise<void>;
  onEditPin: (id: string, changes: Partial<MapPin>) => void | Promise<void>;
  onDeletePin: (id: string) => void | Promise<void>;
  /**
   * Pin to open on mount, from a `?pin=` deep link (search hit, backlink).
   * Handled here rather than by the caller because pin selection also seeds
   * the editor draft.
   */
  focusPinId?: string | null;
  /** Owned by the engine so a map switch retains another pin's draft. */
  drafts?: Map<string, PinDraft>;
}

export interface PinDraft {
  name: string;
  description: string;
  icon: MapPin['icon'];
  color?: string;
  linkedEntryId?: string;
}

interface PinDragState {
  id: string;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
  position: MapPin['position'];
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

  const selectedPin = pins.find((pin) => pin.id === selectedPinId) ?? null;
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
    setPinDraft(drafts.get(pin.id) ?? {
      name: pin.name,
      description: pin.description ?? '',
      icon: pin.icon,
      color: pin.color,
      linkedEntryId: pin.linkedEntryId,
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
    if (!placingPin || !backgroundImage) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPendingPosition({ x, y });
    setCreatePinFailed(false);
    setShowPinForm(true);
  }, [placingPin, backgroundImage]);

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
      await onEditPin(id, {
        name: pinDraft.name.trim(),
        description: pinDraft.description.trim(),
        icon: pinDraft.icon,
        color: pinDraft.color,
        linkedEntryId: pinDraft.linkedEntryId || undefined,
      });
      if (drafts.get(id) === submitted) drafts.delete(id);
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
    if (placingPin || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({
      id: pin.id,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
      position: pin.position,
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
        await onEditPin(pinId, { position });
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
      <div className="flex items-center gap-3 flex-wrap">
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
              onClick={() => setPlacingPin(!placingPin)}
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
      </div>

      {/* Map Canvas */}
      {!backgroundImage ? (
        <EmptyState
          icon={<MapPinIcon size={40} />}
          title={t('maps.empty.title')}
          message={t('maps.empty.message')}
          action={{ label: t('maps.empty.action'), onClick: () => fileInputRef.current?.click() }}
        />
      ) : (
        <div className="rounded-xl overflow-hidden border border-border bg-deep">
          <TransformWrapper
            initialScale={1}
            minScale={0.3}
            maxScale={5}
            panning={{ disabled: placingPin || dragState !== null }}
          >
            <TransformComponent wrapperStyle={{ width: '100%', height: '500px' }}>
              <div ref={mapRef} className="relative inline-block" onClick={handleMapClick}>
                <img src={backgroundImage} alt="World map" className="max-w-none" style={{ maxHeight: '800px' }} />

                {/* Pins */}
                {pins.map(pin => {
                  const config = PIN_ICONS[pin.icon] || PIN_ICONS.custom;
                  const Icon = config.icon;
                  const isSelected = selectedPinId === pin.id;
                  const position = dragState?.id === pin.id ? dragState.position : pin.position;
                  return (
                    <div
                      key={pin.id}
                      className="absolute group"
                      style={{
                        left: `${position.x}%`,
                        top: `${position.y}%`,
                        transform: 'translate(-50%, -100%)',
                        touchAction: 'none',
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
                          className={`w-8 h-8 rounded-full flex items-center justify-center shadow-lg cursor-move border-2 transition-transform hover:scale-125 ${
                            isSelected
                              ? 'border-white ring-2 ring-accent-gold ring-offset-2 ring-offset-deep'
                              : 'border-white/20'
                          }`}
                          style={{ backgroundColor: pin.color ?? config.color }}
                        >
                          <Icon size={16} className="text-white" />
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
              </div>
            </TransformComponent>
          </TransformWrapper>
        </div>
      )}

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
                      <Move size={12} className="text-text-dim opacity-0 group-hover:opacity-100" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeletePin(pin)}
                      className="p-1.5 mr-1 opacity-0 group-hover:opacity-100 hover:bg-danger/20 rounded transition"
                      title={t('common.delete')}
                    >
                      <Trash2 size={12} className="text-danger" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {selectedPin && pinDraft && (
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
                  <label className="block text-xs text-text-muted mb-1.5">{t('gallery.linkEntries')}</label>
                  <select
                    value={pinDraft.linkedEntryId ?? ''}
                    onChange={(e) => patchPinDraft({ ...pinDraft, linkedEntryId: e.target.value || undefined })}
                    className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition"
                  >
                    <option value="">—</option>
                    {sortedCodexEntries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.title} · {entry.type}
                      </option>
                    ))}
                  </select>
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
    </div>
  );
}
