import { worldgenScopeOperations } from '@/engines/worldgen/era';
import { worldEraToolScope } from '@/services/worldEras/toolScope';
import { applyWorldEdits, openWorldForReading } from '@/engines/worldgen/bridgeAccess';
import { targetFromKey } from '@/engines/worldgen/core/edits';
import { validatePlaceStyle } from '@/engines/worldgen/core/placeStyle';
import {preparePlaceImages,webPlaceImageAdapter} from '@/engines/worldgen/cartography/placeImages';
import { assertEngineEnabled, assertRowInScope, BridgeError, requireString, withAudit, type ToolArgs } from './shared';

/** Uses the same sparse style edit and writer/CAS boundary as the inspector. */
export async function whStylePlace(args: ToolArgs): Promise<unknown> {
  const scope = worldEraToolScope(args);
  const worldId = requireString(args, 'worldId'), key = requireString(args, 'key');
  const world = await worldgenScopeOperations(scope).worlds.getOne(worldId);
  if (!world) throw new BridgeError('not-found', `No generated world with id "${worldId}".`);
  assertRowInScope(args, world.projectId); await assertEngineEnabled(world.projectId, 'worldgen');
  const target = targetFromKey(key);
  if (!target || ['road', 'label'].includes(target)) throw new BridgeError('bad-args', 'Use a place key returned by wh_list_places.');
  if (!args.style || typeof args.style !== 'object' || Array.isArray(args.style)) throw new BridgeError('bad-args', 'style must be an object.');
  let style;
  try { style = validatePlaceStyle(args.style as Record<string, unknown>); } catch (e) { throw new BridgeError('bad-args', (e as Error).message); }
  if (target !== 'realm' && (style.areaStyle !== undefined || style.areaOpacity !== undefined)) throw new BridgeError('bad-args', 'Area styles apply to realm keys.');
  if (target === 'realm' && (style.model !== undefined || style.buildingStyle !== undefined || style.icon !== undefined)) throw new BridgeError('bad-args', 'Building styles apply to places, not territories.');
  if ('iconImage' in style && !['settlement','ruin','feature','landmark','region'].includes(target)) throw new BridgeError('bad-args','Place images apply only to places, not territories, roads, labels or stamps.');
  if ('catalogIcon' in style && !['settlement','ruin','feature','landmark','region'].includes(target)) throw new BridgeError('bad-args','Map symbols apply only to places, not territories, roads, labels or stamps.');
  const depth=target==='realm'||target==='feature'?'full':'places';
  const opened = await openWorldForReading(world, depth, scope?.eraId);
  if (!opened.ok) return { worldId, pending: true, code: opened.code, message: opened.message };
  // Regional keys are generated lazily by sheets; their source identity is
  // validated by targetFromKey, while global places must actually exist.
  if (target !== 'region' && !opened.world.atlas.places.some(p => p.key === key || p.legacyKeys.includes(key))) throw new BridgeError('not-found', `No visible place "${key}" in this world.`);
  let current=world;
  if(style.iconImage){
    try{const prepared=await preparePlaceImages([style],webPlaceImageAdapter(),{strict:true});prepared.dispose();}catch(error){throw new BridgeError('bad-args',`Unreadable place image: ${(error as Error).message}`);}
    // Decoding yielded: revalidate ownership/engine and let the normal writer reread edits.
    const refreshedRow=await worldgenScopeOperations(scope).worlds.getOne(worldId);
    if(!refreshedRow)throw new BridgeError('not-found',`No generated world with id "${worldId}".`);
    current=refreshedRow;assertRowInScope(args,current.projectId);await assertEngineEnabled(current.projectId,'worldgen');
    if(current.projectId!==world.projectId)throw new BridgeError('scope','World ownership changed while preparing image.');
    const refreshed=await openWorldForReading(current,depth,scope?.eraId);
    if(!refreshed.ok)return{worldId,pending:true,code:refreshed.code,message:refreshed.message};
    if(target!=='region'&&!refreshed.world.atlas.places.some(p=>p.key===key||p.legacyKeys.includes(key)))throw new BridgeError('not-found',`No visible place "${key}" in this world.`);
  }
  const { before, delivered } = await applyWorldEdits(current, [{ kind: 'style', target, key, style }], scope?.eraId);
  return withAudit({ worldId, key, style, delivered }, { projectId: world.projectId, entityId: worldId, table: 'generatedWorlds', before: { edits: before }, summary: `styled place ${key} in world "${world.title}"` });
}
