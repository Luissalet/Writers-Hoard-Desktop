// ============================================
// Scrapper Engine — Manual Snapshot Modal
// ============================================

import { useState, useRef } from 'react';
import { X, Image as ImageIcon } from 'lucide-react';
import type { Snapshot } from '../types';
import TagInput from '@/components/common/TagInput';
import { useTranslation } from '@/i18n/useTranslation';

interface ManualSnapshotModalProps {
  projectId: string;
  onSave: (snapshot: Snapshot) => void;
  onCancel: () => void;
}

export default function ManualSnapshotModal({
  projectId,
  onSave,
  onCancel,
}: ManualSnapshotModalProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [screenshot, setScreenshot] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setScreenshot(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      alert(t('scrapper.enterTitle'));
      return;
    }

    setIsSaving(true);
    try {
      const snapshot: Snapshot = {
        id: crypto.randomUUID(),
        projectId,
        url: '',
        title: title.trim(),
        source: 'manual',
        status: 'success',
        notes: notes.trim(),
        tags,
        thumbnail: screenshot,
        preservedAt: Date.now(),
        createdAt: Date.now(),
      };

      onSave(snapshot);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && title.trim() && !isSaving) {
      handleSave();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-elevated rounded-lg max-w-xl w-full border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-serif font-bold text-foreground">{t('scrapper.addResearchNote')}</h2>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-elevated rounded-lg transition-colors"
          >
            <X size={20} className="text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Title */}
          <div className="space-y-2">
            <label className="font-serif font-semibold text-foreground block">{t('common.title')}</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('scrapper.titlePlaceholder')}
              className="w-full px-4 py-2 bg-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-gold"
              autoFocus
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="font-serif font-semibold text-foreground block">{t('common.notes')}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('scrapper.notesPlaceholder')}
              className="w-full px-4 py-2 bg-elevated border border-border rounded-lg text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent-gold resize-none h-32"
            />
          </div>

          {/* Image Upload */}
          <div className="space-y-2">
            <label className="font-serif font-semibold text-foreground block">
              {t('scrapper.attachmentOptional')}
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:bg-surface transition-colors"
            >
              {screenshot ? (
                <div className="space-y-2">
                  <img
                    src={screenshot}
                    alt="Preview"
                    className="w-full max-h-40 object-contain rounded"
                  />
                  <button
                    type="button"
                    className="text-xs text-accent-gold hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setScreenshot(undefined);
                    }}
                  >
                    {t('common.remove')}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <ImageIcon size={24} className="mx-auto text-muted" />
                  <p className="text-sm text-muted">{t('scrapper.uploadHint')}</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <label className="font-serif font-semibold text-foreground block">{t('common.tags')}</label>
            <TagInput tags={tags} onChange={setTags} />
          </div>
        </div>

        {/* Footer */}
        <div className="bg-surface border-t border-border px-6 py-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-foreground hover:bg-elevated rounded-lg transition-colors font-medium"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!title.trim() || isSaving}
            className="px-4 py-2 bg-accent-gold hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed text-black rounded-lg transition-colors font-medium"
          >
            {isSaving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
