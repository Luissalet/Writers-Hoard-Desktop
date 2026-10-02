// ============================================================================
// What Writers Hoard hands to Prospero's Hoard (pure payload builders)
// ============================================================================
//
// `cast_import_character {name, description?, look?, images?: [paths], source_ref?}`
//   a codex character becomes a cast member: who they are, how they look, and
//   their portrait (plus a few gallery pictures linked to them) as PNG files;
// `production_from_storyboard {title, shots: [{text, duration_s?, image?}], source_ref?}`
//   a storyboard becomes a production draft: one shot per panel, in order.
//
// The builders only decide WHAT is sent. Pictures are named `@file:<id>` in the
// arguments and travel beside them as `pictures` (data URLs as stored); the
// action layer turns those into PNGs and main turns the names into temporary
// paths (electron/familyCall.ts).

import type { CodexEntry, InspirationImage } from '@/types';
import type { StoryboardPanel } from '@/engines/storyboard/types';
import { htmlToMarkdown } from '@/engines/writings/manuscriptExport';
import { FILE_PLACEHOLDER, MAX_FILES } from './protocol';

export const MAX_CHARACTER_PICTURES = 4;
const MAX_DESCRIPTION = 6000;
const MAX_LOOK = 2000;
const MAX_SHOT_TEXT = 1500;

export interface Picture {
  id: string;
  /** A stored `data:image/...;base64,` URL. */
  dataUrl: string;
}

/** Keys of a character sheet that say how someone LOOKS; they go to `look`, not to the description. */
const LOOK_KEY = /^(physical|appearance|look|aspect|apariencia|f[ií]sic|hair|eyes?|height|build|skin|clothing|outfit|cabello|pelo|ojos|altura|complexi|ropa|vestuario)/i;
/** Sheet keys with a heading of their own in the description, in reading order. */
const STORY_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['role', 'Role'], ['species', 'Species'], ['age', 'Age'], ['personality', 'Personality'], ['backstory', 'Backstory'],
  ['abilities', 'Abilities'], ['goals', 'Goals'], ['flaws', 'Flaws'],
];
const SKIP_KEYS = new Set(['name', 'summary']);

function humanKey(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function characterLook(fields: Record<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || !value.trim() || !LOOK_KEY.test(key)) continue;
    lines.push(/^(physical|appearance|look|aspect|apariencia|f[ií]sic)/i.test(key) ? value.trim() : `${humanKey(key)}: ${value.trim()}`);
  }
  return lines.join('\n').slice(0, MAX_LOOK);
}

export function characterDescription(entry: Pick<CodexEntry, 'fields' | 'content'>): string {
  const fields = entry.fields ?? {};
  const parts: string[] = [];
  const summary = fields.summary?.trim();
  if (summary) parts.push(summary);
  const used = new Set<string>();
  for (const [key, label] of STORY_KEYS) {
    const value = fields[key]?.trim();
    if (!value) continue;
    used.add(key);
    parts.push(`${label}: ${value}`);
  }
  for (const [key, value] of Object.entries(fields)) {
    if (used.has(key) || SKIP_KEYS.has(key) || LOOK_KEY.test(key) || typeof value !== 'string' || !value.trim()) continue;
    parts.push(`${humanKey(key)}: ${value.trim()}`);
  }
  const body = entry.content ? htmlToMarkdown(entry.content).trim() : '';
  if (body) parts.push(body);
  return parts.join('\n\n').slice(0, MAX_DESCRIPTION);
}

export interface CharacterPayload {
  args: { name: string; description: string; look: string; images: string[]; source_ref: string };
  pictures: Picture[];
}

/**
 * The cast-member request for a codex character. `gallery` is the project's
 * gallery; the images linked to this entry follow the portrait, up to four pictures in all.
 */
