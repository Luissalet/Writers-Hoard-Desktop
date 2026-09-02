import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, ChevronLeft, ChevronRight, Keyboard, ListTree, PenLine, X } from 'lucide-react';
import type { Writing } from '@/types';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppStore } from '@/stores/appStore';
import { sanitizedHtml } from '@/utils/sanitizeRichHtml';
import { extractFootnotesFromHtml, renderEndnotesHtml } from '@/components/editor/footnotes/footnoteModel';
import type { FootnoteMarkerStyle, FootnotePlacement } from '@/types';
import {
  estimatePieceHeight,
  manuscriptProgress,
  measureWords,
  positionAt,
  readOffset,
  resolveResumePoint,
  sameWindow,
  serializeReadingPosition,
  sumHeights,
  windowAround,
  wordPrefixes,
  type PieceWindow,
  type ReadingPosition,
} from '../readingWindow';
import { loadReadingPosition, saveReadingPosition } from '../readingPositionPersist';

/** One arrow press of prose. */
const LINE_STEP_PX = 96;
/** Space / PageDown leave a couple of lines of overlap, the way a book does. */
const PAGE_FRACTION = 0.9;
/**
 * Longest a scroll can go unremembered. Reading a page takes minutes, so two
 * seconds of it is nothing to lose, and it puts a hard ceiling of one Dexie
 * write per two seconds on a surface that recomputes its position sixty times
 * a second.
 */
const POSITION_SAVE_MS = 2_000;
/** How long the note about having resumed stays up before it takes itself away. */
const RESUME_NOTE_MS = 6_000;

interface ReadingPieceProps {
  piece: Writing;
  words: number;
  footnoteStyle: FootnoteMarkerStyle;
  /** The number of the piece's first note: 1, or one past the previous piece's last. */
  footnoteStart: number;
  onOpenInEditor: (writing: Writing) => void;
}

/**
 * One piece of the manuscript, read-only.
 *
 * Memoised, and every prop it takes is stable: the reader scrolls sixty times
 * a second and the view above re-renders whenever the reading position moves,
 * but the prose is set once per mount. Without this, `sanitizedHtml` would
 * hand React a new `__html` string on every one of those renders and the
 * browser would re-parse four chapters of HTML per scroll.
 *
 * The class names are the app's prose stylesheet (`index.css` keys the
 * manuscript's face, size and measure off `.tiptap-editor .ProseMirror`), so a
 * chapter reads here exactly as it reads in the editor. There is no editor
 * behind it: no `contentEditable`, no TipTap instance, nothing that writes.
 */
