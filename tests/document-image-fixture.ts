import { db } from '@/db';
import { eraDocumentKinds,type EraDocumentKind } from '@/services/worldEras/types';
import { saveWorldEra,readWorldDocument,saveEraDocument } from '@/services/worldEras/store';
import { buildDocumentImage } from '@/services/documentImage/build';
import { createSheet } from '@/engines/character-sheets/types';
import { createRadarChart } from '@/engines/radar/model';
import { assetFromFile } from '@/engines/model-viewer/model';
import { modelViewerFixture } from './model-viewer-fixture';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { saveSnapshot } from '@/engines/worldgen/snapshots';
import { worldRuntimeKey } from '@/engines/worldgen/era';
import { paramsKey } from '@/engines/worldgen/useWorldGeneration';
import { makeFreehandNode } from '@/engines/board/freehand';
import { createElement,act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import WorkspaceLibrary from '@/components/project/workspace/library/WorkspaceLibrary';
import { useLocaleStore } from '@/stores/localeStore';

const P='document-image-world',eraId='image-later',now=1;
const assert=(value:unknown,message:string):asserts value=>{if(!value)throw new Error(message);};
function wav(){const samples=16000,bytes=new ArrayBuffer(44+samples*2),view=new DataView(bytes);const put=(at:number,text:string)=>{for(let i=0;i<text.length;i++)view.setUint8(at+i,text.charCodeAt(i));};put(0,'RIFF');view.setUint32(4,36+samples*2,true);put(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);put(36,'data');view.setUint32(40,samples*2,true);for(let i=0;i<samples;i++)view.setInt16(44+i*2,Math.sin(i*2*Math.PI*440/16000)*12000,true);return new Blob([bytes],{type:'audio/wav'});}
export async function prepareDocumentImageFixture(){
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=400;const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#467c94';ctx.fillRect(0,0,720,400);ctx.fillStyle='#829569';ctx.beginPath();ctx.moveTo(60,40);ctx.lineTo(610,70);ctx.lineTo(670,310);ctx.lineTo(300,370);ctx.lineTo(110,240);ctx.closePath();ctx.fill();const png=canvas.toDataURL();
  const video=await(await fetch((window as unknown as {__transportVideo:string}).__transportVideo)).blob();
  const model=await assetFromFile(new File([await modelViewerFixture()],'Image castle.glb'));
  const sheet=createSheet('coc7','Complete investigator');sheet.details.notes='SHEET FINAL DETAIL';sheet.rows.push({id:'sheet-final',section:'Possessions',name:'Final item',detail:'SHEET FINAL ROW',expression:'',quantity:2});
  const radar=createRadarChart('Complete radar');radar.description='All radar source values';
  const dictionary={id:'image-dictionary',name:'Complete dictionary',description:'A complete generated vocabulary',scriptMapping:'a=α',words:Array.from({length:42},(_,i)=>({id:'word-'+i,word:'word'+i,nativeForm:'',pronunciation:'wɜːd',partOfSpeech:'noun',meaning:i===41?'DICTIONARY FINAL MEANING':'Meaning '+i,examples:'Full example '+i,phrases:'Full phrase '+i,derivatives:'Derivative '+i,origin:'Origin '+i}))};
  const columns=Array.from({length:12},(_,c)=>({id:'col'+c,name:'Column '+(c+1),kind:'text' as const}));
  const table={id:'image-table',title:'Complete sheet',mode:'sheet' as const,columns,rows:Array.from({length:42},(_,r)=>({id:'row'+r,cells:Object.fromEntries(columns.map((column,c)=>[column.id,c===0?String(r+1):c===11&&r===41?'=SUM(A1:A42)':`R${r+1}C${c+1}`]))}))};
  const calculated={id:'image-calculated-table',title:'Calculated decimal table',mode:'table' as const,columns:[{id:'cost',name:'Cost',kind:'number' as const},{id:'count',name:'Count',kind:'number' as const},{id:'total',name:'Total',kind:'number' as const,calculation:{formula:'@[Cost]*@[Count]',rowBindings:{Cost:'cost',Count:'count'},columnBindings:{},resultType:'decimal' as const}}],rows:[{id:'calculated-one',cells:{cost:'7.5',count:'3',total:''}}]};
  const tree={id:'image-tree',title:'Complete relation tree',revision:0,createdAt:now,updatedAt:now,nodes:[{id:'tree-one',label:'First person',position:{x:-180,y:20},image:png},{id:'tree-two',label:'TREE FINAL PERSON',position:{x:160,y:180}}],edges:[{id:'tree-edge',source:'tree-one',target:'tree-two',kind:'custom' as const,label:'Authored relation',style:'dashed' as const}]};
  const sourceToolDocument={id:'image-source-tool',namespace:'uncompiled.image-fixture',title:'Complete source notebook',revision:0,createdAt:now,updatedAt:now,data:{notes:'All portable source fields',final:'SOURCE FINAL FIELD'}};
  await db.projects.add({id:P,title:'Synthetic document image QA',description:'All supported document kinds',mode:'custom',type:'standalone',status:'draft',color:'#d5b575',enabledEngines:[...eraDocumentKinds],createdAt:now,updatedAt:now,modelAssets:[model],characterSheets:[sheet],radarCharts:[radar],dictionaries:[dictionary],dataTables:[table,calculated],relationTrees:[tree],sourceToolDocuments:[sourceToolDocument]});
  await db.codexEntries.add({id:'image-card',projectId:P,title:'Complete card',type:'location',content:'<p>Full card prose.</p>'+Array.from({length:32},(_,i)=>`<p>Card paragraph ${i}: the full local reference stays in the image export.</p>`).join('')+'<p><mark>CODEX FINAL PARAGRAPH</mark></p>',avatar:png,fields:{population:'12',description:'Every field survives'},tags:['fixture'],relations:[],createdAt:now,updatedAt:now});
  await db.writings.add({id:'image-writing',projectId:P,title:'Complete long manuscript',content:Array.from({length:70},(_,i)=>`<p>Paragraph ${i+1}. Long manuscript composition includes every word and local formatting.</p>`).join('')+'<p><mark>WRITING FINAL PARAGRAPH</mark></p>',status:'draft',wordCount:900,tags:[],createdAt:now,updatedAt:now});
  await db.notes.add({id:'image-note',projectId:P,kind:'quote',text:'A complete note\nwith its final line: NOTE FINAL LINE',source:'Local source',tags:['fixture'],pinned:false,createdAt:now,updatedAt:now});
  await db.scenes.add({id:'image-scene',projectId:P,title:'Complete scene',setting:'INT. HARBOR',order:0,tags:[],createdAt:now,updatedAt:now});
  await db.dialogBlocks.bulkAdd(Array.from({length:22},(_,i)=>({id:'image-dialog-'+i,projectId:P,sceneId:'image-scene',type:i%3===0?'action' as const:'dialog' as const,characterName:i%2?'Ágata':'Boris',characterColor:'#d5b575',content:i===21?'DIALOG FINAL TURN':'Full dialogue turn '+i,order:i,createdAt:now,updatedAt:now})));
  await db.worldMaps.add({id:'image-map',projectId:P,title:'Complete local map',backgroundImage:png,features:[{id:'map-path',kind:'path',name:'Complete road',points:[{x:10,y:20},{x:55,y:30},{x:80,y:75}],color:'#d5b575'}],createdAt:now,updatedAt:now});
  await db.mapPins.add({id:'image-map-pin',projectId:P,mapId:'image-map',name:'MAP FINAL PIN',description:'Full pin notes',position:{x:62,y:48},icon:'castle'});
  await db.boards.add({id:'image-board',projectId:P,title:'Complete canvas',surface:'blueprint',createdAt:now,updatedAt:now});
  const nodes=[{id:'image-board-card',projectId:P,boardId:'image-board',kind:'card' as const,title:'Full canvas card',content:'All native geometry is exported',position:{x:-180,y:-80},size:{width:260,height:190},image:png,color:'#d5b575',zIndex:0,tags:[],createdAt:now,updatedAt:now},{id:'image-board-shape',projectId:P,boardId:'image-board',kind:'shape' as const,title:'BOARD FINAL SHAPE',content:'',position:{x:300,y:220},size:{width:220,height:160},shape:'star' as const,color:'#78afc2',zIndex:1,tags:[],createdAt:now,updatedAt:now}];
  await db.boardNodes.bulkAdd(nodes);
  const stroke=makeFreehandNode({projectId:P,boardId:'image-board',title:'Pressure stroke',color:'#d5b575',width:8,tool:'marker',points:[{x:0,y:200,pressure:.2},{x:200,y:320,pressure:1},{x:430,y:200,pressure:.3}]});if(stroke)await db.boardNodes.add(stroke);
  await db.boardEdges.add({id:'image-board-edge',projectId:P,boardId:'image-board',sourceId:nodes[0].id,targetId:nodes[1].id,sources:[{on:'node',id:nodes[0].id}],targets:[{on:'node',id:nodes[1].id}],kind:'causes',label:'Full relation',color:'#d5b575',style:'dashed',width:2,direction:'forward',curvature:'curved',weight:1,certainty:1,tags:[],createdAt:now,updatedAt:now});
  await db.timelines.add({id:'image-timeline',projectId:P,title:'Complete chronology',color:'#d5b575',createdAt:now,updatedAt:now});
  await db.timelineEvents.bulkAdd(Array.from({length:24},(_,i)=>({id:'image-event-'+i,projectId:P,timelineId:'image-timeline',title:i===23?'TIMELINE FINAL EVENT':'Event '+i,description:'Full authored event description '+i,date:'Year '+i,dateMode:'text' as const,eventType:'point' as const,order:i,lane:i%2?'Journey':'Court',color:'#d5b575',image:i===0?png:undefined,createdAt:now,updatedAt:now})));
  const blob=wav();await db.localMediaAssets.add({id:'image-audio',projectId:P,title:'Complete audio waveform',kind:'audio',mime:blob.type,blob,size:blob.size,notes:'MEDIA FINAL NOTES',tags:[],linkedEntryIds:[],createdAt:now,updatedAt:now});
  await db.localMediaAssets.add({id:'image-video',projectId:P,title:'Actual initial video frame',kind:'video',mime:video.type,blob:video,size:video.size,notes:'Actual local VP8 first frame',tags:[],linkedEntryIds:[],createdAt:now,updatedAt:now});
  const params={...DEFAULT_PARAMS,width:256,seed:'document-image-real-world'},world=generateWorld(params);await db.generatedWorlds.add({id:'image-world',projectId:P,title:'Complete generated geography',params,createdAt:now,updatedAt:now});await saveSnapshot('image-world',paramsKey(params),world);
  const ids:Record<EraDocumentKind,string>={'dialog-scene':'image-scene',codex:'image-card',writings:'image-writing',maps:'image-map',worldgen:'image-world',board:'image-board',timeline:'image-timeline',notes:'image-note',media:'image-audio',dictionary:dictionary.id,tables:table.id,genealogy:tree.id,'character-sheets':sheet.id,radar:radar.id,'model-viewer':model.id,'local-tool':sourceToolDocument.id};
  await saveWorldEra(P,{id:eraId,name:'Image later age',description:'',revision:0,createdAt:now,updatedAt:now},null);
  const versions:Record<string,{base:string;era:string}>={};
  for(const kind of eraDocumentKinds){const current=(await readWorldDocument({projectId:P,eraId},kind,ids[kind]))!;const document=structuredClone(current.document);if(kind==='notes')document.root.text='Later age\n'+document.root.text;else if('name'in document.root)document.root.name='Later '+document.root.name;else document.root.title='Later '+document.root.title;const saved=await saveEraDocument({projectId:P,eraId},kind,document,current.version);versions[kind]={base:current.version,era:saved.version};}
  const sourceMarkers:Record<string,string>={codex:'CODEX FINAL PARAGRAPH',writings:'WRITING FINAL PARAGRAPH',notes:'NOTE FINAL LINE','dialog-scene':'DIALOG FINAL TURN',dictionary:'DICTIONARY FINAL MEANING',tables:'903',genealogy:'TREE FINAL PERSON',timeline:'TIMELINE FINAL EVENT','character-sheets':'SHEET FINAL ROW',media:'MEDIA FINAL NOTES','local-tool':'SOURCE FINAL FIELD'};
  for(const [kind,marker]of Object.entries(sourceMarkers)){const result=await buildDocumentImage({projectId:P,kind:kind as EraDocumentKind,entityId:ids[kind as EraDocumentKind],width:640});assert(result.html.includes(marker),kind+' full final source omitted');}
  assert((await buildDocumentImage({projectId:P,kind:'tables',entityId:calculated.id,width:640})).html.includes('22.5'),'normal calculated table projection missing');
  await saveSnapshot(worldRuntimeKey('image-world',eraId),paramsKey(params),world);
  const before=await imageFixtureSnapshot(ids);
  useLocaleStore.setState({locale:'en'});const host=document.createElement('div');document.getElementById('root')!.append(host);const react=createRoot(host);
  (window as unknown as {__imageShowLibrary:()=>Promise<void>}).__imageShowLibrary=async()=>{await act(async()=>{react.render(createElement(MemoryRouter,null,createElement(WorkspaceLibrary,{projectId:P,enabledEngineIds:eraDocumentKinds,onOpen:async()=>true,onManage:async()=>true})));await new Promise(resolve=>setTimeout(resolve,100));});};
  (window as unknown as {__imageFixtureSnapshot:()=>Promise<unknown>}).__imageFixtureSnapshot=()=>imageFixtureSnapshot(ids);
  return{projectId:P,eraId,ids,versions,before,png,videoId:'image-video',calculatedTableId:calculated.id};
}
async function imageFixtureSnapshot(ids:Record<EraDocumentKind,string>){const result:Record<string,string>={};for(const kind of eraDocumentKinds)for(const era of [undefined,eraId])result[JSON.stringify([kind,era??null])]=(await readWorldDocument({projectId:P,eraId:era},kind,ids[kind]))!.version;return result;}
