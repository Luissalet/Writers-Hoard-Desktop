import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildingPalette, placeParts, settlementStyle, symbolScale, hasPlaceModel } from '../core/placeStyle';
import type { WorldData } from '../core/types';
import type { HumanGeography } from '../core/settlements';
import { EARTH_KM } from '../core/camera';
import { SIZE_X, R_GLOBE, GLOBE_RELIEF, type SculptSurface } from './scene3d';
import type { WorldSpatialEntity } from '../core/spatialEntities';
import type { WorldSpatialStyle } from '../core/spatialEntities';
import type { CultureId } from '../core/naming';

/** Explicit per-place constructions. Existing worlds keep their overlay-only
 * presentation until a reader chooses a model/finish. Geometry is rebuilt only
 * when that place's authored construction changes, never on a camera frame. */
export function createPlaceModels() {
  const group = new THREE.Group();
  group.name = 'World place models';
  const ambient = new THREE.AmbientLight('#ffffff', 1.5);
  const sun = new THREE.DirectionalLight('#ffffff', 2); group.add(ambient, sun);
  const entries = new Map<string, { signature: string; object: THREE.Group }>();
  let inputs: { world: WorldData; geo: HumanGeography; revision: number; entities?: readonly WorldSpatialEntity[] } | undefined;
  let candidates: { x: number; y: number; sourceKey: string; rank: string; culture?: CultureId; style: WorldSpatialStyle }[] = [];
  const up = new THREE.Vector3(0, 1, 0), normal = new THREE.Vector3();
  const disposeObject = (object: THREE.Group) => {
    group.remove(object); object.traverse(child => { if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); } });
  };
  function update(world: WorldData, geo: HumanGeography | null, surface: SculptSurface, opts: {
    shape: 'plane' | 'globe'; spanKm: number; visible: boolean; sun: THREE.Vector3; sunColor: THREE.Color; sunIntensity: number; ambient: THREE.Color; entities?: readonly WorldSpatialEntity[];
  }) {
    group.visible = opts.visible && opts.spanKm < 2500;
    if (!group.visible || !geo) return;
    sun.position.copy(opts.sun); sun.color.copy(opts.sunColor); sun.intensity = opts.sunIntensity;
    ambient.color.copy(opts.ambient); ambient.intensity = 1.5;
    const keep = new Set<string>();
    const window = surface.uvWindow;
    const revision = world.revision ?? 0;
    if (inputs?.world !== world || inputs.geo !== geo || inputs.revision !== revision || inputs.entities !== opts.entities) {
      candidates = [
        ...geo.settlements.map(s => ({ x: s.x + .5, y: s.y + .5, sourceKey: s.sourceKey ?? `settlement:${Math.round(s.x)},${Math.round(s.y)}`, rank: s.rank, culture: s.culture, style: settlementStyle(world, s) })),
        ...geo.ruins.map(s => { const key = s.sourceKey ?? `ruin:${Math.round(s.x)},${Math.round(s.y)}`; return { x: s.x, y: s.y, sourceKey: key, rank: 'village', style: world.painted?.styles?.[key] ?? {} }; }),
        ...(opts.entities ?? []).filter(e => e.source === 'regional').map(e => ({ x: e.x, y: e.y, sourceKey: e.key, rank: e.type, style: e.style })),
      ].filter(s => hasPlaceModel(s.style));
      inputs = { world, geo, revision, entities: opts.entities };
    }
    for (const s of candidates) {
      const style = s.style;
      if (!hasPlaceModel(style)) continue;
      const u = s.x / world.width, v = s.y / world.height;
      const du = Math.abs(((u - window.u + 1.5) % 1) - .5);
      if (du > window.size || Math.abs(v - window.v) > window.size * 2) continue;
      const key = s.sourceKey ?? `${s.x},${s.y}`; keep.add(key);
      const model = style.model && style.model !== 'auto' ? style.model : s.rank === 'capital' || s.rank === 'city' ? 'keep' : 'house';
      const palette = buildingPalette(style, s.culture), signature = JSON.stringify([model, palette]);
      let entry = entries.get(key);
      if (entry?.signature !== signature) {
        if (entry) disposeObject(entry.object);
        const object = new THREE.Group();
        const materials = new Map<string, THREE.BufferGeometry[]>();
        for (const p of placeParts(model, palette)) {
          let geometry: THREE.BufferGeometry;
          if (p.shape === 'roof') {
            const triangle = new THREE.Shape(); triangle.moveTo(-p.w / 2, 0); triangle.lineTo(p.w / 2, 0); triangle.lineTo(0, p.h); triangle.closePath();
            geometry = new THREE.ExtrudeGeometry(triangle, { depth: p.d, bevelEnabled: false, steps: 1 }); geometry.translate(0, 0, -p.d / 2);
          } else geometry = new THREE.BoxGeometry(p.w, p.h, p.d);
          if (geometry.index) { const indexed = geometry; geometry = geometry.toNonIndexed(); indexed.dispose(); }
          if (p.angle) geometry.rotateZ(p.angle); geometry.translate(p.x, p.y, p.z);
          const color = palette[p.material];
          const list = materials.get(color) ?? []; list.push(geometry); materials.set(color, list);
        }
        // At most three draw calls per place, irrespective of its towers.
        for (const [color, geometries] of materials) {
          const merged = mergeGeometries(geometries); geometries.forEach(g => g.dispose());
          if (merged) object.add(new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ color })));
        }
        group.add(object); entry = { signature, object }; entries.set(key, entry);
      }
      const object = entry.object, elevation = surface.heightAtCell(s.x, s.y);
      const scale = SIZE_X * opts.spanKm / EARTH_KM * .007 * symbolScale(style);
      object.scale.setScalar(scale); object.quaternion.identity();
      if (opts.shape === 'plane') object.position.set((u - .5) * SIZE_X, elevation * surface.yMul + scale * .015, (v - .5) * SIZE_X * world.height / world.width);
      else {
        const lon = (u - .5) * Math.PI * 2, lat = (.5 - v) * Math.PI;
        normal.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
        object.position.copy(normal).multiplyScalar(R_GLOBE + elevation * surface.yMul * GLOBE_RELIEF + scale * .015);
        object.quaternion.setFromUnitVectors(up, normal);
      }
      if (keep.size >= 128) break;
    }
    for (const [key, entry] of entries) if (!keep.has(key)) { disposeObject(entry.object); entries.delete(key); }
  }
  return { group, update, stats: () => ({ places: entries.size, meshes: [...entries.values()].reduce((n, e) => n + e.object.children.length, 0) }), dispose: () => { for (const entry of entries.values()) disposeObject(entry.object); entries.clear(); group.clear(); } };
}
