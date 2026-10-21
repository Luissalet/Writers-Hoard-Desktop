import {createSheet} from '@/engines/character-sheets/types';
import {applyFiveEClass,FIVE_E_AUTO_FIELDS} from '@/engines/character-sheets/fiveE';
import {sheetPaper} from '@/engines/character-sheets/paper';
const check=(value:unknown,message:string)=>{if(!value)throw Error(message);};
export async function testFiveEPaperSectionCorrection(){
 const out:string[]=[];
 for(const active of [false,true])for(const locale of ['en','es']as const){
  let sheet=createSheet('5e-character','Section correction');if(active)sheet=applyFiveEClass(sheet,'wizard',5,FIVE_E_AUTO_FIELDS);
  sheet.rows=[
   {id:'converted',section:'Authored ritual <script> & 🧭 '.repeat(4),name:'Shield',detail:'Authored detail <own>',expression:'1d4',quantity:2,fiveESpell:{version:1,level:1,prepared:true}},
   {id:'second',section:'Second author section',name:'Shield',detail:'Other note',expression:'2d4',quantity:3,fiveESpell:{version:1,level:2,prepared:false}},
   {id:'blank',section:'',name:'Blank section spell',detail:'Blank is valid',expression:'',quantity:1,fiveESpell:{version:1,level:0,prepared:true}},
   {id:'plain',section:'Ordinary section',name:'Plain row',detail:'Not converted',expression:'',quantity:4},
  ];
  const original=JSON.stringify(sheet),paper=sheetPaper(sheet,locale),svg=new DOMParser().parseFromString(paper.svg,'image/svg+xml'),text=svg.documentElement.textContent??'';
  check(!svg.querySelector('parsererror')&&!svg.querySelector('script'),'Paper markup invalid or author text executed');
  // Line wrapping trims inter-line spaces; compare semantic characters across tspans.
  const compact=(value:string)=>value.replace(/\s/g,'');
  for(const row of sheet.rows)for(const value of [row.section,row.name,row.detail,row.expression])check(compact(text).includes(compact(value)),'Author field omitted '+locale+'/'+active+'/'+row.id+'/'+value);
  const headings=[...svg.querySelectorAll('text')].filter(node=>node.getAttribute('font-weight')==='bold').map(node=>node.textContent);
  check(headings.filter(value=>value===(locale==='en'?'Section':'Sección')).length===2,'Section heading not present in both row tables');
  check(text.includes(locale==='en'?'Yes [x]':'Sí [x]')&&text.includes('No [ ]'),'Prepared metadata lost');
  check(Number.isFinite(paper.height)&&paper.height>700&&JSON.stringify(sheet)===original,'Paper mutated canonical fields or has invalid height');
  out.push(`Section retention ${locale}, profile${active}: converted/duplicate/blank/longUnicode escaped rows, prepared metadata and canonical bytes`);
 }
 return out;
}
