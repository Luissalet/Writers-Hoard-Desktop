import type { DocumentImageRequest,DocumentImageResult } from './types';

export async function exportDocumentImage(request:DocumentImageRequest):Promise<DocumentImageResult>{
  const capture=window.electronAPI?.documentImages;
  if(!capture)throw new Error('desktop_image_renderer_unavailable');
  const {buildDocumentImage}=await import('./build');
  const prepared=await buildDocumentImage(request);
  return capturePreparedDocumentImage(request,prepared);
}

/** Capture the exact admitted HTML; saving must not read the document a second time. */
export async function capturePreparedDocumentImage(request:DocumentImageRequest,prepared:Awaited<ReturnType<typeof import('./build').buildDocumentImage>>):Promise<DocumentImageResult>{
  const capture=window.electronAPI?.documentImages;
  if(!capture)throw new Error('desktop_image_renderer_unavailable');
  const result=await capture.capture({html:prepared.html,width:prepared.width,pixelRatio:prepared.pixelRatio,pageHeight:prepared.pageHeight});
  return{...result,projectId:request.projectId,eraId:request.eraId??null,kind:request.kind,entityId:request.entityId,title:prepared.title,filename:(prepared.title.replace(/[<>:"/\\|?*]/g,'_')||'document')+'.png',sourceVersion:prepared.sourceVersion,dependencies:prepared.dependencies,pixelRatio:prepared.pixelRatio,framing:prepared.framing};
}

export async function downloadDocumentImage(result:DocumentImageResult,admit:()=>boolean=()=>true):Promise<void>{
  const {downloadBlobFile}=await import('@/engines/writings/manuscriptExport');
  if(result.pages.length===1){const response=await fetch(result.pages[0].dataUrl),blob=await response.blob();if(admit())downloadBlobFile(blob,result.filename);return;}
  const {default:JSZip}=await import('jszip'),zip=new JSZip(),stem=result.filename.replace(/\.png$/i,'');
  for(const page of result.pages)zip.file(`${stem}-${String(page.index).padStart(3,'0')}.png`,page.dataUrl.split(',')[1],{base64:true});
  const {pages,...metadata}=result;zip.file('manifest.json',JSON.stringify({...metadata,pages:pages.map(({index,x,y,width,height,pixelWidth,pixelHeight})=>({index,x,y,width,height,pixelWidth,pixelHeight}))},null,2));
  const blob=await zip.generateAsync({type:'blob'});if(admit())downloadBlobFile(blob,stem+'-images.zip');
}
