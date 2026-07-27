import { useCallback, useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  ExternalLink,
  Link2,
  MapPinned,
  RotateCcw,
} from 'lucide-react';
import { db } from '@/db';
import { generateId } from '@/utils/idGenerator';
import type { EntityLink } from '@/types/projectTools';
import type {
  WorldSpatialEntity,
  WorldSpatialStyleOverride,
} from '../core/spatialEntities';

const ICONS = [
  ['volcano', 'Volcán'],
  ['cave', 'Cueva'],
  ['waterfall', 'Cascada'],
  ['gorge', 'Garganta'],
  ['hotspring', 'Termas'],
] as const;

interface SpatialLinkTarget {
  key: string;
  id: string;
  title: string;
  engineId: 'codex' | 'dialog-scene' | 'writings' | 'timeline';
  entityType: 'codex-entry' | 'scene' | 'writing' | 'timeline-event';
  group: string;
}

interface SpatialEntityInspectorProps {
  projectId: string;
  worldId: string;
  entity: WorldSpatialEntity;
  onRename: (name: string) => void;
  onRemove: () => void;
  onRestore: () => void;
  onMove: (x: number, y: number) => void;
  onStyle: (style: WorldSpatialStyleOverride) => void;
  onOpenRegion: () => void;
  onReveal2D: () => void;
  onReveal3D: () => void;
}

function spatialEntityId(worldId: string, key: string): string {
  return `${worldId}::${key}`;
}

