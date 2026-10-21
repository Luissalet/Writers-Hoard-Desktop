import { Biome } from './types';

/** Physical closed-canopy biomes; savanna/scrub remain open ground. */
export function isForestBiome(biome: number): boolean {
  return biome === Biome.BorealForest || biome === Biome.TemperateForest
    || biome === Biome.TemperateRainforest || biome === Biome.TropicalForest
    || biome === Biome.TropicalRainforest;
}

/** Bilinear occupancy of that same mask, not a new ecological field. */
export const FOREST_COVER_GLSL = `
float closedForest(int b) {
  return b == ${Biome.BorealForest} || b == ${Biome.TemperateForest} || b == ${Biome.TemperateRainforest}
      || b == ${Biome.TropicalForest} || b == ${Biome.TropicalRainforest} ? 1.0 : 0.0;
}
float forestMaskTexel(ivec2 p) {
  ivec2 grid = ivec2(uGrid);
  p = ivec2(((p.x % grid.x) + grid.x) % grid.x, clamp(p.y, 0, grid.y - 1));
  return closedForest(int(texelFetch(uBiome,p,0).r * 255.0 + 0.5));
}
float forestCoverAt(vec2 uv) {
  vec2 t = uv * uGrid - 0.5, f = fract(t);
  ivec2 i = ivec2(floor(t));
  return mix(mix(forestMaskTexel(i),forestMaskTexel(i+ivec2(1,0)),f.x),
             mix(forestMaskTexel(i+ivec2(0,1)),forestMaskTexel(i+ivec2(1,1)),f.x),f.y);
}
`;
