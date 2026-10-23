import { sanitizeRichHtml } from '@/utils/sanitizeRichHtml';
import type { Note } from './types';
const escape=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export const plainNoteHtml=(text:string)=>text.split(/\r?\n/).map(line=>`<p>${escape(line)||'<br>'}</p>`).join('');
/** A rich note owns its plain projection. No migration or writes happen on read. */
export function normalizeNoteContent<T extends Partial<Note>>(changes:T):T & Partial<Pick<Note,'text'|'richHtml'>> {
  if(Object.hasOwn(changes,'richHtml')){
    if(changes.richHtml===undefined)return changes;
    const richHtml=sanitizeRichHtml(changes.richHtml),doc=new DOMParser().parseFromString(richHtml,'text/html');
    doc.querySelectorAll('br').forEach(node=>node.replaceWith('\n'));
    doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,tr').forEach(node=>node.append('\n'));
    const text=(doc.body.textContent??'').replace(/\u00a0/g,' ').replace(/[\t ]+\n/g,'\n').replace(/\n+/g,'\n').trim();
    return{...changes,richHtml,text};
  }
  return Object.hasOwn(changes,'text')?{...changes,richHtml:undefined}:changes;
}
export const hasNoteContent=(text:string,richHtml?:string)=>Boolean(text.trim()||richHtml&&/<(?:img|hr|table)\b/i.test(richHtml));
