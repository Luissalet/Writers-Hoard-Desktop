/** Authored test meshes and textures; no external content or network fixture. */
export const triangleObj = 'o Triangle\nv -1 0 0\nv 1 0 0\nv 0 2 0\nvt 0 0\nvt 1 0\nvt .5 1\nvn 0 0 1\nf 1/1/1 2/2/1 3/3/1\n';
export const triangleStl = 'solid triangle\nfacet normal 0 0 1\nouter loop\nvertex -1 0 0\nvertex 1 0 0\nvertex 0 2 0\nendloop\nendfacet\nendsolid triangle';
export const trianglePly = 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n-1 0 0\n1 0 0\n0 2 0\n3 0 1 2\n';
export const triangleFbx = `; FBX 7.4.0 project file
FBXHeaderExtension:  {
	FBXHeaderVersion: 1003
	FBXVersion: 7400
}
Objects:  {
	Geometry: 100, "Geometry::Triangle", "Mesh" {
		Vertices: *9 {
			a: -1,0,0,1,0,0,0,2,0
		}
		PolygonVertexIndex: *3 {
			a: 0,1,-3
		}
	}
	Model: 200, "Model::Triangle", "Mesh" {
		Version: 232
		Properties70:  {
			P: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
			P: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
			P: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
		}
	}
}
Connections:  {
	C: "OO",100,200
	C: "OO",200,0
}
`;

export function triangleGltf(): { json: Record<string, unknown>; bin: ArrayBuffer } {
  const data = new Float32Array([-1, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0.5, 1]);
  return { bin: data.buffer, json: {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    buffers: [{ uri: 'triangle.bin', byteLength: data.byteLength }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, 0, 0], max: [1, 2, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    images: [{ uri: 'paint.png' }], textures: [{ source: 0 }], materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
  } };
}
export async function paintFile(): Promise<File> {
  const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4;
  const context = canvas.getContext('2d')!; context.fillStyle = '#dd5522'; context.fillRect(0, 0, 4, 4); context.fillStyle = '#2233dd'; context.fillRect(0, 0, 2, 4);
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
  return new File([blob], 'paint.png', { type: 'image/png' });
}
