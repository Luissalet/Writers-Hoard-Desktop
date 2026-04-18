import { useState, useMemo, useCallback } from 'react';
import { Plus, Link2 } from 'lucide-react';
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
import type { Scene, DialogBlock, DialogBlockType, BlockFormatting, SceneCast } from '../types';
import { useDialogBlocks, useSceneCast, useLinkedBeats } from '../hooks';
import { useCodexEntries } from '@/engines/codex/hooks';
import CastBar from './CastBar';
import DialogBlockComponent from './DialogBlockComponent';
import DualDialogGroup from './DualDialogGroup';
import ChronometryBadge from './ChronometryBadge';
import { SCREENPLAY_TRANSITIONS, SLUG_PREFIXES, type AutocompleteSuggestion } from './ScriptAutocomplete';
import { generateId } from '@/utils/idGenerator';
import { useTranslation } from '@/i18n/useTranslation';

interface SceneEditorProps {
  scene: Scene;
  scenes: Scene[];
  onUpdateScene: (changes: Partial<Scene>) => void;
  onBack: () => void;
}

function SortableBlockWrapper({
  block,
  onUpdate,
  onUpdateFormatting,
  onDelete,
  suggestions,
}: {
  block: DialogBlock;
  onUpdate: (content: string, parenthetical?: string) => void;
  onUpdateFormatting: (formatting: BlockFormatting) => void;
  onDelete: () => void;
  suggestions?: AutocompleteSuggestion[];
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
        onUpdateFormatting={onUpdateFormatting}
        onDelete={onDelete}
        isDragging={isDragging}
        dragHandleProps={listeners}
        suggestions={suggestions}
      />
    </div>
  );
}

