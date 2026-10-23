import { db } from '@/db';
import { notifyProjectsChanged } from '@/db/operations';
import type { ChapterPresentation, ReaderPresentation } from './readerPresentationTypes';
import { safeReaderTrack } from './readerSoundtrack';
import { listEraRows, readEraRow } from '@/services/worldEras/store';
import type { LocalMediaAsset } from '@/engines/media/types';
import type { Writing } from '@/types';
import {applyEraReaderCover,validateReaderCover,validateCoverJacket} from './coverDesign/model';
export const defaultReaderPresentation = (): ReaderPresentation => ({ revision: 0, playback: { mode: 'read', wordsPerMinute: 240 }, cover: { style: 'hardcover', color: '#293b33', texture: 'linen', artwork: true, showAtStart: false }, chapters: {} });
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
  if(cover.jacket!==undefined)validateCoverJacket(cover.jacket);
  const chapters = value.chapters && typeof value.chapters === 'object' && !Array.isArray(value.chapters) ? value.chapters : {};
  const choice = <T extends string>(candidate: unknown, allowed: readonly T[], fallback: T): T => typeof candidate === 'string' && allowed.includes(candidate as T) ? candidate as T : fallback;
  return {
    revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    playback: { mode: value.playback?.mode === 'play' ? 'play' : 'read', wordsPerMinute: Number.isFinite(value.playback?.wordsPerMinute) ? Math.max(60, Math.min(1000, Number(value.playback?.wordsPerMinute))) : 240 },
    cover: { style: choice(cover.style, ['hardcover', 'paperback', 'paper'], initial.cover.style), color: readerColor(cover.color) || initial.cover.color, texture: choice(cover.texture, ['none', 'linen', 'lines'], 'none'), artwork: cover.artwork !== false, showAtStart: cover.showAtStart === true, ...(cover.jacket?{jacket:structuredClone(cover.jacket)}:{}) },
    chapters: Object.fromEntries(Object.entries(chapters).map(([id, candidate]) => {
      const chapter = candidate && typeof candidate === 'object' ? candidate : defaultChapterPresentation();
      const paragraphAudio = Array.isArray(chapter.paragraphAudio) ? chapter.paragraphAudio.flatMap(cue => { const track = safeReaderTrack(cue?.track); return track && Number.isSafeInteger(cue.paragraphIndex) && cue.paragraphIndex >= 0 && typeof cue.fingerprint === 'string' && /^\d+:\d+$/.test(cue.fingerprint) ? [{ paragraphIndex: cue.paragraphIndex, fingerprint: cue.fingerprint, excerpt: String(cue.excerpt ?? '').slice(0, 100), track, ...(Number.isSafeInteger(cue.through) && cue.through! > cue.paragraphIndex ? { through: cue.through } : {}) }] : []; }).slice(0, 2000) : undefined;
      return [id, { font: choice(chapter.font, ['inherit', 'serif', 'sans', 'mono'], 'inherit'), background: readerColor(chapter.background), image: readerRaster(chapter.image) ? chapter.image : undefined, imageLayout: choice(chapter.imageLayout, ['above', 'beside', 'banner', 'none'], 'above'), mode: choice(chapter.mode, ['pages', 'flow'], 'flow'), audio: safeReaderTrack(chapter.audio), paragraphAudio }];
    })),
  };
}
/** Merge settings per field, so different chapter edits never replace one another. */
export async function saveReaderPresentation(projectId: string, draft: ReaderPresentation, base: ReaderPresentation, eraId?: string): Promise<ReaderPresentation> {
  validateReaderCover(draft.cover);
  const safe = safeReaderPresentation(draft); base = safeReaderPresentation(base);
  const result = await db.transaction('rw', [db.projects, db.writings, db.writingSnapshots, db.localMediaAssets, db.worldEraVariants, db.worldEraAssets], async () => {
    const project = await db.projects.get(projectId); if (!project) throw new Error('missing_project');
    const era=eraId?project.worldEras?.find(item=>item.id===eraId):undefined;if(eraId&&!era)throw Error('world_era_missing');
    const shared=safeReaderPresentation(project.readerPresentation),current = safeReaderPresentation(applyEraReaderCover(project,era).readerPresentation);
    const merge = <T extends object>(original: T, ours: T, latest: T): T => {
      const result = { ...latest };
      for (const key of Object.keys({...original,...ours}) as (keyof T)[]) {
        if (JSON.stringify(ours[key]) === JSON.stringify(original[key])) continue;
        if (JSON.stringify(latest[key]) !== JSON.stringify(original[key]) && JSON.stringify(latest[key]) !== JSON.stringify(ours[key])) throw new Error('presentation_conflict');
        result[key] = ours[key];
      }
      return result;
    };
    const chapters = { ...current.chapters }; const writings = eraId ? (await listEraRows<Writing>({ projectId, eraId }, 'writings')).map(row => row.id) : await db.writings.where('projectId').equals(projectId).primaryKeys();
    for (const [id, chapter] of Object.entries(safe.chapters)) {
      const original = base.chapters[id] ?? defaultChapterPresentation();
      if (!writings.includes(id)) { if (JSON.stringify(chapter) === JSON.stringify(original)) continue; throw new Error('missing_chapter'); }
      // Archived chapters/tracks retain their presentation so restoration can
      // recover it. Unchanged unavailable references must not lock the cover
      // or another chapter's settings; newly assigned audio is still scoped.
      const tracks = [JSON.stringify(chapter.audio) !== JSON.stringify(original.audio) ? chapter.audio : undefined, ...(JSON.stringify(chapter.paragraphAudio) !== JSON.stringify(original.paragraphAudio) ? (chapter.paragraphAudio ?? []).map(cue => cue.track) : [])].filter(track => track !== undefined);
      for (const track of tracks) { const asset = eraId ? await readEraRow<LocalMediaAsset>({ projectId, eraId }, 'localMediaAssets', track.assetId) : await db.localMediaAssets.get(track.assetId); if (!asset || asset.projectId !== projectId || asset.kind !== 'audio') throw new Error('missing_audio'); }
      Object.defineProperty(chapters, id, { value: merge(original, chapter, current.chapters[id] ?? defaultChapterPresentation()), enumerable: true, configurable: true, writable: true });
    }
    const cover=merge(base.cover,safe.cover,current.cover),next = { revision: shared.revision + 1, playback: merge(base.playback!, safe.playback!, shared.playback!), cover:eraId?shared.cover:cover, chapters };
    const coverChanged=era&&JSON.stringify(safe.cover)!==JSON.stringify(base.cover),now=Math.max(Date.now(),project.updatedAt+1);
    await db.projects.update(projectId, { readerPresentation: next, ...(coverChanged?{worldEras:project.worldEras!.map(item=>item.id===era.id?{...item,readerCover:cover,revision:item.revision+1,updatedAt:Math.max(now,item.updatedAt+1)}:item)}:{}), updatedAt:now }); return eraId?{...next,cover}:next;
  });
  notifyProjectsChanged(); return result;
}
