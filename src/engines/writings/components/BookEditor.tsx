// ============================================
// The whole book in one editor
// ============================================
//
// Every numbered chapter of the project, one after another in one Tiptap
// document, with a `ChapterHeadingNode` where each chapter starts. What the
// writer gets is Word's way of working: Heading 1 is a chapter, and the
// chapters are made, moved and folded into each other by editing the text.
// What the app keeps is the same one-row-per-chapter it always had: the
// autosave cuts the document back into sections and writes only the rows
// that moved (`bookSave.ts`), so the list, the reading view, the exports and
// the copilot all see ordinary chapters.
//
// The editor is remounted (a new `key`) whenever the range or the rows it
// was built from change, and its `content` prop never changes while it is
// mounted. That is what keeps this view out of the trap the single-chapter
// editor documents on its own `key`: a `setContent` on a live editor lands on
// the undo stack, and it would also have to get past the heading guard.

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { AnyExtension, Editor } from '@tiptap/react';
import { Fragment } from '@tiptap/pm/model';
import { createDocument } from '@tiptap/core';
import {
  AlignJustify,
  ArrowLeft,
  Check,
  CircleAlert,
  File,
  Heading1,
  LoaderCircle,
  PenLine,
  Superscript,
  Undo2,
  X,
} from 'lucide-react';
import type { FootnoteMarkerStyle, FootnotePlacement, Writing } from '@/types';
import { db } from '@/db';
import { updateProject } from '@/db/operations';
import { countWords } from '@/utils/text';
import { isDesktop } from '@/utils/platform';
import TiptapEditor from '@/components/editor/TiptapEditor';
import { FootnoteNode } from '@/components/editor/footnotes/FootnoteNode';
import FootnotesPanel from '@/components/editor/footnotes/FootnotesPanel';
import { collectFootnotes } from '@/components/editor/footnotes/footnoteModel';
import type { PageLayoutOptions, PageNote } from '@/components/editor/pageMode/PageLayout';
import { useAppStore } from '@/stores/appStore';
import { usePageCount } from '@/components/editor/pageMode/usePageCount';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  BookDocument,
  ChapterHeadingNode,
  type ChapterMoveDirection,
} from '@/components/editor/chapterHeading/ChapterHeadingNode';
import {
  CHAPTER_HEADING_NAME,
  chapterBlocks,
  freshClientId,
  previousHeadingPos,
} from '@/components/editor/chapterHeading/chapterBlocks';
import { ConfirmDialog, onDataChanged } from '@/engines/_shared';
import { toast } from '@/components/common/toast';
import { t as translateNow, useTranslation } from '@/i18n/useTranslation';
import {
  closeAppWindow,
  keepAppWindow,
  registerCloseGuard,
  reportUnsavedWork,
} from '@/services/closeGuard';
import { numberedInOrder } from '../chapterOrder';
import { canonicalHtml, composeBookHtml, normalizeHtml, splitBookDoc } from '../bookDocument';
import { saveBook, type BookBaseline, type BookBaselineEntry, type BookConflict } from '../bookSave';
import {
  restoreDeletedWriting,
  takeLastDeletedWriting,
  updateWritingAtVersion,
  type DeletedWritingBundle,
} from '../operations';
import { writeWritingRecoveryDraft } from '../recoveryJournal';
import { takeSnapshot } from '../snapshots';

/** Debounce for the autosave (ms) — the single-chapter editor's. */
const AUTOSAVE_MS = 1200;
/** A book this size or smaller opens whole. */
const WHOLE_BOOK_MAX_CHAPTERS = 60;
const WHOLE_BOOK_MAX_WORDS = 120_000;
/** A bigger book opens on its first chapters, with the range selector to widen. */
const LARGE_BOOK_OPENING = 20;
/** Whether the footnotes panel is open, remembered per browser. */
const NOTES_OPEN_KEY = 'writers-hoard:book:notesOpen';