export default function SceneEditor({
  scene,
  scenes: _scenes,
  onUpdateScene,
  onBack,
}: SceneEditorProps) {
  const { t } = useTranslation();
  void _scenes; // available for future scene-navigation features
  const { items: blocks, addItem: addBlock, editItem: editBlock, removeItem: removeBlock, reorder } =
    useDialogBlocks(scene.id);
  const { cast, addMember, removeMember } = useSceneCast(scene.id);
  const { items: codexEntries } = useCodexEntries(scene.projectId);
  const linkedBeats = useLinkedBeats(scene.id);

  // Build autocomplete suggestions from cast, codex, and standard screenwriting terms
  const autocompleteSuggestions = useMemo((): AutocompleteSuggestion[] => {
    const suggestions: AutocompleteSuggestion[] = [];

    // Characters from scene cast
    for (const member of cast) {
      suggestions.push({
        label: member.characterName.toUpperCase(),
        category: 'character',
        color: member.color,
      });
    }

    // Characters from codex (not already in cast)
    const castNames = new Set(cast.map((c) => c.characterName.toUpperCase()));
    for (const entry of codexEntries) {
      if (entry.type === 'character' && !castNames.has(entry.title.toUpperCase())) {
        suggestions.push({
          label: entry.title.toUpperCase(),
          category: 'character',
        });
      }
      if (entry.type === 'location') {
        suggestions.push({
          label: entry.title.toUpperCase(),
          category: 'location',
        });
      }
    }

    // Slug prefixes as locations
    for (const prefix of SLUG_PREFIXES) {
      suggestions.push({ label: prefix, category: 'location' });
    }

    // Standard transitions
    suggestions.push(...SCREENPLAY_TRANSITIONS);

    return suggestions;
  }, [cast, codexEntries]);

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

  const handleAddBlockType = async (type: DialogBlockType) => {
    const nextOrder = blocks.length > 0 ? Math.max(...blocks.map((b) => b.order)) + 1 : 0;
    const block: DialogBlock = {
      id: generateId('block'),
      sceneId: scene.id,
      projectId: scene.projectId,
      type,
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

  // Dual dialog pairing
  const [dualSelectMode, setDualSelectMode] = useState<string | null>(null); // first block id

  const handlePairDual = useCallback(async (blockId: string) => {
    if (!dualSelectMode) {
      // First selection
      setDualSelectMode(blockId);
    } else {
      // Second selection — pair them
      const groupId = generateId('dual');
      await editBlock(dualSelectMode, { dualGroupId: groupId });
      await editBlock(blockId, { dualGroupId: groupId });
      setDualSelectMode(null);
    }
  }, [dualSelectMode, editBlock]);

  const handleUnpairDual = useCallback(async (groupId: string) => {
    const grouped = blocks.filter((b) => b.dualGroupId === groupId);
    for (const b of grouped) {
      await editBlock(b.id, { dualGroupId: undefined });
    }
  }, [blocks, editBlock]);

  // Group blocks for rendering — dual groups are collapsed into one entry
  const renderGroups = useMemo(() => {
    const groups: Array<{ type: 'single'; block: DialogBlock } | { type: 'dual'; left: DialogBlock; right: DialogBlock; groupId: string }> = [];
    const processedDualGroups = new Set<string>();

    for (const block of blocks) {
      if (block.dualGroupId) {
        if (processedDualGroups.has(block.dualGroupId)) continue;
        processedDualGroups.add(block.dualGroupId);
        const pair = blocks.filter((b) => b.dualGroupId === block.dualGroupId);
        if (pair.length >= 2) {
          groups.push({ type: 'dual', left: pair[0], right: pair[1], groupId: block.dualGroupId });
        } else {
          groups.push({ type: 'single', block });
        }
      } else {
        groups.push({ type: 'single', block });
      }
    }
    return groups;
  }, [blocks]);

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
        <div className="flex-1 flex items-start gap-3">
          {/* Scene number badge */}
          <span className={`inline-flex items-center justify-center w-10 h-10 rounded-lg text-sm font-bold flex-shrink-0 mt-0.5 ${
            scene.isOmitted
              ? 'bg-border/30 text-text-dim line-through'
              : scene.isLocked
                ? 'bg-accent-gold/20 text-accent-gold border border-accent-gold/30'
                : 'bg-surface text-text-muted border border-border'
          }`}>
            {scene.sceneNumber ?? '—'}
          </span>
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
              className={`text-2xl font-serif font-bold hover:text-accent-gold transition ${
                scene.isOmitted ? 'text-text-dim line-through' : 'text-text-primary'
              }`}
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
              placeholder={t('dialogScene.settingPlaceholder')}
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
          {/* Linked beats indicator */}
          {linkedBeats.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <Link2 size={11} className="text-accent-gold/70" />
              <span className="text-[10px] text-accent-gold/70">
                Linked to {linkedBeats.length} outline beat{linkedBeats.length > 1 ? 's' : ''}
                {linkedBeats.length <= 3 && ': '}
                {linkedBeats.slice(0, 3).map((b) => b.title).join(', ')}
              </span>
            </div>
          )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ChronometryBadge blocks={blocks} />
          <button
            onClick={onBack}
            className="px-3 py-1.5 text-sm bg-border/30 text-text-muted hover:text-text-primary rounded transition"
          >
            Back
          </button>
        </div>
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
              placeholder={t('dialogScene.descriptionPlaceholder')}
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

          {/* Dual-select mode indicator */}
          {dualSelectMode && (
            <div className="mt-4 flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/30 rounded-lg text-xs text-blue-300">
              <span>{t('dialogScene.pairHint')}</span>
              <button
                onClick={() => setDualSelectMode(null)}
                className="ml-auto px-2 py-0.5 bg-blue-500/20 rounded hover:bg-blue-500/30 transition"
              >
                Cancel
              </button>
            </div>
          )}

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
                    {renderGroups.map((group) => {
                      if (group.type === 'dual') {
                        return (
                          <DualDialogGroup
                            key={group.groupId}
                            left={group.left}
                            right={group.right}
                            onUpdateLeft={(content, p) => editBlock(group.left.id, { content, parenthetical: p })}
                            onUpdateRight={(content, p) => editBlock(group.right.id, { content, parenthetical: p })}
                            onUpdateFormattingLeft={(f) => editBlock(group.left.id, { formatting: f })}
                            onUpdateFormattingRight={(f) => editBlock(group.right.id, { formatting: f })}
                            onDeleteLeft={() => removeBlock(group.left.id)}
                            onDeleteRight={() => removeBlock(group.right.id)}
                            onUnpair={() => handleUnpairDual(group.groupId)}
                            suggestions={autocompleteSuggestions}
                          />
                        );
                      }
                      const block = group.block;
                      return (
                        <div key={block.id} className="group/block relative">
                          <SortableBlockWrapper
                            block={block}
                            onUpdate={(content, parenthetical) => {
                              editBlock(block.id, { content, parenthetical });
                            }}
                            onUpdateFormatting={(formatting) => {
                              editBlock(block.id, { formatting });
                            }}
                            onDelete={() => removeBlock(block.id)}
                            suggestions={autocompleteSuggestions}
                          />
                          {/* Dual pair button for dialog blocks */}
                          {block.type === 'dialog' && !block.dualGroupId && (
                            <button
                              onClick={() => handlePairDual(block.id)}
                              className={`absolute -right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-[9px] font-bold transition z-10 ${
                                dualSelectMode === block.id
                                  ? 'bg-blue-500/20 text-blue-400 opacity-100 ring-1 ring-blue-500/40'
                                  : dualSelectMode
                                    ? 'bg-blue-500/10 text-blue-300 opacity-100 hover:bg-blue-500/20'
                                    : 'bg-border/50 text-text-dim hover:text-text-primary opacity-0 group-hover/block:opacity-100'
                              }`}
                              title={dualSelectMode === block.id ? 'Selected — click another block' : dualSelectMode ? 'Pair with this block' : 'Start dual dialog pairing'}
                            >
                              ||
                            </button>
                          )}
                        </div>
                      );
                    })}
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
                <div>
                  <p className="text-xs text-text-muted mb-2 font-semibold">
                    Elements:
                  </p>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <button
                      onClick={() => handleAddBlockType('stage-direction')}
                      className="px-3 py-2 text-xs bg-elevated border border-border rounded hover:border-accent-gold/40 transition text-text-muted hover:text-text-primary text-left"
                    >
                      + Stage Direction
                    </button>
                    <button
                      onClick={() => handleAddBlockType('action')}
                      className="px-3 py-2 text-xs bg-elevated border border-border rounded hover:border-accent-gold/40 transition text-text-muted hover:text-text-primary text-left"
                    >
                      + Action
                    </button>
                    <button
                      onClick={() => handleAddBlockType('transition')}
                      className="px-3 py-2 text-xs bg-elevated border border-border rounded hover:border-accent-gold/40 transition text-text-muted hover:text-text-primary text-left"
                    >
                      + Transition
                    </button>
                    <button
                      onClick={() => handleAddBlockType('slug')}
                      className="px-3 py-2 text-xs bg-elevated border border-border rounded hover:border-accent-gold/40 transition text-text-muted hover:text-text-primary text-left"
                    >
                      + Scene Heading
                    </button>
                    <button
                      onClick={() => handleAddBlockType('note')}
                      className="px-3 py-2 text-xs bg-elevated border border-border rounded hover:border-accent-gold/40 transition text-text-muted hover:text-text-primary text-left"
                    >
                      + Note
                    </button>
                  </div>
                </div>

                {/* Dual Dialog — needs at least 2 cast members to pick from */}
                {cast.length >= 2 && (
                  <div>
                    <p className="text-xs text-text-muted mb-2 font-semibold">
                      Dual Dialogue (simultaneous):
                    </p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {cast.map((memberA, i) =>
                        cast.slice(i + 1).map((memberB) => (
                          <button
                            key={`${memberA.id}-${memberB.id}`}
                            onClick={async () => {
                              const groupId = generateId('dual');
                              const nextOrder = blocks.length > 0 ? Math.max(...blocks.map((b) => b.order)) + 1 : 0;
                              const blockA: DialogBlock = {
                                id: generateId('block'),
                                sceneId: scene.id,
                                projectId: scene.projectId,
                                type: 'dialog',
                                characterName: memberA.characterName,
                                characterColor: memberA.color,
                                content: '',
                                order: nextOrder,
                                dualGroupId: groupId,
                                createdAt: Date.now(),
                                updatedAt: Date.now(),
                              };
                              const blockB: DialogBlock = {
                                id: generateId('block'),
                                sceneId: scene.id,
                                projectId: scene.projectId,
                                type: 'dialog',
                                characterName: memberB.characterName,
                                characterColor: memberB.color,
                                content: '',
                                order: nextOrder + 1,
                                dualGroupId: groupId,
                                createdAt: Date.now(),
                                updatedAt: Date.now(),
                              };
                              await addBlock(blockA);
                              await addBlock(blockB);
                              setShowAddMenu(false);
                            }}
                            className="px-3 py-2 text-xs bg-elevated border border-blue-500/30 rounded hover:border-blue-400/50 transition text-text-muted hover:text-text-primary text-left flex items-center gap-2"
                          >
                            <span className="flex items-center gap-1">
                              <span
                                className="w-2 h-2 rounded-full inline-block"
                                style={{ backgroundColor: memberA.color }}
                              />
                              {memberA.characterName}
                            </span>
                            <span className="text-blue-400 font-bold">||</span>
                            <span className="flex items-center gap-1">
                              <span
                                className="w-2 h-2 rounded-full inline-block"
                                style={{ backgroundColor: memberB.color }}
                              />
                              {memberB.characterName}
                            </span>
                          </button>
                        )),
                      )}
                    </div>
                  </div>
                )}
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
