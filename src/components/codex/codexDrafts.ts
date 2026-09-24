// ============================================
// codexDrafts — recovery copies of the unsaved entry form
// ============================================
//
// The entry form lives in a modal that every close path unmounts, so what the
// author typed used to vanish with it. Each open form now mirrors itself into
// a per-project local draft store, keyed by the entry id (`'new'` for the
// create form), until it is saved, discarded or the entry is deleted.

import { createLocalDraftStore } from '@/hooks/localDraftStore';
import { getTemplateFields, type CodexEntry, type CodexEntryType } from '@/types';

/** What the entry form edits; `avatarOriginal` is the uncropped source of `avatar`. */
export interface CodexFormValues {
  type: CodexEntryType;
  title: string;
  avatar: string;
  avatarOriginal: string;
  fields: Record<string, string>;
  content: string;
  tags: string[];
}

/**
 * The recovery copy. `base` is the entry the edit started from, so the
 * per-field conflict merge still sees what changed elsewhere after recovery.
 * The image pair is absent when it is the base's own or too large to keep.
 */
export interface CodexFormDraft extends Omit<CodexFormValues, 'avatar' | 'avatarOriginal'> {
  avatar?: string;
  avatarOriginal?: string;
  base?: CodexEntry;
  /** The base's image pair was too large to keep; the entry as it is now stands in. */
  baseImageOmitted?: boolean;
}

// Avatars are full-resolution data URLs; localStorage holds a few MB per origin.
const IMAGE_LIMIT = 200_000;
const TYPES: readonly string[] = ['character', 'location', 'item', 'faction', 'concept', 'magic', 'custom'];

const isStringRecord = (value: unknown): value is Record<string, string> =>
  value !== null && typeof value === 'object' && Object.values(value).every(item => typeof item === 'string');
const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');
const isOptionalString = (value: unknown) => value === undefined || typeof value === 'string';

function isCodexFormDraft(value: unknown): value is CodexFormDraft {
  if (value === null || typeof value !== 'object') return false;
  const draft = value as Partial<CodexFormDraft>;
  const base = draft.base as Partial<CodexEntry> | undefined;
  return typeof draft.type === 'string' && TYPES.includes(draft.type)
    && typeof draft.title === 'string' && typeof draft.content === 'string'
    && isStringRecord(draft.fields) && isStringList(draft.tags)
    && isOptionalString(draft.avatar) && isOptionalString(draft.avatarOriginal)
    && (base === undefined || (typeof base === 'object' && base !== null
      && typeof base.id === 'string' && typeof base.projectId === 'string'
      && typeof base.title === 'string' && typeof base.content === 'string'
      && isStringRecord(base.fields) && isStringList(base.tags) && Array.isArray(base.relations)));
}

export function codexDraftStore(projectId: string): Map<string, CodexFormDraft> {
  return createLocalDraftStore(`wh.codex-drafts.v1.${projectId}`, isCodexFormDraft);
}

/** The saved state of an entry, or of a fresh one, as the form holds it. */
export function codexFormValues(entry?: CodexEntry): CodexFormValues {
  const type = entry?.type || 'character';
  return {
    type,
    title: entry?.title || '',
    avatar: entry?.avatar || '',
    avatarOriginal: entry?.avatarOriginal || entry?.avatar || '',
    fields: entry?.fields || getTemplateFields(type),
    content: entry?.content || '',
    tags: entry?.tags || [],
  };
}

export function sameCodexFormValues(a: CodexFormValues, b: CodexFormValues): boolean {
  return a.type === b.type && a.title === b.title && a.content === b.content
    && a.avatar === b.avatar && a.avatarOriginal === b.avatarOriginal
    && JSON.stringify(a.fields) === JSON.stringify(b.fields) && JSON.stringify(a.tags) === JSON.stringify(b.tags);
}

const fits = (...images: (string | undefined)[]) => images.every(image => (image ?? '').length <= IMAGE_LIMIT);

export function toCodexDraft(values: CodexFormValues, base?: CodexEntry): CodexFormDraft {
  const { avatar, avatarOriginal, ...text } = values;
  const draft: CodexFormDraft = { ...text };
  const saved = codexFormValues(base);
  // An oversized new image is not kept: recovery falls back to the base's.
  if ((avatar !== saved.avatar || avatarOriginal !== saved.avatarOriginal) && fits(avatar, avatarOriginal)) {
    Object.assign(draft, { avatar, avatarOriginal });
  }
  if (base) {
    const keepImage = fits(base.avatar, base.avatarOriginal);
    draft.base = keepImage ? base : { ...base, avatar: undefined, avatarOriginal: undefined };
    if (!keepImage) draft.baseImageOmitted = true;
  }
  return draft;
}

/** `entry` is the version the form is opened on now. */
export function restoreCodexDraft(draft: CodexFormDraft, entry?: CodexEntry): { values: CodexFormValues; base?: CodexEntry } {
  const { avatar, avatarOriginal, base: storedBase, baseImageOmitted, ...text } = draft;
  const base = storedBase && baseImageOmitted
    ? { ...storedBase, avatar: entry?.avatar, avatarOriginal: entry?.avatarOriginal }
    : storedBase ?? entry;
  const image = avatar !== undefined && avatarOriginal !== undefined ? { avatar, avatarOriginal } : codexFormValues(base);
  return { values: { ...text, avatar: image.avatar, avatarOriginal: image.avatarOriginal }, base };
}
