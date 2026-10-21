import type {ReaderPresentation} from '../readerPresentationTypes';
import {coverFaceBox} from './model';
import {renderCoverSvg} from './render';
import type {CoverFace} from './types';
export async function exportCoverImage(title:string,artwork:string|undefined,cover:ReaderPresentation['cover'],face:CoverFace='spread',format:'png'|'svg'='png',pixelRatio=1){
 if(!['spread','front','back','spine'].includes(face)||!['png','svg'].includes(format)||!Number.isFinite(pixelRatio)||pixelRatio<=0||pixelRatio>4)throw Error('cover_export_invalid');
 const svg=renderCoverSvg(title,artwork,cover,face),b=coverFaceBox(face),filename=(title.replace(/[<>:"/\\|?*]/g,'_')||'cover')+'-'+face+'.'+format;
 if(format==='svg')return{format,filename,width:b.width,height:b.height,svg,dataUrl:'data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg)))};
 const source=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
 try{const image=new Image();image.src=source;await image.decode();const canvas=document.createElement('canvas');canvas.width=Math.ceil(b.width*pixelRatio);canvas.height=Math.ceil(b.height*pixelRatio);const ctx=canvas.getContext('2d');if(!ctx)throw Error('cover_renderer_unavailable');ctx.drawImage(image,0,0,canvas.width,canvas.height);return{format,filename,width:canvas.width,height:canvas.height,dataUrl:canvas.toDataURL('image/png')};}finally{URL.revokeObjectURL(source);}
}
