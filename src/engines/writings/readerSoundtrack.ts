import type { ChapterPresentation, ReaderAudioTrack } from './readerPresentationTypes';

export function safeReaderTrack(value: unknown): ReaderAudioTrack | undefined {
  if (!value || typeof value !== 'object') return;
  const track = value as ReaderAudioTrack;
  if (typeof track.assetId !== 'string' || !track.assetId || track.assetId.length > 200) return;
  return { assetId: track.assetId, volume: Number.isFinite(track.volume) ? Math.max(0, Math.min(1, track.volume)) : .6, loop: track.loop === true };
}
export function paragraphFingerprint(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim(); let hash = 2166136261;
  for (let i = 0; i < normalized.length; i++) hash = Math.imul(hash ^ normalized.charCodeAt(i), 16777619);
  return `${normalized.length}:${hash >>> 0}`;
}
export function readerParagraphs(html: string) {
  const template = document.createElement('template'); template.innerHTML = html;
  return [...template.content.querySelectorAll('p')].filter(node => !node.closest('[data-wh-media-block],[data-wh-tool-block],[data-wh-codex-block],[data-wh-wiki-hidden]')).map((node, paragraphIndex) => ({ paragraphIndex, fingerprint: paragraphFingerprint(node.textContent ?? ''), excerpt: (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100) }));
}
export interface ReaderSoundChapter { id: string; audio?: ReaderAudioTrack; cues: { paragraphIndex: number; fingerprint: string; track: ReaderAudioTrack }[] }
export const readerSoundChapter = (id: string, style?: ChapterPresentation): ReaderSoundChapter => ({ id, audio: style?.audio, cues: style?.paragraphAudio ?? [] });

/** Self-contained DOM runtime, also serialized verbatim into the offline reader.
 * It owns two audio channels, starts only from a real user toggle, and releases
 * them on disable/unmount. Missing or edited paragraphs never trigger a cue. */
export function installReaderSoundtrack(root: HTMLElement, toggle: HTMLButtonElement, status: HTMLElement, chapters: ReaderSoundChapter[], sources: Record<string, string>, copy: { enable: string; disable: string; blocked: string; unavailable: string }) {
  let enabled = false, disposed = false, frame = 0, generation = 0;
  const channels = [new Audio(), new Audio()]; const keys = ['', ''];
  const fingerprint = (text: string) => { const normalized = text.replace(/\s+/g, ' ').trim(); let hash = 2166136261; for (let i = 0; i < normalized.length; i++) hash = Math.imul(hash ^ normalized.charCodeAt(i), 16777619); return `${normalized.length}:${hash >>> 0}`; };
  const stop = (index: number) => { const audio = channels[index]; keys[index] = ''; audio.pause(); audio.removeAttribute('src'); audio.load(); };
  const play = (index: number, key: string, track?: ReaderAudioTrack) => {
    if (!track || !sources[track.assetId]) { if (track) status.textContent = copy.unavailable; if (keys[index]) stop(index); return; }
    if (keys[index] === key) return;
    stop(index); keys[index] = key; const audio = channels[index]; audio.src = sources[track.assetId]; audio.loop = track.loop; audio.volume = track.volume;
    const token = generation; void audio.play().catch(() => { if (!disposed && enabled && token === generation && keys[index] === key) status.textContent = copy.blocked; });
  };
  const update = () => {
    frame = 0; if (!enabled || disposed) return; status.textContent = '';
    const viewport = root.getBoundingClientRect(); const top = Math.max(0, viewport.top), bottom = Math.min(innerHeight, viewport.bottom), left = Math.max(0, viewport.left), right = Math.min(innerWidth, viewport.right);
    if (bottom <= top || right <= left) { stop(0); stop(1); return; }
    const target = top + (bottom - top) * .3;
    let selected: { chapter: ReaderSoundChapter; article: HTMLElement; score: number } | undefined;
    for (const article of root.querySelectorAll<HTMLElement>('[data-piece-id]')) {
      const chapter = chapters.find(chapter => chapter.id === article.dataset.pieceId); if (!chapter) continue;
      const box = article.getBoundingClientRect(); if (box.bottom <= top || box.top >= bottom) continue;
      const score = Math.abs(Math.max(box.top, Math.min(target, box.bottom)) - target);
      if (!selected || score < selected.score) selected = { chapter, article, score };
    }
    if (!selected) { stop(0); stop(1); return; }
    play(0, `${selected.chapter.id}:${JSON.stringify(selected.chapter.audio)}`, selected.chapter.audio);
    const paragraphs = [...selected.article.querySelectorAll<HTMLElement>('.ProseMirror p')].filter(node => !node.closest('[data-wh-media-block],[data-wh-tool-block],[data-wh-codex-block],[data-wh-wiki-hidden],.wh-tool-export,.wh-reader-codex-reference'));
    let active = -1, score = Infinity;
    paragraphs.forEach((node, index) => { for (const box of node.getClientRects()) { if (box.bottom <= top || box.top >= bottom || box.right <= left || box.left >= right) continue; const distance = Math.abs(Math.max(box.top, Math.min(target, box.bottom)) - target); if (distance < score) { score = distance; active = index; } } });
    const cue = selected.chapter.cues.find(cue => cue.paragraphIndex === active && paragraphs[active] && cue.fingerprint === fingerprint(paragraphs[active].textContent ?? ''));
    play(1, cue ? `${selected.chapter.id}:${active}:${JSON.stringify(cue.track)}` : '', cue?.track);
  };
  const schedule = () => { if (!frame && enabled && !disposed) frame = requestAnimationFrame(update); };
  const click = () => { enabled = !enabled; generation++; toggle.textContent = enabled ? copy.disable : copy.enable; toggle.setAttribute('aria-pressed', String(enabled)); status.textContent = ''; if (enabled) update(); else { stop(0); stop(1); } };
  toggle.textContent = copy.enable; toggle.setAttribute('aria-pressed', 'false'); toggle.addEventListener('click', click);
  root.addEventListener('scroll', schedule, true); window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule); const observer = new ResizeObserver(schedule); observer.observe(root);
  return () => { disposed = true; generation++; cancelAnimationFrame(frame); toggle.removeEventListener('click', click); root.removeEventListener('scroll', schedule, true); window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule); observer.disconnect(); stop(0); stop(1); };
}
