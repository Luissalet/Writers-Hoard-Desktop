import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { ModelError, sourceFileBytes, validateGlb, type ModelSourceFile } from './model';
import { disposeModelResources } from './viewport';

const baseName = (name: string) => name.replaceAll('\\', '/').split('/').pop()!;
const text = (file: ModelSourceFile) => new TextDecoder('utf-8', { fatal: true }).decode(sourceFileBytes(file));
const image = (name: string) => /\.(png|jpe?g|webp|avif)$/i.test(name);

/** Resolve only the files explicitly chosen by the author, without network/filesystem reads. */
export function localModelResources(files: readonly ModelSourceFile[], basePath = '') {
  const resolve = (url: string): string => {
    if (/^data:(?:application\/(?:octet-stream|gltf-buffer)|image\/(?:png|jpeg|webp|avif));base64,[a-z0-9+/=\s]+$/i.test(url)) return url.replace(/^data:application\/gltf-buffer;/i, 'data:application/octet-stream;');
    if (/^(?:https?:|\/\/|file:)/i.test(url)) throw new ModelError('external');
    let path: string;
    try { path = decodeURIComponent(url).replaceAll('\\', '/').replace(/^\.\//, ''); } catch { throw new ModelError('invalid'); }
    const exact = files.filter(file => file.name.replaceAll('\\', '/') === basePath + path || file.name.replaceAll('\\', '/') === path);
    const candidates = exact.length ? exact : files.filter(file => baseName(file.name) === baseName(path));
    if (candidates.length !== 1) throw new ModelError('external');
    const file = candidates[0];
    sourceFileBytes(file);
    // File pickers do not always populate MIME. Loaders need the real image MIME.
    const mime = image(file.name) ? `image/${/\.jpe?g$/i.test(file.name) ? 'jpeg' : file.name.split('.').pop()!.toLowerCase()}` : 'application/octet-stream';
    return file.dataUrl.replace(/^data:[^;]*;/, `data:${mime};`);
  };
  return { resolve };
}

function validationGlb(json: unknown): ArrayBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const length = Math.ceil(encoded.length / 4) * 4;
  const bytes = new ArrayBuffer(20 + length), view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true);
  const payload = new Uint8Array(bytes, 20); payload.fill(32); payload.set(encoded);
  return bytes;
}

export async function convertModelFiles(name: string, files: readonly ModelSourceFile[]): Promise<ArrayBuffer> {
  const matches = files.filter(file => baseName(file.name) === name);
  if (matches.length !== 1) throw new ModelError('invalid');
  const primary = matches[0], format = name.split('.').pop()!.toLowerCase();
  const { resolve } = localModelResources(files, primary.name.slice(0, primary.name.lastIndexOf('/') + 1));
  const manager = new THREE.LoadingManager();
  const embeddedUrls = new Set<string>();
  manager.setURLModifier(url => {
    // These URLs are produced by the installed loaders for embedded image bytes.
    if (url.startsWith('blob:')) { embeddedUrls.add(url); return url; }
    return resolve(url);
  });
  let began = false, loadError = false;
  let finish: () => void = () => {};
  const textures = new Promise<void>(done => { finish = done; });
  manager.onStart = () => { began = true; };
  manager.onLoad = () => finish();
  manager.onError = () => { loadError = true; };
  let model: THREE.Object3D | undefined;
  let roots: THREE.Object3D[] = [];
  let animations: THREE.AnimationClip[] = [];
  try {
    if (format === 'gltf') {
      const json: unknown = JSON.parse(text(primary));
      const visit = (value: unknown): void => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
          if (key === 'uri') { if (typeof child !== 'string') throw new ModelError('invalid'); (value as Record<string, unknown>)[key] = resolve(child); }
          else visit(child);
        }
      };
      visit(json);
      // Validate topology and extensions without counting base64 buffers as JSON
      // metadata. The real bytes remain in json and are parsed by GLTFLoader.
      const structure: unknown = JSON.parse(JSON.stringify(json, (key, value: unknown) => key === 'uri' ? 'data:application/octet-stream;base64,AA==' : value));
      validateGlb(validationGlb(structure));
      const gltf = await new GLTFLoader(manager).parseAsync(JSON.stringify(json), '');
      model = gltf.scene; roots = gltf.scenes; animations = gltf.animations;
    } else if (format === 'fbx') {
      model = new FBXLoader(manager).parse(sourceFileBytes(primary), ''); animations = model.animations;
    } else if (format === 'obj') {
      const loader = new OBJLoader(manager), content = text(primary);
      const libraries = [...content.matchAll(/^\s*mtllib\s+(.+)$/gm)].map(match => match[1].trim());
      if (libraries.length) {
        // OBJLoader accepts one material creator; merge all selected libraries in source order.
        const materials = libraries.map(library => {
          const path = resolve(library);
          return text({ name: library, dataUrl: path, size: atob(path.split(',')[1]).length });
        }).join('\n');
        const creator = new MTLLoader(manager).parse(materials, ''); creator.preload(); loader.setMaterials(creator);
      }
      model = loader.parse(content);
    } else if (format === 'stl' || format === 'ply') {
      const geometry = format === 'stl' ? new STLLoader().parse(sourceFileBytes(primary)) : new PLYLoader().parse(sourceFileBytes(primary));
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      model = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#cfb886', roughness: 0.75, vertexColors: !!geometry.getAttribute('color') }));
    } else throw new ModelError('invalid');
    if (!roots.length) roots = [model];
    const images = files.filter(file => image(file.name));
    if (['obj', 'stl', 'ply'].includes(format) && images.length === 1 && !files.some(file => /\.mtl$/i.test(file.name))) {
      const texture = new THREE.TextureLoader(manager).load(resolve(images[0].name)); texture.colorSpace = THREE.SRGBColorSpace;
      model.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.geometry || !mesh.material) return;
        // Supply a stable planar UV projection for plain scans/meshes without UVs.
        if (!mesh.geometry.getAttribute('uv')) {
          mesh.geometry.computeBoundingBox(); const bounds = mesh.geometry.boundingBox!, size = bounds.getSize(new THREE.Vector3()), positions = mesh.geometry.getAttribute('position');
          const axes = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a));
          const uv = new Float32Array(positions.count * 2);
          for (let i = 0; i < positions.count; i++) for (let j = 0; j < 2; j++) { const axis = axes[j]; uv[i * 2 + j] = (positions.getComponent(i, axis) - bounds.min.getComponent(axis)) / (size.getComponent(axis) || 1); }
          mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        }
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if ('map' in material) { const painted = material as THREE.MeshStandardMaterial; painted.map = texture; painted.color.set('#ffffff'); material.needsUpdate = true; }
      });
    }
    if (began) await textures;
    if (loadError) throw new ModelError('external');
    const bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty() || !Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.x)) throw new ModelError('invalid');
    const result = await new GLTFExporter().parseAsync(model, { binary: true, animations, onlyVisible: false });
    if (!(result instanceof ArrayBuffer)) throw new ModelError('invalid');
    validateGlb(result); return result;
  } catch (error) { throw error instanceof ModelError ? error : new ModelError('invalid'); }
  finally { disposeModelResources(roots.length ? roots : model ? [model] : []); for (const url of embeddedUrls) URL.revokeObjectURL(url); }
}
