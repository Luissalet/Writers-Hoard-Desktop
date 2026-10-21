import { simplifyStroke,type StrokePoint } from '@/utils/freehand';
import { strokeOutline } from '@/engines/board/freehand';
import type { CharacterSheet } from './types';

export const SHEET_INK_SURFACE='paper-v1';
export const SHEET_PAPER_WIDTH=1000;
export interface SheetInkStroke {id:string;tool:'pen'|'marker'|'eraser';color:string;width:number;points:StrokePoint[]}
export interface SheetInk {version:1;surface:typeof SHEET_INK_SURFACE;width:1000;strokes:SheetInkStroke[]}
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
export function validSheetInk(value:unknown):value is SheetInk {
  if(!record(value)||value.version!==1||value.surface!==SHEET_INK_SURFACE||value.width!==1000||!Array.isArray(value.strokes))return false;
  const ids=new Set<string>();
  return value.strokes.every(stroke=>{
    if(!record(stroke)||typeof stroke.id!=='string'||!stroke.id||ids.has(stroke.id)||!['pen','marker','eraser'].includes(String(stroke.tool))||typeof stroke.color!=='string'||!/^#[\da-f]{6}$/i.test(stroke.color)||typeof stroke.width!=='number'||!Number.isFinite(stroke.width)||stroke.width<1||stroke.width>24||!Array.isArray(stroke.points)||!stroke.points.length)return false;
    ids.add(stroke.id);
    return stroke.points.every(point=>record(point)&&typeof point.x==='number'&&Number.isFinite(point.x)&&point.x>=0&&point.x<=1000&&typeof point.y==='number'&&Number.isFinite(point.y)&&point.y>=0&&Number.isSafeInteger(Math.ceil(point.y))&&(point.pressure===undefined||typeof point.pressure==='number'&&Number.isFinite(point.pressure)&&point.pressure>=0&&point.pressure<=1));
  });
}
export function applySheetInk(sheet:CharacterSheet,action:{kind:'stroke';stroke:SheetInkStroke}|{kind:'undo'}):CharacterSheet {
  const ink:SheetInk=structuredClone(sheet.ink??{version:1,surface:SHEET_INK_SURFACE,width:1000,strokes:[]});
  if(action.kind==='undo')ink.strokes.pop();
  else{ink.strokes.push(structuredClone(action.stroke));if(!validSheetInk(ink))throw new Error('invalid_sheet_ink');ink.strokes[ink.strokes.length-1].points=simplifyStroke(action.stroke.points,.6);}
  if(!validSheetInk(ink))throw new Error('invalid_sheet_ink');
  return{...sheet,ink};
}
export function sheetInkHeight(ink?:SheetInk):number{return ink?.strokes.reduce((height,stroke)=>stroke.points.reduce((next,point)=>Math.max(next,point.y+stroke.width),height),0)??0;}
/** Ordered erasers mask earlier ink only. Removing the last operation is exact Undo. */
export function sheetInkSvg(ink:SheetInk|undefined,height:number,prefix:string):string {
  let paths='';const masks:string[]=[];
  for(const [index,stroke]of (ink?.strokes??[]).entries()){
    const outline=strokeOutline(stroke.points,stroke.width);
    if(stroke.tool==='eraser'){const id=`${prefix}-${index}`;masks.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="${height}"><rect width="1000" height="${height}" fill="white"/><path d="${outline}" fill="black"/></mask>`);paths=`<g mask="url(#${id})">${paths}</g>`;}
    else paths+=`<path data-sheet-ink-stroke="${index}" d="${outline}" fill="${stroke.color}" fill-opacity="${stroke.tool==='marker'?.32:1}"/>`;
  }
  return`<defs>${masks.join('')}</defs><g data-sheet-ink="true">${paths}</g>`;
}
