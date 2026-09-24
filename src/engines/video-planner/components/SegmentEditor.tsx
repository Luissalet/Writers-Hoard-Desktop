import { useState, useRef } from 'react';
import { Images, Upload } from 'lucide-react';
import type { VideoSegment, VisualType } from '../types';
import ImagePreviewCrop from '@/components/common/ImagePreviewCrop';
import { useTranslation } from '@/i18n/useTranslation';
import GalleryAssetPicker from '@/components/gallery/GalleryAssetPicker';
import Modal from '@/components/common/Modal';

interface SegmentEditorProps {
  segment: VideoSegment;
  onSave: (segment: Partial<VideoSegment>) => void | Promise<void>;
  onCancel: () => void;
}

const VISUAL_TYPES: Array<{ value: VisualType; icon: string }> = [
  { value: 'camera', icon: '📷' },
  { value: 'broll', icon: '🎬' },
  { value: 'screen-capture', icon: '🖥️' },
  { value: 'graphic', icon: '✨' },
  { value: 'text-overlay', icon: '📝' },
  { value: 'custom', icon: '🎨' },
];

export default function SegmentEditor({ segment, onSave, onCancel }: SegmentEditorProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(segment.title);
  const [startTime, setStartTime] = useState(segment.startTime || '');
  const [endTime, setEndTime] = useState(segment.endTime || '');
  const [script, setScript] = useState(segment.script);
  const [speakerName, setSpeakerName] = useState(segment.speakerName || '');
  const [visualType, setVisualType] = useState<VisualType>(segment.visualType);
  const [visualDescription, setVisualDescription] = useState(segment.visualDescription || '');
  const [visualImageData, setVisualImageData] = useState(segment.visualImageData || '');
  const [visualImageDataOriginal, setVisualImageDataOriginal] = useState(segment.visualImageDataOriginal || segment.visualImageData || '');
  const [audioNotes, setAudioNotes] = useState(segment.audioNotes || '');
  const [notes, setNotes] = useState(segment.notes || '');
  const [tags, setTags] = useState(segment.tags.join(', '));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [showGallery, setShowGallery] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // Anything changed since the editor opened keeps Escape and the backdrop
  // from discarding it; Cancel and the X still close.
  const dirty = title !== segment.title
    || startTime !== (segment.startTime || '')
    || endTime !== (segment.endTime || '')
    || script !== segment.script
    || speakerName !== (segment.speakerName || '')
    || visualType !== segment.visualType
    || visualDescription !== (segment.visualDescription || '')
    || visualImageData !== (segment.visualImageData || '')
    || audioNotes !== (segment.audioNotes || '')
    || notes !== (segment.notes || '')
    || tags !== segment.tags.join(', ');

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setPendingImage(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
    await onSave({
      title,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      script,
      speakerName: speakerName || undefined,
      visualType,
      visualDescription: visualDescription || undefined,
      visualImageData: visualImageData || undefined,
      visualImageDataOriginal: visualImageDataOriginal || visualImageData || undefined,
      audioNotes: audioNotes || undefined,
      notes: notes || undefined,
      tags: tags
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean),
    });
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal open onClose={() => { if (!saving) onCancel(); }} dismissible={!dirty} title={t('videoPlanner.segment.editTitle')} wide>
        {/* Content */}
        <fieldset disabled={saving} className="p-6 space-y-6">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-accent-gold mb-2">{t('videoPlanner.segment.title')}</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-deep border border-border rounded px-3 py-2 text-neutral-50 focus:border-accent-gold focus:outline-none"
              placeholder={t('videoPlanner.segment.titlePlaceholder')}
            />
          </div>

          {/* Timing */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-accent-gold mb-2">{t('videoPlanner.segment.startTime')}</label>
              <input
                type="text"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-deep border border-border rounded px-3 py-2 text-neutral-50 focus:border-accent-gold focus:outline-none"
                placeholder="00:00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-accent-gold mb-2">{t('videoPlanner.segment.endTime')}</label>
              <input
                type="text"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-deep border border-border rounded px-3 py-2 text-neutral-50 focus:border-accent-gold focus:outline-none"
                placeholder="00:30"
              />
            </div>
          </div>

          {/* Script (large textarea) */}
          <div>
            <label className="block text-sm font-medium text-accent-gold mb-2">{t('videoPlanner.segment.script')}</label>
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              className="w-full bg-deep border border-border rounded px-3 py-2 text-neutral-50 focus:border-accent-gold focus:outline-none font-serif min-h-32 resize-none"
              placeholder={t('videoPlanner.segment.scriptPlaceholder')}
            />
          </div>

          {/* Speaker */}
          <div>
            <label className="block text-sm font-medium text-accent-gold mb-2">{t('videoPlanner.segment.speakerName')}</label>
            <input
              type="text"
              value={speakerName}
              onChange={(e) => setSpeakerName(e.target.value)}
              className="w-full bg-deep border border-border rounded px-3 py-2 text-neutral-50 focus:border-accent-gold focus:outline-none"
              placeholder={t('videoPlanner.segment.speakerPlaceholder')}
            />
          </div>

          {/* Visual Type */}
          <div>
            <label className="block text-sm font-medium text-accent-gold mb-3">{t('videoPlanner.segment.visualType')}</label>
            <div className="grid grid-cols-3 gap-2">
              {VISUAL_TYPES.map((vt) => (
                <button
                  key={vt.value}
                  type="button"
                  onClick={() => setVisualType(vt.value)}
                  aria-pressed={visualType === vt.value}
                  className={`p-3 rounded border transition-[border-color,background-color] ${
                    visualType === vt.value
                      ? 'border-accent-gold bg-accent-gold/10'
                      : 'border-border hover:border-accent-gold/50'
                  }`}
                >
                  <span className="text-2xl block mb-1">{vt.icon}</span>
                  <span className="text-xs text-neutral-300">{t(`videoPlanner.segment.visual.${vt.value}`)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Visual Description */}
          <div>
            <label className="block text-sm font-medium text-accent-gold mb-2">{t('videoPlanner.segment.visualDescription')}</label>
            <textarea
              value={visualDescription}
              onChange={(e) => setVisualDescription(e.target.value)}
              className="w-full bg-deep border border-border rounded px-3 py-2 text-neutral-50 focus:border-accent-gold focus:outline-none min-h-20 resize-none"
              placeholder={t('videoPlanner.segment.visualDescriptionPlaceholder')}
            />
          </div>

          {/* Image Upload */}
          <div>
            <label className="block text-sm font-medium text-accent-gold mb-2">{t('videoPlanner.segment.visualImage')}</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => visualImageData ? setPendingImage(visualImageDataOriginal || visualImageData) : fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-border rounded-lg p-4 text-center hover:border-accent-gold/50 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold/60"
            >
              {visualImageData ? (
                <div>
                  <img
                    src={visualImageData}
                    alt={title || t('videoPlanner.segment.visualImage')}
                    className="w-full max-h-40 object-contain rounded mb-2"
                  />
                  <p className="text-xs text-neutral-400">{t('videoPlanner.segment.clickToPreview')}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-5 h-5 text-accent-gold/50" />
                  <p className="text-sm text-neutral-300">{t('videoPlanner.segment.dropImage')}</p>
                </div>
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowGallery(true)}
              className="mt-2 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-neutral-300 transition hover:border-accent-gold"
            >
              <Images size={15} />
              {t('common.chooseFromGallery')}
            </button>
          </div>

          {/* Audio Notes */}
          <div>
            <label className="block text-sm font-medium text-accent-gold mb-2">{t('videoPlanner.segment.audioNotes')}</label>
            <textarea
              value={audioNotes}
              onChange={(e) => setAudioNotes(e.target.value)}
              className="w-full bg-deep border border-border rounded px-3 py-2 text-neutral-50 focus:border-accent-gold focus:outline-none min-h-16 resize-none"
              placeholder={t('videoPlanner.segment.audioNotesPlaceholder')}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-accent-gold mb-2">{t('videoPlanner.segment.productionNotes')}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-deep border border-border rounded px-3 py-2 text-neutral-50 focus:border-accent-gold focus:outline-none min-h-16 resize-none"
              placeholder={t('videoPlanner.segment.productionNotesPlaceholder')}
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-accent-gold mb-2">{t('videoPlanner.segment.tags')}</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full bg-deep border border-border rounded px-3 py-2 text-neutral-50 focus:border-accent-gold focus:outline-none"
              placeholder={t('videoPlanner.segment.tagsPlaceholder')}
            />
          </div>
        </fieldset>

        {/* Footer */}
        {saveFailed && <p role="alert" className="px-4 pb-3 text-sm text-danger">{t('common.saveFailed')}</p>}
        <div className="sticky bottom-0 flex justify-end gap-3 bg-elevated border-t border-border p-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 rounded border border-border hover:bg-surface transition-colors text-neutral-300"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded bg-accent-gold text-deep font-medium hover:bg-accent-gold/90 transition-colors disabled:opacity-50"
          >
            {t(saving ? 'common.saving' : 'videoPlanner.segment.saveChanges')}
          </button>
        </div>
      </Modal>
      <GalleryAssetPicker
        projectId={segment.projectId}
        open={showGallery}
        onClose={() => setShowGallery(false)}
        onSelect={selection => {
          setVisualImageData(selection.imageData);
          setVisualImageDataOriginal(selection.imageDataOriginal);
        }}
      />
      <ImagePreviewCrop
        imageSrc={pendingImage}
        onConfirm={(cropped, original) => {
          setVisualImageData(cropped);
          setVisualImageDataOriginal(original);
          setPendingImage(null);
        }}
        onCancel={() => setPendingImage(null)}
      />
    </>
  );
}
