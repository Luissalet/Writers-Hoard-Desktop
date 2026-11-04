import {MAX_MEDIA_BYTES} from '../../media/types';
import {isSourceRasterMime,type SourceRasterMime} from '../../../services/sourceRasterFormat';
import type {LocalToolConvergenceIdentity} from './formatTypes';

export const IMAGE_BLOCK_SCHEMA='writers-blocks/5' as const;
export const ALIGNMENT_BLOCK_SCHEMA='writers-blocks/6' as const;
export const RASTER_BLOCK_SCHEMA='writers-blocks/7' as const;
export const CELL_IMAGE_BLOCK_SCHEMA='writers-blocks/8' as const;
export const TABLE_ROW_HEIGHTS_SCHEMA='writers-blocks/9' as const;
export const TABLE_CELL_HEADERS_SCHEMA='writers-blocks/10' as const;
export const TABLE_CELL_SPANS_SCHEMA='writers-blocks/11' as const;
export const isTableCellHeadersSchema=(schema:unknown)=>schema===TABLE_CELL_HEADERS_SCHEMA||schema===TABLE_CELL_SPANS_SCHEMA;
export const isTableRowHeightsSchema=(schema:unknown)=>schema===TABLE_ROW_HEIGHTS_SCHEMA||isTableCellHeadersSchema(schema);
export const isImageCellsSchema=(schema:unknown)=>schema===CELL_IMAGE_BLOCK_SCHEMA||isTableRowHeightsSchema(schema);
export const isImageRasterSchema=(schema:unknown)=>schema===RASTER_BLOCK_SCHEMA||isImageCellsSchema(schema);
export const isImageAlignmentSchema=(schema:unknown)=>schema===ALIGNMENT_BLOCK_SCHEMA||isImageRasterSchema(schema);
export const isImageBlockSchema=(schema:unknown)=>schema===IMAGE_BLOCK_SCHEMA||isImageAlignmentSchema(schema);
export const isRichImageEngine=(version:unknown):version is '9'|'10'|'11'|'12'|'13'|'14'|'15'=>version==='9'||version==='10'||version==='11'||version==='12'||version==='13'||version==='14'||version==='15';
export const isImageAlignmentEngine=(version:unknown):version is '10'|'11'|'12'|'13'|'14'|'15'=>version==='10'||version==='11'||version==='12'||version==='13'||version==='14'||version==='15';
export const isImageRasterEngine=(version:unknown):version is '11'|'12'|'13'|'14'|'15'=>version==='11'||version==='12'||version==='13'||version==='14'||version==='15';
export type RichImageAlignment='left'|'center'|'right';
export const isRichImageAlignment=(value:unknown):value is RichImageAlignment=>value==='left'||value==='center'||value==='right';
export type RichImageSize='small'|'medium'|'full';
export type RichImageAsset={sha256:string;mime:SourceRasterMime;size:number};
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
export function validateRichImageAsset(value:unknown,rasterFormats=false):asserts value is RichImageAsset {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('local_tool_image_asset_invalid');
 const asset=value as Record<string,unknown>;
 if(Object.keys(asset).length!==3||!Object.hasOwn(asset,'sha256')||!Object.hasOwn(asset,'mime')||!Object.hasOwn(asset,'size')||
    (rasterFormats?!isSourceRasterMime(asset.mime):asset.mime!=='image/png')||typeof asset.sha256!=='string'||! /^[a-f0-9]{64}$/.test(asset.sha256)||
    typeof asset.size!=='number'||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>MAX_MEDIA_BYTES)throw Error('local_tool_image_asset_invalid');
}
