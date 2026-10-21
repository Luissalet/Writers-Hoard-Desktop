import type { ManuscriptBlock, ManuscriptSource, ChapterSplitMode } from '../manuscriptImport';
export interface ImportFinding { code: string; count: number; detail?: string }
export interface SourceComment { id: string; author: string; date: string; parent: string | null; resolved: boolean; text: string; startMarker: string; endMarker: string }
export interface InspectedManuscript extends ManuscriptSource { sha256: string; original: Blob; findings: ImportFinding[]; comments: SourceComment[]; markerPrefix: string; format: string; sourceOnlyComments?: number }
export interface ImportSplit { mode: ChapterSplitMode; headingLevel: number; separator: string }
export interface ImportChoice { key: string; title: string; included: boolean; targetId?: string; expectedUpdatedAt?: number; expectedDocumentVersion?: string }
export interface ImportComment { source: SourceComment; start: number; end: number; selectedText: string; contextBefore: string; contextAfter: string; replies: SourceComment[] }
export interface ImportPlanChapter { key: string; title: string; content: string; words: number; pendingRevisions: number; comments: ImportComment[]; choice: ImportChoice; blocks: ManuscriptBlock[] }
export interface ManuscriptPlan { digest: string; chapters: ImportPlanChapter[]; findings: ImportFinding[]; importedComments: number; importedReplies: number; retainedComments: number }
export type { ManuscriptSourceReceipt, ManuscriptSourceRow, ManuscriptWritingSource, ImportedCommentOrigin } from './sourceTypes';
