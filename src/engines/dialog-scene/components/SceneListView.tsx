import { Plus, Trash2, GripVertical, Lock, Unlock, EyeOff, Eye } from 'lucide-react';
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Scene } from '../types';
import { generateId } from '@/utils/idGenerator';
import { useTranslation } from '@/i18n/useTranslation';

interface SceneListViewProps {
  scenes: Scene[];
  onSelectScene: (sceneId: string) => void;
  onCreateScene: (scene: Scene) => void;
  onUpdateScene: (sceneId: string, changes: Partial<Scene>) => void;
  onDeleteScene: (sceneId: string) => void;
  onReorderScenes: (orderedIds: string[]) => void;
}

function SortableSceneCard({
  scene,
  onSelect,
  onUpdate,
  onDelete,
}: {
  scene: Scene;
  onSelect: () => void;
  onUpdate: (changes: Partial<Scene>) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { listeners, setNodeRef, transform, isDragging } = useSortable({
    id: scene.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform) }}
      className={`transition ${isDragging ? 'opacity-50' : ''}`}
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className={`group relative rounded-lg border bg-elevated hover:bg-elevated/70 transition cursor-pointer p-4 ${
          scene.isOmitted ? 'border-border/50 opacity-60' : 'border-border'
        }`}
        onClick={onSelect}
      >
        <div className="flex items-start gap-3">
          {/* Drag handle */}
          <button
            {...listeners}
            className="pt-1 text-text-dim opacity-0 group-hover:opacity-100 transition flex-shrink-0 cursor-grab active:cursor-grabbing"
            title={t('common.dragToReorder')}
          >
            <GripVertical size={16} />
          </button>

          {/* Scene number badge */}
          <div className="flex-shrink-0 pt-0.5">
            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold ${
              scene.isOmitted
                ? 'bg-border/30 text-text-dim line-through'
                : scene.isLocked
                  ? 'bg-accent-gold/20 text-accent-gold border border-accent-gold/30'
                  : 'bg-surface text-text-muted border border-border'
            }`}>
              {scene.sceneNumber ?? '—'}
            </span>
          </div>

          {/* Scene info */}
          <div className="flex-1 min-w-0">
            <h3 className={`font-serif font-semibold truncate ${
              scene.isOmitted ? 'text-text-dim line-through' : 'text-text-primary'
            }`}>
              {scene.title}
            </h3>
            {scene.setting && (
              <p className="text-xs text-text-muted mt-1">
                {t('dialogScene.setting')}: {scene.setting}
              </p>
            )}
            {scene.description && (
              <p className="text-sm text-text-dim mt-2 line-clamp-2">
                {scene.description}
              </p>
            )}
            <p className="text-xs text-text-dim mt-2">
              {new Date(scene.createdAt).toLocaleDateString()}
            </p>
          </div>

          {/* Scene controls */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
            {/* Lock/Unlock number */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdate({ isLocked: !scene.isLocked });
              }}
              className={`p-1.5 rounded transition ${
                scene.isLocked
                  ? 'text-accent-gold bg-accent-gold/10'
                  : 'text-text-dim hover:text-text-primary hover:bg-surface'
              }`}
              title={scene.isLocked ? t('dialogScene.unlockNumber') : t('dialogScene.lockNumber')}
            >
              {scene.isLocked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>

            {/* Omit/Restore */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUpdate({ isOmitted: !scene.isOmitted });
              }}
              className={`p-1.5 rounded transition ${
                scene.isOmitted
                  ? 'text-amber-400 bg-amber-500/10'
                  : 'text-text-dim hover:text-text-primary hover:bg-surface'
              }`}
              title={scene.isOmitted ? t('dialogScene.restoreScene') : t('dialogScene.omitScene')}
            >
              {scene.isOmitted ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>

            {/* Delete */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1.5 text-text-dim hover:text-danger hover:bg-danger/10 rounded transition"
              title={t('dialogScene.deleteScene')}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default function SceneListView({
  scenes,
  onSelectScene,
  onCreateScene,
  onUpdateScene,
  onDeleteScene,
  onReorderScenes,
}: SceneListViewProps) {
  const { t } = useTranslation();
  const [showNewScene, setShowNewScene] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleCreateScene = () => {
    if (!newTitle.trim()) return;

    const scene: Scene = {
      id: generateId('scene'),
      projectId: '', // will be set by parent
      title: newTitle.trim(),
      order: scenes.length,
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    onCreateScene(scene);
    setNewTitle('');
    setShowNewScene(false);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = scenes.findIndex((s) => s.id === active.id);
      const newIndex = scenes.findIndex((s) => s.id === over.id);
      const newScenes = arrayMove(scenes, oldIndex, newIndex);
      onReorderScenes(newScenes.map((s) => s.id));
    }
  };

  const sceneIds = useMemo(() => scenes.map((s) => s.id), [scenes]);

  return (
    <div className="h-full flex flex-col bg-deep">
      {/* Header */}
      <div className="border-b border-border bg-surface/30 px-6 py-4 flex items-center justify-between">
        <h1 className="text-2xl font-serif font-bold text-text-primary">{t('dialogScene.title')}</h1>
        <button
          onClick={() => setShowNewScene(!showNewScene)}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-accent-gold text-deep rounded-lg font-semibold hover:bg-accent-amber transition"
        >
          <Plus size={16} />
          {t('dialogScene.newScene')}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* New Scene Form */}
          <AnimatePresence>
            {showNewScene && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="rounded-lg border border-border bg-elevated p-4 space-y-3"
              >
                <input
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={t('dialogScene.sceneTitlePlaceholder')}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary placeholder:text-text-dim focus:border-accent-gold outline-none text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateScene();
                    if (e.key === 'Escape') {
                      setShowNewScene(false);
                      setNewTitle('');
                    }
                  }}
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCreateScene}
                    className="flex-1 px-3 py-1.5 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition"
                  >
                    {t('dialogScene.createScene')}
                  </button>
                  <button
                    onClick={() => {
                      setShowNewScene(false);
                      setNewTitle('');
                    }}
                    className="flex-1 px-3 py-1.5 bg-border/30 text-text-muted text-sm rounded-lg hover:bg-border/50 transition"
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Scenes List */}
          {scenes.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-text-dim text-sm mb-4">
                {t('dialogScene.noScenes')}
              </p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sceneIds}
                strategy={verticalListSortingStrategy}
              >
                <AnimatePresence>
                  {scenes.map((scene) => (
                    <SortableSceneCard
                      key={scene.id}
                      scene={scene}
                      onSelect={() => onSelectScene(scene.id)}
                      onUpdate={(changes) => onUpdateScene(scene.id, changes)}
                      onDelete={() => {
                        if (
                          confirm(
                            t('dialogScene.deleteConfirm').replace('{name}', scene.title)
                          )
                        ) {
                          onDeleteScene(scene.id);
                        }
                      }}
                    />
                  ))}
                </AnimatePresence>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>
    </div>
  );
}
