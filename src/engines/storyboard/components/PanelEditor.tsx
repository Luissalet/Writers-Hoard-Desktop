// ============================================
// Storyboard Engine — Panel Editor Modal
// ============================================

import { useState, useRef } from 'react';
import { Images, Upload } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import Modal from '@/components/common/Modal';
import ImagePreviewCrop from '@/components/common/ImagePreviewCrop';
import type { StoryboardPanel } from '../types';
import { useTranslation } from '@/i18n/useTranslation';
import GalleryAssetPicker from '@/components/gallery/GalleryAssetPicker';
import type { Scene } from '@/engines/dialog-scene/types';

interface PanelEditorProps {
  panel: StoryboardPanel | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (panel: StoryboardPanel) => void | Promise<void>;
  /** Scenes available for linking (`linkedSceneId` had no UI at all). */
  scenes?: Scene[];
}

export default function PanelEditor({ panel, isOpen, onClose, onSave, scenes = [] }: PanelEditorProps) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<Partial<StoryboardPanel>>(
    panel || { subtitle: '', description: '', duration: '', tags: [] }
  );
  const [previewImage, setPreviewImage] = useState<string | undefined>(panel?.imageData);
  const [previewOriginal, setPreviewOriginal] = useState<string | undefined>(panel?.imageDataOriginal || panel?.imageData);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [showGallery, setShowGallery] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setPendingImage(result);
      };
      reader.readAsDataURL(file);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.webp'] },
    noClick: false,
  });

  const handleSave = async () => {
    if (!panel || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
    await onSave({
      ...panel,
      ...formData,
      subtitle: (formData.subtitle || '').trim(),
      description: (formData.description || '').trim(),
      tags: Array.isArray(formData.tags) ? formData.tags : [],
      updatedAt: Date.now(),
    });
    onClose();
    } catch {
      setSaveFailed(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (!isOpen || !panel) return null;

  // Anything changed since the editor opened keeps Escape and the backdrop
  // from discarding it; Cancel and the X still close.
  const dirty = (formData.subtitle || '') !== (panel.subtitle || '')
    || (formData.description || '') !== (panel.description || '')
    || (formData.duration || '') !== (panel.duration || '')
    || (formData.linkedSceneId || '') !== (panel.linkedSceneId || '')
    || formData.imageData !== panel.imageData
    || formData.imageDataOriginal !== panel.imageDataOriginal
    || formData.imageRef !== panel.imageRef
    || (formData.tags ?? []).join(',') !== (panel.tags ?? []).join(',');

  return (
    <>
      <Modal open={isOpen} busy={saving} dismissible={!dirty} onClose={() => { if (!saving) onClose(); }} title={t('storyboard.editPanel')}>
      <fieldset disabled={saving} className="space-y-6 max-w-2xl">
        {/* Image Upload */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-2">{t('storyboard.form.image')}</label>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition ${
              isDragActive
                ? 'border-accent-gold bg-accent-gold/10'
                : 'border-border hover:border-accent-gold'
            }`}
          >
            <input {...getInputProps()} />
            {previewImage ? (
              <div className="space-y-2">
                <img
                  src={previewImage}
                  alt="Preview"
                  className="max-h-48 mx-auto rounded cursor-pointer hover:opacity-90 transition"
                  onClick={(e) => { e.stopPropagation(); setPendingImage(previewOriginal || previewImage!); }}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setPreviewImage(undefined);
                    setPreviewOriginal(undefined);
                    setFormData(prev => ({ ...prev, imageData: undefined, imageDataOriginal: undefined }));
                  }}
                  className="text-sm text-accent-gold hover:text-accent-amber"
                >
                  {t('storyboard.form.removeImage')}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="mx-auto text-text-muted" size={24} />
                <p className="text-text-primary font-medium">{t('storyboard.form.dropImage')}</p>
                <p className="text-text-muted text-xs">{t('storyboard.form.imageFormats')}</p>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowGallery(true)}
            className="mt-2 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-muted transition hover:border-accent-gold hover:text-text-primary"
          >
            <Images size={15} />
            {t('common.chooseFromGallery')}
          </button>
        </div>

        {/* Subtitle */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-2">{t('storyboard.form.subtitle')}</label>
          <input
            type="text"
            value={formData.subtitle || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, subtitle: e.target.value }))}
            placeholder={t('storyboard.form.subtitlePlaceholder')}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:border-accent-gold focus:outline-none transition"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-2">{t('storyboard.form.description')}</label>
          <textarea
            value={formData.description || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            placeholder={t('storyboard.form.descriptionPlaceholder')}
            rows={4}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:border-accent-gold focus:outline-none transition resize-none"
          />
        </div>

        {/* Duration (for video storyboards) */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-2">{t('storyboard.form.duration')}</label>
          <input
            type="text"
            value={formData.duration || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, duration: e.target.value }))}
            placeholder={t('storyboard.form.durationPlaceholder')}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:border-accent-gold focus:outline-none transition"
          />
          <p className="text-text-muted text-xs mt-1">{t('storyboard.form.durationHint')}</p>
        </div>

        {/* Linked scene — the bridge between the storyboard and the script.
            `StoryboardPanel.linkedSceneId` was declared in types.ts and never
            read or written by anything. */}
        <div className="mb-4">
          <label className="block text-sm font-semibold text-text-primary mb-2">
            {t('storyboard.form.linkedScene')}
          </label>
          <select
            value={formData.linkedSceneId ?? ''}
            onChange={(e) => setFormData({ ...formData, linkedSceneId: e.target.value || undefined })}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary focus:border-accent-gold focus:outline-none transition text-sm"
          >
            <option value="">{t('storyboard.form.noLinkedScene')}</option>
            {scenes.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.sceneNumber ? `#${sc.sceneNumber} ` : ''}{sc.title}
              </option>
            ))}
          </select>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-2">{t('storyboard.form.tags')}</label>
          <input
            type="text"
            value={(Array.isArray(formData.tags) ? formData.tags : []).join(', ')}
            onChange={(e) => {
              const tags = e.target.value
                .split(',')
                .map(tag => tag.trim())
                .filter(tag => tag.length > 0);
              setFormData(prev => ({ ...prev, tags }));
            }}
            placeholder={t('storyboard.form.tagsPlaceholder')}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:border-accent-gold focus:outline-none transition"
          />
        </div>

        {saveFailed && <p role="alert" className="text-sm text-danger">{t('common.saveFailed')}</p>}
        {/* Action Buttons */}
        <div className="flex gap-3 pt-4 border-t border-border">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-surface border border-border text-text-primary rounded-lg hover:bg-elevated transition font-semibold"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-accent-gold text-deep rounded-lg hover:bg-accent-amber transition font-semibold disabled:opacity-50"
          >
            {t(saving ? 'common.saving' : 'storyboard.form.savePanel')}
          </button>
        </div>
      </fieldset>
    </Modal>
      <GalleryAssetPicker
        projectId={panel.projectId}
        open={showGallery}
        onClose={() => setShowGallery(false)}
        onSelect={selection => {
          setPreviewImage(selection.imageData);
          setPreviewOriginal(selection.imageDataOriginal);
          setFormData(prev => ({
            ...prev,
            imageData: selection.imageData,
            imageDataOriginal: selection.imageDataOriginal,
            imageRef: selection.id,
          }));
        }}
      />
      <ImagePreviewCrop
        imageSrc={pendingImage}
        onConfirm={(cropped, original) => {
          setPreviewImage(cropped);
          setPreviewOriginal(original);
          setFormData(prev => ({ ...prev, imageData: cropped, imageDataOriginal: original }));
          setPendingImage(null);
        }}
        onCancel={() => setPendingImage(null)}
      />
    </>
  );
}
