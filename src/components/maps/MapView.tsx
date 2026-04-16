import { useState, useRef, useCallback } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { Plus, Upload, Trash2, MapPin as MapPinIcon, Mountain, Trees, Castle, Anchor, Landmark, Church } from 'lucide-react';
import type { MapPin } from '@/types';
import { generateId } from '@/utils/idGenerator';
import Modal from '@/components/common/Modal';
import EmptyState from '@/components/common/EmptyState';
import { useTranslation } from '@/i18n/useTranslation';

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
  onUploadBackground: (imageData: string) => void;
  onAddPin: (pin: MapPin) => void;
  onDeletePin: (id: string) => void;
}

export default function MapView({ projectId, mapId, backgroundImage, pins, onUploadBackground, onAddPin, onDeletePin }: MapViewProps) {
  const { t } = useTranslation();
  const [placingPin, setPlacingPin] = useState(false);
  const [pinType, setPinType] = useState<MapPin['icon']>('city');
  const [showPinForm, setShowPinForm] = useState(false);
  const [pendingPosition, setPendingPosition] = useState<{ x: number; y: number } | null>(null);
  const [pinName, setPinName] = useState('');
  const [pinDescription, setPinDescription] = useState('');
  const [hoveredPin, setHoveredPin] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    setShowPinForm(true);
  }, [placingPin, backgroundImage]);

  const handleSavePin = () => {
    if (!pendingPosition || !pinName.trim()) return;
    onAddPin({
      id: generateId('pin'),
      projectId,
      mapId,
      name: pinName,
      icon: pinType,
      position: pendingPosition,
      description: pinDescription,
    });
    setShowPinForm(false);
    setPinName('');
    setPinDescription('');
    setPendingPosition(null);
    setPlacingPin(false);
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
            panning={{ disabled: placingPin }}
          >
            <TransformComponent wrapperStyle={{ width: '100%', height: '500px' }}>
              <div ref={mapRef} className="relative inline-block" onClick={handleMapClick}>
                <img src={backgroundImage} alt="World map" className="max-w-none" style={{ maxHeight: '800px' }} />

                {/* Pins */}
                {pins.map(pin => {
                  const config = PIN_ICONS[pin.icon] || PIN_ICONS.custom;
                  const Icon = config.icon;
                  return (
                    <div
                      key={pin.id}
                      className="absolute group"
                      style={{ left: `${pin.position.x}%`, top: `${pin.position.y}%`, transform: 'translate(-50%, -100%)' }}
                      onMouseEnter={() => setHoveredPin(pin.id)}
                      onMouseLeave={() => setHoveredPin(null)}
                    >
                      <div className="relative">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center shadow-lg cursor-pointer border-2 border-white/20 transition-transform hover:scale-125"
                          style={{ backgroundColor: config.color }}
                        >
                          <Icon size={16} className="text-white" />
                        </div>

                        {/* Tooltip */}
                        {hoveredPin === pin.id && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-surface border border-border rounded-lg px-3 py-2 shadow-xl whitespace-nowrap z-10 min-w-[120px]">
                            <h4 className="font-serif font-bold text-accent-gold text-sm">{pin.name}</h4>
                            {pin.description && <p className="text-xs text-text-muted mt-0.5">{pin.description}</p>}
                            <button
                              onClick={(e) => { e.stopPropagation(); onDeletePin(pin.id); }}
                              className="mt-1 text-xs text-danger hover:underline flex items-center gap-1"
                            >
                              <Trash2 size={10} /> {t('common.remove')}
                            </button>
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
        <div className="bg-surface border border-border rounded-xl p-4">
          <h4 className="font-serif font-bold text-accent-gold text-sm mb-3">{t('maps.markers')} ({pins.length})</h4>
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
            {pins.map(pin => {
              const config = PIN_ICONS[pin.icon] || PIN_ICONS.custom;
              const Icon = config.icon;
              return (
                <div key={pin.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-elevated transition group">
                  <Icon size={14} style={{ color: config.color }} />
                  <span className="text-sm text-text-primary flex-1">{pin.name}</span>
                  <button
                    onClick={() => onDeletePin(pin.id)}
                    className="p-1 opacity-0 group-hover:opacity-100 hover:bg-danger/20 rounded transition"
                  >
                    <Trash2 size={12} className="text-danger" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pin creation modal */}
      <Modal open={showPinForm} onClose={() => { setShowPinForm(false); setPendingPosition(null); }} title={t('maps.newPin')}>
        <div className="space-y-4">
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
          <div className="flex gap-3 pt-2">
            <button onClick={handleSavePin} className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition">
              {t('maps.placePin')}
            </button>
            <button onClick={() => { setShowPinForm(false); setPendingPosition(null); }} className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition">
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
