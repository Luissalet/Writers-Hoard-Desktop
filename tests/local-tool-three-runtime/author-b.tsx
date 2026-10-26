import {author} from './probe';
// A separate creation has its own literal imports, without a shared author-kit cache.
export default author('tests.three-b',()=>Promise.all([
 import('three'),
 import('three/examples/jsm/loaders/OBJLoader.js'),
 import('three/examples/jsm/loaders/GLTFLoader.js'),
 import('three/examples/jsm/loaders/STLLoader.js'),
 import('three/examples/jsm/loaders/PLYLoader.js'),
 import('three/examples/jsm/loaders/FBXLoader.js'),
]));