export function buildCharacterPayload(entry: CodexEntry, sourceRef: string, gallery: InspirationImage[] = []): CharacterPayload {
  const pictures: Picture[] = [];
  const portrait = entry.avatarOriginal || entry.avatar;
  if (portrait?.startsWith('data:image/')) pictures.push({ id: 'portrait', dataUrl: portrait });
  const linked = gallery
    .filter(image => (image.linkedEntryIds ?? [image.linkedEntryId]).includes(entry.id))
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const image of linked) {
    if (pictures.length >= MAX_CHARACTER_PICTURES) break;
    const data = image.imageData || image.thumbnailData;
    if (data?.startsWith('data:image/') && !pictures.some(picture => picture.dataUrl === data)) pictures.push({ id: `gallery-${pictures.length}`, dataUrl: data });
  }
  return {
    args: {
      name: (entry.fields?.name?.trim() || entry.title).trim(),
      description: characterDescription(entry),
      look: characterLook(entry.fields ?? {}),
      images: pictures.map(picture => `${FILE_PLACEHOLDER}${picture.id}`),
      source_ref: sourceRef,
    },
    pictures,
  };
}

/** Seconds for a panel's free-text duration: "8", "8s", "1:30", "00:15-00:23". Undefined when it is not a duration. */
export function durationSeconds(text: string | undefined): number | undefined {
  const raw = (text ?? '').trim().toLowerCase();
  if (!raw) return undefined;
  const clock = (value: string): number | undefined => {
    const parts = value.trim().split(':').map(Number);
    if (!parts.length || parts.length > 3 || parts.some(part => !Number.isFinite(part) || part < 0)) return undefined;
    return parts.reduce((total, part) => total * 60 + part, 0);
  };
  const range = /^([\d:.]+)\s*[-–—]\s*([\d:.]+)$/.exec(raw);
  if (range) {
    const start = clock(range[1]);
    const end = clock(range[2]);
    return start !== undefined && end !== undefined && end > start ? Math.round((end - start) * 10) / 10 : undefined;
  }
  if (raw.includes(':')) {
    const seconds = clock(raw.replace(/\s*(s|sec|secs|seconds?)$/, ''));
    return seconds && seconds > 0 ? seconds : undefined;
  }
  const plain = /^(\d+(?:[.,]\d+)?)\s*(s|sec|secs|seconds?|segundos?|seg)?$/.exec(raw);
  if (!plain) return undefined;
  const value = Number(plain[1].replace(',', '.'));
  return value > 0 ? value : undefined;
}

export interface StoryboardPayload {
  args: { title: string; shots: Array<{ text: string; duration_s?: number; image?: string }>; source_ref: string };
  pictures: Picture[];
  /** Panels whose picture was left out because the call is limited to MAX_FILES pictures. */
  picturesDropped: number;
}

/**
 * The production-draft request for a storyboard: one shot per panel in order.
 * `imageOf` resolves a panel's picture (its own, or the gallery image it refers to).
 */
export function buildStoryboardPayload(
  title: string,
  panels: StoryboardPanel[],
  sourceRef: string,
  imageOf: (panel: StoryboardPanel) => string | undefined,
): StoryboardPayload {
  const pictures: Picture[] = [];
  let dropped = 0;
  const shots = [...panels].sort((a, b) => a.order - b.order).map((panel, index) => {
    const heading = (panel.subtitle ?? '').trim();
    const detail = (panel.description ?? '').trim();
    const text = [heading, detail].filter(Boolean).join('\n').slice(0, MAX_SHOT_TEXT) || `Shot ${index + 1}`;
    const shot: { text: string; duration_s?: number; image?: string } = { text };
    const seconds = durationSeconds(panel.duration);
    if (seconds !== undefined) shot.duration_s = seconds;
    const data = imageOf(panel);
    if (data?.startsWith('data:image/')) {
      if (pictures.length < MAX_FILES) {
        const id = `shot-${index + 1}`;
        pictures.push({ id, dataUrl: data });
        shot.image = `${FILE_PLACEHOLDER}${id}`;
      } else dropped += 1;
    }
    return shot;
  });
  return { args: { title: title.trim() || 'Storyboard', shots, source_ref: sourceRef }, pictures, picturesDropped: dropped };
}
