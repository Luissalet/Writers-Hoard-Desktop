import { sampleWorldHeight, WORLD_HEIGHT_GLSL } from '@/engines/worldgen/core/heightSampling';
import { generateWorld } from '@/engines/worldgen/core/pipeline';
import { DEFAULT_PARAMS } from '@/engines/worldgen/core/types';
import { SculptSurface, SIZE_X, pickCell } from '@/engines/worldgen/sculpt/scene3d';
import * as THREE from 'three';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

export async function testHeightSamplerCandidate() {
  // Analytic ramps test a mathematical property; visual evidence uses generated geography.
  const W = 16, H = 8, ramp = Float32Array.from({ length: W * H }, (_, i) => (i % W) * .5 + Math.floor(i / W) * .25);
  let rampError = 0;
  for (let y = 2; y < H - 2; y += .13) for (let x = 2; x < W - 2; x += .17) rampError = Math.max(rampError, Math.abs(sampleWorldHeight(ramp, W, H, (x+.5)/W, (y+.5)/H) - (x*.5+y*.25)));
  assert(rampError < 1e-12, `Reconstruction terraces a linear ramp: ${rampError}`);
  const world = generateWorld({ ...DEFAULT_PARAMS, width: 256, seed: 'height-reconstruction-real' });
  for (let y = 0; y < world.height; y += 3) for (let x = 0; x < world.width; x += 3) assert(sampleWorldHeight(world.elevation, world.width, world.height, (x+.5)/world.width, (y+.5)/world.height) === world.elevation[y*world.width+x], 'Reconstruction changes a generated height sample');
  for (let y = 1; y < world.height-2; y += 3) for (let x = 0; x < world.width; x += 3) for (const t of [.1,.4,.8]) {
    const a = world.elevation[y*world.width+x], b = world.elevation[y*world.width+(x+1)%world.width], c = world.elevation[(y+1)*world.width+x], d = world.elevation[(y+1)*world.width+(x+1)%world.width];
    const height = sampleWorldHeight(world.elevation, world.width, world.height, (x+.5+t)/world.width, (y+.5+t)/world.height);
    assert(height >= Math.min(a,b,c,d)-1e-6 && height <= Math.max(a,b,c,d)+1e-6, 'Interpolation invents a peak/depression beyond its real cell heights');
  }
  for (const v of [.01,.2,.5,.9,.99]) for (const u of [-.1,0,.001,.9,1]) assert(Math.abs(sampleWorldHeight(world.elevation, world.width, world.height, u,v) - sampleWorldHeight(world.elevation, world.width, world.height, u+1,v)) < 1e-10, 'Longitude seam changes reconstructed height');

  for (let y = 2; y < world.height - 2; y += 7) for (let x = 0; x < world.width; x += 7) {
    const u = (x+.5)/world.width, v = (y+.5)/world.height, step = 1e-5;
    const h = sampleWorldHeight(world.elevation,world.width,world.height,u,v);
    const left = (h - sampleWorldHeight(world.elevation,world.width,world.height,u-step/world.width,v))/step;
    const right = (sampleWorldHeight(world.elevation,world.width,world.height,u+step/world.width,v)-h)/step;
    assert(Math.abs(left-right)<.005,'Reconstruction creates a lighting facet at a stored sample');
  }
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
  const gl = canvas.getContext('webgl2')!; assert(gl && gl.getExtension('EXT_color_buffer_float'), 'Height acceptance requires real float WebGL2');
  const shader = (type: number, source: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, source); gl.compileShader(s); assert(gl.getShaderParameter(s, gl.COMPILE_STATUS), gl.getShaderInfoLog(s) ?? 'Height shader compilation failed'); return s; };
  const vs = shader(gl.VERTEX_SHADER, '#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}');
  const fs = shader(gl.FRAGMENT_SHADER, `#version 300 es\nprecision highp float; precision highp int; uniform sampler2D uHeight; const vec2 uGrid=vec2(${world.width}.0,${world.height}.0); out vec4 color; ${WORLD_HEIGHT_GLSL}\nvoid main(){float h=sampleWorldHeightTexture(gl_FragCoord.xy/vec2(128.0,64.0));color=vec4(h,0,0,1);}`);
  const program = gl.createProgram()!; gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);assert(gl.getProgramParameter(program,gl.LINK_STATUS), gl.getProgramInfoLog(program) ?? 'Height shader link failed');
  const texture = gl.createTexture()!, output = gl.createTexture()!, framebuffer = gl.createFramebuffer()!;
  try {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,world.width,world.height,0,gl.RED,gl.FLOAT,world.elevation);
    gl.bindTexture(gl.TEXTURE_2D,output); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,128,64,0,gl.RGBA,gl.FLOAT,null);
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);assert(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'Float height framebuffer incomplete');
    gl.useProgram(program);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(gl.getUniformLocation(program,'uHeight'),0);gl.viewport(0,0,128,64);gl.drawArrays(gl.TRIANGLES,0,3);
    const pixels = new Float32Array(128*64*4);gl.readPixels(0,0,128,64,gl.RGBA,gl.FLOAT,pixels);let error=0;
    for (let y=0;y<64;y++)for(let x=0;x<128;x++)error=Math.max(error,Math.abs(pixels[(y*128+x)*4]-sampleWorldHeight(world.elevation,world.width,world.height,(x+.5)/128,(y+.5)/64)));
    assert(error<2e-5,`CPU/GLSL height divergence ${error}km`); assert(gl.getError()===gl.NO_ERROR,'Height shader WebGL error');
  } finally { gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteTexture(output);gl.deleteProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);gl.getExtension('WEBGL_lose_context')?.loseContext(); }
  return ['Monotone height reconstruction preserves analytic ramps, every generated sample, bounded extrema, wrapped seams and real float GPU/CPU heights'];
}

export async function testWorldgenHeightReconstruction() {
  const results = await testHeightSamplerCandidate();
  const world = generateWorld({ ...DEFAULT_PARAMS, width: 256, seed: 'height-reconstruction-real' });
  const surface = new SculptSurface({ worldWidth:world.width,worldHeight:world.height,mesh:32,palette:[[.5,.5,.5]] });
  try {
    surface.uploadAll(world.elevation,world.biome);surface.setShape('plane');surface.setExaggeration(30);surface.setDetail(0);
    for (const [u,v] of [[0,.5],[.27,.38],[.6,.7],[.999,.5]]) {
      const expected = sampleWorldHeight(world.elevation,world.width,world.height,u,v);
      assert(Math.abs(surface.heightAtUV(u,v)-expected)<1e-10,'SculptSurface CPU height still uses another reconstruction');
      const origin = new THREE.Vector3((u-.5)*SIZE_X,30,(v-.5)*SIZE_X*world.height/world.width);
      const picked = pickCell(surface,origin,new THREE.Vector3(0,-1,0),'plane',world.width,world.height);
      assert(picked && Math.abs(picked.x/world.width-u)<1e-5 && Math.abs(picked.y/world.height-v)<1e-5,'Picking does not meet the reconstructed surface');
    }
  } finally { surface.dispose(); }
  return [...results,'Actual SculptSurface height/picking use the same ramp-preserving field'];
}
