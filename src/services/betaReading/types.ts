// ============================================================================
// Beta reading — stored rows and the two file formats
// ============================================================================
//
// Two files travel: the PACKAGE the writer sends (one self-contained HTML page
// that carries its own manifest) and the RESPONSE the reader sends back (one
// JSON file). Everything else here is what the app keeps in Dexie.

import type { AnchorState, BetaAnchor } from './anchor';

export type { AnchorState, BetaAnchor };

export const PACKAGE_FORMAT = 'writers-hoard.beta-package';
export const RESPONSE_FORMAT = 'writers-hoard.beta-response';
export const FORMAT_VERSION = 1;

/** What a reader can mark on a chapter. Order is the order of the buttons. */
export const REACTIONS = ['love', 'laugh', 'tense', 'sad', 'confused', 'bored'] as const;
export type BetaReaction = typeof REACTIONS[number];

export type BetaStatus = AnchorState | 'resolved';

// --- the package file ------------------------------------------------------

export interface PackageManifestChapter {
  /** The Writing's id: what a response's comments point back to. */
  chapterId: string;
  title: string;
  /** Position in the package, from 1. */
  order: number;
  /** Hash of the plain text at the moment the package was made. */
  contentHash: string;
  wordCount: number;
  /** The plain text snapshot: one paragraph per line. */
  text: string;
}

export interface PackageManifest {
  format: typeof PACKAGE_FORMAT;
  formatVersion: number;
  packageId: string;
  /** Monotonic per project: 1, 2, 3 … */
  version: number;
  projectId: string;
  projectTitle: string;
  createdAt: string;
  locale: 'es' | 'en';
  chapters: PackageManifestChapter[];
}

// --- the response file -----------------------------------------------------

export interface ResponseComment {
  /** The reader page's own id; only a fallback, the stored id is derived from the content. */
  id: string;
  chapterId: string;
  quote: string;
  prefix: string;
  suffix: string;
  paragraph: number;
  text: string;
  createdAt: string;
}

export interface ReaderResponse {
  format: typeof RESPONSE_FORMAT;
  formatVersion: number;
  packageId: string;
  packageVersion: number;
  reader: string;
  exportedAt: string;
  /** Hash of each chapter the reader was shown, so a response can be judged even without the package row. */
  chapters: Array<{ chapterId: string; contentHash: string }>;
  reactions: Record<string, string[]>;
  comments: ResponseComment[];
}

// --- stored rows -----------------------------------------------------------

export interface BetaPackageRow {
  id: string;
  projectId: string;
  version: number;
  title: string;
  locale: 'es' | 'en';
  createdAt: number;
  chapters: Array<PackageManifestChapter & { html: string }>;
  /** Where the file was written, when the desktop app did it. */
  filePath?: string;
}

export interface BetaResponseRow {
  id: string;
  projectId: string;
  packageId: string;
  packageVersion: number;
  reader: string;
  exportedAt: number;
  importedAt: number;
  /** Chapter id → reaction keys, as the reader last sent them. */
  reactions: Record<string, string[]>;
  /** Hash of each chapter the reader saw. */
  chapterHashes: Record<string, string>;
}

export interface BetaCommentRow {
  /** Derived from the content, so importing the same file twice is a no-op. */
  id: string;
  projectId: string;
  responseId: string;
  packageId: string;
  packageVersion: number;
  reader: string;
  /** The Writing this comment is about. */
  writingId: string;
  anchor: BetaAnchor;
  text: string;
  /** When the reader wrote it. */
  createdAt: number;
  importedAt: number;
  updatedAt: number;
  /** Where the quote sits in the chapter now (as of `evaluatedHash`). */
  anchorState: AnchorState;
  matchParagraph: number | null;
  matchStart: number | null;
  matchEnd: number | null;
  /** The chapter text hash `anchorState` was computed against; a different hash means "recompute". */
  evaluatedHash: string;
  resolved: boolean;
  resolvedAt?: number;
}

export function statusOf(comment: Pick<BetaCommentRow, 'resolved' | 'anchorState'>): BetaStatus {
  return comment.resolved ? 'resolved' : comment.anchorState;
}
