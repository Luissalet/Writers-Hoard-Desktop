import { useWorldEraScope } from '@/services/worldEras/hooks';
import { listEraRows } from '@/services/worldEras/store';
import type { CodexEntry, Writing, TimelineEvent } from '@/types';
import { listWorldLinks, saveWorldLink, deleteWorldLink } from '../era';
import { useCallback, useEffect, useState } from 'react';
import {
  Eye,
  EyeOff,
  ExternalLink,
  Copy,
  Link2,
  Lock,
  LockOpen,
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
import { useTranslation } from '@/i18n/useTranslation';
import { PLACE_MODELS, BUILDING_STYLES, PLACE_LABEL_FONTS, AREA_STYLES } from '../core/placeStyle';

const ICONS = [
  ['volcano', 'worldgen.place.icon.volcano'],
  ['cave', 'worldgen.place.icon.cave'],
  ['waterfall', 'worldgen.place.icon.waterfall'],
  ['gorge', 'worldgen.place.icon.gorge'],
  ['hotspring', 'worldgen.place.icon.hotspring'],
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
  /** Locked against accidents: no moving or hiding until unlocked. */
  locked?: boolean;
  onLock?: (locked: boolean) => void;
  /** A copy beside it; absent for what cannot be copied (realms, seas, regions). */
  onDuplicate?: () => void;
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
  locked = false,
  onLock,
  onDuplicate,
  onOpenRegion,
  onReveal2D,
  onReveal3D,
}: SpatialEntityInspectorProps) {
  const { t } = useTranslation();
  const scope = useWorldEraScope(projectId);
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
      listEraRows<CodexEntry>(scope, 'codexEntries').then(rows => rows.filter(entry => entry.type === 'location').sort((a, b) => a.title.localeCompare(b.title))),
      db.scenes.where('projectId').equals(projectId).sortBy('order'),
      listEraRows<Writing>(scope, 'writings').then(rows => rows.sort((a, b) => a.title.localeCompare(b.title))),
      listEraRows<TimelineEvent>(scope, 'timelineEvents').then(rows => rows.sort((a, b) => a.order - b.order)),
      listWorldLinks(scope, worldId).then(rows => rows.filter(row => row.sourceEntityId === sourceEntityId)),
    ]);
    const targets: SpatialLinkTarget[] = [
      ...locations.map((entry) => ({
        key: `codex-entry:${entry.id}`,
        id: entry.id,
        title: entry.title,
        engineId: 'codex' as const,
        entityType: 'codex-entry' as const,
        group: 'worldgen.place.group.codexLocations',
      })),
      ...scenes.map((scene) => ({
        key: `scene:${scene.id}`,
        id: scene.id,
        title: scene.sceneNumber ? `${scene.sceneNumber}. ${scene.title}` : scene.title,
        engineId: 'dialog-scene' as const,
        entityType: 'scene' as const,
        group: 'worldgen.place.group.scenes',
      })),
      ...writings.map((writing) => ({
        key: `writing:${writing.id}`,
        id: writing.id,
        title: writing.title,
        engineId: 'writings' as const,
        entityType: 'writing' as const,
        group: 'worldgen.place.group.writings',
      })),
      ...timelineEvents.map((timelineEvent) => ({
        key: `timeline-event:${timelineEvent.id}`,
        id: timelineEvent.id,
        title: timelineEvent.title,
        engineId: 'timeline' as const,
        entityType: 'timeline-event' as const,
        group: 'worldgen.place.group.timeline',
      })),
    ];
    return {
      targets,
      links: currentLinks.filter((link) => link.projectId === projectId),
    };
  }, [projectId, sourceEntityId, scope, worldId]);

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
    if (!locked && Number.isFinite(nextX) && Number.isFinite(nextY)
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
    await saveWorldLink(scope, worldId, {
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
          aria-label={t('worldgen.place.nameLabel')}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-text-muted">
          {t('worldgen.place.worldX')}
          <input
            type="number"
            value={x}
            onChange={(event) => setX(event.target.value)}
            onBlur={commitPosition}
            disabled={locked}
            className="mt-0.5 w-full rounded border border-border bg-deep px-2 py-1.5 text-xs text-text-primary"
          />
        </label>
        <label className="text-[10px] text-text-muted">
          {t('worldgen.place.worldY')}
          <input
            type="number"
            value={y}
            onChange={(event) => setY(event.target.value)}
            onBlur={commitPosition}
            disabled={locked}
            className="mt-0.5 w-full rounded border border-border bg-deep px-2 py-1.5 text-xs text-text-primary"
          />
        </label>
      </div>

      {entity.kind === 'landmark' && (
        <label className="text-[10px] text-text-muted">
          {t('worldgen.place.symbol')}
          <select
            value={entity.style.icon ?? entity.type}
            onChange={(event) => onStyle({ icon: event.target.value })}
            className="mt-0.5 w-full rounded border border-border bg-deep px-2 py-1.5 text-xs text-text-primary"
          >
            {ICONS.map(([id, label]) => <option key={id} value={id}>{t(label)}</option>)}
          </select>
        </label>
      )}

      {['settlement', 'region', 'ruin'].includes(entity.kind) && (
        <fieldset className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2">
          <legend className="px-1 text-[10px] uppercase tracking-wide text-text-muted">{t('worldgen.place.appearance')}</legend>
          <label className="text-[10px] text-text-muted">{t('worldgen.place.buildingModel')}
            <select aria-label={t('worldgen.place.buildingModel')} value={entity.style.model ?? 'auto'} onChange={e => onStyle({ model: e.target.value as typeof PLACE_MODELS[number] })} className="mt-1 w-full rounded border border-border bg-deep p-1.5 text-xs text-text-primary">
              {PLACE_MODELS.map(id => <option value={id} key={id}>{t(`worldgen.place.model.${id}`)}</option>)}
            </select>
          </label>
          <label className="text-[10px] text-text-muted">{t('worldgen.place.buildingStyle')}
            <select aria-label={t('worldgen.place.buildingStyle')} value={entity.style.buildingStyle ?? 'auto'} onChange={e => onStyle({ buildingStyle: e.target.value as typeof BUILDING_STYLES[number] })} className="mt-1 w-full rounded border border-border bg-deep p-1.5 text-xs text-text-primary">
              {BUILDING_STYLES.map(id => <option value={id} key={id}>{t(`worldgen.place.building.${id}`)}</option>)}
            </select>
          </label>
          <label className="col-span-2 text-[10px] text-text-muted">{t('worldgen.place.customSymbol')}
            <input aria-label={t('worldgen.place.customSymbol')} value={entity.style.icon === 'auto' ? '' : entity.style.icon ?? ''} maxLength={16} placeholder="city · town · fort · place · ◆" onChange={e => onStyle({ icon: e.target.value || 'auto' })} className="mt-1 w-full rounded border border-border bg-deep p-1.5 text-xs text-text-primary" />
          </label>
        </fieldset>
      )}

      {entity.kind === 'realm' && (
        <fieldset className="grid grid-cols-2 gap-2 rounded-lg border border-border p-2">
          <legend className="px-1 text-[10px] uppercase tracking-wide text-text-muted">{t('worldgen.place.territory')}</legend>
          <label className="text-[10px] text-text-muted">{t('worldgen.place.areaStyle')}
            <select aria-label={t('worldgen.place.areaStyle')} value={entity.style.areaStyle ?? 'wash'} onChange={e => onStyle({ areaStyle: e.target.value as typeof AREA_STYLES[number] })} className="mt-1 w-full rounded border border-border bg-deep p-1.5 text-xs text-text-primary">
              {AREA_STYLES.map(id => <option value={id} key={id}>{t(`worldgen.place.area.${id}`)}</option>)}
            </select>
          </label>
          <label className="text-[10px] text-text-muted">{t('worldgen.place.areaOpacity')}
            <input aria-label={t('worldgen.place.areaOpacity')} type="range" min={0} max={1} step={.05} value={entity.style.areaOpacity ?? 1} onChange={e => onStyle({ areaOpacity: Number(e.target.value) })} className="mt-2 w-full accent-amber-400" />
          </label>
        </fieldset>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-text-muted">{t('worldgen.place.labelFont')}
          <select aria-label={t('worldgen.place.labelFont')} value={entity.style.labelFont ?? 'theme'} onChange={e => onStyle({ labelFont: e.target.value as typeof PLACE_LABEL_FONTS[number] })} className="mt-1 w-full rounded border border-border bg-deep p-1.5 text-xs text-text-primary">
            {PLACE_LABEL_FONTS.map(id => <option value={id} key={id}>{t(`worldgen.place.font.${id}`)}</option>)}
          </select>
        </label>
        <label className="text-[10px] text-text-muted">{t('worldgen.place.labelSize')}
          <input aria-label={t('worldgen.place.labelSize')} type="range" min={.6} max={2} step={.05} value={entity.style.labelSize ?? 1} onChange={e => onStyle({ labelSize: Number(e.target.value) })} className="mt-2 w-full accent-amber-400" />
        </label>
      </div>

      <label className="flex items-center gap-2 text-[10px] text-text-muted">
        {t('worldgen.place.color')}
        <input
          type="color"
          value={entity.style.color ?? '#e4a853'}
          onChange={(event) => onStyle({ color: event.target.value })}
          className="h-7 w-10 rounded border border-border bg-transparent"
        />
        <span className="ml-auto">{t('worldgen.place.size')}</span>
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
        {t('worldgen.place.alwaysShowName')}
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
          <MapPinned size={12} /> {t('worldgen.place.region')}
        </button>
        {onDuplicate && (
          <button
            type="button"
            onClick={onDuplicate}
            data-testid="place-duplicate"
            className="col-span-2 flex items-center justify-center gap-1.5 rounded border border-border bg-elevated px-2 py-1.5 text-[11px] text-text-primary hover:border-accent-gold/40"
          >
            <Copy size={12} /> {t('worldgen.place.duplicate')}
          </button>
        )}
        {onLock && (
          <button
            type="button"
            onClick={() => onLock(!locked)}
            aria-pressed={locked}
            data-testid="place-lock"
            title={locked ? t('worldgen.place.unlockHint') : t('worldgen.place.lockHint')}
            className={`${onDuplicate ? '' : 'col-span-3 '}flex items-center justify-center gap-1.5 rounded border px-2 py-1.5 text-[11px] ${locked ? 'border-accent-gold/60 bg-accent-gold/15 text-accent-gold' : 'border-border bg-elevated text-text-primary hover:border-accent-gold/40'}`}
          >
            {locked ? <LockOpen size={12} /> : <Lock size={12} />} {locked ? t('worldgen.place.unlock') : t('worldgen.place.lock')}
          </button>
        )}
        {entity.hidden ? (
          <button
            type="button"
            onClick={onRestore}
            className="col-span-3 flex items-center justify-center gap-1.5 rounded border border-border bg-elevated px-2 py-1.5 text-[11px] text-text-primary hover:border-accent-gold/40"
          >
            <RotateCcw size={12} /> {t('worldgen.place.restore')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onRemove}
            disabled={locked}
            title={locked ? t('worldgen.place.lockedHide') : undefined}
            data-testid="place-hide"
            className="col-span-3 flex disabled:opacity-40 items-center justify-center gap-1.5 rounded border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] text-danger hover:bg-danger/15"
          >
            <EyeOff size={12} /> {t('worldgen.place.hide')}
          </button>
        )}
      </div>

      <div className="border-t border-border pt-2">
        <div className="mb-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-muted">
          <Link2 size={11} /> {t('worldgen.place.links')}
        </div>
        <select
          value=""
          onChange={(event) => {
            void addLink(event.target.value);
          }}
          className="w-full rounded border border-border bg-deep px-2 py-1.5 text-xs text-text-primary"
        >
          <option value="">{t('worldgen.place.linkPlaceholder')}</option>
          {Array.from(new Set(linkTargets.map((target) => target.group))).map((group) => (
            <optgroup key={group} label={t(group)}>
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
                await deleteWorldLink(scope, worldId, link.id);
                await refreshLinks();
              }}
              className="text-text-muted hover:text-danger"
              title={t('worldgen.place.removeLink')}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
