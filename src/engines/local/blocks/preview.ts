import type {EraDocument} from '@/services/worldEras/types';
import {localToolSemanticPreview,type LocalToolSemanticPreview} from '../previewTypes';
import {validateLocalToolBlockEnvelope,type LocalToolBlockEnvelope} from './types';
export {renderLocalToolPreview} from '../previewTypes';
/** Supplied documents are already effective/captured; this helper has no IO. */
export function localToolBlockPreview(envelope:LocalToolBlockEnvelope,locale:'es'|'en'='en',documents?:readonly EraDocument[]):LocalToolSemanticPreview {
 validateLocalToolBlockEnvelope(envelope);const title=envelope.name[locale];if(envelope.scope==='host')return localToolSemanticPreview(title,envelope.data,envelope.preview,locale,envelope.codec);
 if(!documents)return{title,fields:[{label:locale==='es'?'Contexto':'Context',value:locale==='es'?'El contenido del mundo no está disponible en esta captura.':'World content is unavailable in this snapshot.'}]};
 return{title,fields:documents.map(({root})=>({label:String(root.title??root.name??root.id),value:envelope.world.fields.map(key=>{const value=root[key];return typeof value==='string'?value:value===undefined?'':JSON.stringify(value,null,2);}).join(' · ')}))};
}