export default function SpatialEntityInspector({
  projectId,
  worldId,
  entity,
  onRename,
  onRemove,
  onRestore,
  onMove,
  onStyle,
  onOpenRegion,
  onReveal2D,
  onReveal3D,
}: SpatialEntityInspectorProps) {
  const [previousKey, setPreviousKey] = useState(entity.key);
  const [name, setName] = useState(entity.name);
  const [x, setX] = useState(String(Math.round(entity.x * 100) / 100));
  const [y, setY] = useState(String(Math.round(entity.y * 100) / 100));
  if (previousKey !== entity.key) {
    setPreviousKey(entity.key);
    setName(entity.name);
    setX(String(Math.round(entity.x * 100) / 100));
    setY(String(Math.round(entity.y * 100) / 100));
  }

  const [linkTargets, setLinkTargets] = useState<SpatialLinkTarget[]>([]);
  const [links, setLinks] = useState<EntityLink[]>([]);
  const sourceEntityId = spatialEntityId(worldId, entity.key);

  const loadLinkState = useCallback(async () => {
    const [locations, scenes, writings, timelineEvents, currentLinks] = await Promise.all([
      db.codexEntries
        .where('projectId')
        .equals(projectId)
        .filter((entry) => entry.type === 'location')
        .sortBy('title'),
      db.scenes.where('projectId').equals(projectId).sortBy('order'),
      db.writings.where('projectId').equals(projectId).sortBy('title'),
      db.timelineEvents.where('projectId').equals(projectId).sortBy('order'),
      db.entityLinks.where('sourceEntityId').equals(sourceEntityId).toArray(),
    ]);
    const targets: SpatialLinkTarget[] = [
      ...locations.map((entry) => ({
        key: `codex-entry:${entry.id}`,
        id: entry.id,
        title: entry.title,
        engineId: 'codex' as const,
        entityType: 'codex-entry' as const,
        group: 'Códice · localizaciones',
      })),
      ...scenes.map((scene) => ({
        key: `scene:${scene.id}`,
        id: scene.id,
        title: scene.sceneNumber ? `${scene.sceneNumber}. ${scene.title}` : scene.title,
        engineId: 'dialog-scene' as const,
        entityType: 'scene' as const,
        group: 'Escenas',
      })),
      ...writings.map((writing) => ({
        key: `writing:${writing.id}`,
        id: writing.id,
        title: writing.title,
        engineId: 'writings' as const,
        entityType: 'writing' as const,
        group: 'Escritos',
      })),
      ...timelineEvents.map((timelineEvent) => ({
        key: `timeline-event:${timelineEvent.id}`,
        id: timelineEvent.id,
        title: timelineEvent.title,
        engineId: 'timeline' as const,
        entityType: 'timeline-event' as const,
        group: 'Cronología',
      })),
    ];
    return {
      targets,
      links: currentLinks.filter((link) => link.projectId === projectId),
    };
  }, [projectId, sourceEntityId]);

  const refreshLinks = async () => {
    const state = await loadLinkState();
    setLinkTargets(state.targets);
    setLinks(state.links);
  };

  useEffect(() => {
    let active = true;
    loadLinkState().then((state) => {
      if (!active) return;
      setLinkTargets(state.targets);
      setLinks(state.links);
    });
    return () => {
      active = false;
    };
  }, [loadLinkState]);

  const commitPosition = () => {
    const nextX = Number(x);
    const nextY = Number(y);
    if (Number.isFinite(nextX) && Number.isFinite(nextY)
        && (nextX !== entity.x || nextY !== entity.y)) {
      onMove(nextX, nextY);
    }
  };

  const addLink = async (targetKey: string) => {
    const target = linkTargets.find((candidate) => candidate.key === targetKey);
    if (!target || links.some((link) => (
      link.targetEntityType === target.entityType && link.targetEntityId === target.id
    ))) return;
    const now = Date.now();
    await db.entityLinks.add({
      id: generateId('entity-link'),
      projectId,
      sourceEngineId: 'worldgen',
      sourceEntityType: 'world-spatial',
      sourceEntityId,
      sourceTitle: entity.name,
      targetEngineId: target.engineId,
      targetEntityType: target.entityType,
      targetEntityId: target.id,
      targetTitle: target.title,
      relation: target.entityType === 'codex-entry' ? 'represents' : 'takes-place-at',
      provenance: 'manual',
      createdAt: now,
      updatedAt: now,
    });
    await refreshLinks();
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="text-[10px] uppercase tracking-wider text-text-muted">
          {entity.kind} · {entity.type}
        </span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const value = name.trim();
            if (value && value !== entity.name) onRename(value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          className="mt-1 w-full rounded-lg border border-border bg-deep px-2.5 py-2 text-sm font-medium text-text-primary outline-none focus:border-accent-gold/60"
          aria-label="Nombre del lugar"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-text-muted">
          X mundial
          <input
            type="number"
            value={x}
            onChange={(event) => setX(event.target.value)}
            onBlur={commitPosition}
            className="mt-0.5 w-full rounded border border-border bg-deep px-2 py-1.5 text-xs text-text-primary"
          />
        </label>
        <label className="text-[10px] text-text-muted">
          Y mundial
          <input
            type="number"
            value={y}
            onChange={(event) => setY(event.target.value)}
            onBlur={commitPosition}
            className="mt-0.5 w-full rounded border border-border bg-deep px-2 py-1.5 text-xs text-text-primary"
          />
        </label>
      </div>

      {entity.kind === 'landmark' && (
        <label className="text-[10px] text-text-muted">
          Símbolo
          <select
            value={entity.style.icon ?? entity.type}
            onChange={(event) => onStyle({ icon: event.target.value })}
            className="mt-0.5 w-full rounded border border-border bg-deep px-2 py-1.5 text-xs text-text-primary"
          >
            {ICONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
      )}

      <label className="flex items-center gap-2 text-[10px] text-text-muted">
        Color
        <input
          type="color"
          value={entity.style.color ?? '#e4a853'}
          onChange={(event) => onStyle({ color: event.target.value })}
          className="h-7 w-10 rounded border border-border bg-transparent"
        />
        <span className="ml-auto">Tamaño</span>
        <input
          type="range"
          min={0.65}
          max={2.4}
          step={0.05}
          value={entity.style.size ?? 1}
          onChange={(event) => onStyle({ size: Number(event.target.value) })}
          className="w-24 accent-amber-400"
        />
      </label>

      <label className="flex items-center gap-2 text-xs text-text-primary">
        <input
          type="checkbox"
          checked={entity.style.labelVisible ?? false}
          onChange={(event) => onStyle({ labelVisible: event.target.checked })}
          className="accent-amber-400"
        />
        Mostrar siempre el nombre
      </label>

      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={onReveal2D}
          className="flex items-center justify-center gap-1.5 rounded border border-border bg-elevated px-2 py-1.5 text-[11px] text-text-primary hover:border-accent-gold/40"
        >
          <ExternalLink size={12} /> 2D
        </button>
        <button
          type="button"
          onClick={onReveal3D}
          className="flex items-center justify-center gap-1.5 rounded border border-border bg-elevated px-2 py-1.5 text-[11px] text-text-primary hover:border-accent-gold/40"
        >
          <ExternalLink size={12} /> 3D
        </button>
        <button
          type="button"
          onClick={onOpenRegion}
          className="flex items-center justify-center gap-1.5 rounded border border-border bg-elevated px-2 py-1.5 text-[11px] text-text-primary hover:border-accent-gold/40"
        >
          <MapPinned size={12} /> Comarca
        </button>
        {entity.hidden ? (
          <button
            type="button"
            onClick={onRestore}
            className="col-span-3 flex items-center justify-center gap-1.5 rounded border border-border bg-elevated px-2 py-1.5 text-[11px] text-text-primary hover:border-accent-gold/40"
          >
            <RotateCcw size={12} /> Restaurar en el mapa
          </button>
        ) : (
          <button
            type="button"
            onClick={onRemove}
            className="col-span-3 flex items-center justify-center gap-1.5 rounded border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] text-danger hover:bg-danger/15"
          >
            <EyeOff size={12} /> Ocultar
          </button>
        )}
      </div>

      <div className="border-t border-border pt-2">
        <div className="mb-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-muted">
          <Link2 size={11} /> Vinculaciones
        </div>
        <select
          value=""
          onChange={(event) => {
            void addLink(event.target.value);
          }}
          className="w-full rounded border border-border bg-deep px-2 py-1.5 text-xs text-text-primary"
        >
          <option value="">Vincular con Códice, escena, escrito o evento…</option>
          {Array.from(new Set(linkTargets.map((target) => target.group))).map((group) => (
            <optgroup key={group} label={group}>
              {linkTargets
                .filter((target) => target.group === group)
                .filter((target) => !links.some((link) => (
                  link.targetEntityType === target.entityType
                    && link.targetEntityId === target.id
                )))
                .map((target) => (
                  <option key={target.key} value={target.key}>{target.title}</option>
                ))}
            </optgroup>
          ))}
        </select>
        {links.map((link) => (
          <div key={link.id} className="mt-1.5 flex items-center gap-2 rounded bg-elevated px-2 py-1.5 text-[11px]">
            <Eye size={11} className="text-accent-gold" />
            <span className="min-w-0 flex-1 truncate text-text-primary">
              <span className="text-text-muted">{link.targetEngineId} · </span>
              {link.targetTitle}
            </span>
            <button
              type="button"
              onClick={async () => {
                await db.entityLinks.delete(link.id);
                await refreshLinks();
              }}
              className="text-text-muted hover:text-danger"
              title="Quitar vínculo"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
