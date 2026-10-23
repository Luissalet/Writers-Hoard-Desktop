import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assetBytes, ModelError, type ModelAsset } from './portable';

export type Lighting = 'studio' | 'soft' | 'daylight';
export type CameraMode = 'orbit' | 'fly';
export type CameraDirection = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down';
export interface ModelViewport {
  reset(): void;
  zoom(direction: 'in' | 'out'): void;
  rotate(direction: 'left' | 'right'): void;
  setWireframe(enabled: boolean): void;
  setLighting(lighting: Lighting): void;
  /** Play or pause a clip; `loop` false plays it once and holds the last pose. */
  setAnimation(index: number, playing: boolean, loop?: boolean): void;
  setCameraMode(mode: CameraMode): void;
  setAutoRotate(enabled: boolean): void;
  setActive(active: boolean): void;
  move(direction: CameraDirection): void;
  cameraPosition(): [number, number, number];
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

export async function createModelViewport(container: HTMLElement, asset: ModelAsset, label: string, onError: (error: ModelError) => void, signal?: AbortSignal, onCameraModeChange?: (mode: CameraMode) => void): Promise<ModelViewport> {
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
  let active = true;
  let frame = 0;
  let mixer: THREE.AnimationMixer | undefined;
  let model: THREE.Object3D | undefined;
  let modelScenes: THREE.Object3D[] = [];
  let clips: THREE.AnimationClip[] = [];
  let activeAction: THREE.AnimationAction | undefined;
  let previousTime = 0;
  let cameraMode: CameraMode = 'orbit';
  let autoRotate = false;
  let animationPlaying = false;
  const keys = new Set<string>();
  let dragging = false;
  let tick: (time: number) => void = () => {};
  const schedule = () => { if (!disposed && active && !document.hidden && !frame) { previousTime = performance.now(); frame = requestAnimationFrame(tick); } };
  const setActive = (value: boolean) => {
    active = value;
    if (!active || document.hidden) { cancelAnimationFrame(frame); frame = 0; clearKeys(); }
    else { render(); if (animationPlaying || autoRotate) schedule(); }
  };
  const setCameraMode = (mode: CameraMode) => {
    cameraMode = mode; controls.enabled = mode === 'orbit'; keys.clear(); dragging = false;
    if (mode === 'orbit') controls.update();
    if (mode === 'orbit' && autoRotate) schedule();
    onCameraModeChange?.(mode); render();
  };
  const move = (direction: CameraDirection, distance = 0.3) => {
    const vector = new THREE.Vector3();
    if (direction === 'up' || direction === 'down') vector.set(0, direction === 'up' ? 1 : -1, 0);
    else {
      camera.getWorldDirection(vector);
      if (direction === 'back') vector.negate();
      else if (direction === 'left' || direction === 'right') { vector.cross(camera.up).normalize(); if (direction === 'left') vector.negate(); }
    }
    camera.position.addScaledVector(vector, distance); render();
  };
  const clearKeys = () => { keys.clear(); dragging = false; };
  const visibility = () => setActive(active);
  const keyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === 'r') { event.preventDefault(); reset(); return; }
    if (key === 'escape') { event.preventDefault(); setCameraMode('orbit'); return; }
    if (key === 'w' && cameraMode === 'orbit') setCameraMode('fly');
    if (cameraMode === 'fly' && ['w', 'a', 's', 'd', ' ', 'shift'].includes(key)) { event.preventDefault(); keys.add(key); schedule(); }
  };
  const keyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
  const pointerDown = (event: PointerEvent) => { renderer.domElement.focus(); if (cameraMode === 'fly' && event.button === 0) { dragging = true; renderer.domElement.setPointerCapture(event.pointerId); } };
  const pointerUp = () => { dragging = false; };
  const pointerMove = (event: PointerEvent) => {
    if (cameraMode !== 'fly' || !dragging) return;
    const rotation = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    rotation.y -= event.movementX * 0.004; rotation.x = THREE.MathUtils.clamp(rotation.x - event.movementY * 0.004, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    camera.quaternion.setFromEuler(rotation); render();
  };
  const render = () => { if (!disposed && active && !document.hidden) renderer.render(scene, camera); };
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
    clearKeys();
    renderer.domElement.removeEventListener('keydown', keyDown); renderer.domElement.removeEventListener('blur', clearKeys);
    renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointermove', pointerMove); renderer.domElement.removeEventListener('pointerup', pointerUp); renderer.domElement.removeEventListener('pointercancel', pointerUp);
    window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', clearKeys); document.removeEventListener('visibilitychange', visibility);
    renderer.domElement.removeEventListener('webglcontextlost', contextLost);
    signal?.removeEventListener('abort', dispose);
    mixer?.stopAllAction(); if (model) mixer?.uncacheRoot(model);
    disposeModelResources([scene, ...modelScenes]);
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  }
  controls.addEventListener('change', render);
  signal?.addEventListener('abort', dispose, { once: true });
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  renderer.domElement.addEventListener('keydown', keyDown); renderer.domElement.addEventListener('blur', clearKeys);
  renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointermove', pointerMove); renderer.domElement.addEventListener('pointerup', pointerUp); renderer.domElement.addEventListener('pointercancel', pointerUp);
  window.addEventListener('keyup', keyUp); window.addEventListener('blur', clearKeys); document.addEventListener('visibilitychange', visibility);
  observer.observe(container);
  const reset = () => { setCameraMode('orbit'); camera.position.set(3, 2, 3); controls.target.set(0, 0, 0); camera.up.set(0, 1, 0); controls.update(); render(); };
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
    tick = (time: number) => {
      frame = 0;
      if (disposed || !active || document.hidden) return;
      const elapsed = Math.max(0, Math.min((time - previousTime) / 1000, 0.1)); previousTime = time;
      if (animationPlaying) mixer?.update(elapsed);
      if (autoRotate && cameraMode === 'orbit') { controls.autoRotate = true; controls.update(elapsed); controls.autoRotate = false; }
      if (cameraMode === 'fly' && keys.size) {
        for (const [key, direction] of [['w', 'forward'], ['s', 'back'], ['a', 'left'], ['d', 'right'], [' ', 'up'], ['shift', 'down']] as const) if (keys.has(key)) move(direction, elapsed * 2);
      }
      render();
      if (animationPlaying || autoRotate && cameraMode === 'orbit' || cameraMode === 'fly' && keys.size) frame = requestAnimationFrame(tick);
    };
    return {
      reset,
      setCameraMode,
      setActive,
      move,
      cameraPosition: () => camera.position.toArray(),
      setAutoRotate(enabled) { autoRotate = enabled; if (enabled) schedule(); },
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
      setAnimation(index, playing, loop = true) {
        if (!mixer || !clips[index]) return;
        const next = mixer.clipAction(clips[index]);
        if (next !== activeAction) { activeAction?.stop(); activeAction = next; activeAction.reset(); }
        activeAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1); activeAction.clampWhenFinished = !loop;
        if (!loop && playing && activeAction.time >= clips[index].duration) activeAction.reset();
        activeAction.paused = !playing; activeAction.play();
        animationPlaying = playing;
        if (playing) schedule(); else render();
      },
      animations: clips.map((clip, index) => clip.name || String(index + 1)),
      dispose,
    };
  } catch (error) { dispose(); throw error instanceof ModelError ? error : new ModelError('failed'); }
}
