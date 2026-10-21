import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import * as THREE from 'three';
import JSZip from 'jszip';
import { db } from '@/db';
import type { Project } from '@/types';
import { assetFromFiles, assetBytes, addModelAsset, ModelError, modelStoredBytes, originalModelDownload, removeModelAsset, validateGlb, type ModelAsset } from '@/engines/model-viewer/model';
import { createModelViewport, disposeModelResources } from '@/engines/model-viewer/viewport';
import ModelViewerEngine, { ModelView } from '@/engines/model-viewer/ModelViewerEngine';
import { MODEL_HANDLERS } from '@/engines/model-viewer/bridge';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { getBridgeTool } from '@/services/aiBridge/manifest';
import { exportProjectData, importProjectData } from '@/db/operations';
import { restoreArchivedMetadata } from '@/services/documentArchive/metadata';
import { useLocaleStore } from '@/stores/localeStore';
import { modelViewerFixture } from './model-viewer-fixture';
import { paintFile, triangleFbx, triangleGltf, triangleObj, trianglePly, triangleStl } from './model-viewer-depth-fixtures';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
async function expectCode(files: File[], code: string) { try { await assetFromFiles(files); throw new Error('Accepted invalid files'); } catch (error) { assert(error instanceof ModelError && error.code === code, `Expected ${code}, got ${String(error)}`); } }
const name = (ext: string) => `Triangle.${ext}`;

