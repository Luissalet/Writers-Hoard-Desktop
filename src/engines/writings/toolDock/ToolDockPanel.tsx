import {lazy,Suspense,useRef,useState} from 'react';
import Modal from '@/components/common/Modal';
import {useTranslation} from '@/i18n/useTranslation';
import type {WorldEraScope} from '@/services/worldEras/types';
import type {ToolDockOwner} from './types';
const ToolDock=lazy(()=>import('./ToolDock'));
/** Natural lazy boundary: closed Writing/Book editors load no focused tool editors. */
export default function ToolDockPanel({scope,owner,temporary=false}:{scope:WorldEraScope;owner:ToolDockOwner;temporary?:boolean}){const {locale}=useTranslation(),[open,setOpen]=useState(false),guard=useRef<()=>boolean>(()=>true),es=locale==='es',body=<Suspense fallback={<p role="status">…</p>}><ToolDock key={JSON.stringify([scope.projectId,scope.eraId??null,owner])} scope={scope} owner={owner} locale={locale} registerGuard={value=>{guard.current=value;}}/></Suspense>;return <section data-writing-tool-dock-panel className="min-w-0"><button type="button" className="min-h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text-primary" aria-expanded={open} onClick={()=>{if(!open||guard.current())setOpen(!open);}}>{es?'Herramientas de escritura':'Writing tools'}</button>{open&&(temporary?<Modal open wide title={es?'Herramientas de escritura':'Writing tools'} onClose={()=>{if(guard.current())setOpen(false);}}><div className="p-4">{body}</div></Modal>:<div className="mt-3">{body}</div>)}</section>;}
