import { db } from '@/db';
import type { InspirationImage } from '@/types';
export interface VisualMatch { id: string; score: number }
export function visualSearchApi() { const api = window.electronAPI?.visualSearch; if (!api) throw Error('visual_search_desktop_required'); return api; }
/** Rank actual image pixels. Tags, prose and filenames never enter the model. */
export async function searchVisualImages(projectId: string, query: string, candidates?: readonly InspirationImage[], options: { signal?: AbortSignal; progress?: (done: number, total: number) => void } = {}): Promise<{ matches: VisualMatch[]; failed: string[] }> {
  if (!query.trim()) throw Error('visual_query_missing');
  if (!await db.projects.get(projectId)) throw Error('visual_project_missing');
  const rows = candidates ?? await db.inspirationImages.where('projectId').equals(projectId).toArray();
  if (rows.some(row => row.projectId !== projectId)) throw Error('visual_foreign_image');
  const api = visualSearchApi(), text = await api.text(query), matches: VisualMatch[] = [], failed: string[] = [];
  if (text.length !== 512 || text.some(value => !Number.isFinite(value))) throw Error('visual_query_embedding_invalid');
  for (const [index, image] of rows.entries()) {
    options.signal?.throwIfAborted();
    try {
      const { vector } = await api.image(image.imageData);
      if (vector.length !== text.length || vector.some(value => !Number.isFinite(value))) throw Error('visual_image_embedding_invalid');
      matches.push({ id: image.id, score: vector.reduce((sum, value, i) => sum + value * text[i], 0) });
    } catch (error) { if (options.signal?.aborted) throw error; failed.push(image.id); }
    options.progress?.(index + 1, rows.length);
  }
  options.signal?.throwIfAborted();
  if (failed.length && !matches.length) throw Error('visual_images_failed');
  matches.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  return { matches, failed };
}
