import type {Node as PMNode} from '@tiptap/pm/model';
import {RICH_MARKS,richHref,type RichMark,type RichMarkValue} from '../convergence/richTypes';
import type {RichEditorSession} from './session';

export interface InlineFormat {marks:RichMark[];link?:{href:string}}
export function richInlineFormat(marks:readonly RichMarkValue[]=[]):InlineFormat {
 const link=marks.find(m=>m.type==='link');return{marks:RICH_MARKS.filter(kind=>marks.some(m=>m.type===kind)),...(link?.type==='link'?{link:{href:link.attrs.href}}:{})};
}
/** Both paragraph and tree admission carry values, never another author's witness. */
export function inlineCells(node:PMNode,links=false):InlineFormat[]{
 const result:InlineFormat[]=[];node.forEach(child=>{
  if(!child.isText||child.marks.some(m=>!RICH_MARKS.includes(m.type.name as RichMark)&&!(links&&m.type.name==='link')))throw Error('local_tool_rich_editor_schema_invalid');
  const link=child.marks.find(m=>m.type.name==='link');if(link&&!richHref(link.attrs.href))throw Error('local_tool_rich_editor_link_invalid');
  const value:InlineFormat={marks:RICH_MARKS.filter(kind=>child.marks.some(m=>m.type.name===kind)),...(link?{link:{href:link.attrs.href as string}}:{})};for(let i=0;i<(child.text??'').length;i++)result.push(value);
 });return result;
}
export function matchInlineLinks(session:RichEditorSession,nodeId:string,want:InlineFormat[],have:InlineFormat[]){
 if(!session.links)return;let at=0;
 while(at<want.length){const href=want[at].link?.href??null;if((have[at]?.link?.href??null)===href){at++;continue;}let to=at+1;while(to<want.length&&(want[to].link?.href??null)===href&&(have[to]?.link?.href??null)!==href)to++;
  session.apply({type:'rich-link',field:session.field,nodeId,range:session.replica.richRange(session.field,nodeId,at,to),href});at=to;
 }
}
