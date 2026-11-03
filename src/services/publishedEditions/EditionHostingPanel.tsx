import {useEffect,useState} from 'react';
import {WIKI_HOST_SLUG,type ReadHostAddress,type WikiHostAudience} from '@/services/wikiProfiles/hostingTypes';
import {describeEditionOwner,editionOwnerKey,listEditionAddresses,serveEditionAddress,withdrawEditionAddress} from './hosting';
import type {PublishedEdition} from './types';

/**
 * Serve a saved manuscript edition at its own /read/<slug> link, switch the link to another edition
 * of the same manuscript and era, or withdraw it. Without projectId it is the library view on Home:
 * every reading link in the local registry, including those whose project was removed.
 */
export default function EditionHostingPanel({projectId,edition,editionTitles,projectTitles,locale,control,button}:{
 projectId?:string;edition?:Pick<PublishedEdition,'id'|'title'|'writingScope'|'eraId'>;
 editionTitles?:Readonly<Record<string,string>>;projectTitles?:Readonly<Record<string,string>>;
 locale:'es'|'en';control:string;button:string;
}){
 const es=locale==='es',library=projectId===undefined,ownerKey=edition?editionOwnerKey(edition):undefined;
 const [open,setOpen]=useState(false),[addresses,setAddresses]=useState<ReadHostAddress[]>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const [slug,setSlug]=useState(''),[audience,setAudience]=useState<WikiHostAudience>('public');
 const existing=addresses?.find(address=>address.slug===slug);
 useEffect(()=>{
  if(!open)return;let active=true;
  void listEditionAddresses(library?{}:{projectId,ownerKey}).then(result=>{if(active){setAddresses(result);setError('');}},()=>{if(active)setError('wiki_host_unavailable');});
  return()=>{active=false;};
 },[open,library,projectId,ownerKey,reload]);
 async function update(work:()=>Promise<ReadHostAddress>){
  if(busy)return;setBusy(true);setError('');
  try{const next=await work();setAddresses(current=>[...(current??[]).filter(address=>address.slug!==next.slug),next].sort((a,b)=>a.slug.localeCompare(b.slug)));}
  catch(err){setError(err instanceof Error?err.message:'wiki_host_unavailable');}
  finally{setBusy(false);}
 }
 const ownerLabel=(address:ReadHostAddress)=>{const owner=describeEditionOwner(address.ownerKey);if(!owner)return'';const scope=owner.scope==='world'?(es?'Todo el mundo':'Whole world'):(owner.manuscriptId==='main'?(es?'Relato principal':'Main manuscript'):(es?'Relato ':'Manuscript ')+owner.manuscriptId);return`${scope} · ${owner.eraId??(es?'Base':'Base')}`;};
 return <details data-testid="edition-hosting" className="rounded-lg border border-border p-3" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary className="cursor-pointer font-display text-base">{library?(es?'Enlaces de lectura publicados':'Published reading links'):(es?'Enlace de lectura de esta edición':'Reading link for this edition')}</summary>
  <div className="mt-3 space-y-3">
   <p className="text-sm text-text-muted">{library
    ?(es?'Ediciones de manuscrito servidas en /read/. Puedes retirarlas aunque su proyecto ya no esté en tu biblioteca.':'Manuscript editions served under /read/. You can withdraw them even when their project is no longer in your library.')
    :(es?'El enlace sirve esta edición congelada tal cual: sólo sus capítulos, sin otros relatos ni el canon del mundo. Los cambios de los borradores no aparecen hasta que muevas el enlace a otra edición.':'The link serves this frozen edition as is: only its chapters, no other manuscript and no world canon. Draft changes appear only when you move the link to another edition.')}</p>
   {projectId&&edition&&<form className="flex flex-wrap items-end gap-3" onSubmit={event=>{event.preventDefault();if(addresses)void update(()=>serveEditionAddress({projectId,editionId:edition.id,slug,audience,expectedRevision:existing?.revision??0}));}}>
    <label className="grid gap-1 text-sm">{es?'Ruta del enlace':'Link path'}
     <input data-testid="edition-hosting-slug" className={control} value={slug} disabled={busy} required pattern={WIKI_HOST_SLUG.source} placeholder={es?'mi-novela':'my-novel'} onChange={event=>setSlug(event.target.value)}/></label>
    <label className="grid gap-1 text-sm">{es?'Quién puede verlo':'Who can see it'}
     <select data-testid="edition-hosting-audience" className={control} value={audience} disabled={busy} onChange={event=>setAudience(event.target.value==='unlisted'?'unlisted':'public')}>
      <option value="public">{es?'Público':'Public'}</option><option value="unlisted">{es?'Sólo con enlace privado':'Private link only'}</option></select></label>
    <button data-testid="edition-hosting-serve" className={button} disabled={busy||!addresses||!slug}>{existing?.active?(existing.editionId===edition.id?(es?'Actualizar enlace':'Update link'):(es?'Mover el enlace a esta edición':'Move the link to this edition')):(es?'Servir por enlace':'Serve by link')}</button>
   </form>}
   {!!addresses?.length&&<ul className="space-y-2">{addresses.map(address=><li key={address.ownerKey+address.slug} data-testid="edition-hosting-address" className="flex flex-wrap items-center gap-2 text-sm">
    {library&&<span className="text-text-muted">{projectTitles?.[address.projectId]??(es?'Proyecto fuera de la biblioteca':'Project outside the library')} · {ownerLabel(address)}</span>}
    {address.url?<a className="break-all underline" href={address.url} target="_blank" rel="noreferrer">{address.url}</a>:<span>{address.slug} · {es?'Retirado':'Withdrawn'}</span>}
    <span className="text-text-muted">{editionTitles?.[address.editionId]??address.editionId}{address.editionId===edition?.id?(es?' (esta edición)':' (this edition)'):''}</span>
    {!library&&<button type="button" className={button} disabled={busy} onClick={()=>{setSlug(address.slug);setAudience(address.audience);}}>{es?'Usar esta ruta':'Use this path'}</button>}
    {address.active&&<button type="button" className={button} disabled={busy} onClick={()=>{void update(()=>withdrawEditionAddress({projectId:address.projectId,ownerKey:address.ownerKey,slug:address.slug,expectedRevision:address.revision}));}}>{es?'Retirar enlace':'Withdraw link'}</button>}
   </li>)}</ul>}
   {addresses?.length===0&&<p className="text-sm text-text-muted">{es?'Todavía no hay enlaces de lectura.':'There are no reading links yet.'}</p>}
   {error&&<div className="flex flex-wrap items-center gap-3"><p role="alert" className="text-sm text-danger">{error==='wiki_host_conflict'
    ?(es?'La ruta ya la usa otro relato, otra era o ha cambiado. Actualiza la lista.':'The path is used by another manuscript or era, or it changed. Refresh the list.')
    :error==='wiki_host_slug_invalid'?(es?'La ruta sólo admite minúsculas, cifras y guiones internos.':'The path accepts lower-case letters, digits and internal hyphens only.')
    :(es?'No se pudo gestionar el enlace de lectura.':'Could not manage the reading link.')}</p>
    <button type="button" className={button} disabled={busy} onClick={()=>setReload(value=>value+1)}>{es?'Actualizar lista':'Refresh list'}</button></div>}
  </div>
 </details>;
}
