import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import type { ChapterPresentation, ReaderPresentation } from './readerPresentationTypes';
import { safeReaderTrack } from './readerSoundtrack';
export const defaultReaderPresentation = (): ReaderPresentation => ({ revision: 0, cover: { style: 'hardcover', color: '#293b33', texture: 'linen', artwork: true, showAtStart: false }, chapters: {} });
export const defaultChapterPresentation = (): ChapterPresentation => ({ font: 'inherit', background: '', imageLayout: 'above', mode: 'flow' });
export const readerRaster = (value: string | undefined): value is string => typeof value === 'string' && /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(value) && value.length <= 3_000_000;
export const readerColor = (value: unknown) => typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value) ? value : '';
export function readerInk(background: string): string {
  const color = readerColor(background); if (!color) return '';
  const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? '#000000' : '#ffffff';
}
export function safeReaderPresentation(value: ReaderPresentation | undefined): ReaderPresentation {
  const initial = defaultReaderPresentation(); if (!value || typeof value !== 'object') return initial;
  const cover = value.cover && typeof value.cover === 'object' ? value.cover : initial.cover;
  const chapters = value.chapters && typeof value.chapters === 'object' && !Array.isArray(value.chapters) ? value.chapters : {};
  const choice = <T extends string>(candidate: unknown, allowed: readonly T[], fallback: T): T => typeof candidate === 'string' && allowed.includes(candidate as T) ? candidate as T : fallback;
  return {
    revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    cover: { style: choice(cover.style, ['hardcover', 'paperback', 'paper'], initial.cover.style), color: readerColor(cover.color) || initial.cover.color, texture: choice(cover.texture, ['none', 'linen', 'lines'], 'none'), artwork: cover.artwork !== false, showAtStart: cover.showAtStart === true },
    chapters: Object.fromEntries(Object.entries(chapters).map(([id, candidate]) => {
      const chapter = candidate && typeof candidate === 'object' ? candidate : defaultChapterPresentation();
      const paragraphAudio = Array.isArray(chapter.paragraphAudio) ? chapter.paragraphAudio.flatMap(cue => { const track = safeReaderTrack(cue?.track); return track && Number.isSafeInteger(cue.paragraphIndex) && cue.paragraphIndex >= 0 && typeof cue.fingerprint === 'string' && /^\d+:\d+$/.test(cue.fingerprint) ? [{ paragraphIndex: cue.paragraphIndex, fingerprint: cue.fingerprint, excerpt: String(cue.excerpt ?? '').slice(0, 100), track }] : []; }).slice(0, 2000) : undefined;
      return [id, { font: choice(chapter.font, ['inherit', 'serif', 'sans', 'mono'], 'inherit'), background: readerColor(chapter.background), image: readerRaster(chapter.image) ? chapter.image : undefined, imageLayout: choice(chapter.imageLayout, ['above', 'beside', 'none'], 'above'), mode: choice(chapter.mode, ['pages', 'flow'], 'flow'), audio: safeReaderTrack(chapter.audio), paragraphAudio }];
    })),
  };
}
/** Merge settings per field, so different chapter edits never replace one another. */
export async function saveReaderPresentation(projectId: string, draft: ReaderPresentation, base: ReaderPresentation): Promise<ReaderPresentation> {
  const safe = safeReaderPresentation(draft); base = safeReaderPresentation(base);
  const result = await db.transaction('rw', [db.projects, db.writings, db.localMediaAssets], async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('missing_project');
    const current = safeReaderPresentation(project.readerPresentation);
    const merge = <T extends object>(original: T, ours: T, latest: T): T => {
      const result = { ...latest };
      for (const key of Object.keys(ours) as (keyof T)[]) {
        if (JSON.stringify(ours[key]) === JSON.stringify(original[key])) continue;
        if (JSON.stringify(latest[key]) !== JSON.stringify(original[key]) && JSON.stringify(latest[key]) !== JSON.stringify(ours[key])) throw new Error('presentation_conflict');
        result[key] = ours[key];
      }
      return result;
    };
    const chapters = { ...current.chapters }; const writings = await db.writings.where('projectId').equals(projectId).primaryKeys();
    for (const [id, chapter] of Object.entries(safe.chapters)) {
      const original = base.chapters[id] ?? defaultChapterPresentation();
      if (!writings.includes(id)) { if (JSON.stringify(chapter) === JSON.stringify(original)) continue; throw new Error('missing_chapter'); }
      // Archived chapters/tracks retain their presentation so restoration can
      // recover it. Unchanged unavailable references must not lock the cover
      // or another chapter's settings; newly assigned audio is still scoped.
      const tracks = [JSON.stringify(chapter.audio) !== JSON.stringify(original.audio) ? chapter.audio : undefined, ...(JSON.stringify(chapter.paragraphAudio) !== JSON.stringify(original.paragraphAudio) ? (chapter.paragraphAudio ?? []).map(cue => cue.track) : [])].filter(track => track !== undefined);
      for (const track of tracks) { const asset = await db.localMediaAssets.get(track.assetId); if (!asset || asset.projectId !== projectId || asset.kind !== 'audio') throw new Error('missing_audio'); }
      Object.defineProperty(chapters, id, { value: merge(original, chapter, current.chapters[id] ?? defaultChapterPresentation()), enumerable: true, configurable: true, writable: true });
    }
    const next = { revision: current.revision + 1, cover: merge(base.cover, safe.cover, current.cover), chapters };
    await db.projects.update(projectId, { readerPresentation: next, updatedAt: Date.now() }); return next;
  });
  notifyProjectsChanged(); return result;
}
