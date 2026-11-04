import * as Y from 'yjs';
import {convergenceBytes,convergenceCanonical,convergenceIdentityOf,validateLocalToolConvergenceUpdate} from './format';
import type {LocalToolConvergenceIdentity,LocalToolConvergenceUpdate,RegisterVersion} from './formatTypes';
import {JsonMap} from './json';
import {readImageFields} from './tableFields';
import {isRichImageEngine,validateRichImageAsset,type RichImageAsset} from './imageFormat';

/** A full room cut includes dormant source versions so a later Undo needs no new uploader. */
export function collectRoomImageAssets(update:LocalToolConvergenceUpdate):RichImageAsset[]{
 if(!isRichImageEngine(update.engine.version))return [];
 validateLocalToolConvergenceUpdate(update);const identity=convergenceIdentityOf(update),doc=new Y.Doc({gc:false});
 try {
  Y.applyUpdate(doc,convergenceBytes(update.updateBase64));
  const origin=new JsonMap<LocalToolConvergenceIdentity>(doc.getMap('convergence-identity')).get('value');
  if(convergenceCanonical(origin)!==convergenceCanonical(identity))throw Error('local_tool_live_identity_invalid');
  const widths=new JsonMap<string[]>(doc.getMap('table-width-fields')).get('value');
  if(!Array.isArray(widths))throw Error('local_tool_image_fields_invalid');
  const {images}=readImageFields(doc,identity,new Set(widths)),roots=new Set([...images].map(field=>'blocks3:'+JSON.stringify(field)+':image-source'));
  const assets=new Map<string,RichImageAsset>();
  for(const version of new JsonMap<RegisterVersion>(doc.getMap('register-versions')).values())if(version.present&&roots.has(version.root)){
   const asset=version.value;validateRichImageAsset(asset);
   const prior=assets.get(asset.sha256);if(prior&&prior.size!==asset.size)throw Error('local_tool_image_asset_invalid');
   assets.set(asset.sha256,asset);
  }
  return [...assets.values()].sort((a,b)=>a.sha256.localeCompare(b.sha256));
 } finally {doc.destroy();}
}
