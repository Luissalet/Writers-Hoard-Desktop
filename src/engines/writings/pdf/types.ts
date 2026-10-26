/** Private transport to the existing editorial core, not a second layout engine. */
export type PdfAttrs = Record<string, unknown>;
export type PdfPart = {kind:'text';text:string;style:PdfAttrs}|{kind:'image';asset:number;width:number;height:number;block:boolean};
export type PdfBlock = {kind:'paragraph';parts:PdfPart[];para:PdfAttrs}|{kind:'table';rows:number;columns:number;headers:number;cells:PdfCell[];wide:boolean};
export interface PdfCell {row:number;column:number;rowSpan:number;colSpan:number;blocks:PdfBlock[]}
export interface PdfSegment {id:string;columns:1|2;blocks:PdfBlock[];cover?:boolean;toc?:{id:string;title:string}[]}
export interface PdfRequest {
 title:string;author?:string;created:number;width:number;height:number;
 margins:{top:number;bottom:number;inside:number;outside:number};initialPageNumber:number;
 paper:string;ink:string;segments:PdfSegment[];
 assets:{id:number;offset:number;length:number;mime:string;width:number;height:number}[];
}
export interface AdaptedPublishingPdf {request:PdfRequest;assets:Uint8Array;diagnostics:string[]}