export async function testModelViewerDepth(): Promise<string[]> {
  const passed: string[] = [];
  const png = await paintFile(), gltf = triangleGltf();
  const gltfFiles = [new File([JSON.stringify(gltf.json)], 'Triangle.gltf'), new File([gltf.bin], 'triangle.bin'), png];
  const originals = new Map<string, File[]>([
    ['glb', [new File([await modelViewerFixture()], 'Castle.glb')]],
    ['gltf', gltfFiles], ['obj', [new File([triangleObj], name('obj'))]],
    ['stl', [new File([triangleStl], name('stl'))]], ['ply', [new File([trianglePly], name('ply'))]],
    ['fbx', [new File([triangleFbx], name('fbx'))]],
  ]);
  const assets: ModelAsset[] = [];
  for (const [format, files] of originals) {
    const asset = await assetFromFiles(files); validateGlb(assetBytes(asset)); assets.push(asset);
    assert(asset.name === files[0].name && asset.size > 0, `Lost ${format} model metadata`);
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const parsed = await new GLTFLoader().parseAsync(assetBytes(asset), '');
    let meshes = 0; parsed.scene.traverse(object => { if (object instanceof THREE.Mesh && object.geometry.getAttribute('position').count >= 3) meshes++; });
    assert(meshes > 0, `${format} conversion contains no mesh`); disposeModelResources(parsed.scenes);
    if (format !== 'glb') assert(asset.sourceFiles?.[0].size === files[0].size, `Lost ${format} source`);
    console.log(`Verified import ${format}`);
  }
  passed.push('3D depth: six real formats converted with installed loaders; decoded GLB geometry and preserved originals');

  const texturedObj = await assetFromFiles([new File(['mtllib paint.mtl\nusemtl paint\n' + triangleObj], name('obj')), new File(['newmtl paint\nKd 1 1 1\nmap_Kd paint.png\n'], 'paint.mtl'), png]);
  const plainScan = await assetFromFiles([new File([trianglePly], 'Scan.ply'), png]);
  const nestedJson=structuredClone(gltf.json);(nestedJson.images as Array<{uri:string}>)[0].uri='red/paint.png';
  const relative=(file:File,path:string)=>{Object.defineProperty(file,'webkitRelativePath',{value:path});return file;};
  const nested=await assetFromFiles([relative(new File([JSON.stringify(nestedJson)],'Nested.gltf'),'root/Nested.gltf'),relative(new File([gltf.bin],'triangle.bin'),'root/triangle.bin'),relative(new File([png],'paint.png',{type:'image/png'}),'root/red/paint.png'),relative(new File([png],'paint.png',{type:'image/png'}),'root/blue/paint.png')]);
  assert(nested.sourceFiles?.length===4&&Array.isArray(validateGlb(assetBytes(nested)).images),'Directory resource paths or duplicate basenames did not resolve exactly');
  const largeBin=new Uint8Array(4*1024*1024);largeBin.set(new Uint8Array(gltf.bin));const largeJson=structuredClone(gltf.json);(largeJson.buffers as Array<{byteLength:number}>)[0].byteLength=largeBin.byteLength;
  const large=await assetFromFiles([new File([JSON.stringify(largeJson)],'Large.gltf'),new File([largeBin],'triangle.bin'),png]);
  assert(large.sourceFiles?.some(file=>file.size===largeBin.byteLength),'Ordinary binary glTF resources incorrectly hit the JSON-metadata bound');
  for (const asset of [assets[1], texturedObj, plainScan]) {
    const json = validateGlb(assetBytes(asset)); assert(Array.isArray(json.images) && json.images.length > 0, `${asset.name} lost texture`);
  }
  const gltfAsset = assets[1];
  const download = await originalModelDownload(gltfAsset), zip = await JSZip.loadAsync(await download.blob.arrayBuffer());
  assert(download.name === 'Triangle-source.zip' && (await zip.file('triangle.bin')!.async('arraybuffer')).byteLength === gltf.bin.byteLength && await zip.file('Triangle.gltf')!.async('string') === JSON.stringify(gltf.json), 'Original bundle did not roundtrip exact source data');
  passed.push('3D depth: external glTF buffers/images and nested directory paths, OBJ+MTL+texture, scan texture projection and unchanged source ZIP');

  await expectCode([gltfFiles[0]], 'external');
  const remote = structuredClone(gltf.json); (remote.buffers as Array<{uri:string}>)[0].uri = 'https://example.invalid/triangle.bin';
  await expectCode([new File([JSON.stringify(remote)], 'Remote.gltf'), png], 'external');
  await expectCode([new File(['mtllib missing.mtl\n' + triangleObj], name('obj'))], 'external');
  await expectCode([new File(['invalid'], name('fbx'))], 'invalid');
  await expectCode([new File(['invalid'], name('stl'))], 'invalid');
  await expectCode([new File(['invalid'], name('ply'))], 'invalid');
  await expectCode([new File([triangleObj], name('obj')), new File([triangleObj], 'Other.obj')], 'invalid');
  passed.push('3D depth: missing and remote resources, malformed meshes and multiple model selection rejected before storage');

  const pid = `model-depth-${Date.now()}`, other = pid + '-other';
  const project: Project = { id: pid, title: 'Depth model QA', description: '', mode: 'novelist', type: 'standalone', status: 'draft', color: '#000', enabledEngines: ['model-viewer'], engineOrder: ['model-viewer'], createdAt: 1, updatedAt: 1 };
  await db.projects.bulkAdd([project, { ...project, id: other }]);
  await addModelAsset(pid, gltfAsset);
  const cloneId = await importProjectData(await exportProjectData(pid));
  const cloned = (await db.projects.get(cloneId))!.modelAssets![0] as ModelAsset;
  assert(cloned.id !== gltfAsset.id && cloned.sourceFiles?.[0].dataUrl === gltfAsset.sourceFiles![0].dataUrl && modelStoredBytes(cloned) === modelStoredBytes(gltfAsset), 'Clone lost resource bytes or identity');
  await removeModelAsset(pid, gltfAsset.id);
  const archived = await db.documentArchives.where('projectId').equals(pid).first(); assert(archived, 'No model archive');
  await db.transaction('rw', db.projects, async () => restoreArchivedMetadata(archived));
  assert((await db.projects.get(pid))?.modelAssets?.[0].dataUrl === gltfAsset.dataUrl, 'Archive restore lost canonical model');
  assert(((await db.projects.get(pid))!.modelAssets![0] as ModelAsset).sourceFiles?.length === 3, 'Archive restore lost original sources');
  passed.push('3D depth: normal project clone remaps model identity, archive/restore preserves all original buffers and textures');

  const listed = await MODEL_HANDLERS.wh_model_list({ projectId: pid }); assert(listed.models.length === 1 && !JSON.stringify(listed).includes('base64'), 'Bridge list leaks binary data');
  const exportResult = await MODEL_HANDLERS.wh_model_export({ projectId: pid, modelId: gltfAsset.id, format: 'original' }); assert(exportResult.name.endsWith('.zip') && exportResult.size > 0, 'Bridge source export failed');
  const imported = await MODEL_HANDLERS.wh_model_import({ projectId: pid, files: [{ name: 'Bridge.obj', dataUrl: 'data:application/octet-stream;base64,' + btoa(triangleObj) }] });
  assert(imported.model.format === 'obj', 'Normal bridge did not import OBJ');
  let foreign = false; try { await MODEL_HANDLERS.wh_model_get({ projectId: other, modelId: gltfAsset.id }); } catch { foreign = true; } assert(foreign, 'Bridge resolved foreign model');
  await MODEL_HANDLERS.wh_model_remove({ projectId: pid, modelId: imported.model.id });
  for(const tool of ['wh_model_list','wh_model_get','wh_model_import','wh_model_export','wh_model_remove'])assert(getBridgeTool(tool)?.engineId==='model-viewer', `Missing native manifest ${tool}`);
  const nativeImport=await runBridgeTool('wh_model_import',{projectId:pid,files:[{name:'Native.ply',dataUrl:'data:application/octet-stream;base64,'+btoa(trianglePly)}]});
  assert(nativeImport.ok, `Native bridge import failed: ${nativeImport.error}`);
  const nativeId=(nativeImport.result as {model:{id:string}}).model.id;
  for(const [tool,args]of [['wh_model_list',{projectId:pid}],['wh_model_get',{projectId:pid,modelId:nativeId}],['wh_model_export',{projectId:pid,modelId:nativeId,format:'glb'}],['wh_model_remove',{projectId:pid,modelId:nativeId}]] as const){const reply=await runBridgeTool(tool,args);assert(reply.ok,`Native ${tool}: ${reply.error}`);}
  const nativeForeign=await runBridgeTool('wh_model_get',{projectId:other,modelId:gltfAsset.id});assert(!nativeForeign.ok&&nativeForeign.code==='not-found','Native bridge scope mismatch');
  passed.push('3D depth: five tools registered and executed through native dispatch, source export, archive and project isolation');

  const host = document.createElement('div'); host.style.cssText = 'width:800px;height:600px'; document.body.append(host);
  let actualMode='orbit'; const viewport = await createModelViewport(host, gltfAsset, 'Camera fixture', () => {}, undefined, mode=>{actualMode=mode;});
  const canvas = host.querySelector('canvas')!, start = viewport.cameraPosition();
  viewport.setCameraMode('fly'); viewport.move('forward'); assert(viewport.cameraPosition().some((v,i)=>v!==start[i]), 'Fly forward did not move');
  viewport.move('up'); viewport.move('down'); viewport.move('left'); viewport.move('right'); viewport.move('back'); viewport.reset();
  assert(viewport.cameraPosition().every((v,i)=>Math.abs(v-start[i])<1e-6), 'Reset did not restore framing');
  canvas.focus(); await pause(100); canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
  for(let i=0;i<60&&!viewport.cameraPosition().some((v,index)=>Math.abs(v-start[index])>.01);i++)await pause(30);
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true }));
  const moved = viewport.cameraPosition(); assert(moved.some((v,i)=>Math.abs(v-start[i])>.01), `W event did not fly: ${start}=>${moved}, mode=${actualMode}`);
  canvas.dispatchEvent(new Event('blur')); await pause(60); const stopped = viewport.cameraPosition(); await pause(70);
  assert(viewport.cameraPosition().every((v,i)=>Math.abs(v-stopped[i])<1e-6), 'Fly continued after blur');
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
  viewport.setAutoRotate(true);
  for(let i=0;i<60&&!viewport.cameraPosition().some((v,index)=>Math.abs(v-start[index])>.01);i++)await pause(30);
  assert(viewport.cameraPosition().some((v,i)=>Math.abs(v-start[i])>.01), `Auto rotation did not rotate: ${start} => ${viewport.cameraPosition()}, mode=${actualMode}`);
  viewport.setCameraMode('fly');await pause(80);const orbitResume=viewport.cameraPosition();viewport.setCameraMode('orbit');
  for(let i=0;i<60&&!viewport.cameraPosition().some((v,index)=>Math.abs(v-orbitResume[index])>.01);i++)await pause(30);
  assert(viewport.cameraPosition().some((v,i)=>Math.abs(v-orbitResume[i])>.01),'Checked autorotation did not resume after returning from fly');
  viewport.setAutoRotate(false); viewport.dispose(); assert(!host.querySelector('canvas'), 'Camera loop leaked canvas'); host.remove();
  passed.push('3D depth: actual focused WASD fly, directional movement, blur release, reset, autorotation and disposal');

  const rootNode = document.getElementById('root')!; const root = createRoot(rootNode);
  rootNode.style.cssText = 'max-width:1200px;margin:24px auto;padding:0 24px'; useLocaleStore.setState({ locale: 'en' });
  await act(async()=>{root.render(<StrictMode><MemoryRouter><ModelViewerEngine projectId={pid}/></MemoryRouter></StrictMode>);await pause(100);});
  for(let i=0;i<60&&!rootNode.textContent?.includes('Model ready');i++)await act(async()=>{await pause();});
  assert(rootNode.textContent?.includes('Model ready'), 'Depth UI failed to open restored glTF');
  const input = rootNode.querySelector<HTMLInputElement>('input[type=file]')!, transfer = new DataTransfer();
  [new File([triangleObj], 'UI.obj'), png].forEach(file=>transfer.items.add(file)); input.files=transfer.files;
  await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}));await pause(150);});
  for(let i=0;i<60&&!(await db.projects.get(pid))!.modelAssets!.some(item=>item.name==='UI.obj');i++)await act(async()=>{await pause();});
  for(let i=0;i<60&&!rootNode.textContent?.includes('Model ready');i++)await act(async()=>{await pause();});
  assert((await db.projects.get(pid))!.modelAssets!.some(item=>item.name==='UI.obj'), `Multi-file UI import failed: ${rootNode.querySelector('[role=alert]')?.textContent ?? rootNode.textContent}`);
  const camera=rootNode.querySelector<HTMLSelectElement>('select[aria-label="Camera"]')!;
  await act(async()=>{camera.value='fly';camera.dispatchEvent(new Event('change',{bubbles:true}));});
  assert(rootNode.textContent?.includes('Forward')&&rootNode.textContent?.includes('Download originals'), 'Fly controls or original export missing');
  const up=[...rootNode.querySelectorAll('button')].find(button=>button.textContent==='Up')!;
  await act(async()=>{up.click();});
  await act(async()=>{root.unmount();await pause(30);});
  const compactRoot=createRoot(rootNode);
  await act(async()=>{compactRoot.render(<MemoryRouter><ModelView asset={assets[0]} compact/></MemoryRouter>);await pause(100);});
  for(let i=0;i<60&&!rootNode.textContent?.includes('Model ready');i++)await act(async()=>{await pause();});
  assert([...rootNode.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].some(item=>item.checked), 'Embedded model did not offer automatic rotation');
  passed.push('3D depth: real multi-file import UI, fly selector/buttons, original download and compact rotating embed');
  await addModelAsset(pid, assets[0]);
  (globalThis as unknown as { modelDepthShowEditor: () => Promise<void> }).modelDepthShowEditor=async()=>{
    await act(async()=>{compactRoot.unmount();await pause(20);});
    const finalRoot=createRoot(rootNode);
    await act(async()=>{finalRoot.render(<MemoryRouter initialEntries={[`/?entity=${assets[0].id}`]}><ModelViewerEngine projectId={pid}/></MemoryRouter>);await pause(100);});
    for(let i=0;i<60&&!rootNode.textContent?.includes('Model ready');i++)await act(async()=>{await pause();});
    const camera=rootNode.querySelector<HTMLSelectElement>('select[aria-label="Camera"]')!;
    await act(async()=>{camera.value='fly';camera.dispatchEvent(new Event('change',{bubbles:true}));await pause(30);});
  };
  await db.projects.delete(other); await db.projects.delete(cloneId);
  return passed;
}
