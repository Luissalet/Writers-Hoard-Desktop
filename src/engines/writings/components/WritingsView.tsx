import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Lightbulb,
  PenLine,
  CheckCircle2,
  FileText,
  ArrowLeft,
  Hash,
  Cloud,
  ExternalLink,
  ArrowRightLeft,
  Copy,
  X,
  Maximize2,
  Minimize2,
  Check,
  BookDown,
  BookUp,
  History,
  LoaderCircle,
  CircleAlert,
  Undo2,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ListTree,
  ListOrdered,
  FileDown,
  FileType2,
  BookOpen,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Writing, WritingStatus } from '@/types';
import type { PublishingProfile } from '@/types/projectTools';
import { generateId } from '@/utils/idGenerator';
import { countWords } from '@/utils/text';
import TiptapEditor from '@/components/editor/TiptapEditor';
import TagInput from '@/components/common/TagInput';
import Modal from '@/components/common/Modal';
import EmptyState from '@/components/common/EmptyState';
import GoogleDocsPicker from './GoogleDocsPicker';
import GoogleDocBadge from './GoogleDocBadge';
import SyncButton from './SyncButton';
import SprintControl from './SprintControl';
import AiToolbar from './AiToolbar';
import CompileModal from './CompileModal';
import ManuscriptImportModal from './ManuscriptImportModal';
import HistoryModal from './HistoryModal';
import ReadingView from './ReadingView';
import RecentlyChanged from './RecentlyChanged';
import PublishingProfileModal from '@/components/project/PublishingProfileModal';
import { takeSnapshot } from '../snapshots';
import { generateImageFromSelection } from '../generateImageFromSelection';
import { db } from '@/db';
import { touchProject } from '@/db/operations';
import type { OutlineBeat } from '@/engines/outline/types';
import { useProject } from '@/hooks/useProjects';
import { useGoogleStore } from '@/stores/googleStore';
import { fetchGoogleDocForAi } from '@/services/googleDocs';
import { recordEditorActivity } from '@/services/writingActivity';
import { rememberProjectRoute } from '@/services/projectIntelligence';
import {
  closeAppWindow,
  keepAppWindow,
  registerCloseGuard,
  reportUnsavedWork,
} from '@/services/closeGuard';
import { isDesktop } from '@/utils/platform';
import { t as translateNow, useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog, onDataChanged, useDebouncedField, useDeepLinkParam } from '@/engines/_shared';
import AnnotationSurface from '@/engines/annotations/components/AnnotationSurface';
import type { AnnotationAnchor } from '@/engines/annotations/types';
import GettingStartedChecklist from '@/components/project/GettingStartedChecklist';
import {
  clearWritingRecoveryDraft,
  inspectWritingRecoveryDraft,
  writeWritingRecoveryDraft,
  type WritingRecoveryDraft,
} from '../recoveryJournal';
import {
  expectDeletedWriting,
  getWritingVersion,
  restoreDeletedWriting,
  takeLastDeletedWriting,
  updateWritingAtVersion,
  WritingConflictError,
  type DeletedWritingBundle,
} from '../operations';
import {
  compareManuscriptOrder,
  moveChapter,
  numberedInOrder,
  renumberChapters,
  type ChapterAssignment,
  type ChapterDirection,
} from '../chapterOrder';
import {
  exportChapter,
  selectChapterExport,
  type ChapterExportOutput,
} from '../chapterExport';
import { applyChapterNumbers } from '../chapterOrderPersist';
import { toast } from '@/components/common/toast';

const STATUS_CONFIG: Record<WritingStatus, { icon: typeof Lightbulb; color: string; bg: string }> = {
  idea: { icon: Lightbulb, color: '#d4a843', bg: 'rgba(212, 168, 67, 0.12)' },
  draft: { icon: PenLine, color: '#4a7ec4', bg: 'rgba(74, 126, 196, 0.12)' },
  finished: { icon: CheckCircle2, color: '#4a9e6d', bg: 'rgba(74, 158, 109, 0.12)' },
};

/**
 * The list filter. `all` is not a status: it is the manuscript — every writing
 * of the project in reading order. Without it, moving chapter 3 to *finished*
 * took it out of the only list that also held 2 and 4.
 */
type StatusFilter = WritingStatus | 'all';

/** Accent-gold (`--color-accent-gold`), so the manuscript tab reads as the whole. */
const ALL_TAB_CONFIG = { icon: FileText, color: '#c4973b', bg: 'rgba(196, 151, 59, 0.12)' };

const LIST_TABS: Array<[StatusFilter, { icon: typeof Lightbulb; color: string; bg: string }]> = [
  ['all', ALL_TAB_CONFIG],
  ...(Object.entries(STATUS_CONFIG) as [WritingStatus, typeof STATUS_CONFIG['idea']][]),
];

/**
 * What one chapter can leave the card as, in the order a beta reader is
 * likeliest to want it: Word for the reader who marks up and mails it back,
 * ePub for the one who reads on a device, Markdown for the workshop thread.
 * HTML and PDF stay in the publishing studio, where a whole book is the point.
 */
const CHAPTER_EXPORT_FORMATS: Array<{
  output: ChapterExportOutput;
  icon: typeof Lightbulb;
  labelKey: string;
}> = [
  { output: 'docx', icon: FileType2, labelKey: 'writings.chapterExport.format.docx' },
  { output: 'epub', icon: BookOpen, labelKey: 'writings.chapterExport.format.epub' },
  { output: 'markdown', icon: FileText, labelKey: 'writings.chapterExport.format.markdown' },
];

/**
 * Previous / next chapter. Walks the same filtered + sorted array the list
 * shows, so what the chevrons call "next" is what the author sees next.
 */
function ChapterNav({
  previous,
  next,
  onNavigate,
}: {
  previous?: Writing;
  next?: Writing;
  onNavigate: (writing: Writing) => void;
}) {
  const { t } = useTranslation();
  const buttonClass =
    'p-1.5 rounded-lg transition border text-text-muted border-border hover:text-text-primary hover:bg-elevated disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted';
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => { if (previous) onNavigate(previous); }}
        disabled={!previous}
        title={previous ? previous.title : t('common.previous')}
        aria-label={t('common.previous')}
        className={buttonClass}
      >
        <ChevronLeft size={15} />
      </button>
      <button
        type="button"
        onClick={() => { if (next) onNavigate(next); }}
        disabled={!next}
        title={next ? next.title : t('common.next')}
        aria-label={t('common.next')}
        className={buttonClass}
      >
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

/**
 * The chapter number, editable where the author reads it.
 *
 * Mounted with the writing's id as its key: switching chapters remounts it, so
 * `useDebouncedField`'s unmount flush writes the pending number to the row it
 * was typed into instead of the one just opened.
 */
function ChapterNumberField({
  writing,
  onUpdate,
}: {
  writing: Writing;
  onUpdate: (id: string, changes: Partial<Writing>) => void;
}) {
  const { t } = useTranslation();
  const field = useDebouncedField(
    writing.chapter === undefined ? '' : String(writing.chapter),
    (value) => {
      const digits = value.replace(/\D/g, '');
      // Empty means "no number": Dexie's `update` drops a key set to undefined.
      onUpdate(writing.id, { chapter: digits ? parseInt(digits, 10) : undefined });
    },
  );

  return (
    <span className="flex items-center gap-1">
      <Hash size={12} />
      {t('writings.chapter')}
      <input
        value={field.value}
        onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ''))}
        onBlur={field.onBlur}
        inputMode="numeric"
        placeholder={t('writings.chapterExample')}
        aria-label={t('writings.chapterOptional')}
        title={t('writings.chapterOptional')}
        className="w-12 px-1 py-0.5 text-center bg-transparent border-b border-border/60 text-text-primary outline-none transition focus:border-accent-gold placeholder:text-text-dim"
      />
    </span>
  );
}

/**
 * Synopsis and tags. Both could be set once, at creation, and never again —
 * the editor showed the synopsis nowhere and the tags nowhere at all. Keyed by
 * writing id for the same flush-on-switch reason as the chapter field.
 */
function WritingMetaFields({
  writing,
  tagSuggestions,
  onUpdate,
}: {
  writing: Writing;
  tagSuggestions: string[];
  onUpdate: (id: string, changes: Partial<Writing>) => void;
}) {
  const { t } = useTranslation();
  const synopsisField = useDebouncedField(
    writing.synopsis ?? '',
    (value) => onUpdate(writing.id, { synopsis: value.trim() ? value : undefined }),
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
      <label className="block">
        <span className="block mb-1.5 text-[10px] text-text-dim uppercase tracking-wider font-medium">
          {t('writings.synopsisOptional')}
        </span>
        <input
          value={synopsisField.value}
          onChange={(e) => synopsisField.onChange(e.target.value)}
          onBlur={synopsisField.onBlur}
          placeholder={t('writings.synopsisPlaceholder')}
          className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition"
        />
      </label>
      <div>
        <span className="block mb-1.5 text-[10px] text-text-dim uppercase tracking-wider font-medium">
          {t('common.tags')}
        </span>
        <TagInput
          tags={writing.tags}
          onChange={(tags) => onUpdate(writing.id, { tags })}
          suggestions={tagSuggestions}
        />
      </div>
    </div>
  );
}

/**
 * The outline beat this writing is being written against.
 *
 * `outlineBeats.linkedWritingId` has always existed, but only the outline side
 * could see it: sitting in the chapter, the author had no way to tell which
 * beat they were writing. One indexed read scoped to the project — never the
 * whole outline — and nothing at all when no beat points here.
 */
