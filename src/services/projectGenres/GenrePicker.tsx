import {useId,useState} from 'react';
import {useTranslation} from '@/i18n/useTranslation';
import {normalizeProjectGenres,PROJECT_GENRE_PRESETS} from './types';
export default function GenrePicker({value,onChange,disabled=false}:{value:string[];onChange:(genres:string[])=>void;disabled?:boolean}){
 const {locale}=useTranslation(),es=locale==='es',id=useId(),[custom,setCustom]=useState('');
 const add=(label:string)=>{if(!label.trim())return;onChange(normalizeProjectGenres([...value,label]));setCustom('');};
 const label=(genre:string)=>PROJECT_GENRE_PRESETS.find(([name])=>name===genre)?.[es?1:0]??genre;
 return <fieldset disabled={disabled} className="min-w-0 space-y-2"><legend className="mb-1.5 text-sm text-text-muted">{es?'Géneros':'Genres'}</legend>
  {value.length>0&&<ul className="flex flex-wrap gap-2" aria-label={es?'Géneros elegidos':'Selected genres'}>{value.map(genre=><li key={genre} className="max-w-full"><button type="button" className="min-h-9 max-w-full break-words rounded-lg border border-border bg-elevated px-3 text-left text-sm text-text-primary hover:border-accent-gold focus-visible:outline-accent-gold" aria-label={`${es?'Quitar género':'Remove genre'}: ${label(genre)}`} onClick={()=>onChange(value.filter(item=>item!==genre))}>{label(genre)} <span aria-hidden="true">×</span></button></li>)}</ul>}
  <label className="sr-only" htmlFor={`${id}-suggestion`}>{es?'Añadir género sugerido':'Add suggested genre'}</label>
  <select id={`${id}-suggestion`} value="" onChange={event=>add(event.target.value)} className="min-h-10 w-full rounded-lg border border-border bg-elevated px-3 text-sm text-text-primary outline-none focus:border-accent-gold"><option value="">{es?'Añadir género…':'Add genre…'}</option>{PROJECT_GENRE_PRESETS.filter(([name])=>!value.includes(name)).map(([name,translated])=><option key={name} value={name}>{es?translated:name}</option>)}</select>
  <div className="flex gap-2"><label className="sr-only" htmlFor={`${id}-custom`}>{es?'Otro género':'Custom genre'}</label><input id={`${id}-custom`} value={custom} onChange={event=>setCustom(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();add(custom);}}} placeholder={es?'Otro género':'Custom genre'} className="min-h-10 min-w-0 flex-1 rounded-lg border border-border bg-elevated px-3 text-sm text-text-primary outline-none focus:border-accent-gold"/><button type="button" onClick={()=>add(custom)} disabled={!custom.trim()} className="min-h-10 shrink-0 rounded-lg border border-border px-3 text-sm text-text-primary hover:bg-elevated disabled:opacity-40 focus-visible:outline-accent-gold">{es?'Añadir':'Add'}</button></div>
 </fieldset>;
}
