import { useState, useMemo, useEffect, useCallback } from 'react';
import { ListTree, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { useAutoSelect, useEnsureDefault, EngineSpinner, ConfirmDialog, useDebouncedField } from '@/engines/_shared';
import { useOutlines, useOutlineBeats } from '../hooks';
import { getBeatCountsByOutline } from '../operations';
import { useScenes } from '@/engines/dialog-scene/hooks';
import { useWritings } from '@/engines/writings/hooks';
import { BEAT_SHEET_TEMPLATES } from '../types';
import type { Outline, OutlineBeat } from '../types';
import { generateId } from '@/utils/idGenerator';
import TemplateSelector from './TemplateSelector';
import BeatList from './BeatList';

export default function OutlineEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const { items: outlines, loading, addItem: addOutline, editItem: editOutline, removeItem: removeOutline } = useOutlines(projectId);
  const [activeOutlineId, setActiveOutlineId] = useState<string>('');
  const [showNewOutline, setShowNewOutline] = useState(false);
  const [newOutlineName, setNewOutlineName] = useState('');
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [templateForNewOutline, setTemplateForNewOutline] = useState<string | undefined>(undefined);
  void templateForNewOutline; // used in template selection flow

  // `reorder` estaba en el hook desde el principio y no se extraía siquiera:
  // el asa de arrastre de `BeatList` era decoración.
  const { items: beats, addItem: addBeat, editItem: editBeat, removeItem: removeBeat, reorder: reorderBeats } = useOutlineBeats(activeOutlineId);
  const { items: scenes } = useScenes(projectId);
  const { writings } = useWritings(projectId);

  // Per-outline beat totals for the dashboard cards. `beats` only ever holds
  // the ACTIVE outline's beats, so counting it per card showed "0 beats" on
  // every inactive outline.
  const [beatCounts, setBeatCounts] = useState<Record<string, number>>({});
  const [pendingDeleteOutline, setPendingDeleteOutline] = useState<Outline | null>(null);

  const refreshBeatCounts = useCallback(() => {
    let cancelled = false;
    void getBeatCountsByOutline(projectId).then((counts) => {
      if (!cancelled) setBeatCounts(counts);
    });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => refreshBeatCounts(), [refreshBeatCounts, outlines.length, beats.length]);

  useAutoSelect(outlines, activeOutlineId, setActiveOutlineId);

  useEnsureDefault({
    items: outlines,
    loading,
    createDefault: () => ({
      id: generateId('outline'),
      projectId,
      title: t('outline.defaultName'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    addItem: addOutline,
    onCreated: setActiveOutlineId,
  });

  const activeOutline = useMemo(
    () => outlines.find((o) => o.id === activeOutlineId),
    [outlines, activeOutlineId],
  );

  const activeTemplate = useMemo(
    () => BEAT_SHEET_TEMPLATES.find((tmpl) => tmpl.id === activeOutline?.templateId),
    [activeOutline?.templateId],
  );

  // Buffered: the title used to hit Dexie plus a full table refresh on every
  // keystroke, with the input bound to the refreshed row — so typing fast lost
  // characters.
  const titleField = useDebouncedField(
    activeOutline?.title ?? '',
    (title) => { if (activeOutlineId) void editOutline(activeOutlineId, { title, updatedAt: Date.now() }); },
  );

  const handleCreateOutline = async (name: string, selectedTemplateId?: string) => {
    const outline: Outline = {
      id: generateId('outline'),
      projectId,
      title: name.trim(),
      templateId: selectedTemplateId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await addOutline(outline);
    setActiveOutlineId(outline.id);

    // Add beats from template if selected.
    // The template only holds i18n keys, so they MUST be resolved here: these
    // strings are copied into the beat rows and live in the author's project
    // for good — a key (or English) written now would never be re-translated.
    if (selectedTemplateId) {
      const template = BEAT_SHEET_TEMPLATES.find((tmpl) => tmpl.id === selectedTemplateId);
      if (template) {
        for (let i = 0; i < template.beats.length; i++) {
          const templateBeat = template.beats[i];
          const beat: OutlineBeat = {
            id: generateId('beat'),
            outlineId: outline.id,
            projectId,
            order: i,
            level: templateBeat.level,
            title: t(templateBeat.titleKey),
            description: t(templateBeat.descriptionKey),
            storyPosition: templateBeat.storyPosition,
            color: templateBeat.color,
            status: 'empty',
            tags: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await addBeat(beat);
        }
      }
    }

    setNewOutlineName('');
    setShowNewOutline(false);
    setShowTemplateSelector(false);
    setTemplateForNewOutline(undefined);
  };

  const handleDeleteOutline = async (id: string) => {
    await removeOutline(id);
    if (activeOutlineId === id) {
      const remaining = outlines.filter((o) => o.id !== id);
      setActiveOutlineId(remaining.length > 0 ? remaining[0].id : '');
    }
    setBeatCounts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  if (loading) return <EngineSpinner />;

  return (
    <div className="space-y-6">
      {/* Main Outline View */}
      {activeOutline && (
        <div className="space-y-4">
          <div className="border border-border rounded-xl bg-surface/50 p-6">
            {/* Outline Title */}
            <input
              type="text"
              value={titleField.value}
              onChange={(e) => titleField.onChange(e.target.value)}
              onBlur={titleField.onBlur}
              className="text-2xl font-semibold text-text-primary bg-transparent focus:outline-none focus:ring-2 focus:ring-accent-gold/50 rounded px-2 py-1 -mx-2 mb-2 w-full"
              placeholder={t('outline.titlePlaceholder')}
            />
            {activeOutline.templateId && (
              <p className="text-xs text-text-dim">
                {t('outline.usingTemplate')} {activeTemplate ? t(activeTemplate.nameKey) : activeOutline.templateId}
              </p>
            )}
          </div>

          {/* Beat List */}
          <BeatList
            beats={beats}
            outlineId={activeOutlineId}
            projectId={projectId}
            scenes={scenes}
            writings={writings}
            onAddBeat={async (beatData) => {
              const beat: OutlineBeat = {
                ...beatData,
                id: generateId('beat'),
                createdAt: Date.now(),
                updatedAt: Date.now(),
              };
              await addBeat(beat);
            }}
            onUpdateBeat={editBeat}
            onDeleteBeat={removeBeat}
            onReorder={(orderedIds) => { void reorderBeats(orderedIds); }}
          />
        </div>
      )}

      {/* Outlines Collection Dashboard */}
      <div className="border border-border rounded-xl bg-surface/50 p-4 mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
            <ListTree size={14} className="text-accent-gold" />
            {t('outline.yourOutlines')}
          </h3>
          {showNewOutline ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                value={newOutlineName}
                onChange={(e) => setNewOutlineName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newOutlineName.trim()) {
                    setShowTemplateSelector(true);
                  } else if (e.key === 'Escape') {
                    setShowNewOutline(false);
                    setNewOutlineName('');
                  }
                }}
                placeholder={t('outline.namePlaceholder')}
                className="px-3 py-1.5 text-xs bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50"
              />
              <button
                onClick={() => {
                  setShowNewOutline(false);
                  setNewOutlineName('');
                }}
                className="px-2 py-1.5 text-xs rounded hover:bg-surface/80"
              >
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowNewOutline(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
            >
              <Plus size={13} />
              {t('outline.newOutline')}
            </button>
          )}
        </div>

        {/* Template Selector Modal */}
        {showTemplateSelector && newOutlineName.trim() && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-elevated border border-border rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
              <TemplateSelector
                onSelectTemplate={(templateId) => {
                  handleCreateOutline(newOutlineName, templateId);
                }}
              />
            </div>
          </div>
        )}

        {/* Outlines Grid */}
        {outlines.length === 0 ? (
          <p className="text-sm text-text-dim text-center py-4">
            {t('outline.noOutlines')}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
            {outlines.map((outline) => {
              const isActive = outline.id === activeOutlineId;
              return (
                <div
                  key={outline.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveOutlineId(outline.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActiveOutlineId(outline.id);
                    }
                  }}
                  className={`group relative cursor-pointer flex flex-col items-center justify-center p-3 rounded-xl border-2 transition text-center min-h-24 ${
                    isActive
                      ? 'border-accent-gold bg-accent-gold/10'
                      : 'border-border bg-surface/50 hover:border-accent-gold/50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteOutline(outline);
                    }}
                    title={t('common.delete')}
                    className="absolute top-1 right-1 p-1 rounded text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-500/10 transition"
                  >
                    <Trash2 size={13} />
                  </button>
                  <ListTree
                    size={20}
                    className={isActive ? 'text-accent-gold mb-1' : 'text-text-dim mb-1'}
                  />
                  <p className="text-xs font-medium text-text-primary truncate w-full">
                    {outline.title}
                  </p>
                  <p className="text-xs text-text-dim mt-1">
                    {beatCounts[outline.id] ?? 0} {t('outline.beats')}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDeleteOutline !== null}
        destructive
        message={t('outline.deleteConfirm').replace('{name}', pendingDeleteOutline?.title ?? '')}
        onConfirm={() => {
          if (pendingDeleteOutline) void handleDeleteOutline(pendingDeleteOutline.id);
          setPendingDeleteOutline(null);
        }}
        onCancel={() => setPendingDeleteOutline(null)}
      />
    </div>
  );
}
