// ============================================
// Annotations Engine — Types
// ============================================
//
// Cross-cutting annotation layer (Engine #22). Attaches text/image/reference
// notes to entities — or specific text ranges within entities — across every
// engine that registers an AnchorAdapter.
//
// Two-table model:
//   annotations            — the note shell (anchor + body)
//   annotationReferences   — the reference payload for reference-type notes
//                            (kept in its own table so the shell stays agnostic
//                             and multi-reference notes are a future schema
//                             extension rather than a column rewrite)
//
// Anchor tiers:
//   - entity       : attaches to an entity as a whole (all 5 v1 engines)
//   - text_range   : attaches to a specific plain-text range within the
//                    entity's body text. HTML is stripped before measuring
//                    offsets so format-only edits don't invalidate anchors.
//   - map_point    : a spot on a classic map (x, y in percent of the image).

export type NoteType = 'text' | 'image' | 'reference';
export type AnchorType = 'entity' | 'text_range' | 'map_point';

/**
 * Anchor data stored on every annotation. For `text_range` anchors we also
 * persist a context triple (prev/selected/next) that powers the fuzzy
 * reanchor algorithm when the underlying text drifts.
 */
export interface AnnotationAnchor {
  type: AnchorType;
  /** Plain-text character offset (HTML-stripped). Present for text_range only. */
  start?: number;
  end?: number;
  /** The originally selected plain text. Used for verification + fuzzy match. */
  selectedText?: string;
  /** ~40 chars of plain text preceding the selection. */
  contextBefore?: string;
  /** ~40 chars of plain text following the selection. */
  contextAfter?: string;
  /** map_point only: where on the map image the note sits, in percent of its width and height. */
  x?: number;
  y?: number;
}

/**
 * The note shell. One row per annotation in the `annotations` Dexie table.
 */
export interface Annotation {
  importedComment?: import('@/engines/writings/manuscriptReview/sourceTypes').ImportedCommentOrigin;
  id: string;
  projectId: string;
  /** Exact comment context; absence means Shared base. */
  eraId?: string;
  /** Legacy rows read as revision0/open/without replies. */
  revision?: number;
  replies?: AnnotationReply[];
  mentions?: AnnotationMention[];
  resolvedAt?: number;
  /** Engine the anchor lives in — e.g. 'writings', 'codex'. */
  sourceEngineId: string;
  /** The entity being annotated (chapter id, codex entry id, seed id, etc.). */
  sourceEntityId: string;
  anchor: AnnotationAnchor;
  noteType: NoteType;
  /** Body for text notes (markdown or plain text). */
  noteBody?: string;
  /** Data URL or relative path for image notes. */
  noteImageUrl?: string;
  /** Flipped true when fuzzy reanchor fails to relocate the selection. */
  isOrphaned: boolean;
  /** Stacking order when multiple notes hit the same position. */
  position: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * The reference payload for reference-type notes. One row per reference;
 * 1:1 with its parent annotation in v1 (enforced by unique index). Dropping
 * the uniqueness later is a non-breaking change that unlocks multi-reference
 * notes if we ever want them.
 */
export interface AnnotationReference {
  id: string;
  annotationId: string;
  /** Engine that owns the target entity — e.g. 'seeds', 'codex'. */
  targetEngineId: string;
  targetEntityId: string;
  createdAt: number;
}

/**
 * Composite shape returned by hooks when a reference note is hydrated with
 * its reference row. Used by the margin panel and backlinks.
 */
export interface AnnotationWithReference extends Annotation {
  reference?: AnnotationReference;
  /** Derived local titles for dashboard search; never persisted. */
  mentionTitles?:string[];
}

/**
 * Shape returned by `useEntityBacklinks` — a list of notes that reference a
 * given entity from some other (or the same) engine.
 */
export interface BacklinkPreview {
  annotationId: string;
  sourceEngineId: string;
  sourceEntityId: string;
  sourceEntityTitle: string;
  /** For text_range anchors: the originally selected text. */
  anchorSnippet?: string;
  noteType: NoteType;
  noteBody?: string;
  createdAt: number;
}

export interface AnnotationMention { engineId: string; entityId: string }
export interface AnnotationReply { id: string; body: string; mentions?: AnnotationMention[]; createdAt: number; updatedAt: number; importedComment?: import('@/engines/writings/manuscriptReview/sourceTypes').ImportedCommentOrigin }
export interface AnnotationThreadFields { noteBody?: string; mentions?: AnnotationMention[]; replies?: AnnotationReply[]; resolvedAt?: number }
export type AnnotationUndo = { receiptId:string;projectId:string;eraId?:string;annotationId:string;expectedRevision:number;kind:'edit';before:AnnotationThreadFields } | { receiptId:string;projectId:string;eraId?:string;annotationId:string;kind:'delete';before:Annotation;reference?:AnnotationReference };
export class AnnotationConflict extends Error { constructor(){super('annotation_thread_conflict');this.name='AnnotationConflict';} }
