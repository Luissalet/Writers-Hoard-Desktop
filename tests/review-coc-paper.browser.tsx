import {createSheet,validateSheet} from '@/engines/character-sheets/types';
import {resolveCocSheet} from '@/engines/character-sheets/cocRules';
import {sheetPaper} from '@/engines/character-sheets/paper';
const parse=(svg:string)=>new DOMParser().parseFromString(svg,'image/svg+xml');
const headingY=(svg:string,name:string)=>Number([...parse(svg).querySelectorAll('text')].find(node=>node.textContent===name)?.getAttribute('y'));
function assert(value:unknown,message:string):asserts value{if(!value)throw Error(message);}
export async function reviewCocPaper(){
 const normal=resolveCocSheet(createSheet('coc7','Coordinate review'));
 normal.ink={version:1,surface:'paper-v1',width:1000,strokes:[{id:'old-mark',tool:'pen',color:'#123456',width:3,points:[{x:150,y:700},{x:200,y:710}]}]};
 // Non-CoC generic projection is the unchanged pre-append table layout; only
 // the single-line preset tag differs, with no effect on the vertical layout.
 const baseline=(sheet:typeof normal)=>{const value=structuredClone(sheet);value.preset='custom';delete value.coc;return sheetPaper(value);};
 const plain=sheetPaper(normal),old=baseline(normal);
 assert(headingY(plain.svg,'Resources')===headingY(old.svg,'Resources'),'Normal trait projection moved old paper rows');
 const large=structuredClone(normal);large.traits.find(row=>row.id==='app')!.value=Number.MAX_SAFE_INTEGER;validateSheet(large);
 const projected=sheetPaper(large),previous=baseline(large),before=headingY(previous.svg,'Resources'),after=headingY(projected.svg,'Resources');
 assert(before===after,`Valid manual trait reflow displaced pre-existing paper/ink anchors: Resources ${before} -> ${after}`);
 return['Existing table coordinates preserved for ordinary and maximum valid manual trait values'];
}
