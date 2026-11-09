import {Mark} from '@tiptap/core';
import {annotationCanonical,validateAnnotationAttrs,type AnnotationPresentation,type RichAnnotationAttrs,type RichAnnotationSpec} from '../convergence/annotationFormat';

export const INLINE_ANNOTATION_ATTRIBUTE='data-writer-inline-annotation';
/** The own clipboard marker carries the contract, not merely its display label. */
export function readInlineAnnotation(raw:string|null,spec:RichAnnotationSpec|undefined):RichAnnotationAttrs|undefined{
 if(!raw||!spec)return undefined;
 try{const value:unknown=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='attrs,descriptor'||!('descriptor'in value)||!('attrs'in value)||annotationCanonical(value.descriptor)!==annotationCanonical(spec))return undefined;validateAnnotationAttrs(value.attrs,spec);return value.attrs;}catch{return undefined;}
}
/** Presentation dictionaries may omit labels; inherited object methods are not labels. */
export function annotationPresentationText(presentation:AnnotationPresentation|undefined,...keys:string[]):string|undefined{
 let value:unknown=presentation;
 for(const key of keys){if(!value||typeof value!=='object'||!Object.hasOwn(value,key))return;value=Reflect.get(value,key);}
 return typeof value==='string'?value:undefined;
}
export function annotationLabel(attrs:RichAnnotationAttrs,spec:RichAnnotationSpec,presentation?:AnnotationPresentation){
 return[annotationPresentationText(presentation,'label')??spec.id,...Object.keys(spec.attributes).map(key=>(annotationPresentationText(presentation,'attributes',key)??key)+': '+(annotationPresentationText(presentation,'values',key,String(attrs[key]))??String(attrs[key])))].join(' · ');
}
/** Only Writer's own semantic marker is guarded; ordinary external HTML is unchanged. */
export function incompatibleInlineAnnotationPaste(html:string,spec:RichAnnotationSpec|undefined):boolean{
 if(!html||!html.toLowerCase().includes(INLINE_ANNOTATION_ATTRIBUTE))return false;
 const fragment=new DOMParser().parseFromString(html,'text/html');
 return Array.from(fragment.querySelectorAll('['+INLINE_ANNOTATION_ATTRIBUTE+']')).some(element=>!readInlineAnnotation(element.getAttribute(INLINE_ANNOTATION_ATTRIBUTE),spec));
}
/** A host-generated mark for the field's fixed declarative policy, never an author schema. */
export function inlineAnnotationMark(spec:RichAnnotationSpec,presentation?:()=>AnnotationPresentation|undefined){return Mark.create({
 name:'annotation',inclusive:false,excludes:'annotation',
 addAttributes(){return{value:{default:null,rendered:false}};},
 parseHTML(){return[{tag:'span['+INLINE_ANNOTATION_ATTRIBUTE+']',getAttrs:(element:HTMLElement)=>{const value=readInlineAnnotation(element.getAttribute(INLINE_ANNOTATION_ATTRIBUTE),spec);return value?{value}:false;}}];},
 renderHTML({mark}){const value:unknown=mark.attrs.value;validateAnnotationAttrs(value,spec);const label=annotationLabel(value,spec,presentation?.());return['span',{[INLINE_ANNOTATION_ATTRIBUTE]:annotationCanonical({descriptor:spec,attrs:value}),title:label,'aria-label':label,class:'underline decoration-dotted decoration-accent-gold underline-offset-4'},0];},
 });}
