import {useLayoutEffect,useRef,useState} from 'react';
import {defineLocalTool,useLocalToolDocumentFields,useLocalToolPublishedOpenDocuments,useLocalToolLocale,type LocalToolJson,type LocalToolProps} from '@/engines/local/sdk';
import {useLocalToolState} from '../../useLocalToolState';
type Data={score:number;note:string};
const fields={score:{path:'$.score',type:'number' as const},note:{path:'$.note',type:'string' as const}};
const namespace='examples.published-fields';
const control='min-h-10 rounded-lg border border-border bg-elevated px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent-gold disabled:opacity-50';
// Source example exports its definition, rather than a React refresh boundary.
// eslint-disable-next-line react-refresh/only-export-components
function PublishedFields({client,context}:LocalToolProps<Data>){
 const es=useLocalToolLocale(client).locale.startsWith('es'),[draft,setDraft]=useState<Data>(),[sharing,setSharing]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const state=useLocalToolState(client,{observe:true,hasDraft:draft!==undefined}),publication=useLocalToolDocumentFields(context,sharing?draft:undefined),projected=useLocalToolPublishedOpenDocuments(client,{namespace,fields});
 const owner=useRef<object>({});useLayoutEffect(()=>{owner.current={};setSaving(false);setError('');return()=>{owner.current={};};},[client]);
 const value=draft??state.snapshot?.data,editable=context?.canEdit!==false;
 const save=async()=>{if(!draft||!state.snapshot||saving)return;const token=owner.current,selected=draft;setSaving(true);setError('');try{await client.save(selected,state.snapshot.revision,state.snapshot.document?.version);if(owner.current!==token)return;setDraft(current=>current===selected?undefined:current);await state.reload();}catch(reason){if(owner.current===token)setError(String(reason));}finally{if(owner.current===token)setSaving(false);}};
 return <section className="space-y-4 p-4 text-text-primary" data-published-fields-example data-instance={publication.instanceId}>
  <h2 className="font-display text-xl">{es?'Campos entre paneles':'Fields between panes'}</h2>
  <p className="text-sm text-text-muted">{es?'Publica este borrador para los paneles abiertos. Guardar conserva el documento.':'Publish this draft for open panes. Save keeps the document.'}</p>
  <label className="block space-y-1 text-sm">{es?'Puntuación':'Score'}<input className={control+' block w-full'} type="number" aria-label={es?'Puntuación':'Score'} disabled={!value||!editable} value={value?.score??''} onChange={event=>setDraft({...value!,score:Number(event.target.value)})}/></label>
  <label className="block space-y-1 text-sm">{es?'Nota':'Note'}<textarea className={control+' block w-full'} aria-label={es?'Nota':'Note'} disabled={!value||!editable} value={value?.note??''} onChange={event=>setDraft({...value!,note:event.target.value})}/></label>
  <div className="flex flex-wrap gap-2"><button className={control} disabled={!draft||!publication.available} onClick={()=>setSharing(true)}>{es?'Publicar borrador':'Publish draft'}</button><button className={control} disabled={!draft||saving||!editable} onClick={()=>void save()}>{es?'Guardar':'Save'}</button><button className={control} disabled={saving||!value} onClick={()=>{publication.clear();setSharing(false);setDraft(undefined);void state.reload();}}>{es?'Descartar':'Discard'}</button></div>
  {(error||state.error||publication.error||projected.error)&&<p role="alert">{error||state.error||publication.error||projected.error}</p>}
  <p className="text-sm text-text-muted">{es?'Guardado':'Saved'}: <span data-saved-score>{state.snapshot?.data.score??'…'}</span></p>
  <h3 className="font-semibold">{es?'Borradores publicados en esta era':'Published drafts in this era'}</h3>
  {projected.loading?<p role="status">{es?'Actualizando…':'Refreshing…'}</p>:<ul className="space-y-2" data-published-field-rows>{projected.rows.map(row=><li key={row.instanceId} data-published-instance={row.instanceId} className="rounded-lg border border-border p-3"><span className="font-medium">{row.title}</span><span className="ml-2 text-sm text-text-muted">{row.instanceId===publication.instanceId?(es?'Este panel':'This pane'):(es?'Vista ':'View ')+row.instanceId.slice(-8)}</span><p>{String(row.fields.score??'')} · {String(row.fields.note??'')}</p></li>)}</ul>}
 </section>;
}
const definition=defineLocalTool<Data>({namespace,name:{en:'Published draft fields',es:'Campos de borrador publicados'},description:{en:'Explicitly share draft fields between open Source panes',es:'Publicación explícita de campos entre paneles Source abiertos'},document:{defaultTitle:{en:'Draft fields',es:'Campos de borrador'},embed:'interactive'},initialState:{score:7,note:''},codec:{version:1,fields:{score:{kind:'scalar'},note:{kind:'scalar'}}},index:{version:1,fields},validateState:(v:LocalToolJson):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v)&&typeof v.score==='number'&&Number.isFinite(v.score)&&typeof v.note==='string',component:PublishedFields});

export default definition;
