import type { DialogBlock } from '@/engines/dialog-scene/types';
import type { Writing } from '@/types';
import { stripHtml } from '@/utils/text';
import type {
  CharacterVoiceAssignment,
  ReadAloudBlock,
  ReadAloudBlockKind,
  ReadAloudGranularity,
  ReadAloudLocale,
  ReadAloudSegment,
} from './types';

const BLOCK_BREAK = /<\/?(?:p|div|li|h[1-6]|blockquote|pre|figure|tr)\b[^>]*>|<br\s*\/?\s*>/gi;

function compactText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Projects a rich-text writing into stable paragraph-like blocks without
 * touching the writing. The fallback keeps plain-text line breaks meaningful.
 */
export function writingToReadAloudBlocks(
  writing: Pick<Writing, 'id' | 'title' | 'content'>,
): ReadAloudBlock[] {
  const marked = writing.content.replace(BLOCK_BREAK, '\n');
  const paragraphs = marked
    .split(/\n+/)
    .map((part) => compactText(stripHtml(part)))
    .filter(Boolean);
  const resolved = paragraphs.length > 0
    ? paragraphs
    : compactText(stripHtml(writing.content))
      ? [compactText(stripHtml(writing.content))]
      : [];

  return resolved.map((text, index) => ({
    id: `${writing.id}:paragraph:${index}`,
    sourceId: writing.id,
    sourceKind: 'writing',
    kind: 'prose',
    text,
    label: writing.title,
  }));
}

function dialogKind(type: DialogBlock['type']): ReadAloudBlockKind {
  return type === 'dialog' ? 'dialogue' : type;
}

/** Projects screenplay blocks in their canonical order, preserving speakers. */
export function dialogBlocksToReadAloudBlocks(
  blocks: readonly DialogBlock[],
): ReadAloudBlock[] {
  return [...blocks]
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .flatMap((block): ReadAloudBlock[] => {
      const rows: ReadAloudBlock[] = [];
      const parenthetical = compactText(block.parenthetical ?? '');
      if (block.type === 'dialog' && parenthetical) {
        rows.push({
          id: `${block.id}:parenthetical`,
          sourceId: block.id,
          sourceKind: 'dialog-block',
          kind: 'stage-direction',
          text: parenthetical,
          label: block.characterName,
          characterId: block.characterId,
          characterName: block.characterName,
          characterColor: block.characterColor,
        });
      }

      const text = compactText(block.content);
      if (text) {
        rows.push({
          id: block.id,
          sourceId: block.id,
          sourceKind: 'dialog-block',
          kind: dialogKind(block.type),
          text,
          label: block.type === 'dialog' ? block.characterName : undefined,
          characterId: block.type === 'dialog' ? block.characterId : undefined,
          characterName: block.type === 'dialog' ? block.characterName : undefined,
          characterColor: block.type === 'dialog' ? block.characterColor : undefined,
        });
      }
      return rows;
    });
}

interface SegmentLike {
  segment: string;
  index: number;
}

function fallbackSentenceSegments(text: string): SegmentLike[] {
  const result: SegmentLike[] = [];
  const matcher = /[^.!?\u00bf\u00a1\u2026]+(?:[.!?\u2026]+[\]})"'\u00bb\u201d\u2019]*|$)/gu;
  for (const match of text.matchAll(matcher)) {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const segment = raw.trim();
    if (segment) result.push({ segment, index: (match.index ?? 0) + leading });
  }
  return result.length > 0 ? result : [{ segment: text, index: 0 }];
}

function sentenceSegments(text: string, locale: ReadAloudLocale): SegmentLike[] {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
    return [...segmenter.segment(text)]
      .map((part) => {
        const leading = part.segment.length - part.segment.trimStart().length;
        return { segment: part.segment.trim(), index: part.index + leading };
      })
      .filter((part) => part.segment.length > 0);
  }
  return fallbackSentenceSegments(text);
}

export function segmentReadAloudBlocks(
  blocks: readonly ReadAloudBlock[],
  granularity: ReadAloudGranularity,
  locale: ReadAloudLocale,
): ReadAloudSegment[] {
  let segmentIndex = 0;
  return blocks.flatMap((block, blockIndex) => {
    const parts = granularity === 'block'
      ? [{ segment: block.text, index: 0 }]
      : sentenceSegments(block.text, locale);
    return parts.map((part) => {
      const row: ReadAloudSegment = {
        ...block,
        segmentId: `${block.id}:segment:${part.index}:${part.segment.length}`,
        blockIndex,
        segmentIndex,
        startOffset: part.index,
        endOffset: part.index + part.segment.length,
        text: part.segment,
      };
      segmentIndex += 1;
      return row;
    });
  });
}

export function voicePreferenceKey(
  value: Pick<ReadAloudBlock, 'characterId' | 'characterName'>,
): string | undefined {
  if (value.characterId?.trim()) return `id:${value.characterId.trim()}`;
  if (value.characterName?.trim()) return `name:${value.characterName.trim().toLocaleLowerCase()}`;
  return undefined;
}

export function collectCharacterVoiceAssignments(
  blocks: readonly ReadAloudBlock[],
  preferences: Readonly<Record<string, string | undefined>>,
): CharacterVoiceAssignment[] {
  const byKey = new Map<string, CharacterVoiceAssignment>();
  for (const block of blocks) {
    if (block.kind !== 'dialogue' || !block.characterName) continue;
    const key = voicePreferenceKey(block);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, {
      key,
      characterId: block.characterId,
      characterName: block.characterName,
      color: block.characterColor,
      voiceURI: preferences[key],
    });
  }
  return [...byKey.values()].sort((left, right) =>
    left.characterName.localeCompare(right.characterName),
  );
}
