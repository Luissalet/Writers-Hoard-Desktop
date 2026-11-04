import {MAX_MEDIA_BYTES} from '../../media/types';
import type {LocalToolConvergenceIdentity} from './formatTypes';

export const IMAGE_BLOCK_SCHEMA='writers-blocks/5' as const;
export const ALIGNMENT_BLOCK_SCHEMA='writers-blocks/6' as const;
export const isRichImageEngine=(version:unknown):version is '9'|'10'=>version==='9'||version==='10';
export type RichImageAlignment='left'|'center'|'right';
export const isRichImageAlignment=(value:unknown):value is RichImageAlignment=>value==='left'||value==='center'||value==='right';
export type RichImageSize='small'|'medium'|'full';
export type RichImageAsset={sha256:string;mime:'image/png';size:number};
export type RichImageChannel='source'|'size'|'alignment';
export interface RichImageCapture {
 format:'writers-hoard-image-capture/1';
 identity:LocalToolConvergenceIdentity;
 field:string;
 nodeId:string;
 channel:RichImageChannel;
 kindVersionId:string;
 membershipVersionId:string;
 placementVersionId:string;
 versionId:string;
 frontier:string[];
}

export const isRichImageSize=(value:unknown):value is RichImageSize=>value==='small'||value==='medium'||value==='full';
export function validateRichImageAsset(value:unknown):asserts value is RichImageAsset {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('local_tool_image_asset_invalid');
 const asset=value as Record<string,unknown>;
 if(Object.keys(asset).length!==3||!Object.hasOwn(asset,'sha256')||!Object.hasOwn(asset,'mime')||!Object.hasOwn(asset,'size')||
    asset.mime!=='image/png'||typeof asset.sha256!=='string'||! /^[a-f0-9]{64}$/.test(asset.sha256)||
    typeof asset.size!=='number'||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>MAX_MEDIA_BYTES)throw Error('local_tool_image_asset_invalid');
}
