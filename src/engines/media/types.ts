export interface LocalMediaAsset {
  id: string;
  projectId: string;
  title: string;
  kind: 'audio' | 'video';
  mime: string;
  blob: Blob;
  size: number;
  notes: string;
  tags: string[];
  linkedEntryIds: string[];
  createdAt: number;
  updatedAt: number;
}
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
export const MAX_PROJECT_MEDIA_BYTES = 500 * 1024 * 1024;
const MEDIA_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/flac', 'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']);
export function mediaKind(mime: string): 'audio' | 'video' | null {
  const base = mime.toLowerCase().split(';')[0].trim();
  return MEDIA_TYPES.has(base) ? base.startsWith('audio/') ? 'audio' : 'video' : null;
}
export function mediaMime(file: Pick<File, 'type' | 'name'>): string {
  if (mediaKind(file.type)) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return ({ mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', wav: 'audio/wav', webm: 'video/webm', mp4: 'video/mp4', mov: 'video/quicktime', flac: 'audio/flac' } as Record<string, string>)[extension] ?? '';
}
export function mediaFilename(asset: Pick<LocalMediaAsset, 'title' | 'mime' | 'kind'>): string {
  const name = asset.title.replace(/[<>:"/\\|?*]/g, '_').trim() || 'media';
  if (/\.(mp3|mp4|m4a|aac|ogg|wav|webm|mov|flac)$/i.test(name)) return name;
  const base = asset.mime.toLowerCase().split(';')[0].trim();
  const extension = ({ 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/flac': 'flac', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogg', 'video/quicktime': 'mov' } as Record<string, string>)[base] ?? (asset.kind === 'audio' ? 'audio' : 'video');
  return `${name}.${extension}`;
}
