import {createLocalToolIcons} from './icons';
import type {PlaceIconShape} from '../worldgen/core/placeIconCatalog';
import {PLACE_ICON_DATA} from '../worldgen/core/placeIconData';

// Notices travel with the exported vector; geometry remains in the existing catalogue only.
const notices=`ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2026 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2026.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The MIT License (MIT) (for portions derived from Feather)

Copyright (c) 2013-2026 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
const xml=(text:string)=>text.replace(/[&<>]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[char]!);
const metadata=createLocalToolIcons(),tau=2*Math.PI;

/** Trusted bundled shapes only; internal test seam, not a user geometry format or SDK barrel API. */
export function renderLocalToolIconSvgShapes(shapes:readonly PlaceIconShape[]):string {
 const paths=shapes.map(([fill,ops])=>{
  const path:string[]=[];let hasPoint=false;
  for(const op of ops){
   switch(op[0]){
    case'M':path.push('M',String(op[1]),String(op[2]));hasPoint=true;break;
    case'L':path.push(hasPoint?'L':'M',String(op[1]),String(op[2]));hasPoint=true;break;
    case'C':case'Q':
     if(!hasPoint)path.push('M',String(op[1]),String(op[2]));
     path.push(op[0],...op.slice(1).map(String));hasPoint=true;break;
    case'Z':if(hasPoint)path.push('Z');break;
    case'E':{
     const [,cx,cy,rx,ry,rotation,start,end,reverse]=op;
     const point=(angle:number):[number,number]=>[cx+rx*Math.cos(angle)*Math.cos(rotation)-ry*Math.sin(angle)*Math.sin(rotation),cy+rx*Math.cos(angle)*Math.sin(rotation)+ry*Math.sin(angle)*Math.cos(rotation)];
     const first=point(start),delta=end-start,clamped=reverse===1?start-end>=tau:delta>=tau;
     const full=clamped||(delta!==0&&delta%tau===0);
     let sweep=full?(reverse===1?-tau:tau):delta%tau;
     if(!full){if(reverse===1&&sweep>0)sweep-=tau;else if(reverse===0&&sweep<0)sweep+=tau;}
     path.push(hasPoint?'L':'M',...first.map(String));hasPoint=true;
     if(delta===0)path.push('L',...first.map(String));
     const pieces=Math.ceil(Math.abs(sweep)/(Math.PI/2));
     for(let index=1;index<=pieces;index++){
      const last=index===pieces,endpoint=last?(full?first:point(end)):point(start+sweep*index/pieces);
      path.push('A',String(rx),String(ry),String(rotation*180/Math.PI),'0',sweep>0?'1':'0',...endpoint.map(String));
     }
     break;
    }
   }
  }
  return '<path d="'+path.join(' ')+'" fill="'+(fill===1?'currentColor':'none')+'"/>';
 }).join('');
 return '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" overflow="hidden" fill="none" fill-rule="nonzero" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><metadata>'+xml(notices)+'</metadata>'+paths+'</svg>';
}

/** Explicit headless graphics entry. Importing it opts into the existing bundled geometry. */
export async function resolveLocalToolIconSvg(id:string):Promise<string|null>{
 const icon=await metadata.get(id);
 return icon?renderLocalToolIconSvgShapes(PLACE_ICON_DATA[icon.name]):null;
}
