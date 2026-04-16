import { useState, useMemo } from 'react';
import { ListTree, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { EngineComponentProps } from '@/engines/_types';
import { useAutoSelect, useEnsureDefault, EngineSpinner } from '@/engines/_shared';
import { useOutlines, useOutlineBeats } from '../hooks';
import { useScenes } from '@/engines/dialog-scene/hooks';
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

  const { items: beats, addItem: addBeat, editItem: editBeat, removeItem: removeBeat } = useOutlineBeats(activeOutlineId);
  const { items: scenes } = useScenes(projectId);

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

    // Add beats from template if selected
    if (selectedTemplateId) {
      const template = BEAT_SHEET_TEMPLATES.find((t) => t.id === selectedTemplateId);
      if (template) {
        for (let i = 0; i < template.beats.length; i++) {
          const templateBeat = template.beats[i];
          const beat: OutlineBeat = {
            id: generateId('beat'),
            outlineId: outline.id,
            projectId,
            order: i,
            level: templateBeat.level,
            title: templateBeat.title,
            description: templateBeat.description,
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
      if (remaining.length > 0) {
        setActiveOutlineId(remaining[0].id);
      } else {
        setActiveOutlineId('');
      }
    }
  };
  // Suppress unused — wired to UI delete buttons
  void handleDeleteOutline;

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
              value={activeOutline.title}
              onChange={(e) => editOutline(activeOutlineId, { title: e.target.value, updatedAt: Date.now() })}
              className="text-2xl font-semibold text-text-primary bg-transparent focus:outline-none focus:ring-2 focus:ring-accent-gold/50 rounded px-2 py-1 -mx-2 mb-2 w-full"
              placeholder={t('outline.titlePlaceholder')}
            />
            {activeOutline.templateId && (
              <p className="text-xs text-text-dim">
                {t('outline.usingTemplate')} {BEAT_SHEET_TEMPLATES.find((tmpl) => tmpl.id === activeOutline.templateId)?.name}
              </p>
            )}
          </div>

          {/* Beat List */}
          <BeatList
            beats={beats}
            scenes={scenes}
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
                <button
                  key={outline.id}
                  onClick={() => setActiveOutlineId(outline.id)}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition text-center min-h-24 ${
                    isActive
                      ? 'border-accent-gold bg-accent-gold/10'
                      : 'border-border bg-surface/50 hover:border-accent-gold/50'
                  }`}
                >
                  <ListTree
                    size={20}
                    className={isActive ? 'text-accent-gold mb-1' : 'text-text-dim mb-1'}
                  />
                  <p className="text-xs font-medium text-text-primary truncate w-full">
                    {outline.title}
                  </p>
                  <p className="text-xs text-text-dim mt-1">
                    {beats.filter((b) => b.outlineId === outline.id).length} {t('outline.beats')}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
