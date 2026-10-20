import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/** A wholly local, generated castle with one animation; no fetched fixture. */
export async function modelViewerFixture(): Promise<ArrayBuffer> {
  const scene = new THREE.Scene();
  const stone = new THREE.MeshStandardMaterial({ color: '#cfb886', roughness: 0.8 });
  const roof = new THREE.MeshStandardMaterial({ color: '#447f79', roughness: 0.65 });
  const ground = new THREE.MeshStandardMaterial({ color: '#666e4d', roughness: 1 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); scene.add(mesh); return mesh; };
  add(new THREE.BoxGeometry(3.8, 0.18, 3.2), ground, 0, -0.09, 0);
  add(new THREE.BoxGeometry(1.8, 1.5, 1.6), stone, 0, 0.75, 0);
  add(new THREE.ConeGeometry(1.45, 1.1, 4), roof, 0, 2.05, 0).rotation.y = Math.PI / 4;
  for (const x of [-1.2, 1.2]) for (const z of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.34, 0.4, 1.6, 12), stone, x, 0.8, z);
    add(new THREE.ConeGeometry(0.48, 0.8, 12), roof, x, 2, z);
  }
  for (const x of [-1.2, 1.2]) add(new THREE.BoxGeometry(0.16, 0.9, 2), stone, x, 0.45, 0);
  for (const z of [-1, 1]) add(new THREE.BoxGeometry(2.4, 0.9, 0.16), stone, 0, 0.45, z);
  const flag = new THREE.Group(); flag.name = 'Weather vane'; flag.position.set(0, 2.65, 0); scene.add(flag);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 6), stone); flag.add(pole);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.025), new THREE.MeshStandardMaterial({ color: '#d5b575' })); banner.position.set(0.25, 0.2, 0); flag.add(banner);
  const quaternions = [0, Math.PI, Math.PI * 2].flatMap(angle => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle).toArray());
  const animation = new THREE.AnimationClip('Weather vane', 2, [new THREE.QuaternionKeyframeTrack(`${flag.uuid}.quaternion`, [0, 1, 2], quaternions)]);
  const result = await new GLTFExporter().parseAsync(scene, { binary: true, animations: [animation] });
  if (!(result instanceof ArrayBuffer)) throw new Error('Fixture exporter did not produce GLB');
  scene.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose(); } });
  return result;
}

export function rebuildGlb(json: Record<string, unknown>, binary?: Uint8Array): ArrayBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const binaryLength = binary ? Math.ceil(binary.length / 4) * 4 : 0;
  const bytes = new ArrayBuffer(20 + jsonLength + (binary ? 8 + binaryLength : 0));
  const view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  const jsonBytes = new Uint8Array(bytes, 20, jsonLength); jsonBytes.fill(0x20); jsonBytes.set(encoded);
  if (binary) { view.setUint32(20 + jsonLength, binaryLength, true); view.setUint32(24 + jsonLength, 0x004e4942, true); new Uint8Array(bytes, 28 + jsonLength).set(binary); }
  return bytes;
}
