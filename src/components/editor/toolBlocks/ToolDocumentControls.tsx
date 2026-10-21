import { useId,useState,useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Blocks,ChevronDown } from 'lucide-react';
import { listToolDocuments } from './preview';
import { toolBlockCopy } from './copy';
import { useToolDocumentDepth } from './EmbeddedToolCloseContext';
import { useEnginePane } from '@/engines/_shared/EnginePaneContext';
export default function ToolDocumentControls({editor,projectId,locale}:{editor:Editor;projectId:string;locale:'es'|'en'}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),id=useId(),c=toolBlockCopy[locale],depth=useToolDocumentDepth();
  const subscribe=(changed:()=>void)=>{editor.on('transaction',changed);return()=>{editor.off('transaction',changed);};};useSyncExternalStore(subscribe,()=>editor.state);
  const pane=useEnginePane(),eraId=pane?.projectId===projectId?pane.eraId:undefined;
  const targets=useLiveQuery(()=>listToolDocuments(projectId,eraId),[projectId,eraId])??[];
  const filtered=targets.filter(target=>`${target.label} ${c.kinds[target.kind]}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0,40);
  const canInsert=!editor.isDestroyed&&editor.isEditable&&editor.can().insertToolDocumentBlock({projectId,kind:'maps',documentId:'placement',label:''});
  if(depth)return null;
  const button='inline-flex min-h-8 items-center gap-2 rounded border border-border bg-surface px-2 py-1.5 text-xs text-text-primary hover:bg-elevated disabled:opacity-50';
  return <div data-tool-block-controls className="w-full min-w-0 px-2 py-1.5"><button type="button" className={button} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}><Blocks size={15}/>{c.title}<ChevronDown size={13}/></button>{open&&<section id={id} aria-label={c.insert} className="mt-3 space-y-3"><p className="text-xs text-text-muted">{c.help}</p><input aria-label={c.search} type="search" value={query} onChange={event=>setQuery(event.target.value)} className="w-full rounded border border-border bg-deep px-3 py-2 text-sm text-text-primary"/><ul className="m-0 max-h-64 list-none space-y-2 overflow-auto p-0">{filtered.map(target=><li key={`${target.kind}:${target.documentId}`}><button type="button" className={`${button} w-full justify-between text-left`} disabled={!canInsert} onClick={()=>{if(editor.chain().focus().insertToolDocumentBlock(target).run())setOpen(false);}}><span className="min-w-0 break-words">{target.label||c.fallback}</span><span className="shrink-0 text-text-muted">{c.kinds[target.kind]}</span></button></li>)}</ul>{!filtered.length&&<p className="text-sm text-text-muted">{c.empty}</p>}</section>}</div>;
}
