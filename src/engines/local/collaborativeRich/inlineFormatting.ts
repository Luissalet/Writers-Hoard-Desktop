import {annotationCanonical,validateAnnotationAttrs,type RichAnnotationSpec,type RichAnnotationAttrs} from '../convergence/annotationFormat';
import type {Node as PMNode} from '@tiptap/pm/model';
import {RICH_MARK_KEYS,RICH_MARKS,richHref,type RichMark,type RichMarkValue,type RichText} from '../convergence/richTypes';
import {normalizeEditorLinkHref} from '@/utils/normalizeEditorLinkHref';
import type {RichEditorSession} from './session';

export interface InlineFormat {marks:RichMark[];link?:{href:string};annotation?:RichAnnotationAttrs}
export function richInlineFormat(marks:readonly RichMarkValue[]=[]):InlineFormat {
 const link=marks.find(m=>m.type==='link'),annotation=marks.find(m=>m.type==='annotation');return{marks:RICH_MARKS.filter(kind=>marks.some(m=>m.type===kind)),...(link?.type==='link'?{link:{href:link.attrs.href}}:{}),...(annotation?.type==='annotation'?{annotation:{...annotation.attrs}}:{})};
}
/** Both paragraph and tree admission carry values, never another author's witness. */
export function inlineCells(node:PMNode,links=false,annotation?:RichAnnotationSpec):InlineFormat[]{
 const result:InlineFormat[]=[];node.forEach(child=>{
  if(!child.isText||child.marks.some(m=>!RICH_MARKS.includes(m.type.name as RichMark)&&!(links&&m.type.name==='link')&&!(annotation&&m.type.name==='annotation')))throw Error('local_tool_rich_editor_schema_invalid');
  const link=child.marks.find(m=>m.type.name==='link');if(link&&!richHref(link.attrs.href))throw Error('local_tool_rich_editor_link_invalid');
  const mark=child.marks.find(m=>m.type.name==='annotation');let attrs:RichAnnotationAttrs|undefined;if(mark){if(!annotation)throw Error('local_tool_rich_annotation_invalid');const value:unknown=mark.attrs.value;validateAnnotationAttrs(value,annotation);attrs=value;}
  const value:InlineFormat={marks:RICH_MARKS.filter(kind=>child.marks.some(m=>m.type.name===kind)),...(link?{link:{href:link.attrs.href as string}}:{}),...(attrs?{annotation:attrs}:{})};for(let i=0;i<(child.text??'').length;i++)result.push(value);
 });return result;
}
export function clipboardParagraphRuns(paragraph:PMNode,annotation?:RichAnnotationSpec):RichText[]|null{
 if(paragraph.type.name!=='paragraph')return null;
 const runs:RichText[]=[];
 for(let i=0;i<paragraph.childCount;i++){
  const node=paragraph.child(i),marks:RichMarkValue[]=[];
  if(!node.isText||!node.text)return null;
  for(const type of [...RICH_MARK_KEYS,...(annotation?['annotation' as const]:[])]){
   const mark=node.marks.find(value=>value.type.name===type);
   if(!mark)continue;
   if(type==='link'){
    const href=typeof mark.attrs.href==='string'?normalizeEditorLinkHref(mark.attrs.href):null;
    if(href)marks.push({type,attrs:{href}});
   }else if(type==='annotation'){if(!annotation)return null;const attrs:unknown=mark.attrs.value;try{validateAnnotationAttrs(attrs,annotation);}catch{return null;}marks.push({type,attrs});}else marks.push({type});
  }
  const previous=runs.at(-1);
  if(previous&&JSON.stringify(previous.marks??[])===JSON.stringify(marks))previous.text+=node.text;
  else runs.push({type:'text',text:node.text,...(marks.length?{marks}:{})});
 }
 return runs;
}
export function matchInlineLinks(session:RichEditorSession,nodeId:string,want:InlineFormat[],have:InlineFormat[]){
 if(!session.links)return;let at=0;
 while(at<want.length){const href=want[at].link?.href??null;if((have[at]?.link?.href??null)===href){at++;continue;}let to=at+1;while(to<want.length&&(want[to].link?.href??null)===href&&(have[to]?.link?.href??null)!==href)to++;
  session.apply({type:'rich-link',field:session.field,nodeId,range:session.replica.richRange(session.field,nodeId,at,to),href});at=to;
 }
}

export function matchInlineAnnotations(session:RichEditorSession,nodeId:string,want:InlineFormat[],have:InlineFormat[]){
 if(!session.annotation)return;let at=0;
 while(at<want.length){const attrs=want[at].annotation??null,key=annotationCanonical(attrs);if(annotationCanonical(have[at]?.annotation??null)===key){at++;continue;}let to=at+1;while(to<want.length&&annotationCanonical(want[to].annotation??null)===key&&annotationCanonical(have[to]?.annotation??null)!==key)to++;
  session.apply({type:'rich-annotation',field:session.field,nodeId,range:session.replica.richRange(session.field,nodeId,at,to),attrs});at=to;
 }
}
