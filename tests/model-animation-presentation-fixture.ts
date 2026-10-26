import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { rebuildGlb } from './model-viewer-fixture';

/** Authored geometry and three distinguishable clips; no fetched content. */
export async function modelAnimationPresentationFixture(): Promise<ArrayBuffer> {
  const scene = new THREE.Scene();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: '#4b8a97', roughness: .7 }));
  body.position.y = .6; scene.add(body);
  const base = new THREE.Mesh(new THREE.BoxGeometry(4, .1, 3), new THREE.MeshStandardMaterial({ color: '#7e8e64', roughness: 1 }));
  base.position.y = -.08; scene.add(base);
  const marker = new THREE.Mesh(new THREE.BoxGeometry(.45, .45, .45), new THREE.MeshBasicMaterial({ color: '#ef6038' }));
  marker.name = 'Authored moving marker'; marker.position.set(-.6, 1.6, .6); scene.add(marker);
  const origin = marker.position.toArray();
  const movement = (axis: number) => {
    const end = [...origin]; end[axis] += 1.4;
    return new THREE.VectorKeyframeTrack(`${marker.uuid}.position`, [0, 12], [...origin, ...end]);
  };
  const clips = [new THREE.AnimationClip('Same name', 12, [movement(0)]), new THREE.AnimationClip('Same name', 12, [movement(1)]), new THREE.AnimationClip('', 12, [movement(2)])];
  let exported: ArrayBuffer | object;
  try { exported = await new GLTFExporter().parseAsync(scene, { binary: true, animations: clips }); }
  finally {
    for (const mesh of [body, base, marker]) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
  }
  if (!(exported instanceof ArrayBuffer)) throw Error('Fixture did not produce GLB');
  // Exporters may synthesize names. Set the authored source names explicitly,
  // preserving every channel/accessor/binary byte rather than relying on that.
  const view = new DataView(exported), jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(exported, 20, jsonLength))) as Record<string, unknown>;
  const animations = json.animations as Array<Record<string, unknown>>;
  if (animations.length !== 3) throw Error('Fixture exporter lost a clip');
  animations[0].name = 'Same name'; animations[1].name = 'Same name'; animations[2].name = '';
  const binaryLength = view.getUint32(20 + jsonLength, true);
  return rebuildGlb(json, new Uint8Array(exported, 28 + jsonLength, binaryLength));
}
