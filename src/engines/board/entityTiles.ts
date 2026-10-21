import { resolveEntity } from '@/engines/_shared';
import { getEraProject, listEraRows, readEraRow, readWorldDocument } from '@/services/worldEras/store';
import { eraDocumentKinds, type EraDocumentKind, type WorldEraScope } from '@/services/worldEras/types';
import { exportMapSvg, DEFAULT_MAP_LAYERS } from '@/components/maps/mapGeometry';
import { safeToolSvg } from '@/components/editor/toolBlocks/preview';
import {projectCodexEntry} from '@/engines/codex/properties';
import type { CodexEntry, MapPin, WorldMap } from '@/types';
import type { BoardEntityRef } from './types';
export interface BoardLiveTile {title:string;subtitle?:string;content?:string;thumbnail?:string;mapSvg?:string;properties?:Array<{label:string;value:string}>}
/** Reactive callers read real effective records; opening a board never rewrites a reference cache. */
export async function resolveBoardTile(scope:WorldEraScope,ref:BoardEntityRef):Promise<BoardLiveTile|null>{
  if((eraDocumentKinds as readonly string[]).includes(ref.engineId)){
    const table=ref.entityType==='map-pin'?'mapPins':ref.entityType==='board-node'?'boardNodes':undefined;
    const root=table?await readEraRow<Record<string,unknown>>(scope,table,ref.entityId):(await readWorldDocument(scope,ref.engineId as EraDocumentKind,ref.entityId))?.document.root;
    if(!root)return null;
    const tile:BoardLiveTile={title:String(root.title??root.name??root.text??ref.entityId),subtitle:typeof root.description==='string'?root.description:undefined,content:typeof root.content==='string'?root.content:undefined,thumbnail:typeof root.avatar==='string'?root.avatar:typeof root.image==='string'?root.image:undefined};
    if(ref.engineId==='codex'){const projection=projectCodexEntry(root as unknown as CodexEntry,(await getEraProject(scope)).codexTemplates);tile.properties=Object.keys(projection.properties).length?Object.values(projection.properties).filter(row=>row.status!=='empty').map(({label,value})=>({label,value})):Object.entries(projection.fields).filter(([key,value])=>value&&!key.startsWith('__')).map(([label,value])=>({label,value}));}
    if(ref.engineId==='maps'&&!table){const map=root as unknown as WorldMap,pins=(await listEraRows<MapPin>(scope,'mapPins')).filter(pin=>pin.mapId===map.id);const background=/^data:image\/(png|jpeg|webp|gif|avif|bmp);base64,/i.test(map.backgroundImage??'')?map.backgroundImage!:'';tile.mapSvg=safeToolSvg(exportMapSvg(background,800,450,map.features??[],pins,map.layerVisibility??DEFAULT_MAP_LAYERS,map.layers));}
    return tile;
  }
  const preview=await resolveEntity(ref.entityId,ref.entityType);return preview?.projectId===scope.projectId?{title:preview.title,subtitle:preview.subtitle,thumbnail:preview.thumbnail}:null;
}
export function boardReferenceRoute(projectId:string,ref:BoardEntityRef):string{
  const key=ref.engineId==='codex'?'entry':ref.engineId==='maps'?ref.entityType==='map-pin'?'pin':'map':ref.engineId==='board'?'node':'entity';
  return `/project/${encodeURIComponent(projectId)}/${encodeURIComponent(ref.engineId)}?${key}=${encodeURIComponent(ref.entityId)}`;
}
