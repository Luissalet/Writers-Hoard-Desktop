import type { DialogBlock } from './types';

/**
 * Scene Chronometry — estimate scene duration from dialog blocks.
 *
 * Industry-standard screenplay timing: approximately 1 minute per page.
 * A standard screenplay page is ~55 lines, ~250 words.
 *
 * Three estimation modes:
 * 1. Page Count: 1 min per ~250 words (industry standard)
 * 2. Character Count: Based on average reading speed (150 wpm spoken dialog, 200 wpm action)
 * 3. Custom: User-defined words-per-minute rate
 */

export type ChronometryMode = 'page' | 'character' | 'custom';

export interface ChronometryResult {
  /** Estimated duration in seconds */
  totalSeconds: number;
  /** Human-readable duration string */
  formatted: string;
  /** Word count across all blocks */
  wordCount: number;
  /** Equivalent page count (screenplay standard) */
  pageCount: number;
  /** Breakdown by block type */
  breakdown: {
    dialogSeconds: number;
    actionSeconds: number;
    otherSeconds: number;
  };
}

const WORDS_PER_PAGE = 250;
const SECONDS_PER_PAGE = 60;

// Spoken dialog is slower than action descriptions
const DIALOG_WPM = 150; // spoken words per minute
const ACTION_WPM = 200; // read/action words per minute
const DIRECTION_WPM = 180; // stage directions, mid-range

function countWords(text: string): number {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

export function estimateSceneDuration(
  blocks: DialogBlock[],
  mode: ChronometryMode = 'page',
  customWpm?: number,
): ChronometryResult {
  let dialogWords = 0;
  let actionWords = 0;
  let otherWords = 0;

  for (const block of blocks) {
    const words = countWords(block.content);
    if (block.type === 'dialog') {
      dialogWords += words;
    } else if (block.type === 'action') {
      actionWords += words;
    } else {
      // stage-direction, transition, note, slug
      otherWords += words;
    }
  }

  const totalWords = dialogWords + actionWords + otherWords;

  let dialogSeconds: number;
  let actionSeconds: number;
  let otherSeconds: number;

  switch (mode) {
    case 'page': {
      // 1 minute per page, proportional distribution
      const pages = totalWords / WORDS_PER_PAGE;
      const totalSec = pages * SECONDS_PER_PAGE;
      const ratio = totalWords > 0 ? totalSec / totalWords : 0;
      dialogSeconds = dialogWords * ratio;
      actionSeconds = actionWords * ratio;
      otherSeconds = otherWords * ratio;
      break;
    }
    case 'character': {
      // Different WPM for spoken vs. read content
      dialogSeconds = totalWords > 0 ? (dialogWords / DIALOG_WPM) * 60 : 0;
      actionSeconds = totalWords > 0 ? (actionWords / ACTION_WPM) * 60 : 0;
      otherSeconds = totalWords > 0 ? (otherWords / DIRECTION_WPM) * 60 : 0;
      break;
    }
    case 'custom': {
      const wpm = customWpm || 160;
      const secsPerWord = 60 / wpm;
      dialogSeconds = dialogWords * secsPerWord;
      actionSeconds = actionWords * secsPerWord;
      otherSeconds = otherWords * secsPerWord;
      break;
    }
  }

  const totalSeconds = Math.round(dialogSeconds + actionSeconds + otherSeconds);

  return {
    totalSeconds,
    formatted: formatDuration(totalSeconds),
    wordCount: totalWords,
    pageCount: Math.round((totalWords / WORDS_PER_PAGE) * 10) / 10,
    breakdown: {
      dialogSeconds: Math.round(dialogSeconds),
      actionSeconds: Math.round(actionSeconds),
      otherSeconds: Math.round(otherSeconds),
    },
  };
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return remainingMin > 0 ? `${hours}h ${remainingMin}m` : `${hours}h`;
}
