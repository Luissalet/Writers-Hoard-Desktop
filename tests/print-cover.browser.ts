import {db} from '@/db';
import {deleteProject} from '@/db/operations';
import {runBridgeTool} from '@/services/aiBridge/dispatch';
import {defaultReaderPresentation} from '@/engines/writings/readerPresentation';
import type {ReaderPresentation} from '@/engines/writings/readerPresentationTypes';
const check=(value:unknown,message:string):asserts value=>{if(!value)throw Error(message);};
export function printFixture():ReaderPresentation['cover']{
 const raster=(color:string)=>{const canvas=document.createElement('canvas');canvas.width=60;canvas.height=90;const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,60,90);ctx.fillStyle='#f0a030';ctx.fillRect(30,15,15,15);return canvas.toDataURL('image/png');};
 return{style:'paperback',color:'#00aa33',texture:'none',artwork:false,showAtStart:true,jacket:{version:1,elements:[{id:'back',kind:'image',x:0,y:0,width:600,height:900,rotation:0,src:raster('#0000ff')},{id:'front',kind:'image',x:672,y:0,width:600,height:900,rotation:0,src:raster('#ff0000')},{id:'title',kind:'text',x:710,y:150,width:500,height:100,rotation:0,text:'OWN PRINT A',font:'georgia',size:48,bold:true,align:'center',color:'#ffffff'},{id:'vertical',kind:'text',x:608,y:100,width:56,height:550,rotation:0,text:'SPINE',vertical:true,font:'arial',size:28,bold:false,align:'left',color:'#ffffff'},{id:'edge-ink',kind:'ink',x:0,y:600,width:1272,height:20,rotation:0,color:'#ffd700',weight:12,points:[{x:0,y:0},{x:1,y:1}]}]}};
}
export async function testPrintCoverPublic(){
 const P='qa-print-cover-'+crypto.randomUUID(),passed:string[]=[],files:unknown[]=[],cover=printFixture();
 const call=async(format:string,layout?:Record<string,number>)=>runBridgeTool('wh_reader_cover_export',{projectId:P,format,face:'spread',...(layout?{printLayout:layout,dpi:300}:{})});
 const raw=async()=>JSON.stringify(await Promise.all(db.tables.map(async table=>[table.name,await table.toArray()])));
 try{
  await db.projects.add({id:P,title:'Own printable cover A',description:'Synthetic print export only',mode:'custom',type:'standalone',status:'draft',color:'#777777',enabledEngines:['writings'],engineOrder:['writings'],createdAt:1,updatedAt:1,readerPresentation:{...defaultReaderPresentation(),cover}});
  const before=await raw(),baseline=await call('png');check(baseline.ok,'Positive incumbent PNG export failed '+JSON.stringify(baseline));const png=baseline.result as {width:number;height:number;dataUrl:string};check(png.width===1272&&png.height===900,'Positive canonical spread dimensions');const image=new Image();image.src=png.dataUrl;await image.decode();const canvas=document.createElement('canvas');canvas.width=1272;canvas.height=900;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);const pixel=(x:number)=>[...ctx.getImageData(x,30,1,1).data].join(',');check(pixel(30)==='0,0,255,255'&&pixel(630)==='0,170,51,255'&&pixel(1240)==='255,0,0,255','Positive real back/spine/front pixels');
  const layouts=[{trimWidthMm:152.4,trimHeightMm:228.6,spineMm:12,bleedMm:3},{trimWidthMm:152.4,trimHeightMm:228.6,spineMm:12,bleedMm:0},{trimWidthMm:148,trimHeightMm:210,spineMm:0,bleedMm:3},{trimWidthMm:210,trimHeightMm:297,spineMm:7.25,bleedMm:1.5}];
  for(const[index,layout]of layouts.entries()){const reply=await call('pdf',layout);check(reply.ok,'C41_PRINT_PDF_EXPORT_MISSING: positive normal PNG pixels/dimensions passed; public tool physical PDF failed '+JSON.stringify(reply));const output=reply.result as {format:string;mimeType:string;dataUrl:string;layoutMm:unknown;width:number;height:number};check(output.format==='pdf'&&output.mimeType==='application/pdf'&&output.dataUrl.startsWith('data:application/pdf;base64,JVBER'),'Physical PDF response incomplete');check(JSON.stringify(output.layoutMm)===JSON.stringify(layout),'Public PDF layout differs from requested');files.push({name:'physical-'+index+'.pdf',...output});}
  for(const format of ['png','jpeg']){const reply=await call(format,layouts[0]);check(reply.ok,'Physical image export failed '+JSON.stringify(reply));files.push({name:'physical.'+(format==='jpeg'?'jpg':'png'),...(reply.result as object)});}
  for(const layout of [{...layouts[0],spineMm:-1},{...layouts[0],trimWidthMm:0},{...layouts[0],bleedMm:Infinity}])check(!(await call('pdf',layout)).ok,'Invalid physical measure accepted');
  check(before===await raw(),'Export changed authored tables/timestamps');const again=await call('png');check(again.ok&&(again.result as {dataUrl:string}).dataUrl===png.dataUrl,'Print exports changed legacy PNG renderer');
  Reflect.set(window,'__printFiles',files);passed.push('Public real cover tool: positive canonical pixels, four physical PDFs, PNG/JPEG, explicit invalid refusal, legacy image and all authored RAW exact');return passed;
 }finally{await deleteProject(P);check(await db.projects.where('id').equals(P).count()===0,'Own print cleanup failed');}
}
