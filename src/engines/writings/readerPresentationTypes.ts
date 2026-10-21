export interface ReaderAudioTrack { assetId: string; volume: number; loop: boolean }
export interface ReaderParagraphAudio { paragraphIndex: number; fingerprint: string; excerpt: string; track: ReaderAudioTrack }
export interface ChapterPresentation {
  font: 'inherit' | 'serif' | 'sans' | 'mono';
  background: string;
  image?: string;
  imageLayout: 'above' | 'beside' | 'none';
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
