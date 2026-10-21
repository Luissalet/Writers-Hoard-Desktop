import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import Modal from '@/components/common/Modal';
import { exportDocumentImage,downloadDocumentImage } from './index';
import type { DocumentImageRequest,DocumentImageResult } from './types';

export interface DocumentImageDialogProps {projectId:string;eraId?:string;target:{kind:DocumentImageRequest['kind'];entityId:string;title?:string};onClose:()=>void}
const input='min-h-10 w-full rounded-lg border border-border bg-deep px-3 py-2 text-sm text-text-primary focus-visible:outline-accent-gold';
const button='min-h-10 rounded-lg border border-border px-4 py-2 text-sm text-text-primary hover:bg-elevated focus-visible:outline-accent-gold disabled:opacity-50';
export default function DocumentImageDialog({projectId,eraId,target,onClose}:DocumentImageDialogProps){
  const {locale}=useTranslation(),es=locale==='es';
  const [width,setWidth]=useState(1440),[ratio,setRatio]=useState(1),[pageHeight,setPageHeight]=useState(2048),[mode,setMode]=useState('fit'),[view,setView]=useState({x:0,y:0,w:800,h:450});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<DocumentImageResult>();
  const canView=['board','maps','worldgen','genealogy'].includes(target.kind);
  const explain=(reason:unknown)=>{const message=reason instanceof Error?reason.message:String(reason);const copy:[string,string,string][]=[['document_not_found','El documento no está disponible en este mundo o era.','This document is unavailable in this world or era.'],['invalid_image_geometry','Revisa las dimensiones y la resolución. Cada mosaico puede medir hasta16000 píxeles por lado.','Check dimensions and pixel ratio. Each tile can measure up to16000 pixels per side.'],['invalid_image_view','El encuadre necesita coordenadas válidas y anchura/altura positivas.','The view needs valid coordinates and positive width/height.'],['desktop_image_renderer_unavailable','Abre este proyecto en el escritorio para crear la imagen.','Open this project in the desktop app to render the image.'],['document_assets_timeout','Un recurso no terminó de cargar. Vuelve a crear la imagen.','An asset did not finish loading. Render the image again.'],['video_decode_failed','No se pudo leer el vídeo local. Comprueba el archivo y vuelve a intentarlo.','The local video could not decode. Check its file and retry.']];const known=copy.find(([code])=>message.includes(code));return known?known[es?1:2]:message;};
  const run=async()=>{setBusy(true);setError('');try{setResult(await exportDocumentImage({projectId,eraId,kind:target.kind,entityId:target.entityId,width,pixelRatio:ratio,pageHeight,locale,view:canView&&mode==='view'?view:undefined}));}catch(reason){setError(explain(reason));}finally{setBusy(false);}};
  return <Modal open fullscreen busy={busy} onClose={onClose} title={es?'Exportar imagen':'Export image'}>
    <section className="p-4 sm:p-6" data-testid="document-image-dialog">
      <p className="break-words text-sm text-text-muted">{target.title??target.entityId} · {eraId??(es?'Base compartida':'Shared base')}</p>
      <p className="mt-4 max-w-prose text-sm text-text-muted">{es?'Se incluye el documento completo. Si no cabe en una imagen, se descarga un ZIP con los mosaicos PNG y su encuadre.':'Includes the complete document. Long or wide documents download as a ZIP of PNG tiles and their framing manifest.'}</p>
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <label className="space-y-1 text-xs text-text-muted">{es?'Anchura (px CSS)':'Width (CSS px)'}<input className={input} type="number" min="320" max={16000/ratio} value={width} onChange={event=>setWidth(Number(event.target.value))}/></label>
        <label className="space-y-1 text-xs text-text-muted">{es?'Resolución':'Pixel ratio'}<select className={input} value={ratio} onChange={event=>setRatio(Number(event.target.value))}>{[1,2,3,4].map(value=><option key={value}>{value}</option>)}</select></label>
        <label className="space-y-1 text-xs text-text-muted">{es?'Altura por mosaico':'Tile height'}<input className={input} type="number" min="320" max={16000/ratio} value={pageHeight} onChange={event=>setPageHeight(Number(event.target.value))}/></label>
        {canView&&<label className="space-y-1 text-xs text-text-muted">{es?'Encuadre':'Framing'}<select className={input} value={mode} onChange={event=>setMode(event.target.value)}><option value="fit">{es?'Todo el contenido':'Fit content'}</option><option value="view">{es?'Rectángulo':'Rectangle'}</option></select></label>}
      </div>
      {canView&&mode==='view'&&<fieldset className="mt-4 grid grid-cols-4 gap-3"><legend className="mb-2 text-xs text-text-muted">{target.kind==='worldgen'?(es?'Celdas del mundo':'World cells'):target.kind==='maps'?(es?'Porcentajes del mapa':'Map percentages'):(es?'Coordenadas del lienzo':'Canvas coordinates')}</legend>{(['x','y','w','h'] as const).map(key=><label key={key} className="text-xs text-text-muted">{key}<input className={input} type="number" value={view[key]} onChange={event=>setView({...view,[key]:Number(event.target.value)})}/></label>)}</fieldset>}
      {error&&<p role="alert" className="mt-4 rounded-lg border border-danger p-3 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex flex-wrap gap-3"><button type="button" className={button} disabled={busy} onClick={()=>void run()}>{busy?(es?'Componiendo…':'Rendering…'):(es?'Crear imagen':'Render image')}</button>{result&&<button type="button" className={button} disabled={busy} onClick={()=>{void downloadDocumentImage(result).catch(reason=>setError(String(reason)));}}>{es?'Descargar':'Download'} {result.pages.length===1?'PNG':'ZIP'}</button>}</div>
      {result&&<div className="mt-5"><p role="status" className="text-xs text-text-muted">{result.width} × {result.height} CSS px · ×{result.pixelRatio} · {result.pages.length} PNG · {result.framing.mode}</p><div className="mt-3 grid max-h-[55vh] grid-cols-1 gap-4 overflow-auto rounded-lg border border-border bg-deep p-3 sm:grid-cols-2">{result.pages.map(page=><figure key={page.index}><img className="h-auto w-full" src={page.dataUrl} alt={`${target.title??target.entityId} · ${page.index}`}/><figcaption className="mt-1 text-xs text-text-muted">{page.index} · {page.pixelWidth} × {page.pixelHeight} px · x{page.x}, y{page.y}</figcaption></figure>)}</div></div>}
    </section>
  </Modal>;
}
