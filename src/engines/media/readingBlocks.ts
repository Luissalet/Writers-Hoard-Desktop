import { liveQuery } from 'dexie';
import { db } from '@/db';
/** Read-only hydration: saved prose and the reader's document identities stay untouched. */
export function hydrateLocalMediaBlocks(container: HTMLElement, projectId: string, unavailable: string): () => void {
  const figures = [...container.querySelectorAll<HTMLElement>('figure[data-wh-media-block="true"]')];
  const players = new Map<HTMLElement, { media: HTMLMediaElement; url: string; assetId: string }>();
  const allowed = figures.filter(figure => figure.dataset.projectId === projectId);
  const ids = [...new Set(allowed.map(figure => figure.dataset.assetId ?? '').filter(Boolean))];
  for (const figure of figures) { figure.replaceChildren(); const caption = document.createElement('figcaption'); caption.textContent = unavailable; figure.append(caption); }
  const stop = (figure: HTMLElement) => { const player = players.get(figure); if (!player) return; player.media.pause(); player.media.removeAttribute('src'); player.media.load(); URL.revokeObjectURL(player.url); player.media.remove(); players.delete(figure); };
  const subscription = liveQuery(() => db.localMediaAssets.bulkGet(ids)).subscribe({ next(rows) {
    for (const figure of allowed) {
      const asset = rows.find(asset => asset && asset.id === figure.dataset.assetId && asset.projectId === projectId);
      const caption = figure.querySelector('figcaption')!; caption.textContent = asset?.title ?? unavailable;
      if (!asset) { stop(figure); continue; }
      if (players.has(figure)) continue;
      const media = document.createElement(asset.kind === 'video' ? 'video' : 'audio'); media.controls = true; media.preload = 'metadata'; media.style.width = '100%'; media.style.maxHeight = '28rem';
      const url = URL.createObjectURL(asset.blob); media.src = url; figure.append(media); players.set(figure, { media, url, assetId: asset.id });
    }
  }, error() { for (const figure of figures) { stop(figure); figure.querySelector('figcaption')!.textContent = unavailable; } } });
  return () => { subscription.unsubscribe(); for (const figure of figures) stop(figure); };
}
