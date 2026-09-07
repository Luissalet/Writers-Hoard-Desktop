import { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowLeft, Trash2, Pin, Clock } from 'lucide-react';
import type { DiaryEntry, DiaryMood } from '../types';
import { MOOD_CONFIG } from '../types';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';
import { toast } from '@/components/common/toast';
import { toLocalDateTimeStamp } from '@/engines/writing-stats/date';
import { discardPendingOwner, registerPendingFlusher, trackPendingWrite } from '@/services/pendingWrites';
import { stripHtml } from '@/utils/text';

interface EntryEditorProps {
  entry: DiaryEntry;
  isNew?: boolean;
  onSave: (changes: Partial<DiaryEntry>) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}

function hasDiaryContent(html: string): boolean {
  return Boolean(stripHtml(html).trim()) || /<(?:img|video|audio|iframe|hr|table)\b/i.test(html);
}

export default function EntryEditor({ entry, isNew, onSave, onDelete, onClose }: EntryEditorProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(entry.title);
  const [content, setContent] = useState(entry.content);
  const [entryDate, setEntryDate] = useState(entry.entryDate);
  const [mood, setMood] = useState<DiaryMood | ''>(entry.mood || '');
  const [tagsText, setTagsText] = useState(entry.tags.join(', '));
  const [pinned, setPinned] = useState(entry.pinned);
  const [saving, setSaving] = useState(false);
  const [autosaving, setAutosaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const contentRef = useRef(content);
  const changes = {
    title: title.trim(), content, entryDate, mood: mood || undefined,
    tags: tagsText.split(',').map(tag => tag.trim()).filter(Boolean), pinned,
  };
  const serialized = JSON.stringify(changes);
  const savedRef = useRef(serialized);
  const [savedSerialized, setSavedSerialized] = useState(serialized);
  const latestRef = useRef({ serialized, onSave });
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const discardingRef = useRef(false);
  useEffect(() => { latestRef.current = { serialized, onSave }; }, [onSave, serialized]);

  const flushDraft = useCallback(async (): Promise<boolean> => {
    if (discardingRef.current) return true;
    if (inFlightRef.current) return inFlightRef.current;
    if (latestRef.current.serialized === savedRef.current) return true;
    const run = async (): Promise<boolean> => {
      setAutosaving(true);
      setSaveFailed(false);
      try {
        // Background saving never freezes typing. Drain newer edits before a
        // close/exit flusher reports success, preserving the entry owner.
        while (!discardingRef.current && latestRef.current.serialized !== savedRef.current) {
          const snapshot = latestRef.current;
          await trackPendingWrite(
            Promise.resolve().then(() => snapshot.onSave(JSON.parse(snapshot.serialized) as Partial<DiaryEntry>)),
            flushDraft,
            `diary-draft:${entry.projectId}:${entry.id}`,
          );
          savedRef.current = snapshot.serialized;
          setSavedSerialized(snapshot.serialized);
        }
        return true;
      } catch {
        setSaveFailed(true);
        return false;
      } finally {
        inFlightRef.current = null;
        setAutosaving(false);
      }
    };
    inFlightRef.current = run();
    return inFlightRef.current;
  }, [entry.id, entry.projectId]);

  useEffect(() => {
    if (serialized === savedRef.current) return;
    return registerPendingFlusher(`diary-draft:${entry.projectId}:${entry.id}`, flushDraft);
  }, [entry.id, entry.projectId, flushDraft, serialized, savedSerialized]);

  useEffect(() => {
    if (serialized === savedRef.current || (isNew && !title.trim() && !hasDiaryContent(content))) return;
    const timer = window.setTimeout(() => { void flushDraft(); }, 1500);
    return () => window.clearTimeout(timer);
  }, [serialized, isNew, title, content, flushDraft]);

  useEffect(() => () => { void flushDraft(); }, [flushDraft]);

  // Keep a ref for TipTap's onChange (avoids stale closure issues)
  const handleContentChange = (html: string) => {
    contentRef.current = html;
    setContent(html);
  };

  // Explicit Save waits for the latest snapshot before acting as Done.
  const handleSave = async (): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    try {
      const saved = await flushDraft();
      if (!saved) throw new Error('Diary draft was not saved');
      // Saving an unchanged entry still acts as Done.
      onClose();
      return true;
    } catch {
      toast.error(t('diary.saveError'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const setToNow = () => {
    setEntryDate(toLocalDateTimeStamp());
  };

  // Back must never discard typed work. If anything changed, save (the
  // parent closes after persisting); brand-new & completely empty → just
  // close without creating a junk entry.
  // Uses `content` state (kept in lockstep with contentRef by
  // handleContentChange) — reading a ref during render is invalid.
  const isDirty = serialized !== savedSerialized;

  const handleBack = async () => {
    const empty = !title.trim() && !hasDiaryContent(contentRef.current);
    if (isNew && empty) {
      discardingRef.current = true;
      discardPendingOwner(`diary-draft:${entry.projectId}:${entry.id}`);
      onClose();
      return;
    }
    if (isDirty && !(isNew && empty)) {
      // The parent closes after success. A failed save keeps the only copy of
      // the draft visible and retryable instead of treating Back as discard.
      await handleSave();
      return;
    }
    onClose();
  };

  return (
    <div className="space-y-4" aria-busy={saving} inert={saving}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition"
        >
          <ArrowLeft size={14} />
          {t('common.back')}
        </button>
        <div className="flex items-center gap-2">
          {!isNew && (
            <button
              onClick={() => setPendingDelete(true)}
              className="p-2 rounded-lg text-text-dim hover:text-danger hover:bg-danger/10 transition"
              title={t('diary.deleteEntry')}
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm bg-accent-gold text-deep rounded-lg hover:bg-accent-amber transition font-medium disabled:opacity-50"
          >
            {saving ? t('common.saving') : isNew ? t('common.create') : t('writings.save')}
          </button>
        </div>
      </div>

      {saveFailed ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger"><span>{t('diary.saveError')}</span><button type="button" onClick={() => { void flushDraft(); }} className="underline">{t('diary.retrySave')}</button></div> : <p role="status" className="text-xs text-text-muted">{autosaving ? t('common.saving') : isDirty ? t('diary.autosavePending') : t('diary.autosaveReady')}</p>}

      {/* Date & time + pin */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-text-dim">{t('diary.dateTime')}</label>
          <input
            type="datetime-local"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="px-2.5 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
          />
          <button
            onClick={setToNow}
            className="p-1.5 rounded-lg text-text-dim hover:text-accent-gold hover:bg-accent-gold/10 transition"
            title={t('diary.setToNow')}
          >
            <Clock size={13} />
          </button>
        </div>
        <button
          onClick={() => setPinned(!pinned)}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition ${
            pinned
              ? 'bg-accent-gold/20 text-accent-gold'
              : 'bg-elevated text-text-dim hover:text-accent-gold'
          }`}
        >
          <Pin size={11} />
          {pinned ? t('diary.pinned') : t('diary.pin')}
        </button>
      </div>

      {/* Mood row */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-text-dim mr-1">{t('diary.mood')}</span>
        {Object.entries(MOOD_CONFIG).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setMood(mood === key ? '' : (key as DiaryMood))}
            className={`px-2.5 py-1 rounded-full text-xs transition ${
              mood === key
                ? 'bg-accent-gold/20 ring-1 ring-accent-gold'
                : 'bg-elevated hover:bg-elevated/80'
            }`}
            title={t(cfg.labelKey)}
          >
            {cfg.emoji} {t(cfg.labelKey)}
          </button>
        ))}
      </div>

      {/* Title */}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('diary.titlePlaceholder')}
        className="w-full px-3 py-2 text-lg font-serif bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
      />

      {/* Rich text editor */}
      <TiptapEditor
        content={content}
        onChange={handleContentChange}
        placeholder={t('diary.contentPlaceholder')}
      />

      {/* Tags */}
      <div>
        <label className="text-xs text-text-dim mb-1 block">{t('diary.tagsLabel')}</label>
        <input
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder={t('diary.tagsHint')}
          className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
        />
      </div>

      <ConfirmDialog
        open={pendingDelete}
        destructive
        message={t('diary.deleteConfirm')}
        onConfirm={async () => {
          discardingRef.current = true;
          try {
            if (inFlightRef.current) await inFlightRef.current;
            await onDelete();
            discardPendingOwner(`diary-draft:${entry.projectId}:${entry.id}`);
            setPendingDelete(false);
          } catch (error) {
            discardingRef.current = false;
            throw error;
          }
        }}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  );
}
