// ============================================
// Storyboard Engine — Panel Editor Modal
// ============================================

import { useState } from 'react';
import { Upload } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import Modal from '@/components/common/Modal';
import ImagePreviewCrop from '@/components/common/ImagePreviewCrop';
import type { StoryboardPanel } from '../types';

interface PanelEditorProps {
  panel: StoryboardPanel | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (panel: StoryboardPanel) => void;
}

export default function PanelEditor({ panel, isOpen, onClose, onSave }: PanelEditorProps) {
  const [formData, setFormData] = useState<Partial<StoryboardPanel>>(
    panel || { subtitle: '', description: '', duration: '', tags: [] }
  );
  const [previewImage, setPreviewImage] = useState<string | undefined>(panel?.imageData);
  const [previewOriginal, setPreviewOriginal] = useState<string | undefined>(panel?.imageDataOriginal || panel?.imageData);
  const [pendingImage, setPendingImage] = useState<string | null>(null);

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

  const handleSave = () => {
    if (!panel) return;
    onSave({
      ...panel,
      ...formData,
      subtitle: (formData.subtitle || '').trim(),
      description: (formData.description || '').trim(),
      tags: Array.isArray(formData.tags) ? formData.tags : [],
      updatedAt: Date.now(),
    });
    onClose();
  };

  if (!isOpen || !panel) return null;

  return (
    <>
      <Modal open={isOpen} onClose={onClose} title="Edit Panel">
      <div className="space-y-6 max-w-2xl">
        {/* Image Upload */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-2">Image</label>
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
                  Remove image
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <Upload className="mx-auto text-text-muted" size={24} />
                <p className="text-text-primary font-medium">Drop image or click to select</p>
                <p className="text-text-muted text-xs">Supports JPG, PNG, GIF, WebP</p>
              </div>
            )}
          </div>
        </div>

        {/* Subtitle */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-2">Subtitle</label>
          <input
            type="text"
            value={formData.subtitle || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, subtitle: e.target.value }))}
            placeholder="Brief title for this panel"
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:border-accent-gold focus:outline-none transition"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-2">Description</label>
          <textarea
            value={formData.description || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Detailed notes about this panel"
            rows={4}
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:border-accent-gold focus:outline-none transition resize-none"
          />
        </div>

        {/* Duration (for video storyboards) */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-2">Duration (optional)</label>
          <input
            type="text"
            value={formData.duration || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, duration: e.target.value }))}
            placeholder="e.g., 00:15-00:23"
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:border-accent-gold focus:outline-none transition"
          />
          <p className="text-text-muted text-xs mt-1">Format: HH:MM-HH:MM for video timecodes</p>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-2">Tags</label>
          <input
            type="text"
            value={(Array.isArray(formData.tags) ? formData.tags : []).join(', ')}
            onChange={(e) => {
              const tags = e.target.value
                .split(',')
                .map(t => t.trim())
                .filter(t => t.length > 0);
              setFormData(prev => ({ ...prev, tags }));
            }}
            placeholder="Separate tags with commas"
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary placeholder-text-muted focus:border-accent-gold focus:outline-none transition"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4 border-t border-border">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-surface border border-border text-text-primary rounded-lg hover:bg-elevated transition font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-accent-gold text-deep rounded-lg hover:bg-accent-amber transition font-semibold"
          >
            Save Panel
          </button>
        </div>
      </div>
    </Modal>
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
