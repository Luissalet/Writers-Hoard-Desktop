import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, GripVertical, Link2, Pencil, PenLine, Waypoints } from 'lucide-react';
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
import EmptyState from '@/components/common/EmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';
import { beatNeedsChapter, writeChapterForBeat } from '../beatToChapter';
import { navigateTo } from '@/engines/_shared/anchoring';

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
  focused,
  elementRef,
  children,
}: {
  id: string;
  depth: number;
  dragTitle: string;
  expandControl: React.ReactNode;
  focused: boolean;
  elementRef: (node: HTMLDivElement | null) => void;
  children: React.ReactNode;
}) {
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={node => {
        setNodeRef(node);
        elementRef(node);
      }}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      tabIndex={-1}
      aria-current={focused ? 'true' : undefined}
      className={`group flex items-center gap-2 rounded-lg border p-3 outline-none transition ${
        focused
          ? 'border-accent-gold bg-accent-gold/10 ring-2 ring-inset ring-accent-gold/60'
          : 'border-transparent hover:border-border hover:bg-surface/80'
      }`}
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
  /** Beat selected by a stable `?beat=` deep link. */
  focusedBeatId?: string;
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
  focusedBeatId,
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
  // The beat whose chapter is being created. Held by id rather than by a plain
  // boolean so two rows cannot show the same spinner, and so a second click on
  // the SAME row is refused here as well as inside the transaction.
  const [writingBeatId, setWritingBeatId] = useState<string | null>(null);

  // Which chapters exist right now, for the same "a link counts only when its
  // target is alive" test the proofreader applies. Rebuilt with the prop, so a
  // chapter deleted in another tab brings the action back on the next render.
  const liveWritingIds = useMemo(() => new Set(writings.map(writing => writing.id)), [writings]);

  // One definition of what a new beat is, because the toolbar button and the
  // empty state both mint one and a writer who used the second must not get a
  // different row from the writer who used the first.
  const addBeat = () => {
    onAddBeat({
      outlineId,
      projectId,
      order: beats.length,
      level: 'beat',
      title: t('outline.beat.defaultTitle'),
      description: '',
      status: 'empty',
    });
  };

  const writeBeat = async (beat: OutlineBeat) => {
    if (writingBeatId) return;
    setWritingBeatId(beat.id);
    try {
      const created = await writeChapterForBeat(beat);
      // The list the spine renders comes from the parent's hook, which has no
      // idea this wrote anything; telling it through the same callback the
      // editor uses keeps the linked-chapter badge honest without a refetch.
      onUpdateBeat(beat.id, { linkedWritingId: created.writingId });
      toast.success(t('outline.beat.chapterCreated').replace('{title}', created.title));
      navigateTo(
        `/project/${encodeURIComponent(projectId)}/writings?writing=${encodeURIComponent(created.writingId)}`,
      );
    } catch (error) {
      console.error('[outline] the chapter for this beat could not be created', error);
      toast.error(t('outline.beat.chapterFailed'));
    } finally {
      setWritingBeatId(null);
    }
  };
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const appliedFocusRef = useRef<string | null>(null);
  const focusedAncestors = useMemo(() => {
    const ancestors = new Set<string>();
    const byId = new Map(beats.map(beat => [beat.id, beat]));
    let parentId = focusedBeatId ? byId.get(focusedBeatId)?.parentId : undefined;
    while (parentId && !ancestors.has(parentId)) {
      ancestors.add(parentId);
      parentId = byId.get(parentId)?.parentId;
    }
    return ancestors;
  }, [beats, focusedBeatId]);

  useEffect(() => {
    if (!focusedBeatId) {
      appliedFocusRef.current = null;
      return;
    }
    if (
      appliedFocusRef.current === focusedBeatId ||
      !beats.some(beat => beat.id === focusedBeatId)
    ) return;
    const row = rowRefs.current.get(focusedBeatId);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.focus({ preventScroll: true });
    appliedFocusRef.current = focusedBeatId;
  }, [beats, focusedBeatId, focusedAncestors]);

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
    const isExpanded = expandedBeats.has(beat.id) || focusedAncestors.has(beat.id);
    const hasChildBeats = hasChildren(beat.id);
    const statusConfig = BEAT_STATUS_CONFIG[beat.status];

    return (
      <div key={beat.id}>
        <SortableBeatRow
          id={beat.id}
          depth={depth}
          dragTitle={t('outline.beat.dragHint')}
          focused={focusedBeatId === beat.id}
          elementRef={node => {
            if (node) rowRefs.current.set(beat.id, node);
            else rowRefs.current.delete(beat.id);
          }}
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

          {/* Linked chapter indicator.
              The spine had one for a linked SCENE and none for a linked
              chapter, so a beat that had been written looked exactly like one
              that had not — and after "write this beat" the writer pressed it,
              came back, and found the row unchanged. The word-target chip below
              shows the same link, but only for a beat that happens to carry a
              target, which most do not. */}
          {beat.linkedWritingId && !(beat.wordTarget !== undefined && beat.wordTarget > 0) && (() => {
            const linkedWriting = writings.find((w) => w.id === beat.linkedWritingId);
            if (!linkedWriting) return null;
            // The COUNT, not the chapter's name. A chapter written from this
            // beat takes the beat's title, so naming it here printed the row's
            // own title back to itself twice; the number is the thing the spine
            // could not otherwise say — whether the promise has been kept, and
            // how far. The name is in the tooltip, where it costs no width.
            const written = linkedWriting.wordCount ?? 0;
            return (
              <div
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded flex-shrink-0 tabular-nums ${
                  written > 0 ? 'bg-accent-gold/10 text-accent-gold/80' : 'bg-surface text-text-dim'
                }`}
                title={`${t('outline.beat.linkedTo').replace('{name}', linkedWriting.title)} · ${
                  written.toLocaleString()
                } ${t('writings.words')}`}
              >
                <PenLine size={10} aria-hidden="true" />
                <span>{written.toLocaleString()}</span>
              </div>
            );
          })()}

          {/* Word target progress — the field was writable in the editor but
              never read anywhere; the linked writing's live word count was
              already arriving through the `writings` prop. */}
          {beat.wordTarget !== undefined && beat.wordTarget > 0 && (() => {
            const linkedWriting = beat.linkedWritingId
              ? writings.find((w) => w.id === beat.linkedWritingId)
              : undefined;
            const written = linkedWriting?.wordCount ?? 0;
            const reached = written >= (beat.wordTarget ?? 0);
            return (
              <div
                className={`text-xs px-2 py-1 rounded flex-shrink-0 tabular-nums ${
                  reached ? 'bg-green-500/10 text-green-500' : 'bg-surface text-text-dim'
                }`}
                title={t('outline.beat.wordTarget')}
              >
                {written.toLocaleString()}/{(beat.wordTarget ?? 0).toLocaleString()}
              </div>
            );
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
            {/* The spine's one verb. Shown only while the beat has nothing
                written for it — once it does, the badge above says so and this
                would just be a way to mint a duplicate. */}
            {beatNeedsChapter(beat, liveWritingIds) && (
              <button
                type="button"
                onClick={() => void writeBeat(beat)}
                disabled={writingBeatId !== null}
                className="p-1.5 hover:bg-accent-gold/10 rounded text-text-muted hover:text-accent-gold transition disabled:opacity-40"
                title={t('outline.beat.writeChapter')}
                aria-label={t('outline.beat.writeChapter')}
              >
                <PenLine size={14} aria-hidden="true" />
              </button>
            )}
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
            addBeat();
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
          <EmptyState
            icon={<Waypoints size={40} className="text-accent-gold" />}
            title={t('outline.noBeats.title')}
            message={t('outline.noBeats.message')}
            action={{ label: t('outline.addBeat'), onClick: addBeat }}
          />
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
