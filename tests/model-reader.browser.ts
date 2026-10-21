import { db } from '@/db';
import type { Project, Writing, CodexEntry } from '@/types';
import { assetFromFile, modelDataUrl } from '@/engines/model-viewer/model';
import { assetBytes, validateGlb } from '@/engines/model-viewer/portable';
import { modelViewerFixture, rebuildGlb } from './model-viewer-fixture';
import { hydrateToolDocumentBlocks } from '@/components/editor/toolBlocks/reading';
import { buildWorldWiki, loadWorldWikiData } from '@/services/worldWikiExport';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { saveWorldEra, updateEraProjectMetadata } from '@/services/worldEras/store';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import ReadingView from '@/engines/writings/components/ReadingView';
import { EnginePaneContext } from '@/engines/_shared/EnginePaneContext';
import { useLocaleStore } from '@/stores/localeStore';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { disposeModelResources } from '@/engines/model-viewer/viewport';

const assert=(value:unknown,message:string):asserts value=>{if(!value)throw new Error(message);};
const wait=(ms=50)=>new Promise(resolve=>setTimeout(resolve,ms));
function models(html:string){const doc=new DOMParser().parseFromString(html,'text/html');return [...doc.querySelectorAll<HTMLTemplateElement>('template[data-wh-model-data]')].map(element=>JSON.parse(element.content.textContent!));}

