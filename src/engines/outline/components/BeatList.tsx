import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, GripVertical, Link2, Pencil } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { OutlineBeat } from '../types';
import type { Scene } from '@/engines/dialog-scene/types';
import type { Writing } from '@/types';
import { BEAT_STATUS_CONFIG, BEAT_LEVEL_LABEL } from '../types';
import BeatEditor from './BeatEditor';
import { ConfirmDialog } from '@/engines/_shared';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Una fila arrastrable.
 *
 * Vive como componente propio y no como una función de render dentro de
 * `BeatList` porque `useSortable` es un hook: llamarlo dentro de un `.map()`
 * cambiaría el número de hooks por render y lo rechazaría
 * `react-hooks/rules-of-hooks`.
 *
 * El asa es un `<button>` con `setActivatorNodeRef`, no la fila entera: si toda
 * la fila arrastrara, no se podría seleccionar el texto de un beat ni pinchar
 * sus botones sin pelearse con el gesto — que es exactamente la queja que llevó
 * a sacar «mover» a su propia herramienta en el mapa.
 */
function SortableBeatRow({
  id,
  depth,
  dragTitle,
  expandControl,
  children,
}: {
  id: string;
  depth: number;
  dragTitle: string;
  expandControl: React.ReactNode;
  children: React.ReactNode;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      className="flex items-center gap-2 p-3 hover:bg-surface/80 rounded-lg transition border border-transparent hover:border-border group"
    >
      <div style={{ paddingLeft: `${depth * 16}px` }} className="flex items-center gap-2 flex-1 min-w-0">
        {expandControl}
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          title={dragTitle}
          className="text-text-dim opacity-0 group-hover:opacity-100 transition cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical size={14} />
        </button>
        {children}
      </div>
    </div>
  );
}

interface BeatListProps {
  beats: OutlineBeat[];
  /**
   * Owning outline / project. Passed explicitly rather than sniffed from
   * `beats[0]`: on an empty outline there is no first beat, and the row was
   * being created with `outlineId: ''`, which no scoped query ever returns
   * and no project delete ever cleans up.
   */
  outlineId: string;
  projectId: string;
  onAddBeat: (beat: Omit<OutlineBeat, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateBeat: (beatId: string, changes: Partial<OutlineBeat>) => void;
  onDeleteBeat: (beatId: string) => void;
  /**
   * Guardar el orden nuevo de TODO el esquema, de arriba abajo.
   *
   * El asa de arrastre llevaba aquí desde el principio y no hacía nada:
   * `reorderBeats` existía en `operations.ts` y estaba cableada como
   * `reorderFn` en el hook, pero ningún componente registraba un solo evento de
   * arrastre ni llamaba a `reorder`. El lector veía el asa, arrastraba un
   * capítulo, y no pasaba nada — la única forma de reordenar era borrar y
   * recrear los beats de en medio, perdiendo sus enlaces a escena y a
   * manuscrito.
   */
  onReorder?: (orderedIds: string[]) => void;
  /** Scenes available for linking */
  scenes?: Scene[];
  /** Writings available for linking */
  writings?: Writing[];
}

export default function BeatList({
  beats,
  outlineId,
  projectId,
  onAddBeat,
  onUpdateBeat,
  onDeleteBeat,
  onReorder,
  scenes = [],
  writings = [],
}: BeatListProps) {
  const { t } = useTranslation();
  // El teclado va incluido a propósito: un asa que sólo responde al ratón deja
  // fuera de reordenar a quien no lo usa, y el sensor es una línea.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [expandedBeats, setExpandedBeats] = useState<Set<string>>(new Set());
  const [editingBeat, setEditingBeat] = useState<OutlineBeat | null>(null);
  const [pendingDeleteBeat, setPendingDeleteBeat] = useState<OutlineBeat | null>(null);

  const toggleExpanded = (beatId: string) => {
    const newExpanded = new Set(expandedBeats);
    if (newExpanded.has(beatId)) {
      newExpanded.delete(beatId);
    } else {
      newExpanded.add(beatId);
    }
    setExpandedBeats(newExpanded);
  };

  const getChildBeats = (parentId: string) => {
    return beats.filter((b) => b.parentId === parentId).sort((a, b) => a.order - b.order);
  };

  const hasChildren = (beatId: string) => {
    return beats.some((b) => b.parentId === beatId);
  };

  /**
   * El orden global del esquema, recorriendo el árbol como se ve en pantalla.
   *
   * `reorderBeats` numera una lista plana de ids para TODO el esquema, así que
   * mover dos hermanos exige reemitir el recorrido entero: si sólo se
   * renumerasen esos dos, sus `order` chocarían con los de otras ramas y el
   * `sort` de cada grupo mezclaría el resultado. Recorrer en profundidad y en
   * el orden en que se pinta da números crecientes de arriba abajo, que es lo
   * que el lector acaba de ver.
   */
  const flatten = (siblingOverride: { parentId?: string; ids: string[] }): string[] => {
    const salida: string[] = [];
    const hijos = (parentId?: string) => {
      const grupo = beats
        .filter((b) => (b.parentId ?? undefined) === parentId)
        .sort((a, b) => a.order - b.order);
      if ((siblingOverride.parentId ?? undefined) !== parentId) return grupo;
      // El grupo que el lector acaba de reordenar manda sobre `order`.
      const porId = new Map(grupo.map((b) => [b.id, b]));
      return siblingOverride.ids.map((id) => porId.get(id)).filter((b): b is OutlineBeat => !!b);
    };
    const bajar = (parentId?: string) => {
      for (const b of hijos(parentId)) {
        salida.push(b.id);
        bajar(b.id);
      }
    };
    bajar(undefined);
    return salida;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorder) return;
    const movido = beats.find((b) => b.id === active.id);
    const destino = beats.find((b) => b.id === over.id);
    // Sin reparentar: arrastrar entre niveles distintos es otra función, y
    // adivinarla aquí convertiría un gesto de ordenar en un cambio de jerarquía
    // que el lector no ha pedido.
    if (!movido || !destino || (movido.parentId ?? undefined) !== (destino.parentId ?? undefined)) return;

    const grupo = beats
      .filter((b) => (b.parentId ?? undefined) === (movido.parentId ?? undefined))
      .sort((a, b) => a.order - b.order)
      .map((b) => b.id);
    const desde = grupo.indexOf(String(active.id));
    const hasta = grupo.indexOf(String(over.id));
    if (desde < 0 || hasta < 0) return;

    onReorder(flatten({ parentId: movido.parentId ?? undefined, ids: arrayMove(grupo, desde, hasta) }));
  };

