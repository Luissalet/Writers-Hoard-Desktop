import {useMemo,useRef,useState} from 'react';
import {useTranslation} from '@/i18n/useTranslation';
import {LocalToolAtomPendingContext} from '../blocks/pending';
import {SourceToolWorkspaceSession,type SourceToolWorkspaceProps} from '../documents/SourceToolWorkspace';
const key=(props:SourceToolWorkspaceProps)=>JSON.stringify([props.projectId,props.eraId??null,props.definition.namespace,props.documentId??null]);
/** Query retargeting shares the same pending protocol as normal navigation.
 * A blocked owner retains its actual mounted subtree until Save or Discard. */
export default function LocalAppWorkspace(props:SourceToolWorkspaceProps){
 const {locale}=useTranslation(),[binding,setBinding]=useState(props),[pending,setPending]=useState(false),tokens=useRef(new Set<string>());
 const report=useMemo(()=>(token:string,value:boolean)=>{if(value)tokens.current.add(token);else tokens.current.delete(token);setPending(tokens.current.size>0);},[]);
 const changed=key(binding)!==key(props);
 if(!pending&&binding!==props)setBinding(props);
 return <LocalToolAtomPendingContext.Provider value={report}>{changed&&<div role="status" className="space-y-2"><p>{locale==='es'?'Guarda o descarta el borrador antes de cambiar de instancia.':'Save or discard the draft before changing instance.'}</p><button type="button" className="min-h-10 rounded-lg border border-border px-3 text-sm disabled:opacity-40" data-local-app-binding-continue disabled={pending} onClick={()=>{if(!tokens.current.size)setBinding(props);}}>{locale==='es'?'Continuar':'Continue'}</button></div>}<SourceToolWorkspaceSession key={key(binding)} {...binding} definition={changed?binding.definition:props.definition}/></LocalToolAtomPendingContext.Provider>;
}
