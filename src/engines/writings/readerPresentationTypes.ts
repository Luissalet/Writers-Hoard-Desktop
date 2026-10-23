export const defaultReaderPresentation = (): ReaderPresentation => ({ revision: 0, playback: { mode: 'read', wordsPerMinute: 240 }, cover: { style: 'hardcover', color: '#293b33', texture: 'linen', artwork: true, showAtStart: false }, chapters: {} });
export interface ReaderAudioTrack { assetId: string; volume: number; loop: boolean }
/** A sound tied to a paragraph: it plays while that paragraph is read, or — with `through` — on through that later paragraph (an ambience over a passage). */
export interface ReaderParagraphAudio { paragraphIndex: number; fingerprint: string; excerpt: string; track: ReaderAudioTrack; through?: number }
export interface ChapterPresentation {
  font: 'inherit' | 'serif' | 'sans' | 'mono';
  background: string;
  image?: string;
  /** banner: the chapter label, the image across the page, then the title. */
  imageLayout: 'above' | 'beside' | 'banner' | 'none';
  mode: 'flow' | 'pages';
  audio?: ReaderAudioTrack;
  paragraphAudio?: ReaderParagraphAudio[];
}
export interface ReaderPresentation {
  revision: number;
  playback?: { mode: 'read' | 'play'; wordsPerMinute: number };
  cover: { style: 'hardcover' | 'paperback' | 'paper'; color: string; texture: 'none' | 'linen' | 'lines'; artwork: boolean; showAtStart: boolean; jacket?:import('./coverDesign/types').CoverJacket };
  chapters: Record<string, ChapterPresentation>;
}
