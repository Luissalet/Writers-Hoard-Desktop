import {useLiveQuery} from 'dexie-react-hooks';
import {useWorldEraScope} from '@/services/worldEras/hooks';
import {readWorldDocument} from '@/services/worldEras/store';
import {useEnginePane} from '@/engines/_shared/EnginePaneContext';
import {useTranslation} from '@/i18n/useTranslation';
import {LocalMediaPlayer} from '@/engines/media/LocalMediaPlayer';
import type {LocalMediaAsset} from '@/engines/media/types';
import type {BoardNode} from '../types';
import {getBoardCopy} from '../copy';
import {isUsableBoardMedia} from './boardAssets';
/** Private media payload: never part of BoardLiveTile, persisted refs, snapshots or MCP DTOs. */
export default function BoardMediaTile({node}:{node:BoardNode}) {
 const scope=useWorldEraScope(node.projectId),{locale}=useTranslation(),pane=useEnginePane();
 const key=`${scope.projectId}:${scope.eraId??'base'}:${node.ref?.entityId??''}`;
 return <MediaReference key={key} node={node} scope={scope} locale={locale} visible={pane?.visible!==false}/>;
}
function MediaReference({node,scope,locale,visible}:{node:BoardNode;scope:{projectId:string;eraId?:string};locale:string;visible:boolean}) {
 const copy=getBoardCopy(locale),id=node.ref?.entityId??'';
 const read=useLiveQuery(async()=>{
  if(!id.trim())return null;
  const result=await readWorldDocument(scope,'media',id),asset=result?.document.root as unknown as LocalMediaAsset|undefined;
  return asset?.id===id&&asset.projectId===scope.projectId&&isUsableBoardMedia(asset)?{asset,version:result!.version}:null;
 },[scope.projectId,scope.eraId,id]);
 return <div className="flex h-full w-full flex-col overflow-auto rounded-xl border border-border bg-elevated p-3" data-testid={`board-live-${node.id}`} aria-busy={read===undefined}>
  <h4 className="truncate font-serif text-sm font-semibold text-text-primary">{read?.asset.title??node.ref?.title??node.title}</h4>
  {read===undefined?<p className="text-sm text-text-muted">{locale==='es'?'Cargando referencia…':'Loading reference…'}</p>:read===null?<p role="status" className="text-sm text-text-muted">{copy.mediaUnavailable}</p>:visible?<div className="nodrag nopan nowheel mt-2 min-h-0 flex-1" data-board-media-controls onPointerDown={event=>event.stopPropagation()} onMouseDown={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
   <LocalMediaPlayer key={read.version} asset={read.asset} loop={false} speed={1} fallback={copy.mediaFailed}/>
  </div>:null}
 </div>;
}
