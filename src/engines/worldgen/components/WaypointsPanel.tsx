import { useState } from 'react';
import { MapPin, Plus, Trash2, Plane, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { WAYPOINT_COLORS, type WorldWaypoint } from '../types';

interface WaypointsPanelProps {
  waypoints: WorldWaypoint[];
  selectedId: string | null;
  selected: WorldWaypoint | null;
  onSelect: (id: string | null) => void;
  onEdit: (id: string, changes: Partial<WorldWaypoint>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  placing: boolean;
  onTogglePlacing: () => void;
  onFlyTo: (wp: WorldWaypoint) => void;
  disabled: boolean;
}

export default function WaypointsPanel({
  waypoints, selectedId, selected, onSelect, onEdit, onDelete,
  placing, onTogglePlacing, onFlyTo, disabled,
}: WaypointsPanelProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <button
        onClick={onTogglePlacing}
        disabled={disabled}
        className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition disabled:opacity-40 ${
          placing
            ? 'bg-danger/15 text-danger border border-danger/40'
            : 'bg-accent-gold/10 text-accent-gold border border-accent-gold/30 hover:bg-accent-gold/20'
        }`}
      >
        {placing ? <X size={13} /> : <Plus size={13} />}
        {placing ? t('worldgen.waypoints.cancelPlacing') : t('worldgen.waypoints.add')}
      </button>

      {waypoints.length === 0 && !placing && (
        <p className="text-xs text-text-dim text-center py-6 leading-relaxed">
          {t('worldgen.waypoints.empty')}
        </p>
      )}

      <div className="space-y-1.5">
        {waypoints.map((wp) => {
          const isSel = wp.id === selectedId;
          return (
            <div
              key={wp.id}
              className={`rounded-lg border transition ${
                isSel ? 'border-accent-gold/60 bg-accent-gold/5' : 'border-border bg-elevated hover:border-border-hover'
              }`}
            >
              <button
                onClick={() => onSelect(isSel ? null : wp.id)}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/40"
                  style={{ background: wp.color }}
                />
                <span className={`flex-1 text-xs truncate ${isSel ? 'text-accent-gold' : 'text-text-primary'}`}>
                  {wp.name}
                </span>
                <MapPin size={11} className="text-text-dim shrink-0" />
              </button>

              {isSel && selected && (
                <WaypointEditor
                  key={selected.id}
                  waypoint={selected}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onFlyTo={onFlyTo}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WaypointEditor({ waypoint, onEdit, onDelete, onFlyTo }: {
  waypoint: WorldWaypoint;
  onEdit: (id: string, changes: Partial<WorldWaypoint>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onFlyTo: (wp: WorldWaypoint) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(waypoint.name);
  const [description, setDescription] = useState(waypoint.description ?? '');

  const commit = () => {
    const changes: Partial<WorldWaypoint> = {};
    if (name.trim() && name.trim() !== waypoint.name) changes.name = name.trim();
    if (description !== (waypoint.description ?? '')) changes.description = description;
    if (Object.keys(changes).length > 0) onEdit(waypoint.id, changes);
  };

  return (
    <div className="px-2.5 pb-2.5 space-y-2 border-t border-border/60 pt-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="w-full bg-deep/60 border border-border rounded-md px-2 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent-gold/60"
        placeholder={t('worldgen.waypoints.namePlaceholder')}
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={commit}
        rows={2}
        className="w-full bg-deep/60 border border-border rounded-md px-2 py-1.5 text-xs text-text-primary resize-none focus:outline-none focus:border-accent-gold/60"
        placeholder={t('worldgen.waypoints.descriptionPlaceholder')}
      />
      <div className="flex items-center gap-1.5">
        {WAYPOINT_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onEdit(waypoint.id, { color: c })}
            className={`w-4 h-4 rounded-full border transition ${
              waypoint.color === c ? 'border-text-primary scale-110' : 'border-black/40 hover:scale-110'
            }`}
            style={{ background: c }}
            aria-label={c}
          />
        ))}
        <div className="flex-1" />
        <button
          onClick={() => onFlyTo(waypoint)}
          title={t('worldgen.waypoints.flyTo')}
          className="p-1.5 rounded-md text-text-muted hover:text-accent-gold hover:bg-accent-gold/10 transition"
        >
          <Plane size={13} />
        </button>
        <button
          onClick={() => onDelete(waypoint.id)}
          title={t('worldgen.waypoints.delete')}
          className="p-1.5 rounded-md text-text-dim hover:text-danger hover:bg-danger/10 transition"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
