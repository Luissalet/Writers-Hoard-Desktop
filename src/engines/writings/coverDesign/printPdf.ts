import {PDFDocument} from 'pdf-lib';
import {assertPrintPdfPage,type PrintCoverRaster} from './print';
export async function printCoverPdf(raster:PrintCoverRaster){
 assertPrintPdfPage(raster.boxesPt.media);
 const document=await PDFDocument.create({updateMetadata:false}),[,,width,height]=raster.boxesPt.media,page=document.addPage([width,height]);
 page.setMediaBox(0,0,width,height);page.setCropBox(0,0,width,height);page.setBleedBox(0,0,width,height);
 const[x,y,right,top]=raster.boxesPt.trim;page.setTrimBox(x,y,right-x,top-y);
 const image=await document.embedPng(raster.src);page.drawImage(image,{x:0,y:0,width,height});document.setTitle(raster.title);document.setCreator('Writers Hoard');
 const bytes=await document.save();let binary='';for(let index=0;index<bytes.length;index+=16384)binary+=String.fromCharCode(...bytes.subarray(index,index+16384));
 return'data:application/pdf;base64,'+btoa(binary);
}
