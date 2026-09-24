import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import TipTapEditor from '@/components/editor/TiptapEditor';
import TagInput from '@/components/common/TagInput';
import { LinkSelect } from '@/engines/_shared';
import { useSnapshots } from '@/engines/scrapper/hooks';
import type { BiographyFact, FactSource, BiographyCategory } from '../types';
import { BIOGRAPHY_CATEGORIES, CONFIDENCE_LEVELS } from '../types';
import { useTranslation } from '@/i18n/useTranslation';
import { toast } from '@/components/common/toast';
import Modal from '@/components/common/Modal';

interface FactEditorProps {
  fact?: BiographyFact;
  /** Scope for the snapshot picker — the fact itself may not exist yet. */
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (fact: Omit<BiographyFact, 'id' | 'createdAt' | 'updatedAt'>) => void;
}

export default function FactEditor({ fact, projectId, isOpen, onClose, onSave }: FactEditorProps) {
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
  const [newSourceEntityId, setNewSourceEntityId] = useState('');
  // Real captures from the Scrapper, so a 'snapshot' source can finally point
  // at one — `FactSource.entityId` was declared from day one and never filled.
  const { items: snapshots } = useSnapshots(projectId);
  // Differs from what the editor opened with (a new fact opens blank), so
  // Escape or a backdrop click cannot throw the input away. A source typed
  // but not yet added counts too.
  const dirty = title !== (fact?.title ?? '')
    || content !== (fact?.content ?? '')
    || date !== (fact?.date ?? '')
    || endDate !== (fact?.endDate ?? '')
    || category !== (fact?.category ?? 'custom')
    || confidence !== (fact?.confidence ?? 'likely')
    || JSON.stringify(tags) !== JSON.stringify(fact?.tags ?? [])
    || JSON.stringify(sources) !== JSON.stringify(fact?.sources ?? [])
    || newSourceDescription.trim() !== ''
    || newSourceUrl.trim() !== '';

  if (!isOpen) return null;

  const handleSave = () => {
    if (!title.trim() || !content.trim()) {
      toast.error(t('biography.fillTitleContent'));
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
        entityId: (newSourceType === 'snapshot' && newSourceEntityId) || undefined,
      }]);
      setNewSourceDescription('');
      setNewSourceUrl('');
      setNewSourceEntityId('');
    }
  };

  const handleRemoveSource = (idx: number) => {
    setSources(sources.filter((_, i) => i !== idx));
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      dismissible={!dirty}
      title={fact ? t('biography.fact.editTitle') : t('biography.fact.newTitle')}
      wide
    >
        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-2">{t('biography.fact.title')}</label>
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
            <label className="block text-xs font-semibold text-text-muted mb-2">{t('biography.fact.content')}</label>
            <TipTapEditor
              content={content}
              onChange={setContent}
              placeholder={t('biography.detailsPlaceholder')}
            />
          </div>

          {/* Date fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-muted mb-2">{t('biography.fact.date')}</label>
              <input
                type="text"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                placeholder={t('biography.datePlaceholder')}
                className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-text-primary placeholder-text-dim focus:outline-none focus:border-accent-gold text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted mb-2">{t('biography.fact.endDate')}</label>
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
            <label className="block text-xs font-semibold text-text-muted mb-2">{t('biography.fact.category')}</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(BIOGRAPHY_CATEGORIES).map(([key, { labelKey, color }]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCategory(key as BiographyCategory)}
                  aria-pressed={category === key}
                  className={`py-2 px-3 rounded-lg text-xs font-medium transition ${
                    category === key
                      ? `bg-gradient-to-r ${color} text-white`
                      : 'bg-elevated border border-border text-text-muted hover:border-accent-gold/50'
                  }`}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Confidence selector */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-2">{t('biography.fact.confidence')}</label>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(CONFIDENCE_LEVELS).map(([key, { labelKey }]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setConfidence(key as 'confirmed' | 'likely' | 'uncertain' | 'disputed')}
                  aria-pressed={confidence === key}
                  className={`py-2 px-3 rounded-lg text-xs font-medium transition ${
                    confidence === key
                      ? `bg-accent-gold/20 border border-accent-gold text-accent-gold`
                      : 'bg-elevated border border-border text-text-muted hover:border-accent-gold/50'
                  }`}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-2">{t('biography.fact.tags')}</label>
            <TagInput
              tags={tags}
              onChange={setTags}
              placeholder={t('common.addTag')}
            />
          </div>

          {/* Sources */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-2">{t('biography.fact.sources')}</label>

            {sources.length > 0 && (
              <div className="space-y-2 mb-3">
                {sources.map((source, idx) => (
                  <div key={idx} className="p-3 bg-surface/50 rounded-lg border border-border/50 flex items-start justify-between gap-2">
                    <div className="flex-grow min-w-0">
                      <p className="text-xs font-semibold text-text-muted mb-1">
                        {source.type === 'snapshot' && `📸 ${t('biography.source.snapshot')}`}
                        {source.type === 'link' && `🔗 ${t('biography.source.link')}`}
                        {source.type === 'manual' && `✏️ ${t('biography.source.manual')}`}
                        {source.type === 'interview' && `🎤 ${t('biography.source.interview')}`}
                      </p>
                      <p className="text-sm text-text-primary">{source.description}</p>
                      {source.entityId && (() => {
                        const snap = snapshots.find((s) => s.id === source.entityId);
                        return snap ? (
                          <p className="text-xs text-text-dim mt-1 truncate">📸 {snap.title || snap.url}</p>
                        ) : null;
                      })()}
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
                      type="button"
                      onClick={() => handleRemoveSource(idx)}
                      className="p-1 text-text-muted hover:text-red-400 transition flex-shrink-0"
                      title={t('common.remove')}
                      aria-label={t('common.remove')}
                    >
                      <Trash2 size={14} aria-hidden="true" />
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
                    type="button"
                    onClick={() => setNewSourceType(type as 'snapshot' | 'link' | 'manual' | 'interview')}
                    aria-pressed={newSourceType === type}
                    aria-label={t(`biography.source.${type}`)}
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

              {newSourceType === 'snapshot' && (
                <LinkSelect
                  label={t('biography.source.snapshot')}
                  value={newSourceEntityId}
                  onChange={setNewSourceEntityId}
                  options={snapshots.map((s) => ({ id: s.id, label: s.title || s.url }))}
                />
              )}

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
                type="button"
                onClick={handleAddSource}
                className="w-full py-1.5 px-2 bg-accent-gold/10 text-accent-gold rounded text-xs font-medium hover:bg-accent-gold/20 transition flex items-center justify-center gap-1"
              >
                <Plus size={12} />
                {t('biography.fact.addSource')}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-deep border-t border-border p-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-muted hover:text-text-primary transition"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 bg-accent-gold text-deep rounded-lg text-sm font-semibold hover:bg-accent-amber transition"
          >
            {t('biography.fact.save')}
          </button>
        </div>
    </Modal>
  );
}
