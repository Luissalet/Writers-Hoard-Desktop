export const COVER_FONTS = ['georgia','palatino','times','arial','verdana','trebuchet','courier','garamond'] as const;
export type CoverFont = typeof COVER_FONTS[number];
export type CoverFace = 'spread'|'front'|'back'|'spine';
export interface CoverBox { x:number; y:number; width:number; height:number; rotation:number }
interface CoverElementBase extends CoverBox { id:string }
export interface CoverText extends CoverElementBase { kind:'text'; text:string; font:CoverFont; size:number; bold:boolean; align:'left'|'center'|'right'; color:string }
export interface CoverImage extends CoverElementBase { kind:'image'; src:string }
/** Samples are normalized within the element box, so resizing preserves the stroke. */
export interface CoverStroke extends CoverElementBase { kind:'ink'; points:{x:number;y:number;pressure?:number}[]; color:string; weight:number }
export type CoverElement = CoverText|CoverImage|CoverStroke;
export interface CoverJacket { version:1; elements:CoverElement[] }
