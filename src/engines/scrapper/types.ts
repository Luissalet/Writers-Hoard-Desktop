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
  // --- Downloaded media (desktop): the link's video/audio saved to local disk ---
  /** Path relative to the scrapper-media root, e.g. "<projectId>/<snapshotId>.mp4". */
  localMediaPath?: string;
  /** Original human-readable filename produced by yt-dlp. */
  mediaFilename?: string;
  mediaSizeBytes?: number;
  mediaKind?: 'video' | 'audio';
  /** Lifecycle of the local download. Absent = never attempted (link-only). */
  downloadState?: 'idle' | 'downloading' | 'done' | 'error';
  downloadError?: string;
  metadata?: Record<string, string>;
  preservedAt: number;
  createdAt: number;
}
