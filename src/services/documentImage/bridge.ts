import { exportDocumentImage } from './index';
import { eraDocumentKinds } from '@/services/worldEras/types';
import { requireString,optString,optEnum,optNumber,resolveProjectId,BridgeError,type ToolArgs } from '@/services/aiBridge/tools/shared';
export const DOCUMENT_IMAGE_HANDLERS={async wh_export_document_image(args:ToolArgs){
  const view=args.view;
  if(view!==undefined&&(!view||typeof view!=='object'||Array.isArray(view)||!['x','y','w','h'].every(key=>typeof(view as Record<string,unknown>)[key]==='number')))throw new BridgeError('bad-args','view must be {x,y,w,h}.');
  return exportDocumentImage({projectId:resolveProjectId(args),eraId:optString(args,'eraId'),kind:optEnum(args,'kind',eraDocumentKinds)??(()=>{throw new BridgeError('bad-args','kind is required.');})(),entityId:requireString(args,'entityId'),width:optNumber(args,'width'),pixelRatio:optNumber(args,'pixelRatio'),pageHeight:optNumber(args,'pageHeight'),locale:optEnum(args,'locale',['es','en']),view:view as Parameters<typeof exportDocumentImage>[0]['view']});
}};