const ReadingPiece = memo(function ReadingPiece({
  piece,
  words,
  footnoteStyle,
  footnoteStart,
  onOpenInEditor,
}: ReadingPieceProps) {
  const { t, locale } = useTranslation();
  const column = { maxWidth: 'var(--wh-reading-measure)' };
  // The chapter's footnotes, listed under its prose. The references keep
  // their CSS numbers, the list its own, and both count in document order —
  // from `footnoteStart`: the stylesheet resets the counter per prose body,
  // and this inline reset outranks it, so a book whose notes count on
  // through the chapters reads that way here too. No back-links: the
  // sanitizer renames ids, and `handleProseClick` below swallows every
  // in-page anchor anyway.
  const endnotes = renderEndnotesHtml(
    extractFootnotesFromHtml(piece.content).map((note) => ({ ...note, index: note.index + footnoteStart - 1 })),
    {
      heading: t('writings.footnotes.endnotesTitle'),
      style: footnoteStyle,
      backlinks: false,
    },
  );
  const counter = footnoteStart > 1 ? { counterReset: `wh-footnote ${footnoteStart - 1}` } : undefined;

  return (
    <article data-piece-id={piece.id} className="px-6 pt-8 pb-2">
      <header className="mx-auto flex items-start gap-3" style={column}>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-text-dim font-medium">
            {piece.chapter !== undefined && <span>{t('writings.chapter')} {piece.chapter}</span>}
            <span>{words.toLocaleString(locale)} {t('writings.words')}</span>
          </p>
          <h2 className="font-serif text-2xl font-bold text-text-primary">
            {piece.title || t('writings.untitled')}
          </h2>
          {piece.synopsis && (
            <p className="mt-1 text-xs italic text-text-muted">{piece.synopsis}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onOpenInEditor(piece)}
          title={t('writings.reading.openInEditor')}
          className="flex flex-shrink-0 items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-xs text-text-muted transition hover:text-accent-gold hover:border-accent-gold/40"
        >
          <PenLine size={13} />
          {t('writings.reading.openInEditor')}
        </button>
      </header>

      {piece.content.trim() ? (
        <div className="tiptap-editor mt-2">
          <div className="ProseMirror" style={counter} dangerouslySetInnerHTML={sanitizedHtml(piece.content + endnotes)} />
        </div>
      ) : (
        <p className="mx-auto mt-4 text-sm italic text-text-dim" style={column}>
          {t('writings.reading.emptyPiece')}
        </p>
      )}

      <div className="mx-auto mt-6 h-px bg-border/70" style={column} />
    </article>
  );
});

interface ReadingViewProps {
  /** The pieces to read, already in manuscript order. */
  pieces: Writing[];
  /** Where to open — the chapter the writer had in the editor, when there was one. */
  startId?: string | null;
  onClose: () => void;
  onOpenInEditor: (writing: Writing) => void;
  /** The manuscript's footnote marker style; numbers when absent. */
  footnoteStyle?: FootnoteMarkerStyle;
  /**
   * Where the book puts its notes. The reader shows each chapter's notes
   * under that chapter either way — it is one continuous scroll, and "the
   * end of the book" is four hundred chapters down — but with `book` the
   * numbers count on through the chapters as they will in the exports.
   */
  footnotePlacement?: FootnotePlacement;
}

/**
 * The manuscript as one continuous scroll, set with the writer's own reading
 * preferences and holding at most four chapters of DOM (see `readingWindow.ts`
 * for the bound). Read-only by construction: this file imports nothing that
 * writes, and the single action it offers per piece hands the writing back to
 * the host to open in the editor.
 */
export default function ReadingView({
  pieces,
  startId,
  onClose,
  onOpenInEditor,
  footnoteStyle = 'numbers',
  footnotePlacement = 'chapter',
}: ReadingViewProps) {
  const { t, locale } = useTranslation();
  const reading = useAppStore((s) => s.reading);
  const loadReading = useAppStore((s) => s.loadReading);

  useEffect(() => {
    void loadReading();
  }, [loadReading]);

  const startIndex = useMemo(() => {
    const found = startId ? pieces.findIndex((piece) => piece.id === startId) : -1;
    return found >= 0 ? found : 0;
  }, [pieces, startId]);

  const [activeIndex, setActiveIndex] = useState(startIndex);
  const [pieceWindow, setPieceWindow] = useState<PieceWindow>(() =>
    windowAround(startIndex, pieces.length),
  );
  const [railOpen, setRailOpen] = useState(true);
  /** The piece a saved position dropped the reader into, while the note about it shows. */
  const [resumedPiece, setResumedPiece] = useState<Writing | null>(null);
  /** Whether the saved position has been read and dealt with; nothing is written before it has. */
  const [restored, setRestored] = useState(false);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLElement>(null);
  const leadRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const percentRef = useRef<HTMLSpanElement>(null);
  /** Measured heights by piece id — what a piece cost the last time it was mounted. */
  const heightsRef = useRef(new Map<string, number>());
  /** The paragraph under the top of the viewport, so a mount above it can be undone. */
  const anchorRef = useRef<{ id: string; offset: number } | null>(null);
  /** A jump waiting for its piece to mount, and how far into it to land. */
  const jumpRef = useRef<{ id: string; fraction: number } | null>(null);
  /** The opening jump is made once, not again every time the list refreshes. */
  const startedRef = useRef(false);
  /** The saved position is read once, for the same reason. */
  const restoredRef = useRef(false);
  /**
   * The position the scroll handler last passed through, waiting for the
   * throttle below to write it. This is the whole reason the save costs
   * nothing: the handler computes a position per frame anyway, to move the
   * mounted window, and this only keeps the newest one.
   */
  const pendingRef = useRef<ReadingPosition | null>(null);
  /** A scroll of the writer's own, which outranks a restore still in flight. */
  const scrolledRef = useRef(false);

  const words = useMemo(() => measureWords(pieces), [pieces]);
  const prefixes = useMemo(() => wordPrefixes(words), [words]);
  // The first note number of each piece when the book numbers continuously.
  // Cheap enough for the whole manuscript: `extractFootnotesFromHtml` tests
  // for the attribute before it parses, so the chapters without notes — most
  // of them — cost a substring search each.
  const footnoteStarts = useMemo(() => {
    const starts: number[] = [];
    let next = 1;
    for (const piece of pieces) {
      starts.push(next);
      if (footnotePlacement === 'book') next += extractFootnotesFromHtml(piece.content).length;
    }
    return starts;
  }, [footnotePlacement, pieces]);
  const totalWords = prefixes[prefixes.length - 1] ?? 0;

  const heightOf = useCallback(
    (index: number): number => {
      const piece = pieces[index];
      if (!piece) return 0;
      return heightsRef.current.get(piece.id) ?? estimatePieceHeight(words[index] ?? 0);
    },
    [pieces, words],
  );

  const paintProgress = useCallback(
    (scrollTop: number) => {
      const position = positionAt(scrollTop, pieces.length, heightOf);

      // The bar is painted from the BOTTOM of the viewport and the returned
      // position — which names the piece the reader is in and drives the
      // mounted window — from the top. Two different questions: "what have I
      // read" and "where am I". Sharing one offset made a one-chapter
      // manuscript that fits on screen read 0 % forever.
      const scroller = scrollerRef.current;
      const read = scroller
        ? positionAt(
            readOffset(
              scrollTop,
              scroller.clientHeight,
              sumHeights(0, pieces.length, heightOf),
            ),
            pieces.length,
            heightOf,
          )
        : position;
      const fraction = manuscriptProgress(read, prefixes, totalWords);
      if (barRef.current) barRef.current.style.width = `${(fraction * 100).toFixed(1)}%`;
      if (percentRef.current) {
        percentRef.current.textContent = fraction.toLocaleString(locale, {
          style: 'percent',
          maximumFractionDigits: 0,
        });
      }
      return position;
    },
    [heightOf, locale, pieces.length, prefixes, totalWords],
  );

  const pieceElement = useCallback((scroller: HTMLElement, id: string) => {
    return scroller.querySelector<HTMLElement>(`[data-piece-id="${CSS.escape(id)}"]`);
  }, []);

  /**
   * Re-lay the two spacers over everything that is not mounted, then put the
   * reading position back. Both halves matter: the spacers keep the scrollbar
   * honest about a book the DOM does not hold, and the anchor keeps the
   * paragraph on screen from sliding when a piece mounts above it at its real
   * height instead of its estimate.
   */
  const settleLayout = useCallback(
    (view: PieceWindow) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;

      scroller.querySelectorAll<HTMLElement>('[data-piece-id]').forEach((element) => {
        const id = element.dataset.pieceId;
        if (id) heightsRef.current.set(id, element.offsetHeight);
      });

      if (leadRef.current) {
        leadRef.current.style.height = `${sumHeights(0, view.first, heightOf)}px`;
      }
      if (tailRef.current) {
        tailRef.current.style.height = `${sumHeights(view.last + 1, pieces.length, heightOf)}px`;
      }

      const jump = jumpRef.current;
      if (jump) {
        const target = pieceElement(scroller, jump.id);
        if (target) {
          jumpRef.current = null;
          // The fraction is resolved against the piece's REAL height, which is
          // only knowable now that it is mounted: a resumed reader landed on
          // the word-count estimate would be pages out on a long chapter.
          const offset = Math.round(target.offsetHeight * jump.fraction);
          scroller.scrollTop = target.offsetTop + offset;
          anchorRef.current = { id: jump.id, offset };
        }
      } else {
        const anchor = anchorRef.current;
        const element = anchor ? pieceElement(scroller, anchor.id) : null;
        if (anchor && element) scroller.scrollTop = element.offsetTop + anchor.offset;
      }

      pendingRef.current = paintProgress(scroller.scrollTop);
    },
    [heightOf, paintProgress, pieceElement, pieces.length],
  );

  // Spacers, anchor and progress, after every window change — and again
  // whenever a mounted piece changes size under the reader (an image decoding,
  // the reading face swapping), which moves everything below it.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    if (!startedRef.current) {
      startedRef.current = true;
      const start = pieces[startIndex];
      if (start) jumpRef.current = { id: start.id, fraction: 0 };
    }

    const settle = () => settleLayout(pieceWindow);
    settle();

    const observer = new ResizeObserver(settle);
    scroller.querySelectorAll<HTMLElement>('[data-piece-id]').forEach((element) => {
      observer.observe(element);
    });
    return () => observer.disconnect();
  }, [pieceWindow, pieces, settleLayout, startIndex]);

  // The reading position, recomputed once per animation frame while scrolling.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;

    const sync = () => {
      frame = 0;
      const position = paintProgress(scroller.scrollTop);
      // Left here for the throttled save below. Recording it costs one field
      // write; writing it to Dexie here would cost a transaction per frame.
      pendingRef.current = position;
      setActiveIndex(position.index);
      setPieceWindow((current) => {
        const next = windowAround(position.index, pieces.length);
        return sameWindow(current, next) ? current : next;
      });
      const mounted = scroller.querySelectorAll<HTMLElement>('[data-piece-id]');
      for (let index = 0; index < mounted.length; index += 1) {
        const element = mounted[index];
        if (element.offsetTop + element.offsetHeight > scroller.scrollTop) {
          const id = element.dataset.pieceId;
          if (id) anchorRef.current = { id, offset: scroller.scrollTop - element.offsetTop };
          break;
        }
      }
    };

    const onScroll = () => {
      scrolledRef.current = true;
      if (frame) return;
      frame = window.requestAnimationFrame(sync);
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [paintProgress, pieces.length]);

  // `fraction` is how far into the piece to land, and only the resume passes
  // one: a chapter the writer asked for by name starts at its title.
  const jumpTo = useCallback(
    (index: number, fraction = 0) => {
      if (pieces.length === 0) return;
      const clamped = Math.min(Math.max(index, 0), pieces.length - 1);
      const target = pieces[clamped];
      if (!target) return;

      jumpRef.current = { id: target.id, fraction };
      setActiveIndex(clamped);
      setPieceWindow((current) => {
        const next = windowAround(clamped, pieces.length);
        return sameWindow(current, next) ? current : next;
      });

      // A jump inside the mounted window moves neither the window nor the
      // active index, so no render — and therefore no layout effect — follows.
      // Scroll to it here instead of waiting for one that never comes.
      const scroller = scrollerRef.current;
      const element = scroller ? pieceElement(scroller, target.id) : null;
      if (scroller && element) {
        jumpRef.current = null;
        const offset = Math.round(element.offsetHeight * fraction);
        scroller.scrollTop = element.offsetTop + offset;
        anchorRef.current = { id: target.id, offset };
        pendingRef.current = paintProgress(scroller.scrollTop);
      }
    },
    [paintProgress, pieceElement, pieces],
  );

  /**
   * Opening where reading stopped.
   *
   * `startId` is the writer naming a chapter out loud — "read from here" — and
   * outranks anything remembered; only the plain Read button, which has no
   * chapter in mind, resumes. The lookup is one indexed read and lands in
   * milliseconds, but a scroll made while it was in flight is a newer answer
   * to the same question, so it is left alone.
   *
   * Done once per view rather than once per list. `pieces` changes identity
   * whenever the list refetches — an autosave elsewhere, a Google sync — and
   * repeating the restore would haul a reader out of chapter forty and back to
   * their bookmark mid-sentence. A repeat run only switches the saving below
   * on, which matters because the read it would otherwise redo was cancelled
   * by this effect's own cleanup and will never set the flag itself.
   */
  useEffect(() => {
    const projectId = pieces[0]?.projectId;
    if (!projectId) return;
    if (restoredRef.current || startId) {
      // Out of the effect's own tick: the React Compiler rejects a synchronous
      // setState here, and rightly — this path has nothing to wait for, so
      // flipping the flag in the same render pass only invites a cascade. The
      // asynchronous path below is already off-tick by construction.
      queueMicrotask(() => setRestored(true));
      return;
    }
    restoredRef.current = true;

    let live = true;
    void loadReadingPosition(projectId).then((saved) => {
      if (!live) return;
      const resume = resolveResumePoint(saved, pieces, projectId);
      if (resume.resumed && !scrolledRef.current) {
        jumpTo(resume.index, resume.fraction);
        setResumedPiece(pieces[resume.index] ?? null);
      }
      setRestored(true);
    });
    return () => {
      live = false;
    };
  }, [jumpTo, pieces, startId]);

  /**
   * Saving where reading stopped, at most once every `POSITION_SAVE_MS`.
   *
   * Nothing is measured here: the scroll handler above already computes the
   * position once per animation frame to move the mounted window, and this
   * reads what it left in `pendingRef`. Writing from the handler itself would
   * be sixty Dexie transactions a second on the row every other per-project
   * setting shares, felt as stutter in the one view whose whole purpose is a
   * scroll that does not stutter.
   *
   * It waits for `restored` for a reason that is not tidiness: a writer who
   * opens the reader by mistake and presses Esc inside a second would
   * otherwise have the closing flush overwrite their bookmark with the front
   * of the book, before the restore that was in flight could ever apply.
   */
  useEffect(() => {
    if (!restored) return;
    const projectId = pieces[0]?.projectId;
    if (!projectId) return;

    let written = '';
    const flush = () => {
      const position = pendingRef.current;
      const piece = position ? pieces[position.index] : undefined;
      if (!position || !piece) return;
      const next = {
        projectId,
        pieceId: piece.id,
        fraction: position.fraction,
        index: position.index,
      };
      // The stored form is also the comparison: a reader who has stopped
      // moving, or moved less than the rounding, writes nothing at all.
      const mark = serializeReadingPosition(next);
      if (mark === written) return;
      written = mark;
      void saveReadingPosition(next);
    };

    const timer = window.setInterval(flush, POSITION_SAVE_MS);
    return () => {
      window.clearInterval(timer);
      // Leaving is when the position matters most, and the last scroll before
      // it is almost always inside an interval that never got to fire: Esc,
      // the exit button and "open in the editor" all unmount this view.
      flush();
    };
  }, [pieces, restored]);

  // The note about having resumed goes away by itself. This is a reader:
  // something that has to be clicked away is a worse interruption than the one
  // it was put there to explain.
  useEffect(() => {
    if (!resumedPiece) return;
    const timer = window.setTimeout(() => setResumedPiece(null), RESUME_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [resumedPiece]);

  // Keyboard: space and the arrows read, Esc leaves. Everything is prevented
  // rather than passed through — this is a page, not a form.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const scroller = scrollerRef.current;
      const step = (delta: number) => {
        if (scroller) scroller.scrollTop += delta;
      };
      const page = scroller ? Math.max(LINE_STEP_PX, scroller.clientHeight * PAGE_FRACTION) : 400;

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          onClose();
          return;
        case ' ':
        case 'PageDown':
          event.preventDefault();
          step(event.shiftKey ? -page : page);
          return;
        case 'PageUp':
          event.preventDefault();
          step(-page);
          return;
        case 'ArrowDown':
          event.preventDefault();
          step(LINE_STEP_PX);
          return;
        case 'ArrowUp':
          event.preventDefault();
          step(-LINE_STEP_PX);
          return;
        case 'ArrowRight':
          event.preventDefault();
          jumpTo(activeIndex + 1);
          return;
        case 'ArrowLeft':
          event.preventDefault();
          jumpTo(activeIndex - 1);
          return;
        case 'Home':
          event.preventDefault();
          jumpTo(0);
          return;
        case 'End':
          event.preventDefault();
          jumpTo(pieces.length - 1);
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeIndex, jumpTo, onClose, pieces.length]);

  // Keep the rail showing the piece being read.
  useEffect(() => {
    if (!railOpen) return;
    const item = railRef.current?.querySelector<HTMLElement>(`[data-rail-index="${activeIndex}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, railOpen]);

  // The page takes the keys as soon as it opens, without moving the scroll.
  useEffect(() => {
    scrollerRef.current?.focus({ preventScroll: true });
  }, []);

  /**
   * A link in the prose must not navigate the app out of itself. Desktop hands
   * `window.open` to the OS browser (`setWindowOpenHandler` in electron/main),
   * which is where a manuscript's links belong.
   */
  const handleProseClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
  }, []);

  const activePiece = pieces[Math.min(activeIndex, pieces.length - 1)];
  const mounted = pieces.slice(pieceWindow.first, pieceWindow.last + 1);

  return (
    <div
      // The same three attributes the editor writes, resolved by index.css into
      // the custom properties the prose is set with. Reading mode and the
      // editor therefore cannot disagree about face, size or measure.
      data-reading-face={reading.face}
      data-reading-size={reading.size}
      data-reading-measure={reading.measure}
      data-footnote-style={footnoteStyle}
      role="dialog"
      aria-modal="true"
      aria-label={t('writings.reading.title')}
      className="fixed inset-0 z-40 flex flex-col bg-deep"
    >
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-muted hover:text-text-primary transition rounded-lg hover:bg-elevated"
        >
          <X size={16} />
          {t('writings.reading.exit')}
        </button>

        <button
          type="button"
          onClick={() => setRailOpen((open) => !open)}
          title={railOpen ? t('writings.reading.hideRail') : t('writings.reading.showRail')}
          aria-pressed={railOpen}
          className={`p-1.5 rounded-lg transition border ${
            railOpen
              ? 'text-accent-gold border-accent-gold/40 bg-accent-gold/10'
              : 'text-text-muted border-border hover:text-text-primary hover:bg-elevated'
          }`}
        >
          <ListTree size={15} />
        </button>

        {/* The piece being read, always on screen while it is being read. */}
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate font-serif text-sm font-bold text-text-primary">
            {activePiece?.title || t('writings.untitled')}
          </p>
          {activePiece?.chapter !== undefined && (
            <p className="text-[10px] uppercase tracking-widest text-text-dim">
              {t('writings.chapter')} {activePiece.chapter}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => jumpTo(activeIndex - 1)}
            disabled={activeIndex <= 0}
            title={t('common.previous')}
            aria-label={t('common.previous')}
            className="p-1.5 rounded-lg transition border text-text-muted border-border hover:text-text-primary hover:bg-elevated disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => jumpTo(activeIndex + 1)}
            disabled={activeIndex >= pieces.length - 1}
            title={t('common.next')}
            aria-label={t('common.next')}
            className="p-1.5 rounded-lg transition border text-text-muted border-border hover:text-text-primary hover:bg-elevated disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        {/* Progress through the whole manuscript, counted in words rather than
            in viewport-fuls: a 400-word idea and a 4 000-word chapter do not
            move the bar by the same amount. */}
        <div className="flex flex-shrink-0 items-center gap-2" title={t('writings.reading.progressHint')}>
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-elevated">
            <div ref={barRef} className="h-full rounded-full bg-accent-gold" style={{ width: '0%' }} />
          </div>
          <span ref={percentRef} className="w-9 text-right text-[11px] tabular-nums text-text-muted">
            0%
          </span>
          <span className="text-[11px] text-text-dim">
            {t('writings.reading.pieceOf')
              .replace('{index}', (activeIndex + 1).toLocaleString(locale))
              .replace('{count}', pieces.length.toLocaleString(locale))}
          </span>
        </div>

        {/* The shortcuts, in the one shape that survives a narrow window: the
            icon and its tooltip are always there, and the sentence spells
            itself out only where there is room for it on one line. */}
        <span
          className="flex flex-shrink-0 items-center gap-1.5 text-text-dim"
          title={t('writings.reading.keys')}
        >
          <Keyboard size={13} aria-hidden="true" />
          <span className="sr-only">{t('writings.reading.keys')}</span>
          <span aria-hidden="true" className="hidden text-[10px] 2xl:inline">
            {t('writings.reading.keys')}
          </span>
        </span>
      </header>

      {/* Having been moved is worth one sentence and no more. It sits over the
          prose rather than in the header, because a header that grows a row
          when a bookmark is restored reflows the first screenful of the book
          the reader has just been put back into. */}
      {resumedPiece && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute left-1/2 top-16 z-10 -translate-x-1/2"
        >
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-accent-gold/40 bg-elevated px-3.5 py-1.5 text-xs text-text-muted shadow-lg shadow-black/30 animate-[toast-in_0.18s_ease-out]">
            <Bookmark size={13} aria-hidden="true" className="flex-shrink-0 text-accent-gold" />
            <span className="max-w-[22rem] truncate">
              {t('writings.reading.resumed').replace(
                '{piece}',
                resumedPiece.title || t('writings.untitled'),
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                setResumedPiece(null);
                jumpTo(0);
              }}
              className="flex-shrink-0 rounded-full px-2 py-0.5 font-medium text-accent-gold transition hover:bg-accent-gold/10"
            >
              {t('writings.reading.resumeStart')}
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {railOpen && (
          <nav
            ref={railRef}
            aria-label={t('writings.reading.rail')}
            className="w-60 flex-shrink-0 overflow-y-auto border-r border-border bg-surface/40 py-2"
          >
            {pieces.map((piece, index) => (
              <button
                key={piece.id}
                type="button"
                data-rail-index={index}
                onClick={() => jumpTo(index)}
                aria-current={index === activeIndex ? 'true' : undefined}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                  index === activeIndex
                    ? 'bg-accent-gold/10 text-accent-gold font-semibold'
                    : 'text-text-muted hover:bg-elevated hover:text-text-primary'
                }`}
              >
                <span className="w-6 flex-shrink-0 text-right text-[10px] tabular-nums text-text-dim">
                  {piece.chapter ?? index + 1}
                </span>
                <span className="truncate">{piece.title || t('writings.untitled')}</span>
              </button>
            ))}
          </nav>
        )}

        {/* `relative`, so every `offsetTop` read below is measured against this
            scroller and the anchor arithmetic stays self-consistent. */}
        <div
          ref={scrollerRef}
          tabIndex={-1}
          onClick={handleProseClick}
          className="relative flex-1 overflow-y-auto outline-none"
        >
          <div ref={leadRef} aria-hidden="true" />
          {mounted.map((piece, offset) => (
            <ReadingPiece
              key={piece.id}
              piece={piece}
              words={words[pieceWindow.first + offset] ?? 0}
              footnoteStyle={footnoteStyle}
              footnoteStart={footnoteStarts[pieceWindow.first + offset] ?? 1}
              onOpenInEditor={onOpenInEditor}
            />
          ))}
          <div ref={tailRef} aria-hidden="true" />
          <p className="px-6 py-10 text-center text-xs text-text-dim">{t('writings.reading.end')}</p>
        </div>
      </div>
    </div>
  );
}
