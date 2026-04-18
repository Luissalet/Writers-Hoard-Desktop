import { useState, useRef } from 'react';
import { X, Upload } from 'lucide-react';
import type { VideoSegment, VisualType } from '../types';
import ImagePreviewCrop from '@/components/common/ImagePreviewCrop';
import { useTranslation } from '@/i18n/useTranslation';

interface SegmentEditorProps {
  segment: VideoSegment;
  onSave: (segment: Partial<VideoSegment>) => void;
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

  const handleSave = () => {
    onSave({
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
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-surface border border-border rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between bg-elevated border-b border-border p-4">
          <h2 className="font-serif text-xl text-neutral-50">{t('videoPlanner.segment.editTitle')}</h2>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-surface rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
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
                  onClick={() => setVisualType(vt.value)}
                  className={`p-3 rounded border transition-all ${
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
            <div
              onClick={() => visualImageData ? setPendingImage(visualImageDataOriginal || visualImageData) : fileInputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-lg p-4 text-center hover:border-accent-gold/50 cursor-pointer transition-colors"
            >
              {visualImageData ? (
                <div>
                  <img
                    src={visualImageData}
                    alt="Visual"
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
            </div>
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
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex justify-end gap-3 bg-elevated border-t border-border p-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded border border-border hover:bg-surface transition-colors text-neutral-300"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded bg-accent-gold text-deep font-medium hover:bg-accent-gold/90 transition-colors"
          >
            {t('videoPlanner.segment.saveChanges')}
          </button>
        </div>
      </div>
      <ImagePreviewCrop
        imageSrc={pendingImage}
        onConfirm={(cropped, original) => {
          setVisualImageData(cropped);
          setVisualImageDataOriginal(original);
          setPendingImage(null);
        }}
        onCancel={() => setPendingImage(null)}
      />
    </div>
  );
}
