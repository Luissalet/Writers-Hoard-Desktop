import { useState, useMemo } from 'react';
import { Plus, Filter } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import type { Biography, BiographyFact, BiographyCategory } from '../types';
import { useBiographyFacts } from '../hooks';
import { BIOGRAPHY_CATEGORIES } from '../types';
import FactCard from './FactCard';
import FactEditor from './FactEditor';
import NarrativeView from './NarrativeView';
import { generateId } from '@/utils/idGenerator';
import { ConfirmDialog } from '@/engines/_shared';
import { useTranslation } from '@/i18n/useTranslation';
import { useCodexEntries } from '@/engines/codex/hooks';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';

interface BiographyViewProps {
  biography: Biography;
  onUpdate: (changes: Partial<Biography>) => void;
}

type ViewMode = 'cards' | 'narrative';

export default function BiographyView({ biography, onUpdate }: BiographyViewProps) {
  const { t } = useTranslation();
  const { items: facts, addItem: addFact, editItem: editFact, removeItem: removeFact } = useBiographyFacts(biography.id);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingFact, setEditingFact] = useState<BiographyFact | undefined>();
  const [selectedCategory, setSelectedCategory] = useState<BiographyCategory | null>(null);
  const [pendingDeleteFactId, setPendingDeleteFactId] = useState<string | null>(null);

  const { items: codexEntries } = useCodexEntries(biography.projectId);
  const characters = useMemo(
    () => codexEntries.filter((e) => e.type === 'character' || e.type === 'custom'),
    [codexEntries],
  );

  // Extract birth/death dates from facts
  const birthDate = useMemo(() => {
    return facts.find(f => f.category === 'birth')?.date;
  }, [facts]);

  const deathDate = useMemo(() => {
    return facts.find(f => f.category === 'death')?.date;
  }, [facts]);

  // Filter facts by selected category
  const filteredFacts = useMemo(() => {
    if (!selectedCategory) return facts;
    return facts.filter(f => f.category === selectedCategory);
  }, [facts, selectedCategory]);

  const handleNewFact = () => {
    setEditingFact(undefined);
    setIsEditorOpen(true);
  };

  const handleEditFact = (fact: BiographyFact) => {
    setEditingFact(fact);
    setIsEditorOpen(true);
  };

  const handleSaveFact = async (factData: Omit<BiographyFact, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (editingFact) {
      // Update existing
      await editFact(editingFact.id, {
        ...factData,
        biographyId: editingFact.biographyId,
        projectId: editingFact.projectId,
      });
    } else {
      // Create new
      const newFact: BiographyFact = {
        id: generateId('fact'),
        ...factData,
        biographyId: biography.id,
        projectId: biography.projectId,
        order: facts.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await addFact(newFact);
    }
    setIsEditorOpen(false);
    setEditingFact(undefined);
  };

  const handleDeleteFact = (factId: string) => {
    setPendingDeleteFactId(factId);
  };

  const confirmDeleteFact = async () => {
    if (!pendingDeleteFactId) return;
    const id = pendingDeleteFactId;
    setPendingDeleteFactId(null);
    await removeFact(id);
  };

  return (
    <div className="space-y-6">
      {/* Subject Card */}
      <div className="bg-gradient-to-r from-accent-gold/20 to-accent-amber/10 border border-accent-gold/30 rounded-xl p-6">
        <div className="flex gap-6">
          {biography.subjectPhoto && (
            <img
              src={biography.subjectPhoto}
              alt={biography.subjectName}
              className="w-24 h-24 rounded-lg object-cover border border-border"
            />
          )}
          <div className="flex-grow">
            <h1 className="text-3xl font-serif font-bold text-text-primary mb-2">
              {biography.subjectName}
            </h1>
            {/* Codex link. `Biography.subjectId` was declared in types.ts and
                never written by anything, so a biography could not be tied to
                the character it was about. */}
            {characters.length > 0 && (
              <select
                value={biography.subjectId ?? ''}
                onChange={(e) => {
                  const id = e.target.value || undefined;
                  const entry = characters.find((c) => c.id === id);
                  onUpdate({
                    subjectId: id,
                    ...(entry ? { subjectName: entry.title } : {}),
                  });
                }}
                className="mb-3 px-2 py-1 text-xs bg-surface border border-border rounded-lg text-text-muted outline-none focus:border-accent-gold transition cursor-pointer"
              >
                <option value="">{t('biography.subject.none')}</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            )}
            {(birthDate || deathDate) && (
              <p className="text-lg text-text-muted mb-3">
                {birthDate && <span>{birthDate}</span>}
                {birthDate && deathDate && <span> – </span>}
                {deathDate && <span>{deathDate}</span>}
              </p>
            )}
            <p className="text-sm text-text-muted">
              {t('biography.factsCollected').replace('{count}', String(facts.length))}
            </p>
          </div>

          {/* Subject photo upload button */}
          {!biography.subjectPhoto && (
            <button
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                      const base64 = event.target?.result as string;
                      onUpdate({ subjectPhoto: base64 });
                    };
                    reader.readAsDataURL(file);
                  }
                };
                input.click();
              }}
              className="flex-shrink-0 w-24 h-24 bg-surface/50 border-2 border-dashed border-accent-gold/50 rounded-lg flex items-center justify-center text-accent-gold hover:border-accent-gold transition"
            >
              <Plus size={28} />
            </button>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('cards')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              viewMode === 'cards'
                ? 'bg-accent-gold text-deep'
                : 'bg-surface text-text-muted hover:text-text-primary'
            }`}
          >
            {t('biography.view.cards')}
          </button>
          <button
            onClick={() => setViewMode('narrative')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              viewMode === 'narrative'
                ? 'bg-accent-gold text-deep'
                : 'bg-surface text-text-muted hover:text-text-primary'
            }`}
          >
            {t('biography.view.narrative')}
          </button>
        </div>

        <button
          onClick={handleNewFact}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-gold text-deep rounded-lg text-sm font-semibold hover:bg-accent-amber transition"
        >
          <Plus size={16} />
          {t('biography.newFact')}
        </button>
      </div>

      {/* Category filter (Cards view only) */}
      {viewMode === 'cards' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Filter size={14} />
            {t('biography.filterByCategory')}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                selectedCategory === null
                  ? 'bg-accent-gold text-deep'
                  : 'bg-surface text-text-muted hover:text-text-primary'
              }`}
            >
              {t('biography.allFacts').replace('{count}', String(facts.length))}
            </button>
            {Object.entries(BIOGRAPHY_CATEGORIES).map(([key, { labelKey }]) => {
              const count = facts.filter(f => f.category === key).length;
              if (count === 0) return null;
              return (
                <button
                  key={key}
                  onClick={() => setSelectedCategory(key as BiographyCategory)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                    selectedCategory === key
                      ? 'bg-accent-gold text-deep'
                      : 'bg-surface text-text-muted hover:text-text-primary'
                  }`}
                >
                  {t(labelKey)} ({count})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Content */}
      {viewMode === 'cards' ? (
        <div className="space-y-3">
          {filteredFacts.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-text-muted mb-3">
                {selectedCategory
                  ? `No facts in this category yet.`
                  : `No facts yet. Create one to get started.`}
              </p>
              {filteredFacts.length === 0 && !selectedCategory && (
                <button
                  onClick={handleNewFact}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-accent-gold/10 text-accent-gold rounded-lg hover:bg-accent-gold/20 transition"
                >
                  <Plus size={16} />
                  Create First Fact
                </button>
              )}
            </div>
          ) : (
            <AnimatePresence>
              {filteredFacts.map(fact => (
                <FactCard
                  key={fact.id}
                  fact={fact}
                  onEdit={() => handleEditFact(fact)}
                  onDelete={() => handleDeleteFact(fact.id)}
                />
              ))}
            </AnimatePresence>
          )}
        </div>
      ) : (
        <NarrativeView facts={facts} subjectName={biography.subjectName} />
      )}

      {/* Margin notes + backlinks — first time biographies join the
          interconnectedness layer. */}
      <div className="pt-2 border-t border-border">
        <AnnotationSurface
          projectId={biography.projectId}
          engineId="biography"
          entityId={biography.id}
          layout="stack"
        />
      </div>

      {/* Editor modal.
          Mounted conditionally and keyed by the fact being edited: FactEditor
          seeds all of its state from `fact` in useState initialisers, which
          only run on mount. Keeping it permanently mounted meant "edit" always
          opened the form blank (it had first mounted with fact === undefined)
          and saving was rejected. */}
      {isEditorOpen && (
        <FactEditor
          key={editingFact?.id ?? '__new__'}
          fact={editingFact}
          projectId={biography.projectId}
          isOpen={isEditorOpen}
          onClose={() => {
            setIsEditorOpen(false);
            setEditingFact(undefined);
          }}
          onSave={handleSaveFact}
        />
      )}

      <ConfirmDialog
        open={pendingDeleteFactId !== null}
        destructive
        message={t('biography.fact.deleteConfirm')}
        onConfirm={confirmDeleteFact}
        onCancel={() => setPendingDeleteFactId(null)}
      />
    </div>
  );
}
