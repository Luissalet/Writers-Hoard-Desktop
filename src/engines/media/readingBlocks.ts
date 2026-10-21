import { liveQuery } from 'dexie';
import { db } from '@/db';
import {listEraRows} from '@/services/worldEras/store';
import type {LocalMediaAsset} from './types';
import {mediaFilename} from './types';
import {voiceReadingMarkup,installVoiceReading,VOICE_READING_CSS} from './voiceReading';
/** Read-only hydration: saved prose and the reader's document identities stay untouched. */
export function hydrateLocalMediaBlocks(container: HTMLElement, projectId: string, unavailable: string, eraId?:string,locale:'es'|'en'=document.documentElement.lang==='es'?'es':'en'): () => void {
  const figures = [...container.querySelectorAll<HTMLElement>('figure[data-wh-media-block="true"]')];
  const players = new Map<HTMLElement, { media: HTMLMediaElement; url: string; assetId: string;transcriptKey?:string;disposeTranscript?:()=>void }>();
  const style=document.createElement('style');style.textContent=VOICE_READING_CSS;container.append(style);
  const allowed = figures.filter(figure => figure.dataset.projectId === projectId);
  const ids = [...new Set(allowed.map(figure => figure.dataset.assetId ?? '').filter(Boolean))];
  for (const figure of figures) { figure.replaceChildren(); const caption = document.createElement('figcaption'); caption.textContent = unavailable; figure.append(caption); }
  const stop = (figure: HTMLElement) => { const player = players.get(figure); if (!player) return;player.disposeTranscript?.();figure.querySelector('[data-wh-voice-reading]')?.remove(); player.media.pause(); player.media.removeAttribute('src'); player.media.load(); URL.revokeObjectURL(player.url); player.media.remove(); players.delete(figure); };
  const subscription = liveQuery<Array<LocalMediaAsset|undefined>>(() => eraId?listEraRows<LocalMediaAsset>({projectId,eraId},'localMediaAssets').then(rows=>rows.filter(row=>ids.includes(row.id))):db.localMediaAssets.bulkGet(ids)).subscribe({ next(rows) {
    for (const figure of allowed) {
      const asset = rows.find(asset => asset && asset.id === figure.dataset.assetId && asset.projectId === projectId);
      const caption = figure.querySelector('figcaption')!; caption.textContent = asset?.title ?? unavailable;
      if (!asset) { stop(figure); continue; }
      let player=players.get(figure);
      if(!player){const media = document.createElement(asset.kind === 'video' ? 'video' : 'audio'); media.controls = true; media.preload = 'metadata'; media.style.width = '100%'; media.style.maxHeight = '28rem';
       const url = URL.createObjectURL(asset.blob); media.src = url; figure.append(media);player={media,url,assetId:asset.id};players.set(figure,player);}
      const transcriptKey=JSON.stringify([asset.title,asset.voiceMemo?.transcript??null]);
      if(player.transcriptKey!==transcriptKey){player.disposeTranscript?.();figure.querySelector('[data-wh-voice-reading]')?.remove();figure.insertAdjacentHTML('beforeend',voiceReadingMarkup(asset,locale,{url:player.url,filename:mediaFilename(asset)}));player.disposeTranscript=installVoiceReading(figure);player.transcriptKey=transcriptKey;}
    }
  }, error() { for (const figure of figures) { stop(figure); figure.querySelector('figcaption')!.textContent = unavailable; } } });
  return () => { subscription.unsubscribe(); for (const figure of figures) stop(figure);style.remove(); };
}
