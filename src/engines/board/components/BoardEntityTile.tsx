import {useLiveQuery} from 'dexie-react-hooks';
import {useWorldEraScope} from '@/services/worldEras/hooks';
import {useTranslation} from '@/i18n/useTranslation';
import {sanitizedHtml} from '@/utils/sanitizeRichHtml';
import {resolveBoardTile} from '../entityTiles';
import type {BoardNode} from '../types';
export default function BoardEntityTile({node}:{node:BoardNode}){
  const scope=useWorldEraScope(node.projectId),{locale}=useTranslation();
  const tile=useLiveQuery(()=>node.ref?resolveBoardTile(scope,node.ref):Promise.resolve(null),[scope,node.ref]);
  return <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-elevated p-3" data-testid={`board-live-${node.id}`} aria-busy={tile===undefined}>
    <p className="text-xs text-accent-gold">{node.ref?.entityType}</p>
    {tile===undefined?<p className="text-sm text-text-muted">{locale==='es'?'Cargando referencia…':'Loading reference…'}</p>:tile===null?<p className="text-sm text-danger">{locale==='es'?'Referencia no disponible en este contexto':'Reference unavailable in this context'}</p>:<><h4 className="truncate font-serif text-sm font-semibold text-text-primary">{tile.title}</h4>{tile.mapSvg?<div className="min-h-0 flex-1 overflow-hidden" data-testid="board-live-map" dangerouslySetInnerHTML={{__html:tile.mapSvg}}/>:tile.thumbnail?<img src={tile.thumbnail} alt="" draggable={false} className="min-h-0 max-h-24 object-contain"/>:null}{tile.content?<div className="prose prose-invert max-w-none min-h-0 overflow-hidden text-xs leading-relaxed text-text-primary" dangerouslySetInnerHTML={sanitizedHtml(tile.content)}/>:tile.subtitle?<p className="line-clamp-4 text-xs text-text-muted">{tile.subtitle}</p>:null}{tile.properties?.length?<dl className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs text-text-primary">{tile.properties.map((property,index)=><div key={index} className="contents"><dt className="truncate text-text-muted">{property.label}</dt><dd className="truncate">{property.value}</dd></div>)}</dl>:null}</>}
  </div>;
}
