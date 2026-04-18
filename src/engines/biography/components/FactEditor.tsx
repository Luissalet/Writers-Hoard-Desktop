import { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import TipTapEditor from '@/components/editor/TiptapEditor';
import TagInput from '@/components/common/TagInput';
import type { BiographyFact, FactSource, BiographyCategory } from '../types';
import { BIOGRAPHY_CATEGORIES, CONFIDENCE_LEVELS } from '../types';
import { useTranslation } from '@/i18n/useTranslation';

interface FactEditorProps {
  fact?: BiographyFact;
  isOpen: boolean;
  onClose: () => void;
  onSave: (fact: Omit<BiographyFact, 'id' | 'createdAt' | 'updatedAt'>) => void;
}

export default function FactEditor({ fact, isOpen, onClose, onSave }: FactEditorProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(fact?.title ?? '');
  const [content, setContent] = useState(fact?.content ?? '');
  const [date, setDate] = useState(fact?.date ?? '');
  const [endDate, setEndDate] = useState(fact?.endDate ?? '');
  const [category, setCategory] = useState<BiographyCategory>(fact?.category ?? 'custom');
  const [confidence, setConfidence] = useState<'confirmed' | 'likely' | 'uncertain' | 'disputed'>(
    fact?.confidence ?? 'likely'
  );
  const [tags, setTags] = useState(fact?.tags ?? []);
  const [sources, setSources] = useState<FactSource[]>(fact?.sources ?? []);
  const [newSourceType, setNewSourceType] = useState<'snapshot' | 'link' | 'manual' | 'interview'>('manual');
  const [newSourceDescription, setNewSourceDescription] = useState('');
  const [newSourceUrl, setNewSourceUrl] = useState('');

  if (!isOpen) return null;

  const handleSave = () => {
    if (!title.trim() || !content.trim()) {
      alert('Please fill in title and content');
      return;
    }

    const bioFact: Omit<BiographyFact, 'id' | 'createdAt' | 'updatedAt'> = {
      biographyId: fact?.biographyId ?? '',
      projectId: fact?.projectId ?? '',
      title: title.trim(),
      content,
      date: date || undefined,
      endDate: endDate || undefined,
      category,
      confidence,
      sources,
      tags,
      order: fact?.order ?? 0,
    };

    onSave(bioFact);
  };

  const handleAddSource = () => {
    if (newSourceDescription.trim()) {
      setSources([...sources, {
        type: newSourceType,
        description: newSourceDescription.trim(),
        url: newSourceUrl || undefined,
      }]);
      setNewSourceDescription('');
      setNewSourceUrl('');
    }
  };

  const handleRemoveSource = (idx: number) => {
    setSources(sources.filter((_, i) => i !== idx));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-deep rounded-xl border border-border w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-deep border-b border-border p-4 flex items-center justify-between">
          <h2 className="text-lg font-serif font-semibold text-text-primary">
            {fact ? 'Edit Fact' : 'New Fact'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary transition"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-2">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('biography.labelPlaceholder')}
              className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-text-primary placeholder-text-dim focus:outline-none focus:border-accent-gold"
            />
          </div>

          {/* Content */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-2">Content *</label>
            <TipTapEditor
              content={content}
              onChange={setContent}
              placeholder={t('biography.detailsPlaceholder')}
            />
          </div>

          {/* Date fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-muted mb-2">Date</label>
              <input
                type="text"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                placeholder={t('biography.datePlaceholder')}
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-text-primary placeholder-text-dim focus:outline-none focus:border-accent-gold text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted mb-2">End Date</label>
              <input
                type="text"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                placeholder={t('biography.dateEndPlaceholder')}
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-text-primary placeholder-text-dim focus:outline-none focus:border-accent-gold text-sm"
              />
            </div>
          </div>

          {/* Category selector */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-2">Category</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(BIOGRAPHY_CATEGORIES).map(([key, { label, color }]) => (
                <button
                  key={key}
                  onClick={() => setCategory(key as BiographyCategory)}
                  className={`py-2 px-3 rounded-lg text-xs font-medium transition ${
                    category === key
                      ? `bg-gradient-to-r ${color} text-white`
                      : 'bg-elevated border border-border text-text-muted hover:border-accent-gold/50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Confidence selector */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-2">Confidence Level</label>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(CONFIDENCE_LEVELS).map(([key, { label }]) => (
                <button
                  key={key}
                  onClick={() => setConfidence(key as any)}
                  className={`py-2 px-3 rounded-lg text-xs font-medium transition ${
                    confidence === key
                      ? `bg-accent-gold/20 border border-accent-gold text-accent-gold`
                      : 'bg-elevated border border-border text-text-muted hover:border-accent-gold/50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-2">Tags</label>
            <TagInput
              tags={tags}
              onChange={setTags}
              placeholder={t('common.addTag')}
            />
          </div>

          {/* Sources */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-2">Sources</label>

            {sources.length > 0 && (
              <div className="space-y-2 mb-3">
                {sources.map((source, idx) => (
                  <div key={idx} className="p-3 bg-surface/50 rounded-lg border border-border/50 flex items-start justify-between gap-2">
                    <div className="flex-grow min-w-0">
                      <p className="text-xs font-semibold text-text-muted mb-1">
                        {source.type === 'snapshot' && '📸 Snapshot'}
                        {source.type === 'link' && '🔗 Link'}
                        {source.type === 'manual' && '✏️ Manual'}
                        {source.type === 'interview' && '🎤 Interview'}
                      </p>
                      <p className="text-sm text-text-primary">{source.description}</p>
                      {source.url && (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-accent-gold hover:text-accent-amber mt-1 block"
                        >
                          {source.url}
                        </a>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveSource(idx)}
                      className="p-1 text-text-muted hover:text-red-400 transition flex-shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="p-3 bg-elevated rounded-lg border border-border space-y-2">
              <div className="grid grid-cols-4 gap-2">
                {['manual', 'link', 'snapshot', 'interview'].map((type) => (
                  <button
                    key={type}
                    onClick={() => setNewSourceType(type as any)}
                    className={`py-1 px-2 rounded text-xs font-medium transition ${
                      newSourceType === type
                        ? 'bg-accent-gold/20 text-accent-gold border border-accent-gold'
                        : 'bg-surface text-text-muted border border-border hover:border-accent-gold/50'
                    }`}
                  >
                    {type === 'manual' && '✏️'}
                    {type === 'link' && '🔗'}
                    {type === 'snapshot' && '📸'}
                    {type === 'interview' && '🎤'}
                  </button>
                ))}
              </div>

              <input
                type="text"
                value={newSourceDescription}
                onChange={(e) => setNewSourceDescription(e.target.value)}
                placeholder={t('biography.sourcePlaceholder')}
                className="w-full px-2 py-1.5 bg-surface border border-border rounded text-sm text-text-primary placeholder-text-dim focus:outline-none focus:border-accent-gold"
              />

              <input
                type="text"
                value={newSourceUrl}
                onChange={(e) => setNewSourceUrl(e.target.value)}
                placeholder={t('biography.urlPlaceholder')}
                className="w-full px-2 py-1.5 bg-surface border border-border rounded text-sm text-text-primary placeholder-text-dim focus:outline-none focus:border-accent-gold"
              />

              <button
                onClick={handleAddSource}
                className="w-full py-1.5 px-2 bg-accent-gold/10 text-accent-gold rounded text-xs font-medium hover:bg-accent-gold/20 transition flex items-center justify-center gap-1"
              >
                <Plus size={12} />
                Add Source
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-deep border-t border-border p-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-accent-gold text-deep rounded-lg text-sm font-semibold hover:bg-accent-amber transition"
          >
            Save Fact
          </button>
        </div>
      </div>
    </div>
  );
}
