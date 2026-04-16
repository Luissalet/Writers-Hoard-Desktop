import { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
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
import type { Scene, DialogBlock, SceneCast } from '../types';
import { useDialogBlocks, useSceneCast } from '../hooks';
import CastBar from './CastBar';
import DialogBlockComponent from './DialogBlockComponent';
import { generateId } from '@/utils/idGenerator';

interface SceneEditorProps {
  scene: Scene;
  onUpdateScene: (changes: Partial<Scene>) => void;
  onBack: () => void;
}

function SortableBlockWrapper({
  block,
  onUpdate,
  onDelete,
}: {
  block: DialogBlock;
  onUpdate: (content: string, parenthetical?: string) => void;
  onDelete: () => void;
}) {
  const { listeners, setNodeRef, transform, isDragging } = useSortable({
    id: block.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform) }}
      className="relative"
    >
      <DialogBlockComponent
        block={block}
        onUpdate={onUpdate}
        onDelete={onDelete}
        isDragging={isDragging}
        dragHandleProps={listeners}
      />
    </div>
  );
}

export default function SceneEditor({
  scene,
  onUpdateScene,
  onBack,
}: SceneEditorProps) {
  const { items: blocks, addItem: addBlock, editItem: editBlock, removeItem: removeBlock, reorder } =
    useDialogBlocks(scene.id);
  const { cast, addMember, removeMember } = useSceneCast(scene.id);

  const [editingTitle, setEditingTitle] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [editingSetting, setEditingSetting] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = blocks.findIndex((b) => b.id === active.id);
      const newIndex = blocks.findIndex((b) => b.id === over.id);
      const newBlocks = arrayMove(blocks, oldIndex, newIndex);
      await reorder(newBlocks.map((b) => b.id));
    }
  };

  const handleAddDialog = async (characterName: string, characterColor: string) => {
    const nextOrder = blocks.length > 0 ? Math.max(...blocks.map((b) => b.order)) + 1 : 0;
    const block: DialogBlock = {
      id: generateId('block'),
      sceneId: scene.id,
      projectId: scene.projectId,
      type: 'dialog',
      characterName,
      characterColor,
      content: '',
      order: nextOrder,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await addBlock(block);
  };

  const handleAddStageDirection = async () => {
    const nextOrder = blocks.length > 0 ? Math.max(...blocks.map((b) => b.order)) + 1 : 0;
    const block: DialogBlock = {
      id: generateId('block'),
      sceneId: scene.id,
      projectId: scene.projectId,
      type: 'stage-direction',
      characterName: '',
      characterColor: '',
      content: '',
      order: nextOrder,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await addBlock(block);
    setShowAddMenu(false);
  };

  const handleAddCharacter = async (member: SceneCast) => {
    const castMember: SceneCast = {
      ...member,
      id: generateId('cast'),
      sceneId: scene.id,
    };
    await addMember(castMember);
  };

  const blockIds = useMemo(() => blocks.map((b) => b.id), [blocks]);

  return (
    <div className="h-full flex flex-col bg-deep">
      {/* Header */}
      <div className="border-b border-border bg-surface/30 px-6 py-4 flex items-center justify-between">
        <div className="flex-1">
          {editingTitle ? (
            <input
              autoFocus
              value={scene.title}
              onChange={(e) => onUpdateScene({ title: e.target.value })}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setEditingTitle(false);
              }}
              className="text-2xl font-serif font-bold text-text-primary bg-elevated/50 rounded px-3 py-1 border border-border focus:border-accent-gold outline-none w-full"
            />
          ) : (
            <button
              onClick={() => setEditingTitle(true)}
              className="text-2xl font-serif font-bold text-text-primary hover:text-accent-gold transition"
            >
              {scene.title}
            </button>
          )}

          {editingSetting ? (
            <input
              autoFocus
              value={scene.setting || ''}
              onChange={(e) => onUpdateScene({ setting: e.target.value })}
              onBlur={() => setEditingSetting(false)}
              placeholder="Add setting..."
              className="text-xs text-text-muted bg-elevated/50 rounded px-2 py-1 border border-border focus:border-accent-gold outline-none mt-1"
            />
          ) : (
            <button
              onClick={() => setEditingSetting(true)}
              className="text-xs text-text-muted hover:text-text-primary transition mt-1"
            >
              {scene.setting || 'Add setting...'}
            </button>
          )}
        </div>
        <button
          onClick={onBack}
          className="px-3 py-1.5 text-sm bg-border/30 text-text-muted hover:text-text-primary rounded transition"
        >
          Back
        </button>
      </div>

      {/* Description */}
      {editingDesc || scene.description ? (
        <div className="border-b border-border bg-elevated/20 px-6 py-3">
          {editingDesc ? (
            <textarea
              autoFocus
              value={scene.description || ''}
              onChange={(e) => onUpdateScene({ description: e.target.value })}
              onBlur={() => setEditingDesc(false)}
              placeholder="Scene description..."
              className="w-full text-xs text-text-muted bg-elevated border border-border rounded px-3 py-2 focus:border-accent-gold outline-none"
              rows={2}
            />
          ) : (
            <button
              onClick={() => setEditingDesc(true)}
              className="w-full text-left text-xs text-text-muted hover:text-text-primary transition"
            >
              {scene.description}
            </button>
          )}
        </div>
      ) : (
        <div className="border-b border-border bg-elevated/20 px-6 py-2">
          <button
            onClick={() => setEditingDesc(true)}
            className="text-xs text-text-dim hover:text-text-muted transition"
          >
            Add scene description...
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Cast Bar */}
          <CastBar
            cast={cast}
            onAddCharacter={handleAddCharacter}
            onAddDialog={handleAddDialog}
            onRemoveCharacter={removeMember}
          />

          {/* Dialog Blocks */}
          <div className="mt-6">
            {blocks.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-text-dim text-sm mb-3">
                  No dialog yet. Add a character and click their name to start writing.
                </p>
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={blockIds}
                  strategy={verticalListSortingStrategy}
                >
                  <AnimatePresence>
                    {blocks.map((block) => (
                      <SortableBlockWrapper
                        key={block.id}
                        block={block}
                        onUpdate={(content, parenthetical) => {
                          editBlock(block.id, { content, parenthetical });
                        }}
                        onDelete={() => removeBlock(block.id)}
                      />
                    ))}
                  </AnimatePresence>
                </SortableContext>
              </DndContext>
            )}
          </div>

          {/* Add Block Menu */}
          <div className="relative mt-6 pt-4 border-t border-border/30">
            {showAddMenu ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-2"
              >
                {cast.length > 0 && (
                  <div>
                    <p className="text-xs text-text-muted mb-2 font-semibold">
                      Quick Add Dialog:
                    </p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {cast.map((member) => (
                        <button
                          key={member.id}
                          onClick={() => {
                            handleAddDialog(member.characterName, member.color);
                            setShowAddMenu(false);
                          }}
                          className="px-2.5 py-1 text-xs rounded border transition"
                          style={{
                            borderColor: member.color + '60',
                            backgroundColor: member.color + '12',
                            color: member.color,
                          }}
                        >
                          {member.characterName}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  onClick={handleAddStageDirection}
                  className="w-full px-3 py-2 text-xs bg-elevated border border-border rounded hover:border-accent-gold/40 transition text-text-muted hover:text-text-primary"
                >
                  + Stage Direction
                </button>
                <button
                  onClick={() => setShowAddMenu(false)}
                  className="w-full px-3 py-2 text-xs bg-border/20 border border-border rounded hover:bg-border/30 transition text-text-muted"
                >
                  Done
                </button>
              </motion.div>
            ) : (
              <button
                onClick={() => setShowAddMenu(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm text-accent-gold hover:text-accent-amber bg-accent-gold/10 hover:bg-accent-gold/20 rounded-lg transition"
              >
                <Plus size={16} />
                Add Block
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
