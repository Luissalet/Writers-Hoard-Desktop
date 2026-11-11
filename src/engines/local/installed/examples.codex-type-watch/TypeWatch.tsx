import {useEffect,useState} from 'react';
import {ProjectIcon} from '@/components/common/ProjectIcon';
import {codexTypeColors,codexTypeIcons} from '@/components/codex/codexTypeMeta';
import {useLocalToolLocale,type CodexTypeCatalogueRow,type LocalToolCodexTypes,type LocalToolProps} from '../../sdk';
import type {TypeWatchState} from './module';

export default function TypeWatch({client}:LocalToolProps<TypeWatchState>){
 const es=useLocalToolLocale(client).locale==='es',port=client.codexTypes;
 const [result,setResult]=useState<{port:LocalToolCodexTypes;rows:readonly CodexTypeCatalogueRow[];error:boolean}>();
 const [selected,select]=useState('');
 useEffect(()=>{
  if(!port)return;
  return port.watch(rows=>setResult({port,rows,error:false}),()=>setResult({port,rows:[],error:true}));
 },[port]);
 if(!port)return <p className="text-sm text-text-muted">{es?'Este panel no tiene acceso al catálogo de tipos.':'The type catalogue is unavailable in this view.'}</p>;
 const current=result?.port===port?result:undefined;
 if(!current)return <p role="status" className="text-sm text-text-muted">{es?'Cargando tipos…':'Loading types…'}</p>;
 if(current.error)return <p role="alert" className="text-sm text-warning">{es?'No se pudieron leer los tipos del Códex.':'The Codex types could not be read.'}</p>;
 const rows=current.rows,row=rows.find(item=>item.id===selected)??rows[0];
 if(!row)return <p className="text-sm text-text-muted">{es?'Crea un tipo reutilizable en el Códex para consultarlo aquí.':'Create a reusable type in the Codex to see it here.'}</p>;
 return <section className="space-y-3" aria-label={es?'Catálogo de tipos del Códex':'Codex type catalogue'}>
  <label className="block space-y-1 text-sm text-text-muted">
   <span>{es?'Tipo':'Type'}</span>
   <select value={row.id} onChange={event=>select(event.target.value)} className="block w-full rounded-lg border border-border bg-surface p-2 text-text-primary">
    {rows.map(item=><option key={item.id} value={item.id}>{item.path}</option>)}
   </select>
  </label>
  <h3 className="flex items-center gap-2 font-medium text-text-primary">
   <ProjectIcon name={row.icon} fallback={codexTypeIcons[row.category]} size={18} style={{color:row.color??codexTypeColors[row.category]}}/>
   {row.name}
  </h3>
  {row.hiddenFromPickers&&<p className="text-sm text-text-muted">{es?'Oculto en los selectores de creación':'Hidden from creation pickers'}</p>}
  <h4 className="text-sm font-medium">{es?'Propiedades':'Properties'}</h4>
  {row.properties.length||row.references.length?<ul className="space-y-1 text-sm text-text-muted">
   {row.properties.map(property=><li key={property.id}>{property.label} · {property.kind}{property.required?(es?' · Obligatoria':' · Required'):''}</li>)}
   {row.references.map(reference=><li key={'reference:'+reference.key}>{reference.label} · {es?'Referencia':'Reference'}</li>)}
  </ul>:<p className="text-sm text-text-muted">{es?'Sin propiedades definidas.':'No properties defined.'}</p>}
 </section>;
}
