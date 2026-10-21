import {useRef,useState} from 'react';
import {RotateCcw} from 'lucide-react';
import {useTranslation} from '@/i18n/useTranslation';
import type {WorldEraScope} from '@/services/worldEras/types';
import {mutateAnnotationThread,deleteAnnotationThread,undoAnnotationThread,type AnnotationThreadAction} from '../threads';
import type {AnnotationWithReference,AnnotationUndo} from '../types';
import NoteCard from './NoteCard';
import {annotationDrafts} from '../drafts';
import {commentButton} from './ThreadTextEditor';
export default function CommentThreadList({items,scope,emptyLabel}:{items:AnnotationWithReference[];scope:WorldEraScope;emptyLabel?:string}){
 const {locale}=useTranslation(),es=locale==='es';const[status,setStatus]=useState('open'),[undo,setUndo]=useState<AnnotationUndo>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);const locked=useRef(false);const[drafting,setDrafting]=useState<Set<string>>(()=>new Set(annotationDrafts(scope).keys()));
 const run=async(operation:()=>Promise<void>)=>{if(locked.current)return false;locked.current=true;setBusy(true);setError('');try{await operation();return true;}catch{setError(es?'El hilo cambió o no se pudo guardar. Conservamos tu borrador. Revisa las respuestas actuales antes de reintentar.':'The thread changed or could not be saved. Your draft is preserved. Review the current replies before retrying.');return false;}finally{locked.current=false;setBusy(false);}};
 const mutate=(id:string,action:AnnotationThreadAction,revision:number)=>run(async()=>{setUndo((await mutateAnnotationThread(scope,id,revision,action)).undo);});
 const visible=items.filter(row=>drafting.has(row.id)||status==='all'||(status==='resolved')===!!row.resolvedAt);
 return <div className="min-w-0 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><label className="text-xs text-text-muted">{es?'Mostrar':'Show'} <select aria-label={es?'Estado de comentarios':'Comment status'} className="min-h-9 rounded-lg border border-border bg-deep px-2 py-1 text-sm text-text-primary" value={status} onChange={event=>setStatus(event.target.value)}><option value="open">{es?'Abiertos':'Open'}</option><option value="resolved">{es?'Resueltos':'Resolved'}</option><option value="all">{es?'Todos':'All'}</option></select></label>{undo&&<button type="button" className={commentButton} disabled={busy} data-comment-undo onClick={()=>void run(async()=>{await undoAnnotationThread(undo);setUndo(undefined);})}><RotateCcw size={14}/>{es?'Deshacer':'Undo'}</button>}</div>{error&&<p role="alert" className="text-sm text-danger">{error}</p>}
 <ul className="space-y-3">{visible.map(annotation=><li key={annotation.id}><NoteCard annotation={annotation} scope={scope} busy={busy} onDraftState={editing=>setDrafting(previous=>{if(previous.has(annotation.id)===editing)return previous;const next=new Set(previous);if(editing)next.add(annotation.id);else next.delete(annotation.id);return next;})} onMutate={(action,revision)=>mutate(annotation.id,action,revision)} onDelete={async revision=>{await run(async()=>{setUndo((await deleteAnnotationThread(scope,annotation.id,revision)).undo);});}}/></li>)}</ul>{!visible.length&&<p className="py-2 text-xs text-text-muted">{emptyLabel??(es?'No hay comentarios con este estado.':'No comments with this status.')}</p>}</div>;
}
