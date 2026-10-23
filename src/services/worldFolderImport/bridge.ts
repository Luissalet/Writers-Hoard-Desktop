import { requireString, optString, assertRowInScope, BridgeError, withAudit, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { assertWorldEra } from '@/services/worldEras/store';
import { inspectWorldFolderImport } from './plan';
import { applyWorldFolderImport, undoWorldFolderImport } from './persist';
import type { WorldFolderInput } from './types';
async function scopeFor(args:ToolArgs){const scope={projectId:requireString(args,'projectId'),eraId:optString(args,'eraId')};assertRowInScope(args,scope.projectId);await assertWorldEra(scope);return scope;}
function input(args:ToolArgs):WorldFolderInput{
  const files=args.files===undefined&&Array.isArray(args.pasted)&&args.pasted.length?[]:args.files;
  if(!Array.isArray(files)||args.decisions!==undefined&&!Array.isArray(args.decisions))throw new BridgeError('bad-args','Pass files (or pasted text) and optional decisions from the preview.');
  if(args.pasted!==undefined&&!Array.isArray(args.pasted))throw new BridgeError('bad-args','pasted must be a list of {name?, text}.');
  const libraryFolderId=optString(args,'libraryFolderId');
  return{format:args.format as WorldFolderInput['format'],files:files as WorldFolderInput['files'],decisions:args.decisions as WorldFolderInput['decisions'],...(args.pasted!==undefined?{pasted:args.pasted as WorldFolderInput['pasted']}:{}),...(libraryFolderId?{libraryFolderId}:{})};
}
async function checked<T>(run:()=>Promise<T>):Promise<T>{try{return await run();}catch(error){if(error instanceof Error&&error.message.startsWith('world_folder_'))throw new BridgeError(error.message.split(':')[0],error.message);throw error;}}
export const WORLD_FOLDER_IMPORT_HANDLERS={
  wh_world_folder_import_preview:(args:ToolArgs)=>checked(async()=>inspectWorldFolderImport(await scopeFor(args),input(args))),
  wh_world_folder_import_apply:(args:ToolArgs)=>checked(async()=>{const scope=await scopeFor(args),result=await applyWorldFolderImport(scope,input(args),requireString(args,'expectedDigest'));return result.receiptId?withAudit(result,{projectId:scope.projectId,entityId:result.batchId,before:{__worldFolderImportReceipt:result.receiptId},summary:`Imported ${result.created.length} local documents/assets`,kind:'create'}):result;}),
  wh_world_folder_import_undo:(args:ToolArgs)=>checked(async()=>undoWorldFolderImport(await scopeFor(args),requireString(args,'receiptId'))),
};