function readNotesOpen(): boolean {
  try {
    return window.localStorage.getItem(NOTES_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeNotesOpen(open: boolean): void {
  try {
    window.localStorage.setItem(NOTES_OPEN_KEY, open ? '1' : '0');
  } catch {
    // A blocked store only forgets the preference.
  }
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

interface BookRange {
  fromId: string;
  toId: string;
}

/** What the heading node asks the host to do. Read through a ref, so the
 * node configured once per mount always reaches the current handlers. */
interface HostCallbacks {
  onOpenChapter: (writingId: string) => void;
  onMergeWithPrevious: (pos: number) => void;
  onMoveChapter: (pos: number, direction: ChapterMoveDirection) => void;
  onRemovalRefused: () => void;
}

/** The rows the mounted editor was built from, and the key that names them. */
interface LoadedBook {
  key: string;
  html: string;
  /** Built with the rows, outside render: the editor reads them once. */
  extensions: AnyExtension[];
  rows: Writing[];
  firstChapter: number;
  outsideChapters: Set<number>;
  truncated: boolean;
}

/** The chapter the merge dialog is asking about. */
interface PendingMerge {
  pos: number;
  writingId: string;
  title: string;
  previousId: string | null;
  previousTitle: string;
}

/**
 * What a merge took away, held for thirty seconds: the row that went, and the
 * chapter that absorbed its prose as it stood BEFORE the merge, so undo puts
 * both halves back rather than leaving the prose in two places.
 */
interface MergeUndo {
  bundle: DeletedWritingBundle;
  absorber: { id: string; entry: BookBaselineEntry } | null;
}

interface BookSession {
  /** The `LoadedBook.key` this baseline was built for. */
  key: string | null;
  baseline: BookBaseline;
  confirmedDeletes: Set<string>;
  contested: Map<string, BookConflict>;
  dirty: boolean;
  savePromise: Promise<boolean> | null;
  timer: number | null;
  firstChapter: number;
  outsideChapters: Set<number>;
  /**
   * A change notice arrived while a save was in the air. The save is the
   * better judge of THAT write, but a notice is not only about our rows —
   * so the open chapters are re-read once the save has landed.
   */
  pendingRecheck: boolean;
  /**
   * This view is about to reload the book itself (undoing a merge from the
   * bar): the notices its own writes raise are not somebody else's change.
   */
  reloading: boolean;
}

interface BookEditorProps {
  projectId: string;
  writings: Writing[];
  /** Refetch the chapter list; awaited when it answers with a promise, so a caller that follows a save sees the rows it wrote. */
  onRefresh: () => void | Promise<void>;
  onClose: () => void;
  onOpenChapter: (id: string) => void;
  /** The manuscript's footnote marker style; numbers when absent. */
  footnoteStyle?: FootnoteMarkerStyle;
  /**
   * Where the exports put the notes (`Project.footnotePlacement`). With
   * `chapter` the book's numbers — in the prose and in the panel — start
   * again at each chapter heading, as each exported chapter's do; with
   * `book` they run on through the whole book.
   */
  footnotePlacement?: FootnotePlacement;
}

/** The book's footnotes, for the page layout to print at the foot of each sheet. */
const collectPageNotes = (doc: ProseMirrorNode): PageNote[] =>
  collectFootnotes(doc).map((note) => ({ pos: note.pos, text: note.text }));

function newSession(): BookSession {
  return {
    key: null,
    baseline: new Map(),
    confirmedDeletes: new Set(),
    contested: new Map(),
    dirty: false,
    savePromise: null,
    timer: null,
    firstChapter: 1,
    outsideChapters: new Set(),
    pendingRecheck: false,
    reloading: false,
  };
}

/** The range a book opens on: all of it when it is small enough to hold. */
function defaultRange(numbered: readonly Writing[]): BookRange | null {
  if (numbered.length === 0) return null;
  const words = numbered.reduce((sum, row) => sum + (row.wordCount || 0), 0);
  const whole = numbered.length <= WHOLE_BOOK_MAX_CHAPTERS && words <= WHOLE_BOOK_MAX_WORDS;
  const last = whole ? numbered[numbered.length - 1] : numbered[Math.min(LARGE_BOOK_OPENING, numbered.length) - 1];
  return { fromId: numbered[0].id, toId: last.id };
}

/**
 * Which book an editor was built for. The heading extension is configured
 * once per load and handed to the editor whole, so its identity says which
 * `LoadedBook` the editor belongs to — a key the editor itself carries, with
 * no callback that has to know it.
 */
function editorHolds(editor: Editor, book: LoadedBook): boolean {
  return editor.extensionManager.extensions.includes(book.extensions[0]);
}

/**
 * The extensions, configured once per mount; every callback reads the host's
 * current handler. The chapter node stays first: `editorHolds` identifies the
 * book by it. The book's document node lets the top level hold chapters
 * (and nothing below it can). Footnotes are part of the schema so a
 * chapter's notes survive the round trip through the book — without the
 * node, `<sup>` is unknown to StarterKit and the notes would be flattened
 * away on the first save.
 */
function bookExtensions(host: RefObject<HostCallbacks | null>): AnyExtension[] {
  return [
    ChapterHeadingNode.configure({
      onOpenChapter: (writingId) => host.current?.onOpenChapter(writingId),
      onMergeWithPrevious: (pos) => host.current?.onMergeWithPrevious(pos),
      onMoveChapter: (pos, direction) => host.current?.onMoveChapter(pos, direction),
      onRemovalRefused: () => host.current?.onRemovalRefused(),
    }),
    BookDocument,
    FootnoteNode,
  ];
}

// Module scope, like the single-chapter editor's ToolButton: a component
// declared inside another remounts on every render.
function ChapterToolButton({ editor, title, label }: { editor: Editor | null; title: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => editor?.chain().focus().setChapterHeading().run()}
      disabled={!editor}
      title={title}
      className="flex items-center gap-1 px-2 py-1.5 rounded text-xs text-text-muted hover:text-text-primary hover:bg-elevated transition disabled:opacity-50"
    >
      <Heading1 size={16} />
      {label}
    </button>
  );
}

export default function BookEditor({
  projectId,
  writings,
  onRefresh,
  onClose,
  onOpenChapter,
  footnoteStyle = 'numbers',
  footnotePlacement = 'chapter',
}: BookEditorProps) {
  const { t, locale } = useTranslation();
  // Flow or Word-style sheets, from the writer's reading preferences. The
  // editor swaps the page plugin on the live document, so a change of layout
  // or paper never remounts it — and never loses what is not saved yet.
  const readingPrefs = useAppStore((s) => s.reading);
  const setReadingPrefs = useAppStore((s) => s.setReading);
  const pageLayout: PageLayoutOptions = {
    pageSize: readingPrefs.pageSize,
    collectNotes: collectPageNotes,
    footerLabel: (page, total) =>
      t('editor.page.footer').replace('{page}', String(page)).replace('{total}', String(total)),
  };
  const numbered = numberedInOrder(writings);
  const unnumberedCount = writings.length - numbered.length;

  const [range, setRange] = useState<BookRange | null>(() => defaultRange(numbered));
  // Chapters can be numbered while the book view is open; the first time any
  // exist, the book opens on them (render-adjust, not an effect).
  if (range === null && numbered.length > 0) setRange(defaultRange(numbered));

  const [generation, setGeneration] = useState(0);
  const [loaded, setLoaded] = useState<LoadedBook | null>(null);
  // The setter goes straight to `onEditorReady`: it has to be the same
  // function on every render, or the child's effect tears down and re-hands
  // the editor on each one and the two never settle.
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const pageCount = usePageCount(editorInstance);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ writingId: string; kind: BookConflict['kind']; title: string } | null>(null);
  const [pendingMerge, setPendingMerge] = useState<PendingMerge | null>(null);
  // What the writer was leaving for when the save refused: closing the book,
  // or opening one chapter on its own. Held so "leave anyway" does that and
  // not something else.
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [pendingClose, setPendingClose] = useState(false);
  const [undo, setUndo] = useState<MergeUndo | null>(null);
  const [rangeWords, setRangeWords] = useState(0);
  // The footnotes panel beside the book, as the chapter editor shows it.
  const [notesOpen, setNotesOpen] = useState(readNotesOpen);
  const toggleNotes = () => {
    const next = !notesOpen;
    setNotesOpen(next);
    writeNotesOpen(next);
  };
  // The marker style is the manuscript's, kept on the project row: the same
  // write the single-chapter editor makes, so both views change one thing.
  const handleFootnoteStyle = (style: FootnoteMarkerStyle) => {
    void updateProject(projectId, { footnoteStyle: style }).catch((error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    });
  };
  const handleFootnotePlacement = (placement: FootnotePlacement) => {
    void updateProject(projectId, { footnotePlacement: placement }).catch((error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    });
  };

  const sessionRef = useRef<BookSession>(newSession());
  const editorRef = useRef<Editor | null>(null);
  const loadedRef = useRef<LoadedBook | null>(null);
  const onRefreshRef = useRef(onRefresh);
  const mountedRef = useRef(true);
  // The absorber of the merge being confirmed, kept until its deletion lands.
  const mergeAbsorberRef = useRef<Map<string, MergeUndo['absorber']>>(new Map());
  // The heading node's callbacks, assigned below once the handlers exist.
  const hostRef = useRef<HostCallbacks | null>(null);

  useEffect(() => {
    editorRef.current = editorInstance;
  }, [editorInstance]);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  // ---------------------------------------------------------------------
  // Loading the range. Read from Dexie rather than from the `writings` prop:
  // the prop is the list's last refetch, and a reload after somebody else's
  // write must see their row, not the one the list had.
  // ---------------------------------------------------------------------
  const fromId = range?.fromId ?? null;
  const toId = range?.toId ?? null;
  useEffect(() => {
    if (!fromId || !toId) return;
    let cancelled = false;
    void db.writings
      .where('projectId')
      .equals(projectId)
      .toArray()
      .then(async (all) => {
        if (cancelled) return;
        const ordered = numberedInOrder(all);
        const start = Math.max(0, ordered.findIndex((row) => row.id === fromId));
        const endAt = ordered.findIndex((row) => row.id === toId);
        const end = endAt < start ? ordered.length - 1 : endAt;
        const rows = ordered.slice(start, end + 1);
        if (rows.length === 0) return;
        const outsideChapters = new Set<number>();
        ordered.forEach((row, index) => {
          if (index < start || index > end) outsideChapters.add(row.chapter);
        });
        const wholeBook = start === 0 && end === ordered.length - 1;
        const suggested = defaultRange(ordered);
        const next: LoadedBook = {
          key: `${generation}:${rows.map((row) => row.id).join('|')}`,
          html: composeBookHtml(rows),
          extensions: bookExtensions(hostRef),
          rows,
          firstChapter: wholeBook ? 1 : rows[0].chapter,
          outsideChapters,
          truncated:
            !wholeBook && suggested !== null && suggested.fromId === fromId && suggested.toId === toId,
        };
        setLoaded(next);
        setRangeWords(rows.reduce((sum, row) => sum + (row.wordCount || countWords(row.content)), 0));
        setSaveState('saved');
        setSaveError(null);
        setConflict(null);
        // One automatic restore point per chapter per session, as opening a
        // chapter alone would take. Sequential and in the background: the
        // dedupe makes a reopened, unchanged book cost one keyed read each.
        for (const row of rows) {
          if (cancelled) return;
          await takeSnapshot(row, 'auto');
        }
      })
      .catch((err) => console.error('[book] could not load the chapters', err));
    return () => {
      cancelled = true;
    };
  }, [projectId, fromId, toId, generation]);

  // ---------------------------------------------------------------------
  // The session baseline: the rows as this editor was built from them, each
  // one's prose in the editor's own spelling. Built when first needed, because
  // it needs the schema of the editor that holds the document.
  // ---------------------------------------------------------------------
  const ensureSession = (editor: Editor, book: LoadedBook): BookSession => {
    const session = sessionRef.current;
    if (session.key === book.key) return session;
    const baseline: BookBaseline = new Map();
    for (const row of book.rows) {
      baseline.set(row.id, {
        title: row.title,
        html: canonicalHtml(row.content, editor.schema),
        persisted: row.content,
        version: row.updatedAt,
        chapter: row.chapter ?? 0,
        wordCount: row.wordCount || countWords(row.content),
      });
    }
    const fresh = newSession();
    fresh.key = book.key;
    fresh.baseline = baseline;
    fresh.firstChapter = book.firstChapter;
    fresh.outsideChapters = book.outsideChapters;
    sessionRef.current = fresh;
    mergeAbsorberRef.current = new Map();
    return fresh;
  };

  /**
   * The editor that holds the loaded book, or null while the two disagree.
   * A destroyed editor still qualifies: its document is readable after
   * `destroy()`, and the unmount flush needs it whether React tore the child
   * down before this component's cleanup or after. Only what DISPATCHES to
   * the editor checks `isDestroyed`.
   */
  const liveEditor = (): { editor: Editor; book: LoadedBook } | null => {
    const editor = editorRef.current;
    const book = loadedRef.current;
    if (!editor || !book || !editorHolds(editor, book)) return null;
    return { editor, book };
  };

  /**
   * Put the save's results back into the document: the ids of rows it
   * created on their headings, the chapter numbers it settled, and the
   * headings it refused to let go. One transaction, off the undo stack and
   * silent to `onUpdate` — nothing here is an edit of the writer's.
   */
  const applySaveToEditor = (
    editor: Editor,
    session: BookSession,
    created: { clientId: string | null; writingId: string; chapter: number }[],
    refusedMissing: string[],
  ): void => {
    const { schema } = editor;
    const type = schema.nodes[CHAPTER_HEADING_NAME];
    if (!type) return;
    const tr = editor.state.tr;
    const byClientId = new Map(created.filter((row) => row.clientId).map((row) => [row.clientId, row]));
    let prelude: (typeof created)[number] | null = created.find((row) => row.clientId === null) ?? null;

    editor.state.doc.forEach((node, pos) => {
      if (node.type !== type) return;
      const clientId = typeof node.attrs.clientId === 'string' ? node.attrs.clientId : null;
      const fresh = clientId ? byClientId.get(clientId) : undefined;
      const writingId = fresh?.writingId ?? (typeof node.attrs.writingId === 'string' ? node.attrs.writingId : null);
      const entry = writingId ? session.baseline.get(writingId) : undefined;
      const chapter = entry?.chapter ?? fresh?.chapter ?? null;
      if (writingId !== node.attrs.writingId || chapter !== node.attrs.chapter) {
        tr.setNodeMarkup(tr.mapping.map(pos), undefined, { ...node.attrs, writingId, chapter });
      }
    });

    // Prose above the first heading became a chapter: give it its heading.
    if (prelude) {
      tr.insert(0, type.create({ writingId: prelude.writingId, chapter: prelude.chapter, clientId: freshClientId() }));
      prelude = null;
    }

    // A heading that vanished without a confirmed merge comes back with the
    // chapter as it was last saved, in the place the baseline puts it.
    const order = [...session.baseline.keys()];
    for (const id of refusedMissing) {
      const entry = session.baseline.get(id);
      if (!entry) continue;
      const blocks = chapterBlocks(tr.doc, type);
      const after = order.slice(order.indexOf(id) + 1).find((other) => blocks.some((block) => block.writingId === other));
      const at = after ? (blocks.find((block) => block.writingId === after)?.from ?? tr.doc.content.size) : tr.doc.content.size;
      const heading = type.create(
        { writingId: id, chapter: entry.chapter, clientId: freshClientId() },
        entry.title ? schema.text(entry.title) : undefined,
      );
      tr.insert(at, Fragment.from([heading]).append(createDocument(entry.html, schema).content));
    }

    if (!tr.docChanged) return;
    tr.setMeta('preventUpdate', true);
    tr.setMeta('addToHistory', false);
    editor.view.dispatch(tr);
  };

  // ---------------------------------------------------------------------
  // Somebody else wrote to a chapter that is open here. Clean book: reload
  // and say so. Dirty book: the chapter becomes contested and the banner
  // asks — the same rule the single-chapter editor applies. Called by the
  // change listener below, and by the save loop for a notice it set aside.
  // ---------------------------------------------------------------------
  const recheckOpenChapters = (session: BookSession): void => {
    if (session.reloading) return;
    const ids = [...session.baseline.keys()];
    void db.writings
      .bulkGet(ids)
      .then((rows) => {
        if (!mountedRef.current || sessionRef.current !== session || session.reloading) return;
        // A save started since this read: it will answer, and the read is stale.
        if (session.savePromise) {
          session.pendingRecheck = true;
          return;
        }
        const moved: BookConflict[] = [];
        rows.forEach((row, index) => {
          const id = ids[index];
          const entry = session.baseline.get(id);
          if (!entry || session.contested.has(id)) return;
          if (!row) moved.push({ writingId: id, kind: 'gone' });
          else if (row.updatedAt !== entry.version) moved.push({ writingId: id, kind: 'moved', current: row });
        });
        if (moved.length === 0) return;
        if (!session.dirty && session.contested.size === 0) {
          toast.info(translateNow('writings.book.reloaded'));
          setGeneration((value) => value + 1);
          return;
        }
        for (const found of moved) session.contested.set(found.writingId, found);
        const first = moved[0];
        setSaveState('conflict');
        setConflict({
          writingId: first.writingId,
          kind: first.kind,
          title: session.baseline.get(first.writingId)?.title || translateNow('writings.book.untitledChapter'),
        });
      })
      .catch((err) => console.error('[book] could not re-read the open chapters', err));
  };
  // Reached from the save loop's tail through a ref, like the flush itself.
  const recheckOpenChaptersRef = useRef(recheckOpenChapters);
  useEffect(() => {
    recheckOpenChaptersRef.current = recheckOpenChapters;
  });

  // ---------------------------------------------------------------------
  // Autosave. One promise owns the loop; edits during a write are coalesced
  // into the next pass; the baseline moves only on what Dexie confirmed.
  // Reads everything through refs so the timer and the close guard never see
  // a stale closure.
  // ---------------------------------------------------------------------
  const flushSave = (): Promise<boolean> => {
    const live = liveEditor();
    if (!live) return Promise.resolve(true);
    const session = ensureSession(live.editor, live.book);
    if (session.savePromise) return session.savePromise;
    if (!session.dirty) return Promise.resolve(session.contested.size === 0);
    const { editor } = live;

    const loop = async (): Promise<boolean> => {
      while (session.dirty) {
        session.dirty = false;
        if (mountedRef.current) {
          setSaveError(null);
          setSaveState('saving');
        }
        const sections = splitBookDoc(editor.state.doc, editor.schema);
        let result;
        try {
          result = await saveBook({
            projectId,
            baseline: session.baseline,
            sections,
            confirmedDeletes: session.confirmedDeletes,
            contested: new Set(session.contested.keys()),
            firstChapter: session.firstChapter,
            outsideChapters: session.outsideChapters,
            untitledTitle: translateNow('writings.book.untitledChapter'),
          });
        } catch (err) {
          // Try again on the next edit; the document still holds the text.
          session.dirty = true;
          if (mountedRef.current && sessionRef.current === session) {
            setSaveError(err instanceof Error ? err.message : String(err));
            setSaveState('error');
          }
          return false;
        }
        // The book was swapped out while the write was in the air. Its rows
        // were written; nothing of this session is left to update.
        if (sessionRef.current !== session) return false;

        session.baseline = result.baseline;
        session.outsideChapters = result.outsideChapters;
        for (const bundle of result.deleted) session.confirmedDeletes.delete(bundle.writing.id);
        for (const found of result.conflicts) session.contested.set(found.writingId, found);
        if (!editor.isDestroyed) applySaveToEditor(editor, session, result.created, result.refusedMissing);

        if (mountedRef.current) {
          if (result.restored.length > 0) {
            // The heading came back on its own (Ctrl+Z): the row is restored
            // and the undo bar has nothing left to offer for it.
            setUndo((offer) => (offer && result.restored.includes(offer.bundle.writing.id) ? null : offer));
          }
          if (result.deleted.length > 0) {
            const bundle = result.deleted[0];
            setUndo({ bundle, absorber: mergeAbsorberRef.current.get(bundle.writing.id) ?? null });
            mergeAbsorberRef.current.delete(bundle.writing.id);
            toast.success(translateNow('writings.book.merged').replace('{name}', bundle.writing.title));
          }
          if (result.refusedMissing.length > 0) {
            const names = result.refusedMissing
              .map((id) => session.baseline.get(id)?.title || translateNow('writings.book.untitledChapter'))
              .join(', ');
            toast.info(translateNow('writings.book.restoredHeading').replace('{name}', names));
          }
          if (result.collisions.length > 0) {
            toast.info(
              translateNow('writings.book.collision').replace('{numbers}', result.collisions.join(', ')),
            );
          }
          if (result.wrote) {
            setRangeWords([...session.baseline.values()].reduce((sum, entry) => sum + entry.wordCount, 0));
          }
        }
        if (result.wrote) {
          // Awaited, so a caller that follows the flush ("Open chapter", the
          // Back button) finds the list already refetched.
          try {
            await onRefreshRef.current?.();
          } catch (err) {
            console.warn('[book] the chapter list did not refresh after the save', err);
          }
        }
      }
      const contested = session.contested.size > 0;
      if (mountedRef.current && sessionRef.current === session) {
        if (contested) {
          const first = [...session.contested.values()][0];
          setSaveState('conflict');
          setConflict({
            writingId: first.writingId,
            kind: first.kind,
            title: session.baseline.get(first.writingId)?.title || translateNow('writings.book.untitledChapter'),
          });
        } else if (!session.dirty) {
          setSaveState('saved');
        }
      }
      return !contested;
    };

    session.savePromise = loop().finally(() => {
      session.savePromise = null;
      // A notice that arrived mid-save was set aside, not answered.
      if (session.pendingRecheck) {
        session.pendingRecheck = false;
        recheckOpenChaptersRef.current(session);
      }
    });
    return session.savePromise;
  };

  /**
   * The recovery journal, for the moment the app is closing with a save
   * still to make: every chapter whose text differs from its row goes to the
   * journal the single-chapter editor keeps, against the text the row holds,
   * so a crash on the way out leaves the chapter to reopen with its draft
   * (or with the question, if the row moved meanwhile). Synchronous, like
   * the chapter editor's, because an unload does not wait.
   */
  const journalDirtySections = (): void => {
    const live = liveEditor();
    if (!live) return;
    const session = ensureSession(live.editor, live.book);
    if (!session.dirty) return;
    const untitled = translateNow('writings.book.untitledChapter');
    for (const section of splitBookDoc(live.editor.state.doc, live.editor.schema)) {
      const entry = section.writingId ? session.baseline.get(section.writingId) : undefined;
      if (!section.writingId || !entry) continue;
      // The titles as the save writes them: an empty heading is the untitled row.
      const title = section.title.trim() || untitled;
      const baseTitle = entry.title.trim() || untitled;
      if (title === baseTitle && normalizeHtml(section.html) === normalizeHtml(entry.html)) continue;
      writeWritingRecoveryDraft(projectId, section.writingId, title, section.html, baseTitle, entry.persisted);
    }
  };

  // The unmount, unload, close-guard and shortcut effects below reach the
  // flush through a ref, assigned in an effect because refs may not be
  // written during render — so none of them is rebuilt on a render, and none
  // can hold a stale flush.
  const flushSaveRef = useRef(flushSave);
  const journalRef = useRef(journalDirtySections);
  useEffect(() => {
    flushSaveRef.current = flushSave;
    journalRef.current = journalDirtySections;
  });

  /** Every edit: mark the book dirty and (re)arm the debounce. */
  const handleChange = () => {
    const live = liveEditor();
    if (!live) return;
    const session = ensureSession(live.editor, live.book);
    session.dirty = true;
    setSaveError(null);
    setSaveState((state) => (state === 'conflict' ? state : 'dirty'));
    if (session.timer !== null) window.clearTimeout(session.timer);
    session.timer = window.setTimeout(() => {
      session.timer = null;
      void flushSave();
    }, AUTOSAVE_MS);
  };

  // Flush on unmount (sidebar navigation, a jump from search). Best effort:
  // React is leaving, and the write goes out behind it.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      if (session.timer !== null) {
        window.clearTimeout(session.timer);
        session.timer = null;
      }
      if (session.dirty) void flushSaveRef.current();
    };
  }, []);

  // Flush on unload. The desktop close is answered by the guard below, where
  // there is a dialog to put the reason in; the web build keeps the prompt.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      const session = sessionRef.current;
      if (!session.dirty) return;
      journalRef.current();
      void flushSaveRef.current();
      if (isDesktop()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Closing the desktop window: flush first; only a save that FAILED raises
  // the dialog, and the dialog always has a way out.
  useEffect(() => {
    return registerCloseGuard(async () => {
      const session = sessionRef.current;
      if (!session.dirty && session.contested.size === 0) return true;
      journalRef.current();
      if (await flushSaveRef.current()) return true;
      setPendingClose(true);
      return false;
    });
  }, []);

  const unsaved = saveState !== 'saved';
  useEffect(() => {
    if (!unsaved) {
      reportUnsavedWork(null);
      return;
    }
    reportUnsavedWork({
      title: t('writings.closeWindow.stuckTitle'),
      message: t('writings.book.closeWindow.stuckMessage'),
      closeAnyway: t('writings.closeWindow.close'),
      keepOpen: t('writings.closeWindow.keepOpen'),
    });
    // `locale` and not `t`: the translator is a new function every render.
  }, [unsaved, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl/Cmd+S saves now.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void flushSaveRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    return onDataChanged((detail) => {
      if (detail.projectId && detail.projectId !== projectId) return;
      if (detail.table && detail.table !== 'writings') return;
      const live = liveEditor();
      if (!live) return;
      const session = ensureSession(live.editor, live.book);
      // A flush in the air is the better judge of its own rows: it writes
      // against the baseline, and the compare-and-swap raises the question
      // if it lost. The notice is kept, and answered once the flush lands.
      if (session.savePromise) {
        session.pendingRecheck = true;
        return;
      }
      recheckOpenChaptersRef.current(session);
    });
  }, [projectId]);

  // ---------------------------------------------------------------------
  // Answering the banner.
  // ---------------------------------------------------------------------

  /**
   * Reload the book from disk. What the contested chapters hold here is
   * filed as a version first — the same promise the single-chapter editor
   * makes — and everything that is not contested is written before the
   * reload, so only the contested text leaves the screen.
   */
  const handleReload = async () => {
    const live = liveEditor();
    if (live) {
      const session = ensureSession(live.editor, live.book);
      await flushSave();
      const sections = splitBookDoc(live.editor.state.doc, live.editor.schema);
      for (const [id, found] of session.contested) {
        if (found.kind !== 'moved') continue;
        const section = sections.find((row) => row.writingId === id);
        if (!section) continue;
        await takeSnapshot(
          { id, projectId, title: section.title || found.current.title, content: section.html },
          'manual',
        );
      }
      session.contested.clear();
      session.dirty = false;
    }
    setConflict(null);
    setSaveState('saved');
    setGeneration((value) => value + 1);
  };

  /**
   * Keep what is on screen. The other version is filed, then the baseline is
   * rebased onto the row it lost to, so the next flush wins the
   * compare-and-swap honestly. A row that is gone is simply forgotten by the
   * baseline: its section becomes a chapter to create.
   */
  const handleKeepMine = async () => {
    const live = liveEditor();
    if (!live) return;
    const session = ensureSession(live.editor, live.book);
    for (const [id, found] of session.contested) {
      if (found.kind === 'gone') {
        session.baseline.delete(id);
        continue;
      }
      const filed = await takeSnapshot(
        { id, projectId, title: found.current.title, content: found.current.content },
        'manual',
      );
      if (!filed) {
        toast.error(translateNow('writings.externalChange.filingFailed'));
        return;
      }
      const entry = session.baseline.get(id);
      if (!entry) continue;
      session.baseline.set(id, {
        ...entry,
        title: found.current.title,
        html: canonicalHtml(found.current.content, live.editor.schema),
        persisted: found.current.content,
        version: found.current.updatedAt,
        chapter: found.current.chapter ?? entry.chapter,
      });
    }
    session.contested.clear();
    session.dirty = true;
    setConflict(null);
    void flushSave();
  };

  // ---------------------------------------------------------------------
  // Heading actions.
  // ---------------------------------------------------------------------
  const handleOpenChapter = async (writingId: string) => {
    if (!(await flushSave())) {
      setPendingLeave(() => () => onOpenChapter(writingId));
      return;
    }
    onOpenChapter(writingId);
  };

  const handleMergeRequest = (pos: number) => {
    const live = liveEditor();
    if (!live || live.editor.isDestroyed) return;
    const { editor } = live;
    const type = editor.schema.nodes[CHAPTER_HEADING_NAME];
    const node = editor.state.doc.nodeAt(pos);
    if (!type || !node || node.type !== type) return;
    const previousPos = previousHeadingPos(editor.state.doc, type, pos);
    if (previousPos === null) return;
    const writingId = typeof node.attrs.writingId === 'string' ? node.attrs.writingId : null;
    // A chapter that has no row yet is just a heading: fold it without asking.
    if (writingId === null) {
      editor.commands.removeChapterHeadingAt(pos);
      return;
    }
    const previous = editor.state.doc.nodeAt(previousPos);
    setPendingMerge({
      pos,
      writingId,
      title: node.textContent.trim() || t('writings.book.untitledChapter'),
      previousId: typeof previous?.attrs.writingId === 'string' ? previous.attrs.writingId : null,
      previousTitle: previous?.textContent.trim() || t('writings.book.untitledChapter'),
    });
  };

  const handleMergeConfirm = () => {
    const merge = pendingMerge;
    setPendingMerge(null);
    const live = liveEditor();
    if (!merge || !live || live.editor.isDestroyed) return;
    const { editor } = live;
    const node = editor.state.doc.nodeAt(merge.pos);
    // The dialog is modal, but the position is re-checked all the same.
    if (!node || node.type.name !== CHAPTER_HEADING_NAME || node.attrs.writingId !== merge.writingId) return;
    const session = ensureSession(live.editor, live.book);
    const absorberEntry = merge.previousId ? session.baseline.get(merge.previousId) : undefined;
    // The heading goes first; the confirmation is recorded only for a heading
    // that actually went (checked on the document, not on the command's
    // answer — a filtered transaction still reports true), so nothing can arm
    // a deletion for a heading that is still there.
    editor.commands.removeChapterHeadingAt(merge.pos);
    if (editor.state.doc.nodeAt(merge.pos)?.attrs.writingId === merge.writingId) return;
    session.confirmedDeletes.add(merge.writingId);
    mergeAbsorberRef.current.set(
      merge.writingId,
      merge.previousId && absorberEntry ? { id: merge.previousId, entry: { ...absorberEntry } } : null,
    );
    session.dirty = true;
    if (session.timer !== null) {
      window.clearTimeout(session.timer);
      session.timer = null;
    }
    void flushSave();
  };

  const handleMoveChapter = (pos: number, direction: ChapterMoveDirection) => {
    const live = liveEditor();
    if (!live || live.editor.isDestroyed) return;
    live.editor.chain().focus().moveChapterAt(pos, direction).run();
  };

  // The guard refuses per transaction, and a held key is many transactions:
  // one toast per couple of seconds says it as well as fifty would.
  const lastRefusalRef = useRef(0);
  const handleRemovalRefused = () => {
    const now = Date.now();
    if (now - lastRefusalRef.current < 2000) return;
    lastRefusalRef.current = now;
    toast.info(translateNow('writings.book.mergeHint'));
  };

  useEffect(() => {
    hostRef.current = {
      onOpenChapter: (writingId) => void handleOpenChapter(writingId),
      onMergeWithPrevious: handleMergeRequest,
      onMoveChapter: handleMoveChapter,
      onRemovalRefused: handleRemovalRefused,
    };
  });

  // Thirty seconds to take a merge back.
  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 30_000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  /**
   * Undo a merge: the row comes back whole, and the chapter that absorbed its
   * prose is returned to its pre-merge text — after what it holds now is
   * filed as a version, so nothing typed since is lost either.
   */
  const undoMerge = async () => {
    const taken = undo;
    if (!taken) return;
    setUndo(null);
    try {
      await flushSave();
      const live = liveEditor();
      const session = live ? ensureSession(live.editor, live.book) : null;
      // The writes below raise change notices of their own; the reload at
      // the end is the one answer to all of them.
      if (session) session.reloading = true;
      // Spent here: the save must not restore it a second time for a
      // heading that comes back after the reload.
      takeLastDeletedWriting(taken.bundle.writing.id);
      if (taken.absorber && session) {
        const { id, entry } = taken.absorber;
        const current = session.baseline.get(id);
        if (current) {
          await takeSnapshot({ id, projectId, title: current.title, content: current.html }, 'manual');
          try {
            await updateWritingAtVersion(
              id,
              { title: entry.title, content: entry.html, wordCount: entry.wordCount },
              current.version,
            );
          } catch (err) {
            // Written over elsewhere meanwhile: the row comes back, the
            // absorber keeps what it has, and the reload shows both.
            console.warn('[book] could not return the merged prose to its chapter', err);
          }
        }
      }
      await restoreDeletedWriting(taken.bundle);
      if (session) {
        session.contested.clear();
        session.dirty = false;
      }
      setConflict(null);
      setSaveState('saved');
      setGeneration((value) => value + 1);
      toast.success(t('writings.undoDelete.restored').replace('{name}', taken.bundle.writing.title));
    } catch (err) {
      console.error('[book] failed to restore the merged chapter', err);
      toast.error(t('writings.undoDelete.error'));
      // Nothing to reload: the next notice is somebody else's again.
      const live = liveEditor();
      if (live) ensureSession(live.editor, live.book).reloading = false;
    }
  };

  // ---------------------------------------------------------------------
  // Leaving and changing the range: both flush first, and both take the
  // Back button's path when the write fails — a dialog, never a control
  // that silently does nothing.
  // ---------------------------------------------------------------------
  const handleClose = async () => {
    if (!(await flushSave())) {
      setPendingLeave(() => onClose);
      return;
    }
    onClose();
  };

  const handleRangeChange = async (next: BookRange) => {
    if (!(await flushSave())) {
      toast.info(
        sessionRef.current.contested.size > 0
          ? t('writings.externalChange.hint')
          : t('writings.saveErrorIndicator'),
      );
      return;
    }
    setRange(next);
  };

  const handleSaveClick = async () => {
    const saved = await flushSave();
    if (!saved && sessionRef.current.contested.size > 0) toast.info(t('writings.externalChange.hint'));
  };

  // ---------------------------------------------------------------------
  // Render.
  // ---------------------------------------------------------------------
  const rangeFromIndex = fromId ? numbered.findIndex((row) => row.id === fromId) : -1;
  const rangeToIndex = toId ? numbered.findIndex((row) => row.id === toId) : -1;
  const editor = editorInstance && loaded && editorHolds(editorInstance, loaded) ? editorInstance : null;
  const chapterCount = loaded?.rows.length ?? 0;

  const indicator = (
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
      title={saveState === 'conflict' ? t('writings.externalChange.hint') : saveError ?? t('writings.autosaveHint')}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-book-save-state={saveState}
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
              : t('writings.unsavedIndicator')}
    </span>
  );

  const selectClass =
    'bg-elevated border border-border rounded px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-gold transition max-w-[14rem]';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => void handleClose()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-muted hover:text-text-primary transition rounded-lg hover:bg-elevated"
        >
          <ArrowLeft size={16} />
          {t('common.back')}
        </button>
        <h1 className="text-xl font-serif font-bold text-text-primary">{t('writings.book.title')}</h1>
        {loaded && (
          <span className="text-xs text-text-muted">
            {t('writings.book.stats')
              .replace('{chapters}', String(chapterCount))
              .replace('{words}', rangeWords.toLocaleString())}
            {readingPrefs.layout === 'page' && (
              <> · {t('editor.page.count').replace('{n}', String(pageCount))}</>
            )}
          </span>
        )}
        {indicator}
        <div className="flex-1" />
        {/* Continuous or Word-style sheets: the same preference the chapter editor shows. */}
        <div
          className="flex items-center rounded-lg border border-border overflow-hidden"
          title={t('editor.layout.hint')}
          role="group"
        >
          <button
            onClick={() => void setReadingPrefs({ layout: 'flow' })}
            className={`p-1.5 transition ${
              readingPrefs.layout === 'flow'
                ? 'text-accent-gold bg-accent-gold/10'
                : 'text-text-muted hover:text-text-primary hover:bg-elevated'
            }`}
            title={t('editor.layout.flow')}
            aria-pressed={readingPrefs.layout === 'flow'}
          >
            <AlignJustify size={15} />
          </button>
          <button
            onClick={() => void setReadingPrefs({ layout: 'page' })}
            className={`p-1.5 transition ${
              readingPrefs.layout === 'page'
                ? 'text-accent-gold bg-accent-gold/10'
                : 'text-text-muted hover:text-text-primary hover:bg-elevated'
            }`}
            title={t('editor.layout.page')}
            aria-pressed={readingPrefs.layout === 'page'}
          >
            <File size={15} />
          </button>
        </div>
        <button
          type="button"
          onClick={toggleNotes}
          className={`rounded-lg border border-border p-1.5 transition ${
            notesOpen
              ? 'text-accent-gold bg-accent-gold/10'
              : 'text-text-muted hover:text-text-primary hover:bg-elevated'
          }`}
          title={t('writings.book.notesPanel')}
          aria-label={t('writings.book.notesPanel')}
          aria-pressed={notesOpen}
        >
          <Superscript size={15} />
        </button>
        {numbered.length > 0 && range && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <label className="flex items-center gap-1.5">
              {t('writings.book.range.from')}
              <select
                value={range.fromId}
                onChange={(event) => {
                  const nextFrom = event.target.value;
                  const fromIndex = numbered.findIndex((row) => row.id === nextFrom);
                  const toIndex = rangeToIndex < fromIndex ? fromIndex : rangeToIndex;
                  void handleRangeChange({ fromId: nextFrom, toId: numbered[toIndex]?.id ?? nextFrom });
                }}
                className={selectClass}
              >
                {numbered.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.chapter}. {row.title || t('writings.book.untitledChapter')}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              {t('writings.book.range.to')}
              <select
                value={range.toId}
                onChange={(event) => {
                  const nextTo = event.target.value;
                  const toIndex = numbered.findIndex((row) => row.id === nextTo);
                  const fromIndex = rangeFromIndex > toIndex ? toIndex : rangeFromIndex;
                  void handleRangeChange({ fromId: numbered[fromIndex]?.id ?? nextTo, toId: nextTo });
                }}
                className={selectClass}
              >
                {numbered.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.chapter}. {row.title || t('writings.book.untitledChapter')}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <button
          onClick={() => void handleSaveClick()}
          disabled={saveState === 'saving' || !loaded}
          className="px-4 py-1.5 bg-accent-gold text-deep font-semibold text-sm rounded-lg hover:bg-accent-amber transition disabled:opacity-60"
          title="Ctrl+S"
        >
          {saveState === 'saving' ? t('common.saving') : t('writings.save')}
        </button>
      </div>

      {/* What the book does not hold */}
      {(unnumberedCount > 0 || loaded?.truncated) && (
        <p className="text-xs text-text-muted">
          {unnumberedCount > 0 && (
            <span>{t('writings.book.unnumbered').replace('{count}', String(unnumberedCount))}</span>
          )}
          {unnumberedCount > 0 && loaded?.truncated && ' · '}
          {loaded?.truncated && <span>{t('writings.book.largeBook')}</span>}
        </p>
      )}

      {/* A chapter that changed underneath the book. A banner, not a modal,
          for the reason the single-chapter editor gives: the writer is
          mid-sentence, and the honest answer is often "let me read first".
          Autosave skips the contested chapter until this is answered. */}
      {conflict && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-accent-amber/40 bg-accent-amber/10 px-3.5 py-2.5"
        >
          <CircleAlert size={16} className="flex-shrink-0 text-accent-amber" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-text-primary">
              {(conflict.kind === 'gone'
                ? t('writings.book.conflict.gone')
                : t('writings.book.conflict.title')
              ).replace('{name}', conflict.title)}
            </p>
            <p className="text-xs text-text-muted">{t('writings.book.conflict.message')}</p>
          </div>
          <button
            type="button"
            onClick={() => void handleKeepMine()}
            className="rounded-md border border-accent-gold/40 px-2.5 py-1 text-xs font-semibold text-accent-gold transition hover:bg-accent-gold/10"
          >
            {t('writings.book.conflict.keepMine')}
          </button>
          <button
            type="button"
            onClick={() => void handleReload()}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-text-primary transition hover:bg-elevated"
          >
            {t('writings.book.conflict.reload')}
          </button>
        </div>
      )}

      {/* The book */}
      {numbered.length === 0 ? (
        <p className="text-sm text-text-muted py-8 text-center">{t('writings.book.empty')}</p>
      ) : loaded ? (
        // With the panel open the book shares the row with 320px of notes. A
        // sheet is 794px wide (A4) or 816px (Letter), so in page mode the two
        // fit side by side only from `xl` up; below that the panel goes under
        // the editor rather than squeezing the paper. Flow has no fixed width
        // and takes the same breakpoint for one layout to reason about.
        <div
          className={`grid grid-cols-1 gap-4 items-start ${
            notesOpen ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''
          }`}
          // Read by the stylesheet: with `chapter`, every chapter heading
          // resets the footnote counter, so the numbers in the prose restart
          // where the exported chapters' do.
          data-footnote-placement={footnotePlacement}
        >
          <TiptapEditor
            key={loaded.key}
            content={loaded.html}
            onChange={handleChange}
            placeholder={t('writings.startWriting')}
            extensions={loaded.extensions}
            onEditorReady={setEditorInstance}
            layout={readingPrefs.layout}
            pageLayout={pageLayout}
            footnoteStyle={footnoteStyle}
            toolbarExtra={
              <ChapterToolButton
                editor={editor}
                title={t('writings.book.insertChapter')}
                label={t('writings.book.chapterToolbar')}
              />
            }
          />
          {notesOpen && (
            <div className="xl:sticky xl:top-4" data-testid="book-notes-panel">
              <FootnotesPanel
                editor={editor}
                style={footnoteStyle}
                onStyleChange={handleFootnoteStyle}
                placement={footnotePlacement}
                onPlacementChange={handleFootnotePlacement}
                restartNumbersAt={footnotePlacement === 'chapter' ? CHAPTER_HEADING_NAME : undefined}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-text-muted py-8 justify-center">
          <LoaderCircle size={14} className="animate-spin" />
          {t('common.loading')}
        </div>
      )}

      {/* Merge: the one way a heading goes, and it asks first. */}
      <ConfirmDialog
        open={pendingMerge !== null}
        destructive
        title={t('writings.book.mergeConfirm.title')}
        message={t('writings.book.mergeConfirm.message')
          .replace(/\{name\}/g, pendingMerge?.title ?? '')
          .replace('{previous}', pendingMerge?.previousTitle ?? '')}
        confirmLabel={t('writings.book.mergeConfirm.confirm')}
        onConfirm={handleMergeConfirm}
        onCancel={() => setPendingMerge(null)}
      />

      {/* Leaving with the save refused. */}
      <ConfirmDialog
        open={pendingLeave !== null}
        title={conflict ? t('writings.externalChange.leaveTitle') : t('writings.leaveUnsaved.title')}
        message={
          conflict
            ? t('writings.book.leaveContested')
            : t('writings.book.leaveUnsaved').replace('{error}', saveError ?? t('writings.closeWindow.reasonUnknown'))
        }
        confirmLabel={t('writings.leaveUnsaved.leave')}
        cancelLabel={conflict ? t('writings.externalChange.stay') : t('writings.leaveUnsaved.retry')}
        onConfirm={() => {
          const leave = pendingLeave;
          setPendingLeave(null);
          leave?.();
        }}
        onCancel={() => {
          const leave = pendingLeave;
          setPendingLeave(null);
          // "Retry save": leave only once the write lands. A contested book
          // has nothing to retry; "stay" goes back to the banner.
          if (!conflict && leave) {
            void flushSave().then((saved) => {
              if (saved) leave();
            });
          }
        }}
      />

      {/* The X, when the save will not go through. */}
      <ConfirmDialog
        open={pendingClose}
        title={t('writings.closeWindow.title')}
        message={t('writings.book.closeWindow.message').replace(
          '{error}',
          saveError ?? t('writings.closeWindow.reasonUnknown'),
        )}
        confirmLabel={t('writings.closeWindow.close')}
        cancelLabel={t('writings.closeWindow.keepOpen')}
        onConfirm={() => {
          setPendingClose(false);
          closeAppWindow();
        }}
        onCancel={() => {
          setPendingClose(false);
          keepAppWindow();
        }}
      />

      {/* Undo bar for a merge, offset from the toast stack. */}
      {undo && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-elevated px-3.5 py-2.5 shadow-lg shadow-black/30"
        >
          <span className="text-sm text-text-primary">
            {t('writings.book.mergedUndo').replace('{name}', undo.bundle.writing.title)}
          </span>
          <button
            type="button"
            onClick={() => void undoMerge()}
            className="flex items-center gap-1.5 rounded-md border border-accent-gold/40 px-2.5 py-1 text-xs font-semibold text-accent-gold transition hover:bg-accent-gold/10"
          >
            <Undo2 size={13} />
            {t('writings.undoDelete.action')}
          </button>
          <button
            type="button"
            onClick={() => setUndo(null)}
            className="text-text-dim transition hover:text-text-primary"
            aria-label={t('common.dismiss')}
            title={t('common.dismiss')}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
