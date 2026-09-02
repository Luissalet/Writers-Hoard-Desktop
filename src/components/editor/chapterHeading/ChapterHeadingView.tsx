// ============================================
// Chapter heading — what the writer sees
// ============================================
//
// The node view for `ChapterHeadingNode`: the chapter's number on the left,
// its title as the editable text, and on the right — visible on hover — the
// three things a heading can do that the prose around it cannot: open the
// chapter on its own, fold it into the chapter before it, and move it up or
// down the book. The buttons call the callbacks the host handed the node
// through `configure`; the view decides nothing about rows itself.

import { NodeViewContent, NodeViewWrapper, useEditorState, type NodeViewProps } from '@tiptap/react';
import { ChevronDown, ChevronUp, ExternalLink, Merge } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ChapterHeadingOptions, ChapterMoveDirection } from './ChapterHeadingNode';
import { nextHeadingPos, previousHeadingPos } from './chapterBlocks';

const BUTTON_CLASS =
  'wh-chapter-heading__button p-1 rounded text-text-dim transition hover:bg-elevated hover:text-accent-gold disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-dim';

export default function ChapterHeadingView({ node, editor, extension, getPos }: NodeViewProps) {
  const { t } = useTranslation();
  const options = extension.options as ChapterHeadingOptions;
  const writingId = typeof node.attrs.writingId === 'string' ? node.attrs.writingId : null;
  const chapter = typeof node.attrs.chapter === 'number' ? node.attrs.chapter : null;
  const empty = node.content.size === 0;
  const pos = getPos();

  // Whether this is the first or the last chapter is a fact about the
  // document around the node, not about the node — a heading inserted above
  // this one changes the answer without touching this node. So it is read
  // from the editor on every transaction and re-rendered only when it
  // changes. Each walk stops at the nearest heading, so the cost is a few
  // dozen nodes per keystroke, not the book.
  const type = node.type;
  const { hasPrevious, hasNext } = useEditorState({
    editor,
    selector: ({ editor: live }) => {
      const at = getPos();
      const doc = live.state.doc;
      // The view can be asked one transaction after its node left the
      // document, with a position that no longer points at a heading.
      if (typeof at !== 'number' || at >= doc.content.size || doc.nodeAt(at)?.type !== type) {
        return { hasPrevious: false, hasNext: false };
      }
      return {
        hasPrevious: previousHeadingPos(doc, type, at) !== null,
        hasNext: nextHeadingPos(doc, type, at) !== null,
      };
    },
  });

  const label =
    writingId === null
      ? t('writings.book.newChapterLabel')
      : chapter === null
        ? t('writings.chapter')
        : t('writings.book.chapterLabel').replace('{n}', String(chapter));

  const move = (direction: ChapterMoveDirection) => {
    if (typeof pos !== 'number') return;
    options.onMoveChapter?.(pos, direction);
  };

  return (
    <NodeViewWrapper as="div" className="wh-chapter-heading__row">
      <span className="wh-chapter-heading__label" contentEditable={false}>
        {label}
      </span>
      <NodeViewContent<'h1'>
        as="h1"
        className="wh-chapter-heading__title"
        data-empty={empty ? '' : undefined}
        data-placeholder={t('writings.book.untitledChapter')}
      />
      <span className="wh-chapter-heading__actions" contentEditable={false}>
        {/* MouseDown is prevented on every button so the click never moves
            the caret out of the prose: the editor keeps its selection, and
            the host's command runs against the position it was asked about. */}
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (writingId) options.onOpenChapter?.(writingId);
          }}
          disabled={writingId === null || !options.onOpenChapter}
          title={t('writings.book.openChapter')}
          aria-label={t('writings.book.openChapter')}
          className={BUTTON_CLASS}
        >
          <ExternalLink size={13} />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (typeof pos === 'number') options.onMergeWithPrevious?.(pos);
          }}
          disabled={!hasPrevious || !options.onMergeWithPrevious}
          title={t('writings.book.mergeWithPrevious')}
          aria-label={t('writings.book.mergeWithPrevious')}
          className={BUTTON_CLASS}
        >
          <Merge size={13} />
        </button>
        <span className="wh-chapter-heading__grip">
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => move('up')}
            disabled={!hasPrevious || !options.onMoveChapter}
            title={t('writings.book.moveUp')}
            aria-label={t('writings.book.moveUp')}
            className={BUTTON_CLASS}
          >
            <ChevronUp size={13} />
          </button>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => move('down')}
            disabled={!hasNext || !options.onMoveChapter}
            title={t('writings.book.moveDown')}
            aria-label={t('writings.book.moveDown')}
            className={BUTTON_CLASS}
          >
            <ChevronDown size={13} />
          </button>
        </span>
      </span>
    </NodeViewWrapper>
  );
}
