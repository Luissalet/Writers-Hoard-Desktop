/**
 * List / binder / kanban views over the same Writing rows.
 * No parallel store: status and chapter order come from writings themselves.
 */

import type { Writing, WritingStatus } from '@/types';

export type ManuscriptViewMode = 'list' | 'binder' | 'kanban';

export interface ManuscriptCard {
  id: string;
  title: string;
  status: WritingStatus;
  chapter?: number;
  wordCount: number;
  synopsis?: string;
}

export interface ManuscriptKanbanColumn {
  status: WritingStatus;
  cards: ManuscriptCard[];
}

export interface ManuscriptBoard {
  mode: ManuscriptViewMode;
  /** Reading/binder order: numbered chapters first, then unnumbered by createdAt. */
  ordered: ManuscriptCard[];
  columns: ManuscriptKanbanColumn[];
}

function toCard(writing: Writing): ManuscriptCard {
  return {
    id: writing.id,
    title: writing.title,
    status: writing.status,
    chapter: writing.chapter,
    wordCount: writing.wordCount,
    synopsis: writing.synopsis,
  };
}

export function compareManuscriptOrder(a: Writing, b: Writing): number {
  const chapter =
    (a.chapter ?? Number.MAX_SAFE_INTEGER) - (b.chapter ?? Number.MAX_SAFE_INTEGER);
  if (chapter !== 0) return chapter;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

const STATUSES: WritingStatus[] = ['idea', 'draft', 'finished'];

/** Build list/binder/kanban projections from one writings array. */
export function buildManuscriptBoard(
  writings: readonly Writing[],
  mode: ManuscriptViewMode = 'list',
): ManuscriptBoard {
  const orderedWritings = writings.slice().sort(compareManuscriptOrder);
  const ordered = orderedWritings.map(toCard);
  const columns: ManuscriptKanbanColumn[] = STATUSES.map((status) => ({
    status,
    cards: orderedWritings.filter((w) => w.status === status).map(toCard),
  }));
  return { mode, ordered, columns };
}
