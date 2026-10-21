// Real Chromium PDF matrix: letter size, glyph pixels and unchanged normal control.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createCanvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
const dir=path.resolve(process.argv[2]),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function read(file,png){
 const task=getDocument({data:new Uint8Array(fs.readFileSync(file)),standardFontDataUrl:pathToFileURL(path.join(root,'node_modules/pdfjs-dist/standard_fonts/')).href}),pdf=await task.promise;
 assert.equal(pdf.numPages,1,'small isolated specimen fits one page');const page=await pdf.getPage(1),items=(await page.getTextContent()).items.filter(x=>'str'in x),viewport=page.getViewport({scale:1.4}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height)),ctx=canvas.getContext('2d');
 await page.render({canvasContext:ctx,viewport,canvas}).promise;fs.writeFileSync(png,canvas.toBuffer('image/png'));const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;await task.destroy();return{items,viewport,canvas,pixels};
}
const results=[];
for(let i=0;i<4;i++){
 const target=path.join(dir,'quote-'+i),out=await read(path.join(target,'editorial.pdf'),path.join(target,'editorial-pixels.png'));
 // PDF.js may emit a floating initial before the chapter heading; compare body runs.
 const literal=out.items.filter(x=>!x.str.startsWith('Opening ')).map(x=>x.str).join('').normalize('NFD');assert(literal.includes('A\u0301gata crossed the quiet square.'),'PDF retains complete accented word without mark-boundary loss in case '+i+': '+literal);
 const initial=out.items.find(x=>x.str.normalize('NFD').includes('A')&&Math.abs(x.transform[3])>25);assert(initial,'actual accented initial must be larger than25pt, not only the quote');
 assert(out.items.map(x=>x.str).join(' ').replace(/\s+/g,' ').includes('gata crossed the quiet square'),'retains body prose in case '+i+': '+JSON.stringify(out.items.map(x=>x.str)));
 const size=Math.abs(initial.transform[3]),[left,top]=out.viewport.convertToViewportPoint(initial.transform[4],initial.transform[5]-.25*size),[right,bottom]=out.viewport.convertToViewportPoint(initial.transform[4]+initial.width,initial.transform[5]+size);
 const x0=Math.max(0,Math.floor(Math.min(left,right))),x1=Math.min(out.canvas.width,Math.ceil(Math.max(left,right))),y0=Math.max(0,Math.floor(Math.min(top,bottom))),y1=Math.min(out.canvas.height,Math.ceil(Math.max(top,bottom)));
 let ink=0,minY=Infinity,maxY=-1;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const at=(y*out.canvas.width+x)*4;if(out.pixels[at]<160&&out.pixels[at+1]<160&&out.pixels[at+2]<160&&out.pixels[at+3]>200){ink++;minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
 assert(ink>80&&maxY-minY>20,'large initial must actually paint tall glyph pixels');results.push({case:i,initial:initial.str,size,ink,height:maxY-minY});
}
const current=await read(path.join(dir,'control.pdf'),path.join(dir,'control-pixels.png')),before=await read(path.join(dir,'control-before.pdf'),path.join(dir,'control-before-pixels.png'));
assert.deepEqual(current.items.map(x=>({str:x.str,transform:x.transform})),before.items.map(x=>({str:x.str,transform:x.transform})),'normal paragraph text and placement unchanged');
assert.equal(Buffer.compare(Buffer.from(current.pixels),Buffer.from(before.pixels)),0,'normal paragraph raster identical to legacy CSS');
const body=current.items.find(x=>x.str.includes('Normal control'));assert(body&&Math.abs(body.transform[3]-12)<.1,'normal body remains12pt');
fs.writeFileSync(path.join(dir,'quote-proof.json'),JSON.stringify({results,control:{bodySize:body.transform[3],pixelsIdentical:true}},null,2));console.log('PASS four real split-mark quoted PDF initials >25pt with actual tall ink; normal control12pt and pixel-identical to historical CSS');console.log(JSON.stringify(results));
