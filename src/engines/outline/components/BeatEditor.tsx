import { useMemo, useState } from 'react';
import { Link2, Unlink } from 'lucide-react';
import type { OutlineBeat, BeatStatus } from '../types';
import type { Scene } from '@/engines/dialog-scene/types';
import type { Writing } from '@/types';
import { useTranslation } from '@/i18n/useTranslation';
import Modal from '@/components/common/Modal';

interface BeatEditorProps {
  beat: OutlineBeat;
  onSave: (changes: Partial<OutlineBeat>) => void;
  onClose: () => void;
  /** Available scenes for linking */
  scenes?: Scene[];
  /** Every beat in this outline — needed to offer a parent. */
  siblings?: OutlineBeat[];
  /** Available writings for linking */
  writings?: Writing[];
}

const PRESET_COLORS = [
  '#c4973b', '#e8b661', '#f59e0b', '#f97316', '#ef4444',
  '#7c5cbf', '#8b5cf6', '#3b82f6', '#10b981', '#6b7280',
  '#4a9e6d', '#06b6d4', '#ec4899', '#a855f7',
];

export default function BeatEditor({
  beat,
  onSave,
  onClose,
  scenes = [],
  siblings = [],
  writings = [],
}: BeatEditorProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(beat.title);
  const [description, setDescription] = useState(beat.description);
  const [level, setLevel] = useState<'act' | 'chapter' | 'scene' | 'beat'>(beat.level);
  const [status, setStatus] = useState<BeatStatus>(beat.status);
  const [storyPosition, setStoryPosition] = useState(beat.storyPosition || 0);
  const [color, setColor] = useState(beat.color || '#c4973b');
  const [wordTarget, setWordTarget] = useState(beat.wordTarget || 0);
  const [linkedSceneId, setLinkedSceneId] = useState(beat.linkedSceneId || '');
  const [linkedWritingId, setLinkedWritingId] = useState(beat.linkedWritingId || '');
  const [parentId, setParentId] = useState(beat.parentId || '');
  // Anything changed since the editor opened keeps Escape and the backdrop
  // from discarding it; Cancel and the X still close.
  const dirty = title !== beat.title
    || description !== beat.description
    || level !== beat.level
    || status !== beat.status
    || storyPosition !== (beat.storyPosition || 0)
    || color !== (beat.color || '#c4973b')
    || wordTarget !== (beat.wordTarget || 0)
    || linkedSceneId !== (beat.linkedSceneId || '')
    || linkedWritingId !== (beat.linkedWritingId || '')
    || parentId !== (beat.parentId || '');

  // Candidate parents: every other beat except this one and everything nested
  // underneath it — otherwise the tree could be pointed at itself and
  // `BeatList` would recurse forever.
  const parentOptions = useMemo(() => {
    const descendants = new Set<string>([beat.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const candidate of siblings) {
        if (candidate.parentId && descendants.has(candidate.parentId) && !descendants.has(candidate.id)) {
          descendants.add(candidate.id);
          grew = true;
        }
      }
    }
    return siblings
      .filter((b) => !descendants.has(b.id))
      .sort((a, b) => a.order - b.order);
  }, [siblings, beat.id]);

  const handleSave = () => {
    onSave({
      title,
      description,
      level,
      status,
      storyPosition,
      color,
      wordTarget: wordTarget || undefined,
      linkedSceneId: linkedSceneId || undefined,
      linkedWritingId: linkedWritingId || undefined,
      parentId: parentId || undefined,
      updatedAt: Date.now(),
    });
    onClose();
  };

  return (
    <Modal open onClose={onClose} dismissible={!dirty} title={t('outline.beat.editTitle')} wide>
      <div>
        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              {t('common.title')}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50"
              placeholder={t('outline.beatTitlePlaceholder')}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              {t('common.description')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50 resize-none"
              placeholder={t('outline.beatDescriptionPlaceholder')}
            />
          </div>

          {/* Level and Status Row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                {t('outline.beat.level')}
              </label>
              <select
                value={level}
                onChange={(e) => setLevel(e.target.value as 'act' | 'chapter' | 'scene' | 'beat')}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50"
              >
                <option value="act">{t('outline.level.act')}</option>
                <option value="chapter">{t('outline.level.chapter')}</option>
                <option value="scene">{t('outline.level.scene')}</option>
                <option value="beat">{t('outline.level.beat')}</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                {t('outline.beat.status')}
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as BeatStatus)}
                className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50"
              >
                <option value="empty">{t('outline.status.empty')}</option>
                <option value="outlined">{t('outline.status.outlined')}</option>
                <option value="drafted">{t('outline.status.drafted')}</option>
                <option value="done">{t('outline.status.done')}</option>
              </select>
            </div>
          </div>

          {/* Story Position */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              {t('outline.beat.storyPosition').replace('{pct}', String(storyPosition))}
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={storyPosition}
              onChange={(e) => setStoryPosition(Number(e.target.value))}
              className="w-full h-2 bg-surface border border-border rounded-lg appearance-none cursor-pointer accent-accent-gold"
            />
          </div>

          {/* Word Target */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              {t('outline.beat.wordTarget')}
            </label>
            <input
              type="number"
              value={wordTarget}
              onChange={(e) => setWordTarget(Number(e.target.value) || 0)}
              min="0"
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50"
              placeholder={t('outline.beatTargetPlaceholder')}
            />
          </div>

          {/* Color Picker */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              {t('outline.beat.color')}
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-pressed={color === c}
                  className="w-8 h-8 rounded-full border-2 transition-[border-color,box-shadow,transform]"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? '#c4973b' : 'transparent',
                    borderWidth: color === c ? '3px' : '0px',
                  }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Parent beat — this is what makes the act → chapter → scene tree
              in BeatList reachable at all; `parentId` had no UI, so every
              beat was permanently top-level and the whole nesting layer was
              dead code. */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              {t('outline.beat.parent')}
            </label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50 text-sm"
            >
              <option value="">{t('outline.beat.noParent')}</option>
              {parentOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </div>

          {/* Link to a writing */}
          {writings.length > 0 && (
            <div>
              <label className="text-sm font-medium text-text-primary mb-1 flex items-center gap-1.5">
                <Link2 size={14} className="text-accent-gold" />
                {t('outline.beat.linkedWriting')}
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={linkedWritingId}
                  onChange={(e) => setLinkedWritingId(e.target.value)}
                  className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50 text-sm"
                >
                  <option value="">{t('outline.beat.noLinkedWriting')}</option>
                  {writings.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.chapter ? `${w.chapter}. ` : ''}{w.title}
                    </option>
                  ))}
                </select>
                {linkedWritingId && (
                  <button
                    type="button"
                    onClick={() => setLinkedWritingId('')}
                    className="p-2 text-text-dim hover:text-danger rounded transition"
                    title={t('outline.beat.unlinkWriting')}
                  >
                    <Unlink size={14} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Link to Scene */}
          {scenes.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1 flex items-center gap-1.5">
                <Link2 size={14} className="text-accent-gold" />
                {t('outline.beat.linkedScene')}
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={linkedSceneId}
                  onChange={(e) => setLinkedSceneId(e.target.value)}
                  className="flex-1 px-3 py-2 bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-gold/50 text-sm"
                >
                  <option value="">{t('outline.beat.noLinkedScene')}</option>
                  {scenes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.sceneNumber ? `#${s.sceneNumber} ` : ''}{s.title}
                      {s.isOmitted ? ` (${t('outline.beat.omitted')})` : ''}
                    </option>
                  ))}
                </select>
                {linkedSceneId && (
                  <button
                    type="button"
                    onClick={() => setLinkedSceneId('')}
                    className="p-2 text-text-dim hover:text-danger rounded transition"
                    title={t('outline.unlinkScene')}
                  >
                    <Unlink size={14} />
                  </button>
                )}
              </div>
              <p className="text-xs text-text-dim mt-1">
                {t('outline.beat.linkedSceneHint')}
              </p>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2 justify-end pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border bg-surface text-text-primary hover:bg-surface/80 transition"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-accent-gold/10 text-accent-gold hover:bg-accent-gold/20 transition font-medium"
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
