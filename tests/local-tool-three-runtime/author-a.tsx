import {author} from './probe';
// Ordinary trusted author code. Every import stays inside the explicit user action.
export default author('tests.three-a',()=>Promise.all([
 import('three'),
 import('three/examples/jsm/loaders/OBJLoader.js'),
 import('three/examples/jsm/loaders/GLTFLoader.js'),
 import('three/examples/jsm/loaders/STLLoader.js'),
 import('three/examples/jsm/loaders/PLYLoader.js'),
 import('three/examples/jsm/loaders/FBXLoader.js'),
]));
