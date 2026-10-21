import type { EraDocumentKind } from '@/services/worldEras/types';

export interface DocumentImageRect { x:number; y:number; w:number; h:number }
export interface DocumentImageRequest {
  projectId:string; eraId?:string; kind:EraDocumentKind; entityId:string;
  width?:number; pixelRatio?:number; pageHeight?:number; locale?:'es'|'en';
  /** Infinite scene coordinates: flow units, map percentages or world cells. */
  view?:DocumentImageRect;
}
export interface DocumentImageCaptureRequest { html:string; width:number; pixelRatio:number; pageHeight:number }
export interface DocumentImagePage {
  index:number; x:number; y:number; width:number; height:number;
  pixelWidth:number; pixelHeight:number; dataUrl:string;
}
export interface DocumentImageCaptureResult { width:number; height:number; pages:DocumentImagePage[];graphics?:{vendor:string;renderer:string} }
export interface DocumentImageAPI { capture(request:DocumentImageCaptureRequest):Promise<DocumentImageCaptureResult> }
export interface DocumentImageResult extends DocumentImageCaptureResult {
  projectId:string; eraId:string|null; kind:EraDocumentKind; entityId:string;
  title:string; filename:string; sourceVersion:string; pixelRatio:number;
  dependencies:Record<string,string>;
  framing:{mode:'complete-flow'|'fit-content'|'view';coordinateSpace?:string;view?:DocumentImageRect};
}
