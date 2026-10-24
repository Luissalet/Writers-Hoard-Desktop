import type {Timeline,TimelineEvent} from '@/types';
import {safeEventImage} from './eventDetails';
export type BannerPattern='solid'|'stripes'|'dots'|'checks'|'crosshatch'|'grid'|'image';
export interface BannerPatternParams {repeatSizePx?:number;opacity?:number}
export interface BannerImage {dataUrl:string}
export interface BannerStyle {shape:'plain'|'ribbon'|'bunting'|'scallop';pattern:BannerPattern;color:string;patternParams?:BannerPatternParams;image?:BannerImage}
export interface BannerPreset {id:string;name:string;style:BannerStyle;archivedAt?:number}
export interface BannerPresetLink {ownerTimelineId:string;id:string;fallback:BannerStyle;colorMode?:'event'|'preset'}
export interface BannerTarget {timelineId:string;version:string}
export interface BannerAction {mode:'live'|'copy'|'manual';ownerTimelineId?:string;presetId?:string;colorMode?:'event'|'preset'}
export interface BannerIntent {action?:BannerAction;targets:BannerTarget[]}
export interface BannerCatalogContext {targets:BannerTarget[];timelines:Timeline[]}
export const BANNER_PATTERNS:BannerPattern[]=['solid','stripes','dots','checks','crosshatch','grid','image'];
export function normalizeBannerParams(value:unknown):BannerPatternParams|undefined {
 if(value===undefined||value===null)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('banner_params_invalid');
 const input=value as Record<string,unknown>,out:BannerPatternParams={};
 for(const key of Object.keys(input))if(!['repeatSizePx','opacity'].includes(key))throw Error('banner_params_invalid');
 if(input.repeatSizePx!==undefined){if(typeof input.repeatSizePx!=='number'||!Number.isFinite(input.repeatSizePx)||input.repeatSizePx<=0)throw Error('banner_size_invalid');out.repeatSizePx=input.repeatSizePx;}
 if(input.opacity!==undefined){if(typeof input.opacity!=='number'||!Number.isFinite(input.opacity)||input.opacity<0||input.opacity>1)throw Error('banner_opacity_invalid');out.opacity=input.opacity;}
 return out;
}
export function normalizeBannerImage(value:unknown):BannerImage|undefined {
 if(value===undefined||value===null)return undefined;
 const dataUrl=(value as BannerImage)?.dataUrl;
 if(typeof dataUrl!=='string'||!safeEventImage(dataUrl)||dataUrl.length>Math.ceil(5*1024*1024*4/3)+100)throw Error('banner_image_invalid');
 return {dataUrl};
}
export function normalizeBannerStyle(value:unknown):BannerStyle {
 const style=value as BannerStyle;
 if(!style||!['plain','ribbon','bunting','scallop'].includes(style.shape)||!BANNER_PATTERNS.includes(style.pattern)||!/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(style.color))throw Error('banner_style_invalid');
 const patternParams=normalizeBannerParams(style.patternParams),image=normalizeBannerImage(style.image);
 if(style.pattern==='image'&&!image)throw Error('banner_image_missing');
 return {shape:style.shape,pattern:style.pattern,color:style.color,...(patternParams!==undefined?{patternParams}:{}),...(image?{image}:{})};
}
export function manualBannerStyle(event:Partial<TimelineEvent>):BannerStyle {
 let patternParams:BannerPatternParams|undefined,image:BannerImage|undefined;try{patternParams=normalizeBannerParams(event.bannerPatternParams);}catch{/* Invalid imported paint is unavailable, never executable CSS. */}try{image=normalizeBannerImage(event.bannerImage);}catch{/* Keep the raw imported field untouched. */}
 return {shape:event.bannerShape??'plain',pattern:event.bannerPattern??'solid',color:event.color||'#c4973b',...(patternParams!==undefined?{patternParams}:{}),...(image?{image}:{})};
}
export function resolveBannerStyle(event:TimelineEvent,timelines:readonly Timeline[]) {
 const manual=manualBannerStyle(event),link=event.bannerPreset;
 if(!link)return {style:manual,unavailable:manual.pattern==='image'&&!manual.image};
 const owner=timelines.find(t=>t.id===link.ownerTimelineId&&t.projectId===event.projectId),preset=owner?.bannerPresets?.find(p=>p.id===link.id);
 let style:BannerStyle,unavailable=!preset;
 try{style=normalizeBannerStyle(preset?.style??link.fallback);}catch{unavailable=true;try{style=normalizeBannerStyle(link.fallback);}catch{return {style:manual,unavailable:true};}}
 return {style:{...style,color:link.colorMode==='preset'?style.color:manual.color},unavailable,ownerTitle:owner?.title,presetName:preset?.name};
}
export function bannerStyleFields(style:BannerStyle):Partial<TimelineEvent> {
 return {bannerShape:style.shape==='plain'?undefined:style.shape,bannerPattern:style.pattern==='solid'?undefined:style.pattern,bannerImage:style.image?structuredClone(style.image):undefined,bannerPatternParams:style.patternParams?structuredClone(style.patternParams):undefined,color:style.color};
}
/** Legacy backgrounds remain byte-for-byte identical when parameters are absent. */
export function bannerBackground(style:BannerStyle):string {
 const color=style.color||'#c4973b';
 if(!style.patternParams){
  if(style.pattern==='stripes')return `repeating-linear-gradient(135deg, ${color} 0 6px, color-mix(in srgb, ${color} 70%, black) 6px 9px)`;
  if(style.pattern==='dots')return `radial-gradient(circle, rgba(255,255,255,.35) 1.2px, transparent 1.6px) 0 0 / 6px 6px, ${color}`;
  if(style.pattern==='checks')return `conic-gradient(rgba(0,0,0,.22) 25%, transparent 0 50%, rgba(0,0,0,.22) 0 75%, transparent 0) 0 0 / 8px 8px, ${color}`;
 }
 return color;
}
/** A separate paint layer keeps text, outline and base colour opaque. */
export function bannerPaint(style:BannerStyle):Record<string,string|number>|undefined {
 if(style.pattern==='image'&&!style.image)return undefined;
 if(style.pattern==='solid'||!style.patternParams&&['stripes','dots','checks'].includes(style.pattern))return undefined;
 const size=style.patternParams?.repeatSizePx??(style.pattern==='image'?128:style.pattern==='dots'?6:style.pattern==='checks'?8:style.pattern==='stripes'?9:24),opacity=style.patternParams?.opacity??(style.pattern==='image'?1:style.pattern==='stripes'?.3:style.pattern==='dots'?.35:style.pattern==='checks'?.22:.18);
 const line='rgba(255,255,255,1) 0 1px, transparent 1px';
 const image=style.pattern==='image'&&style.image?`url("${style.image.dataUrl.replace(/[\r\n\s]/g,'')}")`:style.pattern==='grid'?`linear-gradient(0deg, ${line}), linear-gradient(90deg, ${line})`:style.pattern==='crosshatch'?`repeating-linear-gradient(45deg, ${line} ${size}px), repeating-linear-gradient(-45deg, ${line} ${size}px)`:style.pattern==='stripes'?`repeating-linear-gradient(135deg, transparent 0 ${size*2/3}px, black ${size*2/3}px ${size}px)`:style.pattern==='dots'?'radial-gradient(circle, white 1.2px, transparent 1.6px)':'conic-gradient(black 25%, transparent 0 50%, black 0 75%, transparent 0)';
 return {backgroundImage:image,backgroundSize:style.pattern==='image'?`${size}px auto`:`${size}px ${size}px`,opacity};
}
/** Only this semantic reference changes; preset ids and opaque style bytes stay local. */
export function remapBannerLink<T extends {bannerPreset?:BannerPresetLink}>(row:T,remap:(id:string,prefix:string)=>string):T {
 return row.bannerPreset&&typeof row.bannerPreset.ownerTimelineId==='string'?{...row,bannerPreset:{...row.bannerPreset,ownerTimelineId:remap(row.bannerPreset.ownerTimelineId,'tl')}}:row;
}
