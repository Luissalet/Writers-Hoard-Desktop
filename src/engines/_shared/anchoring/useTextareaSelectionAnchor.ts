// ============================================
// useTextareaSelectionAnchor — stage AnnotationAnchors from a <textarea>
// ============================================
//
// The `AnnotationSurface` wrapper accepts an optional `pendingAnchor` prop so
// hosts can seed the note composer with a specific text-range selection.
// Tiptap hosts (writings) already expose an `onAnnotate(anchor)` callback;
// plain `<textarea>` hosts (seeds, codex) have no equivalent. This hook
// fills that gap with ~20 LOC of selection-change tracking.
//
// Usage:
//
//   const { pendingAnchor, consumePendingAnchor, bindProps } =
//     useTextareaSelectionAnchor(descriptionText);
//
//   <textarea
//     value={descriptionText}
//     onChange={...}
//     {...bindProps}     // wires onMouseUp / onKeyUp / onSelect
//   />
//
//   <AnnotationSurface
//     pendingAnchor={pendingAnchor}
//     onPendingAnchorConsumed={consumePendingAnchor}
//     ...
//   />
//
// The anchor is built using plain-text char offsets (no HTML to strip) and
// includes a ~40-char context triple so the annotations engine's fuzzy
// reanchor algorithm can relocate the selection if the text later drifts.

import { useCallback, useState } from 'react';
import type { AnnotationAnchor } from '@/engines/annotations/types';

/** How many characters of context we capture on each side of the selection. */
const CONTEXT_WINDOW = 40;

export interface TextareaSelectionAnchorBindings {
  onMouseUp: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
  onKeyUp: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export interface UseTextareaSelectionAnchorResult {
  pendingAnchor: AnnotationAnchor | null;
  consumePendingAnchor: () => void;
  bindProps: TextareaSelectionAnchorBindings;
}

export function useTextareaSelectionAnchor(
  fullText: string,
): UseTextareaSelectionAnchorResult {
  const [pendingAnchor, setPendingAnchor] = useState<AnnotationAnchor | null>(null);

  const handleSelection = useCallback(
    (el: HTMLTextAreaElement) => {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      // Ignore collapsed selections (just a cursor blink) and inputs where
      // the browser hasn't resolved selection yet.
      if (start == null || end == null || start === end) return;
      const selectedText = fullText.slice(start, end).trim();
      if (!selectedText) return;
      setPendingAnchor({
        type: 'text_range',
        start,
        end,
        selectedText: fullText.slice(start, end),
        contextBefore: fullText.slice(Math.max(0, start - CONTEXT_WINDOW), start),
        contextAfter: fullText.slice(end, Math.min(fullText.length, end + CONTEXT_WINDOW)),
      });
    },
    [fullText],
  );

  const consumePendingAnchor = useCallback(() => setPendingAnchor(null), []);

  const bindProps: TextareaSelectionAnchorBindings = {
    onMouseUp: (e) => handleSelection(e.currentTarget),
    onKeyUp: (e) => {
      // Arrow / shift / home / end / page keys all change selection; cover
      // the common ones. Letter keys change content, not selection — ignore.
      const k = e.key;
      if (
        k.startsWith('Arrow') ||
        k === 'Home' ||
        k === 'End' ||
        k === 'PageUp' ||
        k === 'PageDown' ||
        k === 'Shift'
      ) {
        handleSelection(e.currentTarget);
      }
    },
  };

  return { pendingAnchor, consumePendingAnchor, bindProps };
}
