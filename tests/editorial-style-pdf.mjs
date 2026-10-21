// Inspect and rasterize the real PDF emitted by editorial-style.runner.cjs.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createCanvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
const directory=path.resolve(process.argv[2]),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const task=getDocument({data:new Uint8Array(fs.readFileSync(path.join(directory,'editorial.pdf'))),standardFontDataUrl:pathToFileURL(path.join(root,'node_modules/pdfjs-dist/standard_fonts/')).href});const pdf=await task.promise;
const items=[];
for(let n=1;n<=pdf.numPages;n++){
 const page=await pdf.getPage(n),text=await page.getTextContent();items.push(...text.items.filter(item=>'str'in item));
 const viewport=page.getViewport({scale:1.4}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
 await page.render({canvasContext:canvas.getContext('2d'),viewport,canvas}).promise;fs.writeFileSync(path.join(directory,`editorial-pdf-${n}.png`),canvas.toBuffer('image/png'));
}
const text=items.map(item=>item.str).join(' ');assert(text.includes('gata crossed the quiet square'),'PDF retains prose');assert(text.includes('◇')&&text.includes('⁂'),'PDF retains ornaments');assert(items.some(item=>item.str.normalize('NFD').includes('A')&&Math.abs(item.transform[3])>25),'PDF contains large actual drop-cap text');
console.log(`PASS real PDF text, ornaments, large initial and ${pdf.numPages} rasterized page(s): ${directory}`);await task.destroy();
