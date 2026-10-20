import { liveQuery } from 'dexie';
import { escapeToolText,toolTarget } from './model';
import { resolveToolPreview } from './preview';
import { toolBlockCopy } from './copy';
/** Hydrate only the reader DOM; persisted host HTML and undo are untouched. */
export function hydrateToolDocumentBlocks(container:HTMLElement,projectId:string,locale:'es'|'en') {
  const subscriptions=[...container.querySelectorAll<HTMLElement>('figure[data-wh-tool-block="true"]')].map(element=>{
    const target=toolTarget({projectId:element.dataset.projectId,kind:element.dataset.toolKind,documentId:element.dataset.documentId,label:element.dataset.label});
    const fallback=()=>{element.replaceChildren(document.createTextNode(toolBlockCopy[locale].unavailable));};
    if(!target||target.projectId!==projectId){fallback();return undefined;}
    return liveQuery(()=>resolveToolPreview(target,projectId,locale)).subscribe({next:preview=>{
      if(!preview){fallback();return;}
      element.innerHTML=`<figcaption><strong>${escapeToolText(preview.title)}</strong></figcaption>${preview.html}${preview.truncated?`<p>${escapeToolText(toolBlockCopy[locale].truncated)}</p>`:''}`;
    },error:fallback});
  });
  return()=>subscriptions.forEach(subscription=>subscription?.unsubscribe());
}