export async function testModelReader(){
  const P='model-reader-qa',other=P+'-other',eraId='later',passed:string[]=[],artifacts:{name:string;html:string;dataUrl:string}[]=[];
  const fixture=await new GLTFLoader().parseAsync(await modelViewerFixture(),'');
  const paint=document.createElement('canvas');paint.width=paint.height=32;const ctx=paint.getContext('2d')!;
  ctx.fillStyle='#a2b176';ctx.fillRect(0,0,32,32);ctx.fillStyle='#56673e';ctx.fillRect(0,0,16,16);ctx.fillRect(16,16,16,16);
  const texture=new THREE.CanvasTexture(paint);fixture.scene.traverse(object=>{if(object instanceof THREE.Mesh&&(object.material as THREE.MeshStandardMaterial).color.getHexString()==='666e4d')(object.material as THREE.MeshStandardMaterial).map=texture;});
  const textured=await new GLTFExporter().parseAsync(fixture.scene,{binary:true,animations:fixture.animations});disposeModelResources(fixture.scenes);
  assert(textured instanceof ArrayBuffer,'Textured fixture did not export GLB');
  const asset=await assetFromFile(new File([textured],'Castle.glb'));
  assert(Array.isArray(validateGlb(assetBytes(asset)).images),'Fixture lacks a real embedded PNG texture');
  const secret={...asset,id:'secret-model',name:'Excluded model secret'};
  const project:Project={id:P,title:'Synthetic model reader',description:'Generated local model QA',mode:'novelist',type:'standalone',status:'draft',color:'#d5b575',enabledEngines:['model-viewer','writings','codex'],createdAt:1,updatedAt:1,modelAssets:[asset,secret]};
  const block=(owner:string,id=asset.id)=>`<figure data-wh-tool-block="true" data-project-id="${owner}" data-tool-kind="model-viewer" data-document-id="${id}" data-label="Cached model title"></figure>`;
  const writing:Writing={id:'model-reader-writing',projectId:P,title:'The castle',content:`<p>A local reference.</p>${block(P)}${block(other)}`,status:'draft',wordCount:3,tags:[],createdAt:1,updatedAt:1};
  const entry:CodexEntry={id:'model-reader-entry',projectId:P,type:'location',title:'Castle',content:`<p>Orbit the local castle.</p>${block(P)}${block(other)}<div data-wh-wiki-hidden="true">${block(P,secret.id)}</div>`,fields:{},tags:[],relations:[],createdAt:1,updatedAt:1};
  const excluded={...entry,id:'model-reader-excluded',title:'Excluded model entry',content:block(P,secret.id)};
  await db.projects.bulkAdd([project,{...project,id:other,modelAssets:[{...asset,name:'Foreign model secret'}]}]);await db.writings.add(writing);await db.codexEntries.bulkAdd([entry,excluded]);
  const host=document.createElement('div');host.style.cssText='max-width:820px;margin:20px auto';document.body.append(host);let dispose:(()=>void)|undefined;
  try{
    host.innerHTML=block(P);dispose=hydrateToolDocumentBlocks(host,P,'en');
    for(let n=0;n<100&&!host.textContent?.includes('Model ready');n++)await wait();
    assert(host.querySelector('canvas')&&host.textContent?.includes('Model ready'),'Normal reading did not mount actual 3D');
    const gl=host.querySelector('canvas')!.getContext('webgl2')!;dispose();dispose=undefined;
    assert(!host.querySelector('canvas')&&gl.isContextLost(),'Reader unmount leaked GPU context');
    passed.push('Normal reading hydrates actual model and disposes canvas/context');
    const bytes=assetBytes(asset),json=validateGlb(bytes),view=new DataView(bytes),jsonLength=view.getUint32(12,true);
    const materials=json.materials as {pbrMetallicRoughness?:{baseColorFactor?:number[]}}[];
    materials[0].pbrMetallicRoughness!.baseColorFactor=[.55,.15,.15,1];
    const eraBytes=rebuildGlb(json,new Uint8Array(bytes,28+jsonLength,view.getUint32(20+jsonLength,true)));
    const eraAsset={...asset,name:'Later castle',dataUrl:await modelDataUrl(eraBytes,'model/gltf-binary'),size:eraBytes.byteLength};
    await saveWorldEra(P,{id:eraId,name:'Later',description:'',revision:0,createdAt:1,updatedAt:1},null);
    await updateEraProjectMetadata({projectId:P,eraId},{modelAssets:[eraAsset,secret]});
    for(const era of [undefined,eraId]){
      const expected=era?eraAsset:asset;
      const reader=await runBridgeTool('wh_reader_export',{projectId:P,locale:'en',eraId:era});assert(reader.ok,`Reader MCP: ${JSON.stringify(reader)}`);
      const wiki=await runBridgeTool('wh_wiki_export',{projectId:P,locale:'en',eraId:era,excludedEntryIds:[excluded.id]});assert(wiki.ok,`Wiki MCP: ${JSON.stringify(wiki)}`);
      for(const [kind,response]of [['reader',reader],['wiki',wiki]] as const){
        const html=(response.result as {html:string}).html,payloads=models(html);
        assert(payloads.length===1&&payloads[0].dataUrl===expected.dataUrl&&payloads[0].size===expected.size,`${kind}: exact scoped GLB lost`);
        assert(!html.includes('Foreign model secret')&&!html.includes('Excluded model secret')&&!html.includes('Excluded model entry'),`${kind}: excluded or foreign model leak`);
        assert(html.includes('data-model-surface')&&html.includes('WebGLRenderer'),`${kind}: missing standalone runtime`);
        artifacts.push({name:`${kind}-${era?'era':'base'}`,html,dataUrl:expected.dataUrl});
      }
    }
    assert((await db.projects.get(P))?.modelAssets?.[0].dataUrl===asset.dataUrl,'Era export changed Base');
    passed.push('Native Reader/wiki dispatch embeds byte-identical Base/era GLBs and excludes foreign/omitted blocks');
    const options={locale:'en' as const,includeMedia:false,excludedEntryIds:[excluded.id]},wiki=buildWorldWiki(await loadWorldWikiData(P,options),options);
    assert(!wiki.html.includes('data-wh-model-reader')&&!wiki.html.includes(asset.dataUrl),'Media exclusion retains model bytes/runtime');
    const filtered=buildWorldWiki(await loadWorldWikiData(P,{locale:'en'}),{locale:'en',types:[]});assert(!filtered.html.includes('data-wh-model-reader'),'Changed category policy retained model');
    host.innerHTML=block(P);dispose=hydrateToolDocumentBlocks(host,P,'en',eraId);
    for(let n=0;n<100&&!host.textContent?.includes('Model ready');n++)await wait();
    assert(models(host.innerHTML)[0]?.dataUrl===eraAsset.dataUrl,'Normal reader hydration ignored era');dispose();dispose=undefined;
    passed.push('Normal reader era and wiki media/category policy preserve scoped model bytes');
    useLocaleStore.setState({locale:'en'});
    const normalHost=document.createElement('div');document.body.append(normalHost);const normalRoot=createRoot(normalHost);
    (window as unknown as {__modelReaderShowNormal:(era:boolean)=>Promise<void>}).__modelReaderShowNormal=async era=>{
      (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
      await act(async()=>{normalRoot.render(createElement(MemoryRouter,null,createElement(EnginePaneContext.Provider,{value:{instanceId:'model-reader-qa',projectId:P,eraId:era?eraId:undefined,visible:true}},createElement(ReadingView,{pieces:[writing],onClose:()=>{},onOpenInEditor:()=>{}}))));await wait();});
      for(let n=0;n<100&&(!normalHost.querySelector('canvas')||models(normalHost.innerHTML)[0]?.dataUrl!==(era?eraAsset:asset).dataUrl);n++)await act(async()=>{await wait();});
      assert(normalHost.querySelector('canvas')&&models(normalHost.innerHTML)[0]?.dataUrl===(era?eraAsset:asset).dataUrl,'Actual ReadingView ignored scoped GLB: '+JSON.stringify({era,canvas:!!normalHost.querySelector('canvas'),models:models(normalHost.innerHTML).map(row=>({id:row.id,name:row.name})),text:normalHost.textContent?.slice(-250)}));
      (globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=false;
    };
    (window as unknown as {__modelReaderArtifacts:unknown}).__modelReaderArtifacts=artifacts;
    return passed;
  }finally{dispose?.();host.remove();}
}
