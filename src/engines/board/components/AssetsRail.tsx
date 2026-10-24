// Gallery pictures and the effective project's local audio/video library.
import {useCallback,useEffect,useRef,useState} from 'react';
import {useLiveQuery} from 'dexie-react-hooks';
import {ImagePlus,Play,Square,Plus} from 'lucide-react';
import {db} from '@/db';
import {useWorldEraScope} from '@/services/worldEras/hooks';
import {mediaRows} from '@/engines/media/scope';
import {getBoardCopy} from '../copy';
import {BOARD_ASSET_MIME,BOARD_MEDIA_MIME,imageFile,isUsableBoardMedia} from './boardAssets';
interface Props {projectId:string;locale:string;onAdd:(file:File)=>void;onMediaAdd:(id:string)=>void;onImport:()=>void}
export default function AssetsRail(props:Props){
 const scope=useWorldEraScope(props.projectId);
 return <ScopedAssetsRail key={`${scope.projectId}:${scope.eraId??'base'}`} {...props} eraId={scope.eraId}/>;
}
function ScopedAssetsRail({projectId,eraId,locale,onAdd,onMediaAdd,onImport}:Props&{eraId?:string}){
 const es=locale!=='en',copy=getBoardCopy(locale);
 const pictures=useLiveQuery(()=>db.inspirationImages.where('projectId').equals(projectId).toArray(),[projectId]);
 const assets=useLiveQuery(()=>mediaRows(projectId,eraId),[projectId,eraId]);
 const [query,setQuery]=useState(''),[playing,setPlaying]=useState(''),audio=useRef<HTMLAudioElement|null>(null),url=useRef('');
 const release=useCallback(()=>{audio.current?.pause();if(audio.current){audio.current.removeAttribute('src');audio.current.load();}if(url.current)URL.revokeObjectURL(url.current);url.current='';},[]);
 const stop=useCallback(()=>{release();setPlaying('');},[release]);
 useEffect(()=>()=>{release();if(audio.current)audio.current.onended=null;},[release]);
 useEffect(()=>{if(playing&&assets&&!assets.some(asset=>asset.id===playing&&isUsableBoardMedia(asset)))stop();},[assets,playing,stop]);
 const fold=(text:string)=>text.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
 const label=(picture:{notes:string;tags:string[]})=>picture.notes.split('\n')[0].trim()||picture.tags[0]||(es?'Imagen':'Picture');
 const match=(text:string)=>!query.trim()||fold(text).includes(fold(query.trim()));
 const shownPictures=(pictures??[]).filter(picture=>match(`${picture.notes} ${picture.tags.join(' ')}`));
 const shownMedia=(assets??[]).filter(isUsableBoardMedia).filter(asset=>match(`${asset.title} ${asset.tags.join(' ')}`));
 const button='min-h-9 rounded-lg border border-border px-2 text-xs text-text-primary hover:bg-elevated focus-visible:outline-2 focus-visible:outline-accent-gold';
 return <section className="space-y-2" data-testid="board-assets" aria-label={es?'Recursos del proyecto':'Project assets'}>
  <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium text-text-primary">{es?'Recursos':'Assets'}</h3><button type="button" className={button} onClick={onImport}>{copy.mediaImport}</button></div>
  <input className="w-full rounded border border-border bg-deep px-2 py-1 text-xs text-text-primary" placeholder={es?'Buscar…':'Search…'} aria-label={es?'Buscar recursos':'Search assets'} data-testid="board-assets-search" value={query} onChange={event=>setQuery(event.target.value)}/>
  {!shownPictures.length&&!shownMedia.length&&<p className="text-xs text-text-muted">{copy.mediaEmpty}</p>}
  <ul className="grid grid-cols-2 gap-2">{shownPictures.map(picture=><li key={picture.id} className="rounded border border-border p-1 text-[11px] text-text-primary" data-testid={`board-asset-${label(picture)}`}>
   <button type="button" draggable className="block w-full" title={es?'Añadir al tablero (o arrástrala)':'Add to the board (or drag it)'} onDragStart={event=>{event.dataTransfer.setData(BOARD_ASSET_MIME,picture.id);event.dataTransfer.effectAllowed='copy';}} onClick={()=>void imageFile(picture.imageData,label(picture)).then(onAdd)} data-testid="board-asset-add">
    <img src={picture.thumbnailData??picture.imageData} alt="" className="h-16 w-full rounded object-cover"/><span className="mt-1 flex items-center gap-1 truncate"><ImagePlus className="h-3 w-3 shrink-0"/>{label(picture)}</span>
   </button>
  </li>)}</ul>
  <ul className="space-y-2">{shownMedia.map(asset=><li key={asset.id} className="space-y-1 text-xs text-text-primary" data-testid={`board-sound-${asset.title}`}>
   <span className="block truncate" title={asset.title}>{asset.title}</span>
   <div className="flex flex-wrap gap-2"><button type="button" draggable className={`${button} inline-flex items-center gap-1`} data-board-media-add={asset.id} onClick={()=>onMediaAdd(asset.id)} onDragStart={event=>{event.dataTransfer.setData(BOARD_MEDIA_MIME,JSON.stringify({projectId,eraId,entityId:asset.id}));event.dataTransfer.effectAllowed='copy';}}><Plus size={13}/>{copy.mediaAdd}</button>
   {asset.kind==='audio'&&<button type="button" className={button} aria-label={playing===asset.id?(es?'Parar':'Stop'):(es?'Escuchar':'Listen')} data-testid="board-asset-listen" onClick={()=>{
    if(playing===asset.id){stop();return;}stop();const ownedUrl=URL.createObjectURL(asset.blob);url.current=ownedUrl;audio.current??=new Audio();audio.current.src=ownedUrl;audio.current.onended=stop;setPlaying(asset.id);void audio.current.play().catch(()=>{if(url.current===ownedUrl)stop();});
   }}>{playing===asset.id?<Square size={13}/>:<Play size={13}/>}</button>}</div>
  </li>)}</ul>
 </section>;
}
