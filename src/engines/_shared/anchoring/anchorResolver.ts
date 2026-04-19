// ============================================
// Anchor Resolver — Fuzzy reanchor cascade
// ============================================
//
// Given a stored AnnotationAnchor and the current plain-text body of an
// entity, find the best position for the anchor in the new text. Returns:
//   - the resolved {start, end} if a match is found, plus a confidence score
//   - { orphaned: true } if nothing convincing turned up
//
// The cascade is intentionally cheap → expensive:
//   1. fast path     — exact selectedText still sits at original offsets
//   2. local search  — exact match within a ±DRIFT_WINDOW of the original
//   3. context match — find prefix(contextBefore + selectedText) anywhere
//   4. loose search  — first exact match of selectedText anywhere in body
//   5. orphan        — give up, surface in margin as "needs reanchor"
//
// Pure function — no DB, no side effects. Easy to unit test.

import type { AnnotationAnchor } from '@/engines/annotations/types';

export interface ResolvedAnchor {
  start: number;
  end: number;
  /** 1.0 = exact original offset; lower = fuzzy/local/context match. */
  confidence: number;
  /** Which step of the cascade produced this match — useful for analytics. */
  matchedBy: 'fast' | 'local' | 'context' | 'loose';
}

export type AnchorResolution =
  | { ok: true; anchor: ResolvedAnchor }
  | { ok: false; orphaned: true };

/** Window (chars) around the original offset that step 2 searches. */
const DRIFT_WINDOW = 200;
/** Min selectedText length we'll attempt loose matching on, to avoid false hits. */
const MIN_LOOSE_LEN = 4;

/**
 * Resolve a text-range anchor against the current body text.
 * For non-text-range anchors callers should short-circuit before reaching here.
 */
export function resolveTextRangeAnchor(
  anchor: AnnotationAnchor,
  bodyText: string,
): AnchorResolution {
  const selected = anchor.selectedText ?? '';
  const start = anchor.start ?? -1;
  const end = anchor.end ?? -1;

  if (!selected || start < 0 || end < 0 || end <= start) {
    return { ok: false, orphaned: true };
  }

  // --- Step 1: fast path -------------------------------------------------
  if (
    end <= bodyText.length &&
    bodyText.slice(start, end) === selected
  ) {
    return {
      ok: true,
      anchor: { start, end, confidence: 1, matchedBy: 'fast' },
    };
  }

  // --- Step 2: local search around the original offset -------------------
  const localStart = Math.max(0, start - DRIFT_WINDOW);
  const localEnd = Math.min(bodyText.length, end + DRIFT_WINDOW);
  const window = bodyText.slice(localStart, localEnd);
  const localIdx = window.indexOf(selected);
  if (localIdx !== -1) {
    const newStart = localStart + localIdx;
    return {
      ok: true,
      anchor: {
        start: newStart,
        end: newStart + selected.length,
        confidence: 0.9,
        matchedBy: 'local',
      },
    };
  }

  // --- Step 3: context-triple match -------------------------------------
  // Anchor on (contextBefore + selectedText) when available — much sturdier
  // than selectedText alone in repetitive prose ("the the").
  const before = anchor.contextBefore ?? '';
  if (before) {
    const needle = before + selected;
    const idx = bodyText.indexOf(needle);
    if (idx !== -1) {
      const newStart = idx + before.length;
      return {
        ok: true,
        anchor: {
          start: newStart,
          end: newStart + selected.length,
          confidence: 0.75,
          matchedBy: 'context',
        },
      };
    }
  }

  const after = anchor.contextAfter ?? '';
  if (after) {
    const needle = selected + after;
    const idx = bodyText.indexOf(needle);
    if (idx !== -1) {
      return {
        ok: true,
        anchor: {
          start: idx,
          end: idx + selected.length,
          confidence: 0.75,
          matchedBy: 'context',
        },
      };
    }
  }

  // --- Step 4: loose search (first exact match anywhere) -----------------
  if (selected.length >= MIN_LOOSE_LEN) {
    const idx = bodyText.indexOf(selected);
    if (idx !== -1) {
      return {
        ok: true,
        anchor: {
          start: idx,
          end: idx + selected.length,
          confidence: 0.5,
          matchedBy: 'loose',
        },
      };
    }
  }

  // --- Step 5: orphan ----------------------------------------------------
  return { ok: false, orphaned: true };
}

/**
 * Capture the context triple at create time. ~CONTEXT_LEN chars on either
 * side of the selection, clamped to body bounds.
 */
const CONTEXT_LEN = 40;

export function captureContext(
  bodyText: string,
  start: number,
  end: number,
): { contextBefore: string; contextAfter: string } {
  const safeStart = Math.max(0, Math.min(start, bodyText.length));
  const safeEnd = Math.max(safeStart, Math.min(end, bodyText.length));
  return {
    contextBefore: bodyText.slice(Math.max(0, safeStart - CONTEXT_LEN), safeStart),
    contextAfter: bodyText.slice(safeEnd, Math.min(bodyText.length, safeEnd + CONTEXT_LEN)),
  };
}
