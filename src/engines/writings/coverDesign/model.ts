import type {ReaderPresentation} from '../readerPresentationTypes';
import {COVER_FONTS,type CoverJacket,type CoverElement,type CoverFace} from './types';
export const COVER_WIDTH=600,COVER_HEIGHT=900,COVER_SPINE=72,COVER_SPREAD=1272;
export const COVER_FONT_STACKS={georgia:'Georgia,serif',palatino:'Palatino Linotype,Palatino,serif',times:'Times New Roman,Times,serif',arial:'Arial,sans-serif',verdana:'Verdana,sans-serif',trebuchet:'Trebuchet MS,sans-serif',courier:'Courier New,monospace',garamond:'Garamond,serif'};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const number=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const color=(v:unknown)=>typeof v==='string'&&/^#[a-f\d]{6}$/i.test(v);
export function coverContrast(background:string):string {if(!color(background))return '';const rgb=[1,3,5].map(i=>parseInt(background.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4),luminance=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;return(luminance+.05)/.05>=1.05/(luminance+.05)?'#000000':'#ffffff';}
export const coverRaster=(v:unknown):v is string=>typeof v==='string'&&/^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(v);
export function validateCoverJacket(value:unknown):asserts value is CoverJacket {
 if(!record(value)||value.version!==1||!Array.isArray(value.elements))throw Error('cover_jacket_invalid');
 const ids=new Set<string>();for(const e of value.elements){
  if(!record(e)||typeof e.id!=='string'||!e.id||ids.has(e.id)||!['text','image','ink'].includes(String(e.kind))||!['x','y','width','height','rotation'].every(k=>number(e[k]))||Number(e.width)<=0||Number(e.height)<=0)throw Error('cover_element_invalid');ids.add(e.id);
  if(e.kind==='text'&&(typeof e.text!=='string'||!COVER_FONTS.includes(e.font as typeof COVER_FONTS[number])||!number(e.size)||e.size<=0||typeof e.bold!=='boolean'||!['left','center','right'].includes(String(e.align))||!color(e.color)))throw Error('cover_text_invalid');
  if(e.kind==='image'&&!coverRaster(e.src))throw Error('cover_image_invalid');
  if(e.kind==='ink'&&(!color(e.color)||!number(e.weight)||e.weight<=0||!Array.isArray(e.points)||!e.points.length||e.points.some(p=>!record(p)||!number(p.x)||!number(p.y)||p.pressure!==undefined&&(!number(p.pressure)||p.pressure<0||p.pressure>1))))throw Error('cover_ink_invalid');
 }
}
export function validateReaderCover(value:unknown):asserts value is ReaderPresentation['cover'] {
 if(!record(value)||!['hardcover','paperback','paper'].includes(String(value.style))||!color(value.color)||!['none','linen','lines'].includes(String(value.texture))||typeof value.artwork!=='boolean'||typeof value.showAtStart!=='boolean')throw Error('reader_cover_invalid');
 if(value.jacket!==undefined)validateCoverJacket(value.jacket);
}
export function validateProjectCoverMetadata(project:{readerPresentation?:unknown;worldEras?:readonly {readerCover?:unknown}[];publishedEditions?:readonly {presentation?:unknown}[]}):void {
 if(record(project.readerPresentation)&&record(project.readerPresentation.cover)&&project.readerPresentation.cover.jacket!==undefined)validateCoverJacket(project.readerPresentation.cover.jacket);
 for(const era of project.worldEras??[])if(era.readerCover!==undefined)validateReaderCover(era.readerCover);
 for(const edition of project.publishedEditions??[])if(record(edition.presentation)&&record(edition.presentation.cover)&&edition.presentation.cover.jacket!==undefined)validateCoverJacket(edition.presentation.cover.jacket);
}
export function cloneCoverJacket(cover:ReaderPresentation['cover'],remap:(id:string,prefix:string)=>string):ReaderPresentation['cover'] {
 validateReaderCover(cover);return{...structuredClone(cover),...(cover.jacket?{jacket:{version:1,elements:cover.jacket.elements.map(e=>({...structuredClone(e),id:remap(e.id,'cover-element')}))}}:{})};
}
/** Pure effective-project seam; chapter/audio settings keep their existing shared scope. */
export function applyEraReaderCover<T extends {readerPresentation?:ReaderPresentation}>(project:T,era?:{readerCover?:ReaderPresentation['cover']}):T {
 if(!era?.readerCover)return project;
 return{...project,readerPresentation:{revision:0,chapters:{},...project.readerPresentation,cover:structuredClone(era.readerCover)}};
}
export function coverFaceBox(face:CoverFace){return{x:face==='front'?COVER_WIDTH+COVER_SPINE:face==='spine'?COVER_WIDTH:0,y:0,width:face==='spread'?COVER_SPREAD:face==='spine'?COVER_SPINE:COVER_WIDTH,height:COVER_HEIGHT};}
export function initialCoverJacket(title:string,ink:string,frontTitle=true):CoverJacket {
 const elements:CoverJacket['elements']=[];
 if(frontTitle)elements.push({id:crypto.randomUUID(),kind:'text',text:title,x:732,y:160,width:480,height:170,rotation:0,font:'georgia',size:64,bold:true,align:'center',color:ink});
 elements.push({id:crypto.randomUUID(),kind:'text',text:title,x:231,y:420,width:810,height:60,rotation:90,font:'georgia',size:30,bold:false,align:'center',color:ink});return{version:1,elements};
}
export function elementLabel(e:CoverElement){return e.kind==='text'?e.text||'Text':e.kind==='image'?'Artwork':'Ink';}
