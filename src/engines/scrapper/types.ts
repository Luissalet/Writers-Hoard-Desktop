// ============================================
// Scrapper Engine — Type Definitions
// ============================================

export type SnapshotSource = 'url' | 'tweet' | 'instagram' | 'youtube' | 'manual';

export interface Snapshot {
  id: string;
  projectId: string;
  url: string;
  title: string;
  source: SnapshotSource;
  status: 'pending' | 'success' | 'failed';
  errorMessage?: string;
  thumbnail?: string; // base64
  author?: string;
  publishDate?: string;
  /** Optional short description / caption, shown above notes in the detail view. */
  description?: string;
  notes: string;
  tags: string[];
  extractedText?: string;
  htmlContent?: string;
  screenshotBase64?: string;
  // --- Archived web page (desktop): PDF print + full-page shot + rendered HTML ---
  // All three live on disk under the scrapper-media root, same as downloaded
  // media — a page archive is megabytes, far too heavy for IndexedDB.
  /** "<projectId>/<snapshotId>.pdf" — the page printed at screen width. */
  capturePdfPath?: string;
  /** "<projectId>/<snapshotId>.png" — full-page screenshot. */
  captureImagePath?: string;
  /** "<projectId>/<snapshotId>.html" — fully rendered HTML archive. */
  captureHtmlPath?: string;
  /** Lifecycle of the page archive. Absent = never attempted (link-only). */
  captureState?: 'idle' | 'capturing' | 'done' | 'error';
  captureError?: string;
  // --- Downloaded media (desktop): the link's video/audio saved to local disk ---
  /** Path relative to the scrapper-media root, e.g. "<projectId>/<snapshotId>.mp4". */
  localMediaPath?: string;
  /** For photo/carousel posts: every downloaded item in order (under <projectId>/<snapshotId>/). */
  mediaItems?: { relPath: string; kind: 'image' | 'video' }[];
  /** Original human-readable filename produced by yt-dlp. */
  mediaFilename?: string;
  mediaSizeBytes?: number;
  mediaKind?: 'video' | 'audio' | 'image';
  /** Lifecycle of the local download. Absent = never attempted (link-only). */
  downloadState?: 'idle' | 'downloading' | 'done' | 'error';
  downloadError?: string;
  metadata?: Record<string, string>;
  preservedAt: number;
  createdAt: number;
}
