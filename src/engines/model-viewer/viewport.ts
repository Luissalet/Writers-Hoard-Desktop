import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assetBytes, ModelError, type ModelAsset } from './model';

export type Lighting = 'studio' | 'soft' | 'daylight';
export interface ModelViewport {
  reset(): void;
  zoom(direction: 'in' | 'out'): void;
  rotate(direction: 'left' | 'right'): void;
  setWireframe(enabled: boolean): void;
  setLighting(lighting: Lighting): void;
  setAnimation(index: number, playing: boolean): void;
  animations: string[];
  dispose(): void;
}

/** Release shared geometry/material/texture resources exactly once. */
export function disposeModelResources(roots: THREE.Object3D[]): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  for (const root of roots) root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
  });
  for (const texture of textures) {
    texture.dispose();
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
  }
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
}

export async function createModelViewport(container: HTMLElement, asset: ModelAsset, label: string, onError: (error: ModelError) => void, signal?: AbortSignal): Promise<ModelViewport> {
  if (signal?.aborted) throw new ModelError('failed');
  const bytes = assetBytes(asset);
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' }); }
  catch { throw new ModelError('webgl'); }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#202223');
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;outline-offset:-4px';
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', label);
  container.append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.minDistance = 0.2;
  controls.maxDistance = 25;
  controls.enableDamping = false;
  const ambient = new THREE.HemisphereLight('#ffffff', '#8e8a7d', 2);
  const keyLight = new THREE.DirectionalLight('#fff4df', 3);
  keyLight.position.set(4, 6, 3);
  const fillLight = new THREE.DirectionalLight('#dce8ff', 1.5);
  fillLight.position.set(-4, 2, -3);
  scene.add(ambient, keyLight, fillLight);
  let disposed = false;
  let frame = 0;
  let mixer: THREE.AnimationMixer | undefined;
  let model: THREE.Object3D | undefined;
  let modelScenes: THREE.Object3D[] = [];
  let clips: THREE.AnimationClip[] = [];
  let activeAction: THREE.AnimationAction | undefined;
  let previousTime = 0;
  const render = () => { if (!disposed) renderer.render(scene, camera); };
  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); render();
  };
  const observer = new ResizeObserver(resize);
  const contextLost = (event: Event) => { event.preventDefault(); dispose(); onError(new ModelError('contextLost')); };
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame); observer.disconnect(); controls.removeEventListener('change', render); controls.dispose();
    renderer.domElement.removeEventListener('webglcontextlost', contextLost);
    signal?.removeEventListener('abort', dispose);
    mixer?.stopAllAction(); if (model) mixer?.uncacheRoot(model);
    disposeModelResources([scene, ...modelScenes]);
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  }
  controls.addEventListener('change', render);
  signal?.addEventListener('abort', dispose, { once: true });
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  observer.observe(container);
  const reset = () => { camera.position.set(3, 2, 3); controls.target.set(0, 0, 0); camera.up.set(0, 1, 0); controls.update(); render(); };
  reset(); resize();
  try {
    const manager = new THREE.LoadingManager();
    // Defense in depth: GLTFLoader may only resolve its own embedded blobs or
    // already validated data URLs. A new extension cannot silently add fetches.
    manager.setURLModifier(url => {
      if (!url.startsWith('blob:') && !/^data:(?:application\/octet-stream|image\/(?:png|jpeg|webp|avif));base64,/i.test(url)) throw new ModelError('external');
      return url;
    });
    const gltf = await new GLTFLoader(manager).parseAsync(bytes, '');
    modelScenes = gltf.scenes;
    model = gltf.scene;
    if (disposed) { disposeModelResources(modelScenes); throw new ModelError('contextLost'); }
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(extent) || extent <= 0) throw new ModelError('invalid');
    const center = bounds.getCenter(new THREE.Vector3());
    const group = new THREE.Group();
    model.position.sub(center);
    group.add(model); group.scale.setScalar(2 / extent); scene.add(group);
    const grid = new THREE.GridHelper(6, 12, '#66614f', '#3b3e3e');
    grid.position.y = new THREE.Box3().setFromObject(group).min.y - 0.015;
    scene.add(grid);
    clips = gltf.animations;
    if (clips.length) mixer = new THREE.AnimationMixer(model);
    reset();
    const tick = (time: number) => {
      if (disposed || !activeAction || activeAction.paused) return;
      mixer?.update(Math.min((time - previousTime) / 1000, 0.1)); previousTime = time; render(); frame = requestAnimationFrame(tick);
    };
    return {
      reset,
      zoom(direction) {
        const offset = camera.position.clone().sub(controls.target);
        offset.setLength(THREE.MathUtils.clamp(offset.length() * (direction === 'in' ? 0.8 : 1.25), controls.minDistance, controls.maxDistance));
        camera.position.copy(controls.target).add(offset); controls.update(); render();
      },
      rotate(direction) {
        const offset = camera.position.clone().sub(controls.target);
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), direction === 'left' ? -Math.PI / 12 : Math.PI / 12);
        camera.position.copy(controls.target).add(offset); controls.update(); render();
      },
      setWireframe(enabled) {
        model!.traverse(object => {
          const material = (object as THREE.Mesh).material;
          for (const value of Array.isArray(material) ? material : material ? [material] : []) if ('wireframe' in value) value.wireframe = enabled;
        }); render();
      },
      setLighting(lighting) {
        ambient.intensity = lighting === 'soft' ? 3 : lighting === 'daylight' ? 1.5 : 2;
        keyLight.intensity = lighting === 'soft' ? 1 : lighting === 'daylight' ? 5 : 3;
        fillLight.intensity = lighting === 'daylight' ? 0.6 : 1.5; render();
      },
      setAnimation(index, playing) {
        cancelAnimationFrame(frame);
        if (!mixer || !clips[index]) return;
        const next = mixer.clipAction(clips[index]);
        if (next !== activeAction) { activeAction?.stop(); activeAction = next; activeAction.reset(); }
        activeAction.paused = !playing; activeAction.play();
        if (playing) { previousTime = performance.now(); frame = requestAnimationFrame(tick); } else render();
      },
      animations: clips.map((clip, index) => clip.name || String(index + 1)),
      dispose,
    };
  } catch (error) { dispose(); throw error instanceof ModelError ? error : new ModelError('failed'); }
}