  const renderBeatRow = (beat: OutlineBeat, depth: number = 0) => {
    const isExpanded = expandedBeats.has(beat.id);
    const hasChildBeats = hasChildren(beat.id);
    const statusConfig = BEAT_STATUS_CONFIG[beat.status];

    return (
      <div key={beat.id}>
        <SortableBeatRow
          id={beat.id}
          depth={depth}
          dragTitle={t('outline.beat.dragHint')}
          expandControl={hasChildBeats ? (
            <button
              onClick={() => toggleExpanded(beat.id)}
              className="text-text-dim hover:text-text-primary transition"
              title={isExpanded ? t('common.collapse') : t('common.expand')}
            >
              {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : (
            <div className="w-4" />
          )}
        >
          {/* Color Dot */}
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: beat.color || '#c4973b' }}
          />

          {/* Level Label */}
          <span className="text-xs font-medium text-text-dim uppercase w-12 flex-shrink-0">
            {t(BEAT_LEVEL_LABEL[beat.level])}
          </span>

          {/* Title and Description */}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-text-primary truncate">
              {beat.title}
            </div>
            {beat.description && (
              <div className="text-xs text-text-dim line-clamp-1">
                {beat.description}
              </div>
            )}
          </div>

          {/* Linked Scene indicator */}
          {beat.linkedSceneId && (() => {
            const linkedScene = scenes.find((s) => s.id === beat.linkedSceneId);
            return linkedScene ? (
              <div className="flex items-center gap-1 text-xs text-accent-gold/80 px-2 py-1 bg-accent-gold/10 rounded flex-shrink-0" title={t('outline.beat.linkedTo').replace('{name}', linkedScene.title)}>
                <Link2 size={10} />
                <span className="max-w-20 truncate">#{linkedScene.sceneNumber ?? '?'}</span>
              </div>
            ) : null;
          })()}

          {/* Story Position */}
          {beat.storyPosition !== undefined && (
            <div className="text-xs text-text-dim px-2 py-1 bg-surface rounded flex-shrink-0">
              {beat.storyPosition}%
            </div>
          )}

          {/* Status Badge */}
          <div
            className={`text-xs font-medium px-2 py-1 rounded flex-shrink-0 ${statusConfig.color}`}
          >
            {t(statusConfig.labelKey)}
          </div>

          {/* Actions */}
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
            <button
              onClick={() => setEditingBeat(beat)}
              className="p-1.5 hover:bg-accent-gold/10 rounded text-accent-gold transition"
              title={t('common.edit')}
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => setPendingDeleteBeat(beat)}
              className="p-1.5 hover:bg-red-500/10 rounded text-red-500 transition"
              title={t('common.delete')}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </SortableBeatRow>

        {/* Child Beats */}
        {isExpanded && (
          <SortableContext
            items={getChildBeats(beat.id).map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            {getChildBeats(beat.id).map((child) => renderBeatRow(child, depth + 1))}
          </SortableContext>
        )}
      </div>
    );
  };

  // Render only top-level beats (no parent)
  const topLevelBeats = beats.filter((b) => !b.parentId).sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-4">
      {/* Add Button */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            const newBeat: Omit<OutlineBeat, 'id' | 'createdAt' | 'updatedAt'> = {
              outlineId,
              projectId,
              order: beats.length,
              level: 'beat',
              title: t('outline.beat.defaultTitle'),
              description: '',
              status: 'empty',
              tags: [],
            };
            onAddBeat(newBeat);
          }}
          className="flex items-center gap-1.5 px-3 py-2 text-xs bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
        >
          <Plus size={13} />
          {t('outline.addBeat')}
        </button>
      </div>

      {/* Beat List */}
      <div className="border border-border rounded-xl bg-surface/30 overflow-hidden">
        {topLevelBeats.length === 0 ? (
          <div className="p-8 text-center text-text-dim">
            <p className="text-sm">{t('outline.noBeats')}</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={topLevelBeats.map((b) => b.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="divide-y divide-border/50">
                {topLevelBeats.map((beat) => renderBeatRow(beat))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Beat Editor Modal */}
      {editingBeat && (
        <BeatEditor
          beat={editingBeat}
          onSave={(changes) => {
            onUpdateBeat(editingBeat.id, changes);
          }}
          onClose={() => setEditingBeat(null)}
          scenes={scenes}
          siblings={beats}
          writings={writings}
        />
      )}

      <ConfirmDialog
        open={pendingDeleteBeat !== null}
        destructive
        message={t('outline.beat.deleteConfirm').replace('{name}', pendingDeleteBeat?.title ?? '')}
        onConfirm={() => {
          if (pendingDeleteBeat) onDeleteBeat(pendingDeleteBeat.id);
          setPendingDeleteBeat(null);
        }}
        onCancel={() => setPendingDeleteBeat(null)}
      />
    </div>
  );
}