function LinkedBeatChip({ projectId, writingId }: { projectId: string; writingId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [beat, setBeat] = useState<OutlineBeat | null>(null);

  useEffect(() => {
    let cancelled = false;
    void db.outlineBeats
      .where('projectId')
      .equals(projectId)
      .filter((row) => row.linkedWritingId === writingId)
      .first()
      .then((match) => {
        if (!cancelled) setBeat(match ?? null);
      })
      .catch((err) => console.error('[writings] linked beat lookup failed', err));
    return () => { cancelled = true; };
  }, [projectId, writingId]);

  if (!beat) return null;

  return (
    <button
      type="button"
      onClick={() => navigate(
        `/project/${encodeURIComponent(projectId)}/outline`
        + `?outline=${encodeURIComponent(beat.outlineId)}&beat=${encodeURIComponent(beat.id)}`,
      )}
      title={t('writings.linkedBeat')}
      aria-label={t('writings.linkedBeat')}
      className="inline-flex max-w-full items-center gap-1.5 px-2.5 py-1 bg-elevated/60 border border-border rounded-full text-[11px] text-text-muted hover:text-accent-gold hover:border-accent-gold/40 transition"
    >
      <ListTree size={11} className="flex-shrink-0" />
      <span className="truncate">{beat.title}</span>
    </button>
  );
}

/**
 * The catch on an edit nobody is waiting for — a status flip, a chapter number,
 * a tag, a synopsis the model wrote.
 *
 * `updateWriting` rejects for a row that is no longer there rather than
 * resolving over a chapter it never reached, so these calls can now fail. Only
 * the autosave has somewhere to SAY so (the indicator, and the dialog that
 * stops the editor closing quietly); these have to stay out of the console's
 * unhandled-rejection channel and leave the reporting to it. At module scope so
 * the `useCallback`s below can use it without a dependency that changes every
 * render.
 */
function reportSideEdit(err: unknown): void {
  console.error('[writings] a chapter edit could not be written', err);
}

/** Debounce for the editor autosave (ms). */
const AUTOSAVE_MS = 1200;
/** Throttled journal writes protect active typing without blocking every keypress. */
const RECOVERY_JOURNAL_MS = 250;
/** Cap per-flush "active seconds" so idle pauses don't inflate session time. */
const MAX_FLUSH_SECONDS = 120;

/**
 * `conflict` is not a failed save. It is the one state where the chapter has two
 * live versions — what is in the editor and what is now on disk — and the app
 * refuses to choose between them. Nothing is written while it lasts.
 */
type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

/**
 * The chapter as it stands on disk, when something that is not this editor put
 * it there. Held whole rather than as a flag: the writer is going to be shown a
 * choice between two texts, and both of them have to be in hand to offer it.
 */
interface IncomingChapter {
  /** The row's version, i.e. what the editor must write against to win. */
  version: number;
  title: string;
  content: string;
  wordCount: number;
}

interface EditorSession {
  openId: string | null;
  content: string;
  title: string;
  savedContent: string;
  savedTitle: string;
  savedWordCount: number;
  /**
   * The row version this session last saw confirmed — the token every flush
   * writes against, so a flush composed before somebody else's write can never
   * land on top of it. Moves only when a write of ours is confirmed, or when
   * the writer resolves a conflict.
   */
  savedVersion: number;
  /**
   * True from the moment the chapter is known to have moved underneath this
   * session until the writer says which text wins. The flag lives on the ref
   * rather than only in state because `flushSave` runs from unmount and
   * `beforeunload` handlers, where a stale closure over state would be the
   * difference between pausing and overwriting.
   */
  contested: boolean;
  lastFlushAt: number;
  savePromise: Promise<boolean> | null;
  journalTimer: number | null;
}

interface WritingsViewProps {
  projectId: string;
  writings: Writing[];
  onAdd: (writing: Writing) => Promise<void>;
  /**
   * The engine's generic `editItem`. Still declared, and still passed, but this
   * view no longer writes chapter rows through it: every write it makes has to
   * name the version it is writing against and hear back the version it
   * produced, and `makeEntityHook`'s `updateFn` contract — shared by every
   * engine in the app — carries neither. `writeWriting` below is the one path,
   * and it ends in the same `updateWriting` this does.
   */
  onEdit: (id: string, changes: Partial<Writing>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onRefresh?: () => Promise<void>;
}

export default function WritingsView({ projectId, writings, onAdd, onDelete, onRefresh }: WritingsViewProps) {
  const { t, locale } = useTranslation();
  const statusLabel = (status: WritingStatus) => t(`writings.status.${status}`);
  // Drafts stays the landing tab. "All" is new, and making it the default
  // would move the ground under every author who already knows where their
  // work in progress is.
  const [activeStatus, setActiveStatus] = useState<StatusFilter>('draft');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [openWriting, setOpenWriting] = useState<Writing | null>(null);
  const [editedContent, setEditedContent] = useState('');
  const [editedTitle, setEditedTitle] = useState('');
  const [showGooglePicker, setShowGooglePicker] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<AnnotationAnchor | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // What the last delete took away, held for 30 seconds so it can be taken back.
  const [undoBundle, setUndoBundle] = useState<DeletedWritingBundle | null>(null);
  const [pendingLeave, setPendingLeave] = useState(false);
  // The window close is waiting on an answer the writer has to give: the save
  // failed, so there is nothing left for the app to try on its own.
  const [pendingClose, setPendingClose] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recoveredDraft, setRecoveredDraft] = useState(false);
  // A crash draft whose chapter moved on underneath it. Held here rather than
  // pushed into the editor: the row is what opens, and the writer decides.
  const [recoveryConflict, setRecoveryConflict] = useState<WritingRecoveryDraft | null>(null);
  // The chapter as it now stands on disk, when something that is not this
  // editor rewrote it while it was open — the copilot answering a request, an
  // external client on the AI bridge, a project-wide replace, a second window.
  // Non-null is the whole conflict state: it holds the other text, it is what
  // the banner renders, and it is what pauses the autosave.
  const [incoming, setIncoming] = useState<IncomingChapter | null>(null);
  const [showCompile, setShowCompile] = useState(false);
  // Bringing an existing book in. Deliberately not gated on `writings.length`:
  // the project with nothing in it yet is exactly the one this is for.
  const [showManuscriptImport, setShowManuscriptImport] = useState(false);
  // Renumbering the whole book 1..n. It is a confirmation rather than a side
  // effect of anything else, so it needs a flag of its own; `orderBusy` is what
  // stops a second press from planning against a list the first one is still
  // rewriting.
  const [confirmRenumber, setConfirmRenumber] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showExport, setShowExport] = useState(false);
  // Reading mode: the manuscript as one scroll, read-only. `readingStartId` is
  // the piece it opens on — the chapter that was in the editor, when reading
  // was entered from there.
  const [reading, setReading] = useState(false);
  const [readingStartId, setReadingStartId] = useState<string | null>(null);

  const { accessToken } = useGoogleStore();
  const { project } = useProject(projectId);
  const projectTitle = project?.title || t('writings.compile.untitledProject');

  // New writing form
  const [newTitle, setNewTitle] = useState('');
  const [newStatus, setNewStatus] = useState<WritingStatus>('draft');
  const [newSynopsis, setNewSynopsis] = useState('');
  const [newChapter, setNewChapter] = useState('');
  const [newTags, setNewTags] = useState<string[]>([]);

  // ---------------------------------------------------------------------
  // Autosave core.
  //
  // Everything the flush needs lives in a ref so unmount/window handlers never
  // see stale closures. One promise owns the session's save loop: writes are
  // serialized, edits made during a write are coalesced into the next write,
  // and the persisted baseline moves only after Dexie confirms success.
  // ---------------------------------------------------------------------
  const editorRef = useRef<EditorSession>({
    openId: null as string | null,
    content: '',
    title: '',
    savedContent: '',
    savedTitle: '',
    savedWordCount: 0,
    savedVersion: 0,
    contested: false,
    lastFlushAt: 0,
    savePromise: null,
    journalTimer: null,
  });
  const mountedRef = useRef(true);

  // The list refresh, held in a ref.
  //
  // This view no longer writes chapter rows through `onEdit`. Every write it
  // makes has to name the version it is writing against and hear back the
  // version it produced, and `makeEntityHook`'s `updateFn` — the contract every
  // engine in the app shares — carries neither. So the writes go through
  // `updateWritingAtVersion` and ask for the same table refresh `onEdit` would
  // have done afterwards.
  //
  // Synced in an effect rather than assigned during render: writing a ref while
  // rendering is exactly what `react-hooks/refs` forbids.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  /**
   * Every write this view makes to a chapter row, in one place, so the session's
   * version token cannot drift.
   *
   * `expectedVersion` is passed by the autosave and left off by the side edits
   * (status, tags, synopsis, chapter number). That split is not laziness: the
   * autosave carries the whole body and composed it seconds ago, so it is the
   * write that can destroy something; a status flip carries one field the writer
   * just chose and has nothing to lose a race with. What both need is for the
   * session to learn the version the write produced — otherwise a status change
   * would leave the autosave writing against a token the row no longer has, and
   * every subsequent flush would report a conflict that never happened.
   */
  const writeWriting = useCallback(
    async (id: string, changes: Partial<Writing>, expectedVersion?: number): Promise<number> => {
      const version = await updateWritingAtVersion(id, changes, expectedVersion);
      const session = editorRef.current;
      if (session.openId === id) session.savedVersion = version;
      await onRefreshRef.current?.();
      return version;
    },
    [],
  );

  const persistRecoveryDraft = useCallback((session: EditorSession) => {
    if (!session.openId) return;
    writeWritingRecoveryDraft(
      projectId,
      session.openId,
      session.title,
      session.content,
      session.savedTitle,
      session.savedContent,
    );
  }, [projectId]);

  const flushSave = useCallback((): Promise<boolean> => {
    const session = editorRef.current;
    if (!session.openId) return Promise.resolve(true);
    if (session.savePromise) return session.savePromise;
    if (
      session.content === session.savedContent &&
      session.title === session.savedTitle
    ) {
      return Promise.resolve(true);
    }
    // A contested chapter is not saved, and not silently either: `false` is the
    // same answer a failed write gives, so Back, the chevrons and "Read from
    // here" all take the path they already take for unsaved work rather than
    // walking away from the question. The journal keeps taking the writer's
    // text throughout, so nothing is riding on this write landing.
    if (session.contested) return Promise.resolve(false);

    const saveLoop = async (): Promise<boolean> => {
      // `contested` is re-read on every pass, not only on the way in: the
      // listener below can raise the question while this loop is between two
      // writes, and the second write must not go out after that.
      while (
        session.openId &&
        !session.contested &&
        (session.content !== session.savedContent ||
          session.title !== session.savedTitle)
      ) {
        const writingId = session.openId;
        const content = session.content;
        const title = session.title;
        const wordCount = countWords(content);
        const previousWordCount = session.savedWordCount;
        const now = Date.now();
        const seconds = session.lastFlushAt
          ? Math.min(MAX_FLUSH_SECONDS, (now - session.lastFlushAt) / 1000)
          : 0;

        // Synchronous fallback before crossing the async persistence boundary.
        if (session.journalTimer !== null) {
          window.clearTimeout(session.journalTimer);
          session.journalTimer = null;
        }
        persistRecoveryDraft(session);
        if (mountedRef.current && editorRef.current === session) {
          setSaveError(null);
          setSaveState('saving');
        }

        try {
          // Against the version this session last saw confirmed, so the write
          // lands on the chapter it was composed from or on nothing at all.
          await writeWriting(writingId, { content, title, wordCount }, session.savedVersion);
        } catch (err) {
          persistRecoveryDraft(session);
          if (err instanceof WritingConflictError) {
            // Somebody else got there first, and this text was refused rather
            // than written over theirs. Neither is lost: `updateWriting` filed
            // ours in the version history on the way out, theirs is the row.
            // From here it is the writer's choice, so stop writing and ask.
            session.contested = true;
            if (mountedRef.current && editorRef.current === session) {
              setSaveError(null);
              setSaveState('conflict');
              setIncoming({
                version: err.current.updatedAt,
                title: err.current.title,
                content: err.current.content,
                wordCount: err.current.wordCount || countWords(err.current.content),
              });
            }
            return false;
          }
          if (mountedRef.current && editorRef.current === session) {
            setSaveError(err instanceof Error ? err.message : String(err));
            setSaveState('error');
          }
          return false;
        }

        // Only a confirmed write advances the persisted baseline.
        session.savedContent = content;
        session.savedTitle = title;
        session.savedWordCount = wordCount;
        session.lastFlushAt = now;

        const wordsDelta = wordCount - previousWordCount;
        if (wordsDelta > 0 || seconds > 0) {
          void recordEditorActivity(projectId, wordsDelta, seconds);
          // Throttled inside; keeps the dashboard's "edited N days ago" honest.
          void touchProject(projectId);
        }

        const hasNewerChanges =
          session.content !== session.savedContent ||
          session.title !== session.savedTitle;
        if (hasNewerChanges) {
          persistRecoveryDraft(session);
          if (mountedRef.current && editorRef.current === session) {
            setSaveState('dirty');
          }
        } else {
          clearWritingRecoveryDraft(projectId, writingId);
          if (mountedRef.current && editorRef.current === session) {
            setRecoveredDraft(false);
            setSaveState('saved');
          }
        }
      }
      // A loop that stopped because the chapter became contested has not saved
      // what it was holding, and must not answer as though it had.
      return !session.contested;
    };

    session.savePromise = saveLoop().finally(() => {
      session.savePromise = null;
    });
    return session.savePromise;
  }, [persistRecoveryDraft, projectId, writeWriting]);

  // Keep the ref in sync with typed state + debounce the flush.
  useEffect(() => {
    const s = editorRef.current;
    if (!s.openId) return;
    s.content = editedContent;
    s.title = editedTitle;
    const dirty = editedContent !== s.savedContent || editedTitle !== s.savedTitle;
    if (!dirty) {
      if (!s.savePromise) {
        if (s.journalTimer !== null) {
          window.clearTimeout(s.journalTimer);
          s.journalTimer = null;
        }
        if (s.openId) clearWritingRecoveryDraft(projectId, s.openId);
        setRecoveredDraft(false);
        setSaveState('saved');
      }
      return;
    }
    // While two versions of the chapter are live, typing goes to the journal and
    // nowhere else. The debounce is not merely pointless here — it is the thing
    // that would overwrite somebody's work — and the indicator must keep saying
    // `conflict` rather than flickering back to "unsaved" on every keystroke.
    if (incoming) {
      if (s.journalTimer === null) {
        s.journalTimer = window.setTimeout(() => {
          s.journalTimer = null;
          persistRecoveryDraft(s);
        }, RECOVERY_JOURNAL_MS);
      }
      return;
    }
    setSaveError(null);
    setSaveState('dirty');
    if (s.journalTimer === null) {
      s.journalTimer = window.setTimeout(() => {
        s.journalTimer = null;
        persistRecoveryDraft(s);
      }, RECOVERY_JOURNAL_MS);
    }
    const autosaveTimer = window.setTimeout(() => {
      void flushSave();
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(autosaveTimer);
  }, [editedContent, editedTitle, flushSave, incoming, persistRecoveryDraft, projectId]);

  // Flush on unmount (sidebar navigation, global-search jumps, etc.). The
  // journal is synchronous; the DB flush is best-effort once React is leaving.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const s = editorRef.current;
      if (s.journalTimer !== null) {
        window.clearTimeout(s.journalTimer);
        s.journalTimer = null;
      }
      if (
        s.openId &&
        (s.content !== s.savedContent || s.title !== s.savedTitle)
      ) {
        persistRecoveryDraft(s);
        void flushSave();
      }
    };
  }, [flushSave, persistRecoveryDraft]);

  // Flush on unload. The journal write is synchronous, so it lands whatever
  // happens to the async flush behind it.
  //
  // The `preventDefault()` that used to be here is gone in the desktop shell.
  // In a browser it raises "leave site?"; in an Electron renderer it cancels
  // the close and shows NOTHING, which is how the X came to look dead — and
  // how, with a save that kept failing, it became impossible to close the
  // window at all. Electron's close is answered by `closeGuard` below, where
  // there is a dialog to put the reason in. The web build keeps the prompt,
  // because there the browser really does show it.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const s = editorRef.current;
      if (!s.openId) return;
      const dirty = s.content !== s.savedContent || s.title !== s.savedTitle;
      if (!dirty) return;
      persistRecoveryDraft(s);
      void flushSave();
      if (isDesktop()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [flushSave, persistRecoveryDraft]);

  // ---------------------------------------------------------------------
  // Closing the desktop window.
  //
  // Same shape as the Back button, and for the same reason: a control that
  // silently refuses is worse than one that asks. The flush happens first, so
  // the ordinary unsaved close just works and the writer sees nothing at all.
  // Only a save that FAILED raises a dialog, and that dialog always has a way
  // out — the recovery journal already holds the draft, so closing is safe.
  // ---------------------------------------------------------------------
  useEffect(() => {
    return registerCloseGuard(async () => {
      const s = editorRef.current;
      if (!s.openId) return true;
      const dirty = s.content !== s.savedContent || s.title !== s.savedTitle;
      if (!dirty) return true;
      // Synchronous, before anything can go wrong across the await below.
      persistRecoveryDraft(s);
      if (await flushSave()) return true;
      setPendingClose(true);
      return false;
    });
  }, [flushSave, persistRecoveryDraft]);

  // What main is allowed to say if this renderer stops answering. Reported on
  // the transition rather than per keystroke, and cleared the moment the write
  // lands — while it is null main never intercepts the close at all, which is
  // what keeps the ordinary X instant.
  const unsaved = openWriting !== null && saveState !== 'saved';
  useEffect(() => {
    if (!unsaved) {
      reportUnsavedWork(null);
      return;
    }
    reportUnsavedWork({
      title: t('writings.closeWindow.stuckTitle'),
      message: t('writings.closeWindow.stuckMessage'),
      closeAnyway: t('writings.closeWindow.close'),
      keepOpen: t('writings.closeWindow.keepOpen'),
    });
    // `locale` and not `t`: the translator is a new function every render.
  }, [unsaved, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl/Cmd+S saves immediately; Escape exits focus mode.
  useEffect(() => {
    if (!openWriting) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void flushSave();
      } else if (e.key === 'Escape') {
        setFocusMode(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openWriting, flushSave]);

  const filtered = useMemo(
    () => writings
      .filter(w => activeStatus === 'all' || w.status === activeStatus)
      .sort(compareManuscriptOrder),
    [writings, activeStatus]
  );

  const counts = useMemo(() => ({
    all: writings.length,
    idea: writings.filter(w => w.status === 'idea').length,
    draft: writings.filter(w => w.status === 'draft').length,
    finished: writings.filter(w => w.status === 'finished').length,
  }), [writings]);

  // ---------------------------------------------------------------------
  // Manuscript order.
  //
  // The reorder arrows read their position from the WHOLE numbered manuscript,
  // never from the row's place in the list on screen: an arrow that swapped a
  // chapter with a neighbour the writer cannot see would look like an arrow
  // that did nothing.
  //
  // So they are offered exactly when the list on screen IS the whole numbered
  // manuscript — which is the condition, not the "All" tab. The app opens on
  // Borradores, and a project whose chapters are all drafts (every project,
  // early on) shows the entire book there; tying the arrows to a tab hid the
  // feature from precisely the writer who has just imported a manuscript and
  // needs it. The moment a numbered chapter is filtered out of view the arrows
  // go, because from then on a move could not mean what it looks like.
  // ---------------------------------------------------------------------
  const manuscriptOrder = useMemo(() => numberedInOrder(writings), [writings]);
  const manuscriptIndex = useMemo(
    () => new Map(manuscriptOrder.map((row, index) => [row.id, index])),
    [manuscriptOrder],
  );
  const wholeBookIsVisible = useMemo(() => {
    const visible = new Set(filtered.map(row => row.id));
    return manuscriptOrder.every(row => visible.has(row.id));
  }, [filtered, manuscriptOrder]);
  /** Empty exactly when the book already reads 1..n, which is what disables the action. */
  const renumberPlan = useMemo(() => renumberChapters(writings), [writings]);

  /** Tags already used in this project — offered while tagging a chapter. */
  const tagSuggestions = useMemo(
    () => [...new Set(writings.flatMap(w => w.tags))].sort((a, b) => a.localeCompare(b)),
    [writings],
  );

  // What reading mode reads: the list on screen, in manuscript order — so the
  // "All" tab reads the whole book and a status tab reads that pass of it.
  // A chapter that has left the current tab (its status was changed while it
  // was open) would otherwise be unreachable from "Read from here", so that
  // one case falls back to the whole manuscript rather than to chapter 1.
  const readingPieces = useMemo(() => {
    if (!readingStartId || filtered.some(w => w.id === readingStartId)) return filtered;
    return [...writings].sort(compareManuscriptOrder);
  }, [filtered, readingStartId, writings]);

  /** Status the New-writing form starts on; "All" is not a status to create into. */
  const newWritingStatus: WritingStatus = activeStatus === 'all' ? 'draft' : activeStatus;

  // Neighbours of the open writing inside the list the author is actually
  // looking at. -1 (the open writing is filtered out by the current tab)
  // leaves both chevrons disabled rather than jumping somewhere unrelated.
  const openIndex = openWriting ? filtered.findIndex(w => w.id === openWriting.id) : -1;
  const previousWriting = openIndex > 0 ? filtered[openIndex - 1] : undefined;
  const nextWriting =
    openIndex >= 0 && openIndex < filtered.length - 1 ? filtered[openIndex + 1] : undefined;

  // ---------------------------------------------------------------------
  // Live project word count — what a writing sprint measures.
  //
  // A sprint counts words added across the WHOLE project, not just the open
  // chapter, so the figure is every writing's saved `wordCount` (the same
  // number the autosave flush writes, and the same one `recordEditorActivity`
  // derives the daily totals from) plus whatever the open document has gained
  // since its last save — otherwise the readout would sit still for the length
  // of the autosave debounce on every sentence.
  //
  // The getter is stable and reads through refs on purpose: the sprint clock
  // calls it once a second from an interval built once per sprint, and a new
  // identity each render would tear that interval down and rebuild it.
  // ---------------------------------------------------------------------
  const projectWords = useMemo(
    () => writings.reduce((sum, writing) => sum + (writing.wordCount || 0), 0),
    [writings],
  );
  // Seeded rather than only synced: a child's effects run before its parent's,
  // and the sprint control reads this on its very first one.
  const projectWordsRef = useRef(projectWords);
  useEffect(() => {
    projectWordsRef.current = projectWords;
  }, [projectWords]);

  const getProjectWords = useCallback(() => {
    const session = editorRef.current;
    const unsaved = session.openId ? countWords(session.content) - session.savedWordCount : 0;
    return projectWordsRef.current + unsaved;
  }, []);

  // Deep link: `/project/:id/writings?writing=<id>`. Global search, Cmd+K and
  // annotation backlinks all navigate here; until now the URL landed on the
  // list and the author had to find the chapter again by hand.
  const deepLinkedWritingId = useDeepLinkParam('writing');

  const handleOpenWriting = useCallback((writing: Writing) => {
    // The chapter on screen is where the writer is: the dashboard's "Continue"
    // is only as current as whatever records that.
    rememberProjectRoute(projectId, { engineId: 'writings', entityId: writing.id });
    // A journal only reopens as the writer's text when the row is still where
    // the session that wrote it left off. One whose baseline no longer matches
    // was made against a version of the chapter that something else has since
    // replaced, so the ROW opens and the draft becomes a question — putting it
    // in the editor would autosave the older text over the newer one inside the
    // debounce, before the writer had read a word of either.
    const recovery = inspectWritingRecoveryDraft(writing);
    const draft = recovery.kind === 'draft' ? recovery.draft : null;
    const conflict = recovery.kind === 'conflict' ? recovery.draft : null;
    const content = draft?.content ?? writing.content;
    const title = draft?.title ?? writing.title;
    setOpenWriting(writing);
    setEditedContent(content);
    setEditedTitle(title);
    setSaveError(null);
    setRecoveredDraft(Boolean(draft));
    setSaveState(draft ? 'dirty' : 'saved');
    // Asked only where there is an editor to restore it into. A linked Google
    // Doc still gets the version filed below; it just has nowhere to answer.
    setRecoveryConflict(writing.isGoogleDoc ? null : conflict);
    // A question about the chapter being closed has no meaning in the one being
    // opened, and leaving it up would pause the new chapter's autosave.
    setIncoming(null);
    editorRef.current = {
      openId: writing.id,
      content,
      title,
      savedContent: writing.content,
      savedTitle: writing.title,
      savedWordCount: writing.wordCount || countWords(writing.content),
      // The version this session is writing against from here on. It is the row
      // as handed to us, which is the row the list last read — if that is
      // already stale the first flush finds out and asks, which is the point.
      savedVersion: writing.updatedAt,
      contested: false,
      lastFlushAt: Date.now(),
      savePromise: null,
      journalTimer: null,
    };
    // Version history: one automatic restore point per editing session,
    // capturing the document as it was BEFORE this session's changes.
    const sessionSnapshot = writing.isGoogleDoc
      ? Promise.resolve(null)
      : takeSnapshot(writing, 'auto');
    // A conflicted draft is filed as a version straight after it — before the
    // writer answers, and whichever way they answer. Version history is never
    // pruned, so from here the words survive both buttons, a closed dialog and
    // another crash. Only once that has actually landed does the journal go:
    // dropping it here is what stops a writer who keeps closing the question
    // from collecting one more copy of the same draft on every open, and
    // keeping it when the snapshot failed is what stops the one copy of the
    // text from being thrown away on the strength of a write that did not
    // happen.
    void sessionSnapshot.then(async () => {
      if (!conflict) return;
      const filed = await takeSnapshot(
        {
          id: writing.id,
          projectId: writing.projectId,
          title: conflict.title,
          content: conflict.content,
        },
        'manual',
      );
      if (filed) clearWritingRecoveryDraft(writing.projectId, writing.id);
    });
  }, [projectId]);

  // Open whatever the deep link pointed at, once the row is available.
  // Guarded so it never yanks the author out of a document they already have
  // open (e.g. a stale param surviving a re-render).
  const deepLinkOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkedWritingId || deepLinkOpened.current === deepLinkedWritingId) return;
    if (openWriting) return;
    const target = writings.find((w) => w.id === deepLinkedWritingId);
    if (!target) return;
    deepLinkOpened.current = deepLinkedWritingId;
    setActiveStatus(target.status);
    handleOpenWriting(target);
  }, [deepLinkedWritingId, writings, openWriting, handleOpenWriting]);

  // The writer's answer to a draft whose chapter moved on. Both answers are
  // safe by the time they are offered — the draft is already a version — so
  // this is a choice about what the editor shows next, not about what survives.
  //
  // Restoring is an ordinary edit: the draft lands in the editor dirty and the
  // autosave writes it over a row that was snapshotted on open, so the writer
  // can still walk it back through History. Guarded by id because the question
  // is answered by hand and the chevrons are right there — a chapter's draft
  // must land in that chapter or nowhere.
  const handleRestoreRecoveredDraft = useCallback(() => {
    const draft = recoveryConflict;
    setRecoveryConflict(null);
    if (!draft || editorRef.current.openId !== draft.writingId) return;
    setEditedTitle(draft.title);
    setEditedContent(draft.content);
    setSaveError(null);
    setRecoveredDraft(true);
  }, [recoveryConflict]);

  // Keeping the saved chapter is also what Escape and the backdrop do, which is
  // why it is the cancel side: the non-destructive answer is the one a stray
  // keypress can reach.
  const handleKeepSavedChapter = useCallback(() => {
    setRecoveryConflict(null);
  }, []);

  /**
   * The chapter the editor holds, as a bare id.
   *
   * The subscription below must be torn down and rebuilt when the chapter
   * changes and at no other time; depending on the `openWriting` object would
   * rebuild it on every status flip, tag and synopsis edit as well.
   */
  const openWritingId = openWriting?.id ?? null;

  // ---------------------------------------------------------------------
  // Somebody else wrote to the chapter that is open.
  //
  // `notifyDataChanged` is how every write that goes around the entity hooks
  // announces itself: the AI bridge and the copilot (both arrive through
  // `runBridgeTool`), a project-wide replace, an undo. The list hooks have
  // always listened and refetched — and that was the whole of it. The open
  // editor never heard a thing, which is the other half of the silent
  // overwrite: after the copilot rewrote a chapter the editor still held the
  // pre-copilot text, and 1.2 seconds after the next keystroke it put it back.
  //
  // Listening here is what makes the loss avoidable rather than merely
  // detectable. The compare-and-swap in `updateWriting` is a backstop — by the
  // time it fires the writer has already typed a paragraph into a chapter that
  // was going nowhere. This tells them while both texts are still whole and
  // neither has been written over.
  //
  // The writings tools do not fill in `table` (the audit envelope records it
  // only for deletions), so an event that names no entity at all is CHECKED
  // rather than assumed irrelevant — one keyed read, which is exactly what
  // `dataChanged.ts` means by "refetch when in doubt".
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!openWritingId) return;
    return onDataChanged((detail) => {
      if (detail.entityId && detail.entityId !== openWritingId) return;
      void db.writings
        .get(openWritingId)
        .then((row) => {
          const session = editorRef.current;
          if (!mountedRef.current) return;
          // A chapter that is gone, or one the writer has already left. The
          // flush's own `WritingGoneError` path owns the deletion and says
          // something better about it than a banner could.
          if (!row || session.openId !== openWritingId) return;
          // Our own write, or an announcement about something else entirely.
          if (row.updatedAt === session.savedVersion) return;
          // A flush is already in the air, and it is the better judge: it wrote
          // against `savedVersion`, so if this other write landed first the
          // compare-and-swap refuses it and raises the question with the row it
          // lost to — and if it landed second, its own announcement brings us
          // back here with nothing in flight. Answering both would put the
          // question up twice.
          if (session.savePromise) return;

          const dirty =
            session.content !== session.savedContent || session.title !== session.savedTitle;
          if (!dirty) {
            // Nothing of the writer's is at stake, so showing them the new text
            // IS the non-destructive answer — the same rule `useDebouncedField`
            // has always applied to every other field in the app: adopt the
            // remote value when it changes and the field is clean. A question
            // here would be a question about nothing.
            session.content = row.content;
            session.title = row.title;
            session.savedContent = row.content;
            session.savedTitle = row.title;
            session.savedWordCount = row.wordCount || countWords(row.content);
            session.savedVersion = row.updatedAt;
            clearWritingRecoveryDraft(projectId, openWritingId);
            setEditedContent(row.content);
            setEditedTitle(row.title);
            setOpenWriting(current => (current && current.id === row.id ? row : current));
            setRecoveredDraft(false);
            setSaveError(null);
            setSaveState('saved');
            toast.info(translateNow('writings.externalChange.reloaded'));
            return;
          }

          session.contested = true;
          setSaveError(null);
          setSaveState('conflict');
          setIncoming({
            version: row.updatedAt,
            title: row.title,
            content: row.content,
            wordCount: row.wordCount || countWords(row.content),
          });
        })
        .catch(err => console.error('[writings] could not re-read the open chapter', err));
    });
  }, [openWritingId, projectId]);

  // ---------------------------------------------------------------------
  // Answering "this chapter changed underneath you".
  //
  // Both answers are non-destructive, and both are non-destructive for the same
  // reason: the text that is about to leave the screen is filed as a version
  // FIRST, and the answer is only carried out once that write is confirmed. A
  // snapshot that failed leaves the banner exactly where it was, because the
  // alternative is throwing away the only copy of something on the strength of
  // a write that did not happen — the mistake `takeSnapshot` was given a return
  // value to prevent.
  //
  // Version history is never pruned, so from the moment either button is
  // pressed both texts are permanent and a click apart in the history panel.
  // ---------------------------------------------------------------------

  /**
   * Keep what is in the editor. The other version is filed first, then the
   * session is rebased onto the row it lost to — same words in the editor, new
   * version token — so the flush that follows wins the compare-and-swap
   * honestly rather than by having the guard switched off.
   */
  const handleKeepMyChapter = useCallback(() => {
    const other = incoming;
    const session = editorRef.current;
    const writingId = session.openId;
    if (!other || !writingId) return;
    void takeSnapshot(
      { id: writingId, projectId, title: other.title, content: other.content },
      'manual',
    )
      .then((filed) => {
        if (!filed) {
          toast.error(translateNow('writings.externalChange.filingFailed'));
          return;
        }
        const s = editorRef.current;
        if (s.openId !== writingId) return;
        // The baseline moves to THEIR text, not ours: what is on disk is not
        // what the editor holds, so the flush has real work to do.
        s.savedContent = other.content;
        s.savedTitle = other.title;
        s.savedWordCount = other.wordCount;
        s.savedVersion = other.version;
        s.contested = false;
        setIncoming(null);
        return flushSave();
      })
      .catch(err => console.error('[writings] could not keep the editor text', err));
  }, [flushSave, incoming, projectId]);

  /**
   * Take the version that is on disk. What is in the editor is filed first, so
   * "show me theirs" costs the writer one click in History to get back to
   * their own paragraph.
   */
  const handleTakeIncomingChapter = useCallback(() => {
    const other = incoming;
    const session = editorRef.current;
    const writingId = session.openId;
    if (!other || !writingId) return;
    const mineTitle = session.title;
    const mineContent = session.content;
    void takeSnapshot(
      { id: writingId, projectId, title: mineTitle, content: mineContent },
      'manual',
    )
      .then((filed) => {
        if (!filed) {
          toast.error(translateNow('writings.externalChange.filingFailed'));
          return;
        }
        const s = editorRef.current;
        if (s.openId !== writingId) return;
        s.content = other.content;
        s.title = other.title;
        s.savedContent = other.content;
        s.savedTitle = other.title;
        s.savedWordCount = other.wordCount;
        s.savedVersion = other.version;
        s.contested = false;
        // The journal held the text that has just become a version; leaving it
        // would raise the same question again on the next open.
        clearWritingRecoveryDraft(projectId, writingId);
        setIncoming(null);
        setEditedContent(other.content);
        setEditedTitle(other.title);
        setOpenWriting(current =>
          current && current.id === writingId
            ? {
                ...current,
                title: other.title,
                content: other.content,
                wordCount: other.wordCount,
                updatedAt: other.version,
              }
            : current,
        );
        setRecoveredDraft(false);
        setSaveError(null);
        setSaveState('saved');
        toast.success(translateNow('writings.externalChange.tookIncoming'));
      })
      .catch(err => console.error('[writings] could not take the incoming chapter', err));
  }, [incoming, projectId]);

  const leaveEditor = useCallback(() => {
    setPendingLeave(false);
    // The window close was waiting on a question about this chapter. Closing
    // the editor answers it: there is nothing unsaved left to hold the window,
    // and `reportUnsavedWork(null)` stands the main process down for us.
    setPendingClose(false);
    editorRef.current.openId = null;
    editorRef.current.contested = false;
    setOpenWriting(null);
    setFocusMode(false);
    // Nothing left to answer about a chapter that is no longer open. The
    // writer's text is not lost by walking away: the journal still holds it,
    // and its baseline no longer matches the row, so reopening the chapter
    // raises it again as a recovery conflict — which files it as a version
    // before asking. Both texts survive leaving with the question unanswered.
    setRecoveryConflict(null);
    setIncoming(null);
  }, []);

  // Back used to be a silent no-op for as long as the save kept failing — the
  // button simply did nothing, with nothing on screen to say why. Ask instead:
  // the recovery journal already holds the draft, so leaving is safe.
  const handleCloseWriting = useCallback(async () => {
    const saved = await flushSave();
    if (!saved) {
      setPendingLeave(true);
      return;
    }
    leaveEditor();
  }, [flushSave, leaveEditor]);

  // Retry closes the editor if the write finally lands; if it fails again the
  // author stays put with the error indicator, rather than in a dialog loop.
  const handleRetrySave = useCallback(() => {
    setPendingLeave(false);
    void flushSave().then((saved) => {
      if (saved) leaveEditor();
    });
  }, [flushSave, leaveEditor]);

  // The writer read the reason and still wants the window gone. The journal
  // holds the draft, so this is safe — and it is the answer that means the X
  // is never a dead button, however badly the save is going.
  const handleCloseAnyway = useCallback(() => {
    setPendingClose(false);
    closeAppWindow();
  }, []);

  // Staying is the cancel side, so it is what Escape and the backdrop reach —
  // the answer that costs nothing is the one a stray keypress can give.
  //
  // There is deliberately no "retry" button here. Retrying IS pressing the X
  // again: every close asks the guard, and the guard flushes before it answers.
  // A retry button that failed would have to either reopen this dialog (the
  // loop `handleRetrySave` exists to avoid) or swallow the request and leave
  // the X looking dead all over again.
  const handleKeepWindowOpen = useCallback(() => {
    setPendingClose(false);
    keepAppWindow();
  }, []);

  // Walking to the neighbouring chapter is leaving this one: flush first, and
  // when the write fails take exactly the Back button's path — the unsaved
  // dialog, never a chevron that silently does nothing.
  const handleNavigateWriting = useCallback(async (target: Writing) => {
    const saved = await flushSave();
    if (!saved) {
      setPendingLeave(true);
      return;
    }
    handleOpenWriting(target);
  }, [flushSave, handleOpenWriting]);

  // Opening a piece from the "changed recently" panel, which spans the whole
  // project: land in a tab that contains it, so the editor's prev/next
  // chevrons walk its neighbours instead of sitting disabled. A writer already
  // looking at the whole manuscript is left where they are.
  const handleOpenRecent = useCallback((writing: Writing) => {
    setActiveStatus(current =>
      current === 'all' || current === writing.status ? current : writing.status,
    );
    handleOpenWriting(writing);
  }, [handleOpenWriting]);

  // Reading mode from the list: nothing is open, so nothing has to be saved.
  const handleReadList = useCallback(() => {
    setReadingStartId(null);
    setReading(true);
  }, []);

  // Reading mode from the editor, opening on the chapter that was in it. The
  // editor is left first — the same flush, and the same unsaved-changes dialog
  // on failure, as the Back button — so no draft is left behind a read-only
  // surface that cannot save it.
  const handleReadFromHere = useCallback(async () => {
    const startId = editorRef.current.openId;
    const saved = await flushSave();
    if (!saved) {
      setPendingLeave(true);
      return;
    }
    leaveEditor();
    setReadingStartId(startId);
    setReading(true);
  }, [flushSave, leaveEditor]);

  // Leaving reading mode for the editor: one piece, at the point it was read.
  const handleReadingOpenInEditor = useCallback((writing: Writing) => {
    setReading(false);
    setReadingStartId(null);
    handleOpenWriting(writing);
  }, [handleOpenWriting]);

  const handleReadingClose = useCallback(() => {
    setReading(false);
    setReadingStartId(null);
  }, []);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    const writing: Writing = {
      id: generateId('wrt'),
      projectId,
      title: newTitle,
      status: newStatus,
      content: '',
      synopsis: newSynopsis || undefined,
      wordCount: 0,
      chapter: newChapter ? parseInt(newChapter) : undefined,
      tags: newTags,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await onAdd(writing);
    setNewTitle('');
    setNewStatus('draft');
    setNewSynopsis('');
    setNewChapter('');
    setNewTags([]);
    setShowCreateForm(false);
    // Straight into the editor — creating and then hunting for the new doc
    // in the list was a dead-end flow.
    handleOpenWriting(writing);
  };

  const handleSaveContent = async () => {
    const saved = await flushSave();
    // A Save button that quietly does nothing is the failure mode this editor
    // has been bitten by before (see the Back button). While the chapter is
    // contested nothing may be written, so say which question is in the way.
    if (!saved && editorRef.current.contested) toast.info(t('writings.externalChange.hint'));
    if (!saved || !openWriting) return;
    setOpenWriting({ ...openWriting, content: editedContent, title: editedTitle, wordCount: countWords(editedContent) });
  };

  const handleStatusChange = (writingId: string, newSt: WritingStatus) => {
    // Unguarded, like the other side edits, but through `writeWriting` all the
    // same: a status flipped on the chapter that is open moves the row's
    // version, and a session that did not hear about it would report its next
    // autosave as a conflict with nobody.
    void writeWriting(writingId, { status: newSt }).catch(reportSideEdit);
    if (openWriting?.id === writingId) {
      setOpenWriting({ ...openWriting, status: newSt });
    }
  };

  const handleDuplicate = (writing: Writing, targetStatus: WritingStatus) => {
    const now = Date.now();
    void onAdd({
      ...writing,
      id: generateId('wrt'),
      status: targetStatus,
      title: `${writing.title} ${t('writings.copyLabel')}`,
      createdAt: now,
      updatedAt: now,
      // Strip Google Doc link from copies
      googleDocId: undefined,
      googleDocUrl: undefined,
      googleDocName: undefined,
      lastSyncedAt: undefined,
      syncDirection: undefined,
      isGoogleDoc: undefined,
    });
  };

  // Card action menu state — close on outside click
  const [cardMenuId, setCardMenuId] = useState<string | null>(null);
  const closeCardMenu = useCallback(() => setCardMenuId(null), []);
  useEffect(() => {
    if (!cardMenuId) return;
    const handler = () => closeCardMenu();
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [cardMenuId, closeCardMenu]);

  // ---------------------------------------------------------------------
  // Sending one chapter out.
  //
  // The assembly is `chapterExport.ts`, beside the publishing modules whose
  // composer and format writers it borrows. What is left here is the three
  // things only a view can do: hand the module the reader's language, ask
  // before exporting something with nothing in it, and say what happened.
  // ---------------------------------------------------------------------
  const [pendingChapterExport, setPendingChapterExport] = useState<
    { ids: string[]; output: ChapterExportOutput; title: string } | null
  >(null);

  const runChapterExport = useCallback(async (ids: string[], output: ChapterExportOutput) => {
    const result = await exportChapter(writings, ids, output, {
      projectTitle,
      // The manuscript's own heading word, so a chapter sent on its own reads
      // exactly as it reads inside the compiled book.
      chapterLabel: t('projectTools.publishing.chapterLabel.manuscript'),
      untitledLabel: t('projectTools.publishing.untitled'),
      wordLabel: t('writings.words'),
      locale,
    });
    if (result.ok) {
      toast.success(t('projectTools.publishing.exported').replace('{name}', result.filename ?? ''));
      if (result.omittedImageCount) {
        toast.info(t('projectTools.publishing.portableImagesOmitted').replace(
          '{count}',
          String(result.omittedImageCount),
        ));
      }
      return;
    }
    if (result.reason === 'google-docs-without-content') {
      toast.error(t('projectTools.publishing.googleDocsEmptyError').replace(
        '{titles}',
        result.googleDocsWithoutContent.map(doc => doc.title).join(', '),
      ));
      return;
    }
    console.error('[writings] could not export the chapter', result.error);
    toast.error(result.error || t('projectTools.publishing.exportError'));
  }, [locale, projectTitle, t, writings]);

  const startChapterExport = useCallback((writing: Writing, output: ChapterExportOutput) => {
    setCardMenuId(null);
    // A chapter with no prose in it compiles to a file with no prose in it,
    // and the writer hears about that from the reader. It is the one mis-click
    // a single-press export can make expensive, so it is the one it asks
    // about — and it asks rather than refuses, because a placeholder sent on
    // purpose is a thing a workshop does ask for.
    if (selectChapterExport(writings, [writing.id]).emptyWritings.length > 0) {
      setPendingChapterExport({ ids: [writing.id], output, title: writing.title });
      return;
    }
    void runChapterExport([writing.id], output);
  }, [runChapterExport, writings]);

  // Every editor write that is NOT the autosave loop — chapter number,
  // synopsis, tags, the AI's synopsis. Persist, then keep the open copy in
  // step so the header and the manuscript order show the new value at once.
  //
  // The state update is guarded by id on purpose: a debounced field can flush
  // on its way out, once the author has already moved to the next chapter.
  // That write belongs to the row it was typed into and must not drag the
  // editor back to it.
  //
  // Written through `writeWriting` rather than `onEdit` so the session hears the
  // version each of these produced. Unguarded on purpose: a status flip or a tag
  // is a field the writer chose a moment ago, not a body composed minutes ago,
  // and refusing it because the copilot touched the synopsis would be pedantry.
  const handleMetaUpdate = useCallback((id: string, changes: Partial<Writing>) => {
    void writeWriting(id, changes).catch(reportSideEdit);
    setOpenWriting(current => (current && current.id === id ? { ...current, ...changes } : current));
  }, [writeWriting]);

  const handleSynopsisUpdate = (synopsis: string) => {
    if (!openWriting) return;
    handleMetaUpdate(openWriting.id, { synopsis });
  };

  // ---------------------------------------------------------------------
  // Changing the manuscript's order.
  //
  // Both actions take the same path — a plan from `chapterOrder.ts`, one
  // transaction, one refresh — and neither goes through `onEdit`, whose hook
  // refetches the whole table after every single write. On a forty-chapter
  // renumber that is forty reads of forty chapters' html, with the list
  // rearranging itself in front of the writer after each one.
  // ---------------------------------------------------------------------
  const applyOrderPlan = useCallback(async (plan: ChapterAssignment[]): Promise<boolean> => {
    if (plan.length === 0) return false;
    setOrderBusy(true);
    try {
      await applyChapterNumbers(projectId, plan);
      await onRefresh?.();
      return true;
    } catch (err) {
      // The transaction rolled back: the numbering is exactly as it was, and
      // saying so is the whole point of the message.
      console.error('[writings] could not change the chapter numbers', err);
      toast.error(t('writings.chapterOrder.error'));
      return false;
    } finally {
      setOrderBusy(false);
    }
  }, [onRefresh, projectId, t]);

  const handleMoveChapter = useCallback(
    (id: string, direction: ChapterDirection) => applyOrderPlan(moveChapter(writings, id, direction)),
    [applyOrderPlan, writings],
  );

  const handleRenumber = useCallback(async () => {
    setConfirmRenumber(false);
    const count = manuscriptOrder.length;
    if (await applyOrderPlan(renumberPlan)) {
      toast.success(t('writings.chapterOrder.renumbered').replace('{count}', String(count)));
    }
  }, [applyOrderPlan, manuscriptOrder.length, renumberPlan, t]);

  const pendingDeleteWriting = pendingDeleteId ? writings.find(w => w.id === pendingDeleteId) : undefined;

  // The delete is undoable for 30 seconds. `deleteWriting` now reads everything
  // it removes — the row, its whole (never-pruned) version history, its margin
  // notes and their reference rows, and the outline beats it unlinks — and
  // parks that bundle for the one id this view armed; `takeLastDeletedWriting(id)`
  // collects it the moment that delete resolves, and answers null for anything
  // else, so a delete made elsewhere (the copilot, through the AI bridge) while
  // ours was in flight can never be offered back here as if it were this one.
  // The window is deliberately short: this is a way back from a mis-click, not
  // a second trash can.
  useEffect(() => {
    if (!undoBundle) return;
    const timer = window.setTimeout(() => setUndoBundle(null), 30_000);
    return () => window.clearTimeout(timer);
  }, [undoBundle]);

  const undoDelete = () => {
    const bundle = undoBundle;
    if (!bundle) return;
    setUndoBundle(null);
    void restoreDeletedWriting(bundle)
      .then(() =>
        toast.success(t('writings.undoDelete.restored').replace('{name}', bundle.writing.title)),
      )
      .catch((err) => {
        console.error('[writings] failed to restore deleted writing', err);
        toast.error(t('writings.undoDelete.error'));
      });
  };

  const confirmDeleteDialog = (
    <>
      <ConfirmDialog
        open={pendingDeleteId !== null}
        destructive
        message={t('writings.confirmDelete').replace('{name}', pendingDeleteWriting?.title ?? '')}
        onConfirm={() => {
          const id = pendingDeleteId;
          setPendingDeleteId(null);
          if (!id) return;
          if (openWriting?.id === id) {
            editorRef.current.openId = null; // don't autosave a deleted doc
            setOpenWriting(null);
          }
          // Armed before the delete, because `onDelete` resolves only after the
          // hook's own full-table refresh — a long window for another delete
          // to land in.
          expectDeletedWriting(id);
          void onDelete(id)
            .then(() => {
              clearWritingRecoveryDraft(projectId, id);
              setUndoBundle(takeLastDeletedWriting(id));
            })
            .catch((err) => console.error('[writings] failed to delete writing', err));
        }}
        onCancel={() => setPendingDeleteId(null)}
      />

      {/* The toast helper carries no action, so the Undo gets its own bar —
          offset from the toast stack so the two never sit on top of each other. */}
      {undoBundle && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-elevated px-3.5 py-2.5 shadow-lg shadow-black/30"
        >
          <span className="text-sm text-text-primary">
            {t('writings.undoDelete.message').replace('{name}', undoBundle.writing.title)}
          </span>
          <button
            type="button"
            onClick={undoDelete}
            className="flex items-center gap-1.5 rounded-md border border-accent-gold/40 px-2.5 py-1 text-xs font-semibold text-accent-gold transition hover:bg-accent-gold/10"
          >
            <Undo2 size={13} />
            {t('writings.undoDelete.action')}
          </button>
          <button
            type="button"
            onClick={() => setUndoBundle(null)}
            className="text-text-dim transition hover:text-text-primary"
            aria-label={t('common.dismiss')}
            title={t('common.dismiss')}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );

  const confirmLeaveDialog = (
    <>
      {/* Leaving with the save refused. A CONTESTED chapter gets its own copy
          of this: nothing failed, so "could not be saved: " with an empty
          reason would be a lie, and "Retry save" would refuse again for as long
          as the banner goes unanswered. Cancel goes back to the banner, and
          leaving stays safe — the journal still holds the writer's text and its
          baseline no longer matches the row, so reopening the chapter raises it
          as a recovery conflict, which files it as a version before asking. */}
      <ConfirmDialog
        open={pendingLeave}
        title={incoming ? t('writings.externalChange.leaveTitle') : t('writings.leaveUnsaved.title')}
        message={
          incoming
            ? t('writings.externalChange.leaveMessage')
            : t('writings.leaveUnsaved.message').replace('{error}', saveError ?? '')
        }
        confirmLabel={
          incoming ? t('writings.externalChange.leaveAnyway') : t('writings.leaveUnsaved.leave')
        }
        cancelLabel={incoming ? t('writings.externalChange.stay') : t('writings.leaveUnsaved.retry')}
        onConfirm={leaveEditor}
        onCancel={incoming ? () => setPendingLeave(false) : handleRetrySave}
      />

      {/* The X, when the save will not go through. The writer gets the reason
          and both real answers; what they never get is the old silence.
          A refusal without a message of its own — a contested chapter — still
          gets a sentence rather than an empty colon. */}
      <ConfirmDialog
        open={pendingClose}
        title={t('writings.closeWindow.title')}
        message={t('writings.closeWindow.message').replace(
          '{error}',
          saveError ?? t('writings.closeWindow.reasonUnknown'),
        )}
        confirmLabel={t('writings.closeWindow.close')}
        cancelLabel={t('writings.closeWindow.keepOpen')}
        onConfirm={handleCloseAnyway}
        onCancel={handleKeepWindowOpen}
      />
    </>
  );

  // Two versions of one chapter, and no way for the app to know which one the
  // writer wants: a draft the recovery journal saved from a crash, and a body
  // that something else has rewritten since. The chapter on disk is what is on
  // screen, so the default answer changes nothing.
  const recoveryConflictDialog = (
    <ConfirmDialog
      open={recoveryConflict !== null}
      title={t('writings.recoveryConflict.title')}
      message={t('writings.recoveryConflict.message')}
      confirmLabel={t('writings.recoveryConflict.restore')}
      cancelLabel={t('writings.recoveryConflict.keep')}
      onConfirm={handleRestoreRecoveredDraft}
      onCancel={handleKeepSavedChapter}
    />
  );

  // ---- Reading View ----
  // A full return rather than an overlay on top of the list: the list behind it
  // would be a card per chapter — 400 of them on a finished manuscript — laid
  // out and animated under a surface nobody can see through.
  if (reading && readingPieces.length > 0) {
    return (
      <ReadingView
        pieces={readingPieces}
        startId={readingStartId}
        onClose={handleReadingClose}
        onOpenInEditor={handleReadingOpenInEditor}
      />
    );
  }

  // ---- Google Doc Detail View ----
  if (openWriting?.isGoogleDoc) {
    const contentFetcher = accessToken && openWriting.googleDocId
      ? () => fetchGoogleDocForAi(accessToken, openWriting.googleDocId!)
      : undefined;

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleCloseWriting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-muted hover:text-text-primary transition rounded-lg hover:bg-elevated"
          >
            <ArrowLeft size={16} />
            {t('common.back')}
          </button>

          {/* Same walk as the local editor: a linked doc is a chapter too. */}
          <ChapterNav
            previous={previousWriting}
            next={nextWriting}
            onNavigate={(target) => void handleNavigateWriting(target)}
          />

          <div className="flex-1" />
          {/* A sprint spans the project, so it stays visible here too — the
              words counted are the ones a Google Doc sync brings back. */}
          <SprintControl
            projectId={projectId}
            writingId={openWriting.id}
            getProjectWords={getProjectWords}
          />
          {/* A linked document is a chapter too: read on from it. */}
          <button
            onClick={() => void handleReadFromHere()}
            className="p-1.5 rounded-lg transition border text-text-muted border-border hover:text-text-primary hover:bg-elevated"
            title={t('writings.reading.fromHere')}
          >
            <BookOpen size={15} />
          </button>
          {/* Status switcher */}
          <div className="flex items-center gap-1 bg-surface border border-border rounded-lg px-1 py-0.5">
            {(Object.entries(STATUS_CONFIG) as [WritingStatus, typeof STATUS_CONFIG['idea']][]).map(([st, cfg]) => {
              const Icon = cfg.icon;
              return (
                <button
                  key={st}
                  onClick={() => handleStatusChange(openWriting.id, st)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition ${
                    openWriting.status === st ? 'font-semibold' : 'text-text-muted hover:text-text-primary'
                  }`}
                  style={openWriting.status === st ? { color: cfg.color, backgroundColor: cfg.bg } : {}}
                >
                  <Icon size={13} />
                  {statusLabel(st)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-serif font-bold text-text-primary">{openWriting.title}</h1>

        {/* Which beat this document is written against, when one points here. */}
        <LinkedBeatChip projectId={projectId} writingId={openWriting.id} />

        {/* Metadata.
            SyncButton is mounted here — it existed as a component and was
            never rendered anywhere, so a linked Google Doc kept `content: ''`
            forever: no word count, nothing to search, and silently excluded
            from Compile (which filters out empty writings). */}
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <GoogleDocBadge lastSyncedAt={openWriting.lastSyncedAt} googleDocUrl={openWriting.googleDocUrl} />
          <SyncButton
            writing={openWriting}
            size="md"
            onSynced={(changes) => {
              void writeWriting(openWriting.id, changes).catch(reportSideEdit);
              setOpenWriting({ ...openWriting, ...changes });
            }}
          />
        </div>

        {/* Open in Google Docs */}
        <div className="flex items-center gap-3 p-4 bg-blue-500/5 border border-blue-400/20 rounded-xl">
          <Cloud size={20} className="text-blue-400 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-text-primary">{t('writings.gdocLivesHere')}</p>
            <p className="text-xs text-text-muted mt-0.5">{t('writings.gdocHint')}</p>
          </div>
          <a
            href={openWriting.googleDocUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-500 text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition flex-shrink-0"
          >
            {t('writings.gdocOpen')}
            <ExternalLink size={14} />
          </a>
        </div>

        {/* AI Tools */}
        <div className="space-y-2">
          <p className="text-xs text-text-dim uppercase tracking-wider font-medium">{t('writings.aiTools')}</p>
          <p className="text-xs text-text-muted">
            {t('writings.aiHint')}
          </p>
          {/* Keyed by chapter: the toolbar caches ONE chapter's fetched text
              and its pending AI results, and the chevrons swap `writing` in
              place instead of remounting. Without the key it served chapter
              A's text to chapter B, and "save as synopsis" then wrote a
              summary of A onto B. */}
          <AiToolbar
            key={openWriting.id}
            writing={openWriting}
            projectId={projectId}
            onSynopsisUpdate={handleSynopsisUpdate}
            contentFetcher={contentFetcher}
          />
        </div>

        {confirmLeaveDialog}
      </div>
    );
  }

  // ---- Writing Editor View ----
  if (openWriting) {
    const config = STATUS_CONFIG[openWriting.status];
    const StatusIcon = config.icon;
    const wc = countWords(editedContent);
    const exportTitle = editedTitle.trim() || openWriting.title.trim() || projectTitle;

    // The publishing studio seeded with this chapter and nothing else. Sending
    // one chapter to a beta reader through the manuscript export meant
    // unchecking every other writing by hand, one at a time.
    const singleWritingProfile: PublishingProfile = {
      id: '',
      projectId,
      name: exportTitle,
      format: 'manuscript',
      includeTitlePage: true,
      includeSynopsis: false,
      includeBibliography: false,
      citationStyle: 'apa',
      selectionMode: 'selected',
      selectedWritingIds: [openWriting.id],
      writingOrder: [openWriting.id],
      createdAt: 0,
      updatedAt: 0,
    };

    // Focus mode is local to this view — the app has no global immersive
    // layout to borrow, and inventing one for a single editor would put a
    // layout mode in everyone's way. A fixed overlay at the app's own
    // background colour covers the sidebar and the copilot dock, leaving the
    // page and the few controls needed to get back out. Esc exits (see the
    // keydown effect above); modals still sit above it at z-50.
    const editorBody = (
      <>
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={handleCloseWriting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-muted hover:text-text-primary transition rounded-lg hover:bg-elevated"
          >
            <ArrowLeft size={16} />
            {t('common.back')}
          </button>

          {/* Previous / next chapter — reading two in a row used to mean a
              round trip through the list for every one of them. */}
          <ChapterNav
            previous={previousWriting}
            next={nextWriting}
            onNavigate={(target) => void handleNavigateWriting(target)}
          />

          {/* Autosave indicator. `conflict` is amber rather than red: nothing
              has failed and nothing is lost, the app is simply not writing
              until the question in the banner below is answered. */}
          <span
            className={`flex items-center gap-1 text-xs transition ${
              saveState === 'saved'
                ? 'text-text-dim'
                : saveState === 'error'
                  ? 'text-danger'
                  : saveState === 'saving'
                    ? 'text-blue-400'
                    : 'text-accent-amber'
            }`}
            title={
              saveState === 'conflict'
                ? t('writings.externalChange.hint')
                : saveError ?? t('writings.autosaveHint')
            }
            aria-live="polite"
          >
            {saveState === 'saved' ? (
              <Check size={12} />
            ) : saveState === 'saving' ? (
              <LoaderCircle size={12} className="animate-spin" />
            ) : saveState === 'error' || saveState === 'conflict' ? (
              <CircleAlert size={12} />
            ) : (
              <PenLine size={12} />
            )}
            {saveState === 'saved'
              ? t('writings.savedIndicator')
              : saveState === 'saving'
                ? t('common.saving')
                : saveState === 'error'
                  ? t('writings.saveErrorIndicator')
                  : saveState === 'conflict'
                    ? t('writings.externalChange.indicator')
                    : recoveredDraft
                      ? t('writings.recoveredIndicator')
                      : t('writings.unsavedIndicator')}
          </span>

          <div className="flex-1" />

          {!focusMode && (
            /* Status switcher */
            <div className="flex items-center gap-1 bg-surface border border-border rounded-lg px-1 py-0.5">
              {(Object.entries(STATUS_CONFIG) as [WritingStatus, typeof config][]).map(([st, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <button
                    key={st}
                    onClick={() => handleStatusChange(openWriting.id, st)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition ${
                      openWriting.status === st
                        ? 'font-semibold'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                    style={openWriting.status === st ? { color: cfg.color, backgroundColor: cfg.bg } : {}}
                  >
                    <Icon size={13} />
                    {statusLabel(st)}
                  </button>
                );
              })}
            </div>
          )}

          {/* Writing sprint — stays visible in focus mode; a countdown you
              cannot see is not a countdown. */}
          <SprintControl
            projectId={projectId}
            writingId={openWriting.id}
            getProjectWords={getProjectWords}
          />

          {/* Read on from here: the manuscript as one scroll, opening on this
              chapter. Read-only, so the editor is closed (and flushed) first. */}
          <button
            onClick={() => void handleReadFromHere()}
            className="p-1.5 rounded-lg transition border text-text-muted border-border hover:text-text-primary hover:bg-elevated"
            title={t('writings.reading.fromHere')}
          >
            <BookOpen size={15} />
          </button>

          {/* Export just this writing. The studio reads the saved rows from
              Dexie, so the flush has to land before it opens — same rule as
              version history. */}
          <button
            onClick={() => {
              void flushSave().then((saved) => {
                if (saved) setShowExport(true);
              });
            }}
            className="p-1.5 rounded-lg transition border text-text-muted border-border hover:text-text-primary hover:bg-elevated"
            title={t('writings.exportThis')}
          >
            <FileDown size={15} />
          </button>

          {/* Version history */}
          <button
            onClick={() => {
              void flushSave().then((saved) => {
                if (saved) setShowHistory(true);
              });
            }}
            className="p-1.5 rounded-lg transition border text-text-muted border-border hover:text-text-primary hover:bg-elevated"
            title={t('writings.history.title')}
          >
            <History size={15} />
          </button>

          {/* Focus mode toggle */}
          <button
            onClick={() => setFocusMode(!focusMode)}
            className={`p-1.5 rounded-lg transition border ${
              focusMode
                ? 'text-accent-gold border-accent-gold/40 bg-accent-gold/10'
                : 'text-text-muted border-border hover:text-text-primary hover:bg-elevated'
            }`}
            title={focusMode ? t('writings.exitFocusMode') : t('writings.focusMode')}
          >
            {focusMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>

          <button
            onClick={() => void handleSaveContent()}
            disabled={saveState === 'saving'}
            className="px-4 py-1.5 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition disabled:opacity-60"
            title="Ctrl+S"
          >
            {saveState === 'saving' ? t('common.saving') : t('writings.save')}
          </button>
        </div>

        {/* Title */}
        <input
          value={editedTitle}
          onChange={(e) => setEditedTitle(e.target.value)}
          className="w-full text-2xl font-serif font-bold bg-transparent border-none outline-none text-text-primary placeholder:text-text-dim"
          placeholder={t('writings.untitled')}
        />

        {/* Which beat this chapter is written against, when one points here. */}
        <LinkedBeatChip projectId={projectId} writingId={openWriting.id} />

        {/* Word count, chapter & Google Doc badge.
            The chapter used to be a read-only chip: a number could be given at
            creation and never changed, so renumbering meant recreating the
            chapter. It is an input now — empty clears the number. */}
        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span>{wc.toLocaleString()} {t('writings.words')}</span>
          <ChapterNumberField
            key={openWriting.id}
            writing={openWriting}
            onUpdate={handleMetaUpdate}
          />
          <span>
            <StatusIcon size={12} className="inline mr-1" style={{ color: config.color }} />
            {statusLabel(openWriting.status)}
          </span>
          {openWriting.isGoogleDoc && (
            <GoogleDocBadge
              lastSyncedAt={openWriting.lastSyncedAt}
              googleDocUrl={openWriting.googleDocUrl}
            />
          )}
        </div>

        {/* Synopsis + tags — planning furniture, so it follows the AI toolbar
            out of the way in focus mode. */}
        {!focusMode && (
          <WritingMetaFields
            key={openWriting.id}
            writing={openWriting}
            tagSuggestions={tagSuggestions}
            onUpdate={handleMetaUpdate}
          />
        )}

        {/* AI Toolbar — hidden in focus mode. Keyed by chapter for the same
            reason as the linked-document toolbar above: one instance must not
            carry chapter A's fetched text and pending summary into chapter B. */}
        {!focusMode && (
          <AiToolbar
            key={openWriting.id}
            writing={{ ...openWriting, content: editedContent }}
            projectId={projectId}
            onSynopsisUpdate={handleSynopsisUpdate}
          />
        )}

        {/* Editor + Margin notes.

            Keyed by chapter, for the reason the AI toolbar above is: one
            instance must not carry chapter A into chapter B. Here what it
            carries is the UNDO HISTORY. `useEditor` builds its editor once per
            mount and the chevrons swap `content` in place; `setContent` is a
            ProseMirror transaction like any other, so the swap itself lands on
            the undo stack. One Ctrl+Z in chapter B therefore undid the arrival
            of chapter B — putting chapter A's whole body back on screen, which
            fires `onUpdate`, which is `setEditedContent`, which the autosave
            wrote into chapter B's row 1.2 seconds later under a green "Saved".
            A key gives each chapter its own editor and its own history, so the
            walk back through a chapter now stops where the chapter starts. */}
        {/* Two live versions of this chapter, and a question about them.

            A BANNER, and deliberately not a modal. The writer is mid-sentence:
            a dialog would take the caret away and demand an answer about two
            texts it is covering up, and the honest answer to "which of these
            wins" is often "let me read them first". A banner sits above the
            page, says what happened, and waits — the writer can keep typing
            while they think, and the recovery journal keeps taking every
            keystroke exactly as it did before.

            Nor is it a silent reload. Replacing what is on screen would throw
            away the paragraph the writer is in the middle of, which is the same
            loss the guard was added to prevent, only pointed the other way.
            (When the editor is CLEAN there is nothing to throw away, and the
            reload happens silently with a toast — see the listener above.)

            Autosave is paused while this is up, so neither text can reach the
            row until the question is answered. Both buttons file the version
            that is about to leave the screen before they do anything, so
            neither of them can lose a word; the only difference between them is
            which text stays in the editor and which is one click away in
            History. */}
        {incoming && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-accent-amber/40 bg-accent-amber/10 px-3.5 py-2.5"
          >
            <CircleAlert size={16} className="flex-shrink-0 text-accent-amber" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text-primary">
                {t('writings.externalChange.title')}
              </p>
              <p className="text-xs text-text-muted">
                {t('writings.externalChange.message')
                  .replace('{mine}', wc.toLocaleString())
                  .replace('{theirs}', incoming.wordCount.toLocaleString())}
              </p>
            </div>
            <button
              type="button"
              onClick={handleKeepMyChapter}
              className="rounded-md border border-accent-gold/40 px-2.5 py-1 text-xs font-semibold text-accent-gold transition hover:bg-accent-gold/10"
            >
              {t('writings.externalChange.keepMine')}
            </button>
            <button
              type="button"
              onClick={handleTakeIncomingChapter}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-text-primary transition hover:bg-elevated"
            >
              {t('writings.externalChange.takeIncoming')}
            </button>
          </div>
        )}

        {focusMode ? (
          <TiptapEditor
            key={openWriting.id}
            content={editedContent}
            onChange={setEditedContent}
            placeholder={t('writings.startWriting')}
            onGenerateImage={(sel) => void generateImageFromSelection(projectId, sel)}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
            <TiptapEditor
              key={openWriting.id}
              content={editedContent}
              onChange={setEditedContent}
              placeholder={t('writings.startWriting')}
              onAnnotate={(anchor) => setPendingAnchor(anchor)}
              onGenerateImage={(sel) => void generateImageFromSelection(projectId, sel)}
            />
            <AnnotationSurface
              projectId={projectId}
              engineId="writings"
              entityId={openWriting.id}
              layout="sidebar"
              pendingAnchor={pendingAnchor}
              onPendingAnchorConsumed={() => setPendingAnchor(null)}
            />
          </div>
        )}

        {/* Version history */}
        <HistoryModal
          open={showHistory}
          onClose={() => setShowHistory(false)}
          writing={openWriting}
          currentContent={editedContent}
          currentTitle={editedTitle}
          onRestored={({ title, content, wordCount }) => {
            const restoredId = openWriting.id;
            setEditedTitle(title);
            setEditedContent(content);
            setOpenWriting({ ...openWriting, title, content, wordCount });
            editorRef.current = {
              ...editorRef.current,
              content,
              title,
              savedContent: content,
              savedTitle: title,
              savedWordCount: wordCount,
            };
            clearWritingRecoveryDraft(projectId, restoredId);
            setRecoveredDraft(false);
            setSaveError(null);
            setSaveState('saved');
            setShowHistory(false);
            // A restore writes the row without going through this session, so
            // the version token it is holding is now a version behind. Read the
            // new one back rather than guessing at it: leaving it stale would
            // make the next flush report a conflict that never happened, and
            // guessing would put the guard back to sleep.
            void getWritingVersion(restoredId)
              .then((version) => {
                const s = editorRef.current;
                if (version === undefined || s.openId !== restoredId) return;
                s.savedVersion = version;
              })
              .catch(err => console.error('[writings] could not re-read the restored version', err));
          }}
        />

        {/* Export this writing. Mounted only while open so it re-seeds on the
            chapter the author is in, not the one it first opened on. */}
        {showExport && (
          <PublishingProfileModal
            key={openWriting.id}
            open
            onClose={() => setShowExport(false)}
            project={{ id: projectId, title: projectTitle }}
            writings={writings}
            variant="quick"
            titleOverride={exportTitle}
            initialProfile={singleWritingProfile}
          />
        )}

        {confirmDeleteDialog}
        {confirmLeaveDialog}
        {recoveryConflictDialog}
      </>
    );

    return focusMode ? (
      <div className="fixed inset-0 z-40 overflow-y-auto bg-deep">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">{editorBody}</div>
      </div>
    ) : (
      <div className="space-y-4">{editorBody}</div>
    );
  }

  // ---- List View ----
  return (
    <div className="space-y-5">
      {/* Getting Started checklist — auto-hides outside essentials mode */}
      <GettingStartedChecklist projectId={projectId} />

      {/* Status tabs, with "All" first: the manuscript in reading order, the
          one list where marking chapter 3 finished leaves it beside 2 and 4.
          Wrapping since the manuscript-import control joined the row: on a
          narrow window the last button must move to a second line rather than
          off the edge of the panel. */}
      <div className="flex flex-wrap items-center gap-2">
        {LIST_TABS.map(([st, cfg]) => {
          const Icon = cfg.icon;
          return (
            <button
              key={st}
              onClick={() => setActiveStatus(st)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm transition ${
                activeStatus === st
                  ? 'font-semibold border'
                  : 'text-text-muted hover:text-text-primary hover:bg-elevated border border-transparent'
              }`}
              style={activeStatus === st ? { color: cfg.color, backgroundColor: cfg.bg, borderColor: `${cfg.color}30` } : {}}
            >
              <Icon size={16} />
              {st === 'all' ? t('common.all') : statusLabel(st)}
              <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
                activeStatus === st ? 'opacity-80' : 'bg-elevated'
              }`}>
                {counts[st]}
              </span>
            </button>
          );
        })}

        <div className="flex-1" />

        {/* The same sprint control the editor carries. A sprint runs across the
            whole project, so walking back to the list to open another chapter
            must not be where the countdown disappears. */}
        <SprintControl projectId={projectId} getProjectWords={getProjectWords} />

        {/* Read what is in this tab, in manuscript order, as one scroll. */}
        <button
          onClick={handleReadList}
          disabled={filtered.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 border border-border text-text-muted text-sm rounded-lg hover:text-accent-gold hover:border-accent-gold/40 transition disabled:opacity-40 disabled:hover:text-text-muted disabled:hover:border-border"
          title={t('writings.reading.hint')}
        >
          <BookOpen size={16} />
          {t('writings.reading.button')}
        </button>

        {/* The way in for a book that already exists — a .docx, a folder of
            Markdown chapters, or the whole thing pasted. Never disabled: an
            empty project is the case it was built for. */}
        <button
          onClick={() => setShowManuscriptImport(true)}
          className="flex items-center gap-1.5 px-3 py-2 border border-border text-text-muted text-sm rounded-lg hover:text-accent-gold hover:border-accent-gold/40 transition"
          title={t('writings.manuscriptImport.hint')}
        >
          <BookUp size={16} />
          {t('writings.manuscriptImport.button')}
        </button>

        {/* The tidy-up an import leaves behind: it appends its chapters after
            the highest number the project already used, so a novel brought
            into six scratch drafts arrives as 7..46. Sits beside the import
            button because that is where the writer will be looking for it, and
            disables itself the moment the book already reads 1..n. */}
        <button
          onClick={() => setConfirmRenumber(true)}
          disabled={orderBusy || renumberPlan.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 border border-border text-text-muted text-sm rounded-lg hover:text-accent-gold hover:border-accent-gold/40 transition disabled:opacity-40 disabled:hover:text-text-muted disabled:hover:border-border"
          title={t('writings.chapterOrder.renumberHint')}
        >
          <ListOrdered size={16} />
          {t('writings.chapterOrder.renumber')}
        </button>

        <button
          onClick={() => setShowCompile(true)}
          className="flex items-center gap-1.5 px-3 py-2 border border-border text-text-muted text-sm rounded-lg hover:text-accent-gold hover:border-accent-gold/40 transition"
          title={t('writings.compile.hint')}
        >
          <BookDown size={16} />
          {t('writings.compile.button')}
        </button>

        <button
          onClick={() => setShowGooglePicker(true)}
          className="flex items-center gap-1.5 px-3 py-2 border border-border text-text-muted text-sm rounded-lg hover:text-blue-400 hover:border-blue-400/30 transition"
        >
          <Cloud size={16} />
          {t('writings.googleDocs')}
        </button>

        <button
          onClick={() => { setNewStatus(newWritingStatus); setShowCreateForm(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition"
        >
          <Plus size={16} />
          {t('writings.newWriting')}
        </button>
      </div>

      {/* What moved lately — the question the manuscript order cannot answer. */}
      <RecentlyChanged projectId={projectId} writings={writings} onOpen={handleOpenRecent} />

      {/* List */}
      {filtered.length === 0 && (
        <EmptyState
          icon={<FileText size={40} />}
          title={
            activeStatus === 'all'
              ? t('writings.noWritings')
              : activeStatus === 'idea'
              ? t('writings.noIdeas')
              : activeStatus === 'draft'
              ? t('writings.noDrafts')
              : t('writings.noFinished')
          }
          message={
            activeStatus === 'all'
              ? t('writings.noWritings.message')
              : activeStatus === 'idea'
              ? t('writings.noIdeas.message')
              : activeStatus === 'draft'
              ? t('writings.noDrafts.message')
              : t('writings.noFinished.message')
          }
          action={{ label: t('writings.createOne'), onClick: () => { setNewStatus(newWritingStatus); setShowCreateForm(true); } }}
        />
      )}

      {/* Second half of the empty state: not everyone starts from a blank
          page. Sits under the empty list, where a writer holding a finished
          .docx is looking. */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center gap-2 -mt-8 pb-4 text-center">
          <p className="text-sm text-text-muted">{t('writings.manuscriptImport.emptyPrompt')}</p>
          <button
            onClick={() => setShowManuscriptImport(true)}
            className="flex items-center gap-1.5 px-4 py-2 border border-border text-text-muted text-sm rounded-lg hover:text-accent-gold hover:border-accent-gold/40 transition"
          >
            <BookUp size={16} />
            {t('writings.manuscriptImport.button')}
          </button>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="space-y-2">
          <AnimatePresence>
            {filtered.map((writing, i) => {
              const cfg = STATUS_CONFIG[writing.status];
              // Where this chapter sits in the whole book. `undefined` for a
              // writing that carries no number: an idea with no chapter is not
              // chapter zero, and giving it one is the writer's decision, not
              // an arrow's.
              const chapterAt = wholeBookIsVisible ? manuscriptIndex.get(writing.id) : undefined;
              return (
                <motion.div
                  key={writing.id}
                  className="w-full p-4 bg-surface border border-border rounded-xl hover:border-accent-gold/40 transition group flex items-start gap-4"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  {/* Reordering, without a drag. Dim rather than hidden until
                      hover, unlike the actions on the right: these arrows are
                      the only thing on screen that says the manuscript can be
                      rearranged at all. They cannot live inside the button
                      that opens the chapter — a button does not nest — so they
                      sit before it, against the number they change. */}
                  {chapterAt !== undefined && (
                    <div className="flex flex-col items-center flex-shrink-0 -mr-2 -my-1">
                      <button
                        type="button"
                        onClick={() => void handleMoveChapter(writing.id, -1)}
                        disabled={orderBusy || chapterAt === 0}
                        title={t('writings.chapterOrder.moveUp')}
                        aria-label={t('writings.chapterOrder.moveUp')}
                        className="p-1 rounded text-text-dim opacity-60 group-hover:opacity-100 group-focus-within:opacity-100 transition hover:bg-elevated hover:text-accent-gold disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-text-dim"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMoveChapter(writing.id, 1)}
                        disabled={orderBusy || chapterAt === manuscriptOrder.length - 1}
                        title={t('writings.chapterOrder.moveDown')}
                        aria-label={t('writings.chapterOrder.moveDown')}
                        className="p-1 rounded text-text-dim opacity-60 group-hover:opacity-100 group-focus-within:opacity-100 transition hover:bg-elevated hover:text-accent-gold disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-text-dim"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => handleOpenWriting(writing)}
                    className="flex flex-1 min-w-0 items-start gap-4 text-left"
                  >
                    {/* Chapter number or icon */}
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: cfg.bg }}>
                      {writing.chapter !== undefined ? (
                        <span className="font-serif font-bold text-sm" style={{ color: cfg.color }}>
                          {writing.chapter}
                        </span>
                      ) : (
                        <cfg.icon size={18} style={{ color: cfg.color }} />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="font-serif font-bold text-text-primary group-hover:text-accent-gold transition truncate">
                        {writing.title}
                      </h3>
                      <div className="flex items-center gap-3 mt-1">
                        {writing.synopsis && (
                          <p className="text-xs text-text-muted truncate max-w-xs">{writing.synopsis}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span className="text-[10px] text-text-dim">
                          {writing.wordCount.toLocaleString()} {t('writings.words')}
                        </span>
                        <span className="text-[10px] text-text-dim">
                          {t('writings.updated')} {new Date(writing.updatedAt).toLocaleDateString()}
                        </span>
                        {writing.isGoogleDoc && (
                          <GoogleDocBadge compact />
                        )}
                        {writing.tags.length > 0 && (
                          <div className="flex gap-1">
                            {writing.tags.filter(t => t !== 'google-doc').slice(0, 3).map(tag => (
                              <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-elevated rounded text-text-dim">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setCardMenuId(cardMenuId === writing.id ? null : writing.id);
                      }}
                      className="p-1.5 hover:bg-elevated rounded-lg transition"
                      title={t('writings.cardActions')}
                      aria-label={t('writings.cardActions')}
                    >
                      <ArrowRightLeft size={14} className="text-text-muted" aria-hidden="true" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setPendingDeleteId(writing.id); }}
                      className="p-1.5 hover:bg-danger/20 rounded-lg transition"
                      title={t('common.delete')}
                    >
                      <Trash2 size={14} className="text-danger" />
                    </button>

                    {/* Status action popover */}
                    {cardMenuId === writing.id && (
                      <div
                        className="absolute right-0 top-full mt-2 z-50 bg-surface border border-border/80 rounded-2xl shadow-2xl w-64 overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 pt-3 pb-2">
                          <span className="text-xs font-semibold text-text-primary">{t('writings.moveOrCopy')}</span>
                          <button
                            onClick={() => setCardMenuId(null)}
                            className="p-1 hover:bg-elevated rounded-lg transition"
                          >
                            <X size={12} className="text-text-dim" />
                          </button>
                        </div>

                        {/* Move section */}
                        <div className="px-4 pb-3">
                          <p className="text-[10px] uppercase tracking-widest text-text-dim font-semibold mb-2">
                            <ArrowRightLeft size={10} className="inline mr-1 -mt-px" />
                            {t('writings.moveTo')}
                          </p>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(Object.entries(STATUS_CONFIG) as [WritingStatus, typeof STATUS_CONFIG['idea']][]).map(([st, stCfg]) => {
                              const StIcon = stCfg.icon;
                              const isCurrent = writing.status === st;
                              return (
                                <button
                                  key={st}
                                  disabled={isCurrent}
                                  onClick={() => {
                                    handleStatusChange(writing.id, st);
                                    setCardMenuId(null);
                                  }}
                                  className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl text-[11px] transition ${
                                    isCurrent
                                      ? 'font-semibold ring-1'
                                      : 'text-text-muted hover:bg-elevated'
                                  }`}
                                  style={isCurrent
                                    ? { color: stCfg.color, backgroundColor: stCfg.bg, boxShadow: `inset 0 0 0 1px ${stCfg.color}40` }
                                    : {}
                                  }
                                >
                                  <StIcon size={16} />
                                  {statusLabel(st)}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Divider */}
                        <div className="border-t border-border/60 mx-4" />

                        {/* Copy section */}
                        <div className="px-4 pt-3 pb-3">
                          <p className="text-[10px] uppercase tracking-widest text-text-dim font-semibold mb-2">
                            <Copy size={10} className="inline mr-1 -mt-px" />
                            {t('writings.copyTo')}
                          </p>
                          <div className="grid grid-cols-3 gap-1.5">
                            {(Object.entries(STATUS_CONFIG) as [WritingStatus, typeof STATUS_CONFIG['idea']][]).map(([st, stCfg]) => {
                              const StIcon = stCfg.icon;
                              return (
                                <button
                                  key={st}
                                  onClick={() => {
                                    handleDuplicate(writing, st);
                                    setCardMenuId(null);
                                  }}
                                  className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl text-[11px] text-text-muted hover:bg-elevated transition"
                                >
                                  <StIcon size={16} />
                                  {statusLabel(st)}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Divider */}
                        <div className="border-t border-border/60 mx-4" />

                        {/* Send section — this chapter as a file, in one press
                            and without the publishing studio. The third thing
                            a writer does to a single chapter, so it takes the
                            same grid as moving and copying rather than a
                            second menu on the same card. */}
                        <div className="px-4 pt-3 pb-4">
                          <p className="text-[10px] uppercase tracking-widest text-text-dim font-semibold mb-2">
                            <FileDown size={10} className="inline mr-1 -mt-px" />
                            {t('writings.chapterExport.section')}
                          </p>
                          <div className="grid grid-cols-3 gap-1.5">
                            {CHAPTER_EXPORT_FORMATS.map(({ output, icon: FormatIcon, labelKey }) => (
                              <button
                                key={output}
                                onClick={() => startChapterExport(writing, output)}
                                title={t('writings.chapterExport.hint')}
                                className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl text-[11px] text-text-muted hover:bg-elevated transition"
                              >
                                <FormatIcon size={16} />
                                {t(labelKey)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Create Modal */}
      <Modal open={showCreateForm} onClose={() => setShowCreateForm(false)} title={t('writings.newWriting')}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('common.title')}</label>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t('writings.titlePlaceholder')}
              className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition font-serif text-lg"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
            />
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('writings.category')}</label>
            <div className="flex gap-2">
              {(Object.entries(STATUS_CONFIG) as [WritingStatus, typeof STATUS_CONFIG['idea']][]).map(([st, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <button
                    key={st}
                    onClick={() => setNewStatus(st)}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm transition border ${
                      newStatus === st
                        ? 'font-semibold'
                        : 'border-border text-text-muted hover:text-text-primary'
                    }`}
                    style={newStatus === st ? { color: cfg.color, backgroundColor: cfg.bg, borderColor: `${cfg.color}30` } : {}}
                  >
                    <Icon size={16} />
                    {statusLabel(st)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-muted mb-1.5">{t('writings.chapterOptional')}</label>
              <input
                value={newChapter}
                onChange={(e) => setNewChapter(e.target.value.replace(/\D/g, ''))}
                placeholder={t('writings.chapterExample')}
                className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              />
            </div>
            <div>
              <label className="block text-sm text-text-muted mb-1.5">{t('writings.synopsisOptional')}</label>
              <input
                value={newSynopsis}
                onChange={(e) => setNewSynopsis(e.target.value)}
                placeholder={t('writings.synopsisPlaceholder')}
                className="w-full px-4 py-2.5 bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1.5">{t('common.tags')}</label>
            <TagInput tags={newTags} onChange={setNewTags} />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={() => void handleCreate()}
              className="flex-1 py-2.5 bg-accent-gold text-deep font-semibold rounded-lg hover:bg-accent-amber transition"
            >
              {t('common.create')}
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-6 py-2.5 border border-border text-text-muted rounded-lg hover:bg-elevated transition"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Google Docs Picker.
          Mounted conditionally on purpose: kept always-mounted it retained the
          previous search text and selection from one open to the next — its
          load effect only refires on open/auth changes, never resetting state.
          Unmounting on close is the same remount pattern the fact/panel
          editors use. */}
      {showGooglePicker && (
        <GoogleDocsPicker
          open={showGooglePicker}
          onClose={() => setShowGooglePicker(false)}
          projectId={projectId}
          existingWritings={writings}
          onImported={() => {
            void onRefresh?.();
          }}
        />
      )}

      {/* Import an existing manuscript. Mounted only while open, like the
          Google Docs picker: closing is how its parse, its preview and its
          chosen splitting rule are thrown away. */}
      {showManuscriptImport && (
        <ManuscriptImportModal
          open
          onClose={() => setShowManuscriptImport(false)}
          projectId={projectId}
          onImported={async () => {
            await onRefresh?.();
          }}
        />
      )}

      {/* Compile / Export manuscript */}
      <CompileModal
        open={showCompile}
        onClose={() => setShowCompile(false)}
        writings={writings}
        projectId={projectId}
        projectTitle={projectTitle}
      />

      {/* Renumbering is asked for, never inferred. 1, 5, 10 can be act
          numbering the writer chose, and the message says exactly how many
          chapters are in scope and what stays untouched. */}
      <ConfirmDialog
        open={confirmRenumber}
        title={t('writings.chapterOrder.renumberTitle')}
        message={t('writings.chapterOrder.renumberConfirm').replace('{count}', String(manuscriptOrder.length))}
        confirmLabel={t('writings.chapterOrder.renumber')}
        onConfirm={() => void handleRenumber()}
        onCancel={() => setConfirmRenumber(false)}
      />

      {/* The only thing standing between a mistyped click and a beta reader
          opening an empty file. Not destructive — the confirm button says what
          it does rather than warning about it. */}
      <ConfirmDialog
        open={pendingChapterExport !== null}
        title={t('writings.chapterExport.emptyTitle')}
        message={t('writings.chapterExport.emptyConfirm').replace('{name}', pendingChapterExport?.title ?? '')}
        confirmLabel={t('writings.chapterExport.exportAnyway')}
        onConfirm={() => {
          const pending = pendingChapterExport;
          setPendingChapterExport(null);
          if (pending) void runChapterExport(pending.ids, pending.output);
        }}
        onCancel={() => setPendingChapterExport(null)}
      />

      {confirmDeleteDialog}
    </div>
  );
}
