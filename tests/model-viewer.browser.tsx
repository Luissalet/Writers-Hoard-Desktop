import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import * as THREE from 'three';
import { db } from '@/db';
import { exportProjectData, importProjectData } from '@/db/operations';
import { useLocaleStore } from '@/stores/localeStore';
import { addModelAsset, assetBytes, assetFromFile, MAX_MODEL_BYTES, ModelError, removeModelAsset, validateGlb } from '@/engines/model-viewer/model';
import { createModelViewport, disposeModelResources } from '@/engines/model-viewer/viewport';
import ModelViewerEngine from '@/engines/model-viewer/ModelViewerEngine';
import { modelViewerFixture, rebuildGlb } from './model-viewer-fixture';
import type { Project } from '@/types';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const expectCode = (bytes: ArrayBuffer, expected: string) => { try { validateGlb(bytes); throw new Error(`Expected ${expected}`); } catch (error) { assert(error instanceof ModelError && error.code === expected, `Wrong GLB rejection: ${String(error)}`); } };

export async function testModelViewer(): Promise<string[]> {
  const passed: string[] = [];
  const bytes = await modelViewerFixture();
  const asset = await assetFromFile(new File([bytes], 'Castle.glb', { type: 'model/gltf-binary' }));
  assert(asset.size === bytes.byteLength && assetBytes(asset).byteLength === bytes.byteLength, 'Model bytes changed in storage encoding');
  validateGlb(bytes);
  expectCode(bytes.slice(0, 18), 'invalid');
  expectCode(new ArrayBuffer(MAX_MODEL_BYTES + 1), 'size');
  expectCode(rebuildGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: 10, uri: 'https://evil.invalid/model.bin' }] }), 'external');
  expectCode(rebuildGlb({ asset: { version: '2.0' }, images: [{ uri: 'file:///private.png' }] }), 'external');
  expectCode(rebuildGlb({ asset: { version: '2.0' }, images: [{ uri: 'data:image/svg+xml;base64,PHN2Zy8+' }] }), 'external');
  expectCode(rebuildGlb({ asset: { version: '2.0' }, extensions: { future: { uri: 'https://evil.invalid' } } }), 'external');
  expectCode(rebuildGlb({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] }), 'unsupported');
  expectCode(rebuildGlb({ asset: { version: '2.0' }, extensionsUsed: ['EXT_meshopt_compression'] }), 'unsupported');
  expectCode(rebuildGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: 100 }] }), 'invalid');
  expectCode(rebuildGlb({ asset: { version: '2.0' }, nodes: [{ children: [0] }] }), 'invalid');
  expectCode(rebuildGlb({ asset: { version: '2.0' }, accessors: [{ count: 2147483647 }] }), 'invalid');
  const badHeader = bytes.slice(0); new DataView(badHeader).setUint32(8, 3, true); expectCode(badHeader, 'invalid');
  passed.push('3D: generated self-contained GLB roundtrip; rejects invalid containers, oversized models, external/data-SVG URIs, decoder requirements, cyclic nodes and huge accessors before loader access');

  const geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const group = new THREE.Group(); group.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const disposed = { geometry: 0, material: 0, texture: 0 };
  geometry.addEventListener('dispose', () => disposed.geometry++); material.addEventListener('dispose', () => disposed.material++); texture.addEventListener('dispose', () => disposed.texture++);
  disposeModelResources([group, group]);
  assert(disposed.geometry === 1 && disposed.material === 1 && disposed.texture === 1, 'Shared GPU resources disposed incorrectly');
  passed.push('3D: shared geometry, materials and textures disposed exactly once');

  const host = document.createElement('div'); host.style.cssText = 'width:800px;height:600px'; document.body.append(host);
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind: string, ...args: unknown[]) { return kind === 'webgl2' ? null : originalGetContext.apply(this, [kind, ...args] as Parameters<typeof originalGetContext>); } as typeof originalGetContext;
  let noWebgl = '';
  try { await createModelViewport(host, asset, 'No WebGL', () => {}); } catch (error) { if (error instanceof ModelError) noWebgl = error.code; }
  finally { HTMLCanvasElement.prototype.getContext = originalGetContext; }
  assert(noWebgl === 'webgl' && !host.querySelector('canvas'), 'Missing WebGL did not produce an explicit recoverable error');
  const controller = new AbortController();
  let contextError = '';
  const viewport = await createModelViewport(host, asset, 'Fixture model', error => { contextError = error.code; }, controller.signal);
  const canvas = host.querySelector('canvas')!;
  const gl = canvas.getContext('webgl2')!;
  assert(gl && canvas.width > 0, 'No genuine WebGL rendering');
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const colors = new Set<string>(); for (let i = 0; i < pixels.length; i += 4 * 20) colors.add(`${pixels[i]}-${pixels[i + 1]}-${pixels[i + 2]}`);
  assert(colors.size > 20, `Rendered fixture is blank (${colors.size} colors)`);
  viewport.zoom('in'); viewport.zoom('out'); viewport.rotate('left'); viewport.rotate('right'); viewport.reset(); viewport.setWireframe(true); viewport.setWireframe(false); viewport.setLighting('soft'); viewport.setLighting('daylight'); viewport.setLighting('studio');
  assert(viewport.animations.includes('Weather vane'), 'Embedded animation not loaded');
  viewport.setAnimation(0, true); await pause(70); viewport.setAnimation(0, false);
  controller.abort();
  assert(!host.querySelector('canvas') && gl.isContextLost(), 'Abort did not immediately release renderer/context');
  viewport.dispose(); assert(!contextError, 'Normal disposal emitted spurious context-loss error');
  const canceled = new AbortController();
  const pending = createModelViewport(host, asset, 'Cancelled model', () => {}, canceled.signal).catch(error => error);
  canceled.abort(); await pending;
  assert(!host.querySelector('canvas'), 'Loading model leaked canvas after cancellation');
  const lost = await createModelViewport(host, asset, 'Lost context', error => { contextError = error.code; });
  host.querySelector('canvas')!.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  assert(contextError === 'contextLost' && !host.querySelector('canvas'), 'Context loss was not surfaced and disposed'); lost.dispose(); host.remove();
  passed.push('3D: actual WebGL pixels, zoom/orbit/reset/wireframe/lighting/animation, explicit unavailable-WebGL fallback, immediate abort cleanup and context-loss recovery message');

  const pid = `model-${Date.now()}`;
  const project: Project = { id: pid, title: 'Castle references', description: '', mode: 'novelist', type: 'standalone', status: 'draft', color: '#000', enabledEngines: ['model-viewer'], engineOrder: ['model-viewer'], createdAt: 1, updatedAt: 1 };
  await db.projects.add(project);
  await Promise.all([addModelAsset(pid, asset), addModelAsset(pid, { ...asset, id: `${asset.id}-second`, name: 'Second.glb' })]);
  assert((await db.projects.get(pid))!.modelAssets!.length === 2, 'Concurrent model imports lost data');
  const importedId = await importProjectData(await exportProjectData(pid));
  assert((await db.projects.get(importedId))?.modelAssets?.[0].dataUrl === asset.dataUrl, 'Project export/import lost local GLB bytes');
  await db.projects.delete(importedId);
  await removeModelAsset(pid, `${asset.id}-second`);
  assert((await db.projects.get(pid))!.modelAssets!.length === 1, 'Model removal failed');
  passed.push('3D: atomic concurrent imports, project JSON export/import preserves model bytes, local deletion');

  const rootNode = document.getElementById('root')!;
  rootNode.style.cssText = 'max-width:1200px;margin:24px auto;padding:0 24px';
  const root = createRoot(rootNode);
  useLocaleStore.setState({ locale: 'en' });
  await act(async () => { root.render(<StrictMode><MemoryRouter><ModelViewerEngine projectId={pid} /></MemoryRouter></StrictMode>); await pause(100); });
  for (let attempt = 0; attempt < 50 && !rootNode.textContent!.includes('Model ready'); attempt++) await act(async () => { await pause(50); });
  assert(rootNode.textContent!.includes('Model ready'), `Real model UI did not become ready: ${rootNode.textContent}`);
  const button = (label: string) => [...rootNode.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label)!;
  await act(async () => { button('Zoom in').click(); button('Rotate right').click(); button('Frame model').click(); });
  const wireframe = rootNode.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => { wireframe.click(); }); assert(wireframe.checked, 'Wireframe UI did not respond');
  await act(async () => { wireframe.click(); button('Play animation').click(); }); await act(async () => { button('Pause animation').click(); });
  const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL; const originalClick = HTMLAnchorElement.prototype.click;
  let download: Blob | undefined;
  let filename = '';
  URL.createObjectURL = (blob: Blob | MediaSource) => { if (blob instanceof Blob) download = blob; return 'blob:model-test'; }; URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () { filename = this.download; };
  try { await act(async () => { button('Download GLB').click(); }); } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; HTMLAnchorElement.prototype.click = originalClick; }
  assert(download?.size === bytes.byteLength && filename === 'Castle.glb', 'Actual model download lost bytes/name');
  const input = rootNode.querySelector<HTMLInputElement>('input[type="file"]')!;
  const transfer = new DataTransfer(); transfer.items.add(new File(['not glb'], 'Bad.glb')); input.files = transfer.files;
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await pause(70); });
  assert(rootNode.querySelector('[role="alert"]')?.textContent?.includes('valid GLB'), 'Invalid UI file did not show actionable error');
  const validTransfer = new DataTransfer(); validTransfer.items.add(new File([bytes], 'Imported.glb')); input.files = validTransfer.files;
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await pause(100); });
  for (let attempt = 0; attempt < 50 && !rootNode.textContent!.includes('Model ready'); attempt++) await act(async () => { await pause(50); });
  assert((await db.projects.get(pid))!.modelAssets!.length === 2, 'Actual UI import did not persist');
  await act(async () => { useLocaleStore.setState({ locale: 'es' }); });
  assert(rootNode.textContent!.includes('Centrar vista') && rootNode.textContent!.includes('Iluminación'), 'Spanish model controls missing');
  passed.push('3D: real StrictMode UI loads model, controls/playback, original GLB download, invalid-file errors, valid-file import and ES/EN labels');
  // Leave the loaded fixture mounted for the dedicated runner's screenshot.
  return passed;
}
