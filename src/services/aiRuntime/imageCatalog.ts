// ============================================================================
// AI runtime — curated local image-model catalogue (pure data)
// ============================================================================
//
// Weights the app can download and run itself through the managed
// stable-diffusion.cpp server. Every file is pinned by size and SHA-256 as
// published on Hugging Face (LFS object ids, August 2026): a download that
// does not match is thrown away, never loaded. Only ungated repositories —
// nothing here needs an account or a click-through.
//
// `vramBytes` is the estimated peak at the native resolution with the weights
// as shipped; ./imageFit.ts turns it into the perfecto / bien / justo /
// no cabe badge against the detected GPU. The knobs (`defaults`) are what the
// server is asked for when the user leaves the studio's fields on automatic.

export type ImageModelFamily = 'sd1' | 'sdxl' | 'flux';

export type ImageFileRole = 'model' | 'diffusion' | 'vae' | 'clip_l' | 't5xxl';

export interface ImageCatalogFile {
  role: ImageFileRole;
  fileName: string;
  url: string;
  sizeBytes: number;
  sha256: string;
}

export interface ImageCatalogModel {
  id: string;
  label: string;
  family: ImageModelFamily;
  /** Short licence name shown on the card; the user should know before downloading. */
  license: string;
  licenseUrl: string;
  files: ImageCatalogFile[];
  totalBytes: number;
  nativeWidth: number;
  nativeHeight: number;
  /** Estimated peak GPU memory at the native resolution, bytes. */
  vramBytes: number;
  defaults: {
    steps: number;
    cfg: number;
    sampler: string;
    scheduler?: string;
  };
  /** i18n key suffix for the one-line pitch: `settings.ai.imageCatalog.<key>` */
  pitchKey: string;
  recommended?: boolean;
}

const HF = 'https://huggingface.co';

function file(role: ImageFileRole, repo: string, fileName: string, sizeBytes: number, sha256: string): ImageCatalogFile {
  return { role, fileName, url: `${HF}/${repo}/resolve/main/${fileName}`, sizeBytes, sha256 };
}

function model(entry: Omit<ImageCatalogModel, 'totalBytes'>): ImageCatalogModel {
  return { ...entry, totalBytes: entry.files.reduce((sum, f) => sum + f.sizeBytes, 0) };
}

export const LOCAL_IMAGE_CATALOG: readonly ImageCatalogModel[] = [
  model({
    id: 'dreamshaper-8',
    label: 'DreamShaper 8',
    family: 'sd1',
    license: 'CreativeML OpenRAIL-M',
    licenseUrl: `${HF}/Lykon/DreamShaper`,
    files: [file('model', 'Lykon/DreamShaper', 'DreamShaper_8_pruned.safetensors', 2_132_625_894, '879db523c30d3b9017143d56705015e15a2cb5628762c11d086fed9538abd7fd')],
    nativeWidth: 512,
    nativeHeight: 512,
    vramBytes: 3_600_000_000,
    defaults: { steps: 25, cfg: 6.5, sampler: 'dpm++2m', scheduler: 'karras' },
    pitchKey: 'dreamshaper-8',
    recommended: true,
  }),
  model({
    id: 'sd15-q8',
    label: 'Stable Diffusion 1.5 (Q8)',
    family: 'sd1',
    license: 'CreativeML OpenRAIL-M',
    licenseUrl: `${HF}/second-state/stable-diffusion-v1-5-GGUF`,
    files: [file('model', 'second-state/stable-diffusion-v1-5-GGUF', 'stable-diffusion-v1-5-pruned-emaonly-Q8_0.gguf', 1_763_578_176, 'd0555243938c62faeefb4ac93f6c7a053ad373a4290c5256bce229aeb193bf94')],
    nativeWidth: 512,
    nativeHeight: 512,
    vramBytes: 3_000_000_000,
    defaults: { steps: 20, cfg: 7, sampler: 'euler_a' },
    pitchKey: 'sd15-q8',
  }),
  model({
    id: 'dreamshaper-xl-turbo',
    label: 'DreamShaper XL Turbo',
    family: 'sdxl',
    license: 'CreativeML OpenRAIL++-M',
    licenseUrl: `${HF}/Lykon/DreamShaper`,
    files: [file('model', 'Lykon/DreamShaper', 'DreamShaperXL_Turbo_dpmppSdeKarras_half_pruned_6.safetensors', 6_939_220_250, '676f0d60c8e860146d5e8a0d802599cadd04e7cadf85c283f189f41f01c9e359')],
    nativeWidth: 1024,
    nativeHeight: 1024,
    vramBytes: 9_500_000_000,
    defaults: { steps: 7, cfg: 2, sampler: 'dpm++2s_a', scheduler: 'karras' },
    pitchKey: 'dreamshaper-xl-turbo',
    recommended: true,
  }),
  model({
    id: 'sdxl-turbo',
    label: 'SDXL Turbo',
    family: 'sdxl',
    license: 'Stability AI non-commercial research',
    licenseUrl: `${HF}/stabilityai/sdxl-turbo/blob/main/LICENSE.md`,
    files: [file('model', 'stabilityai/sdxl-turbo', 'sd_xl_turbo_1.0_fp16.safetensors', 6_938_081_905, 'e869ac7d6942cb327d68d5ed83a40447aadf20e0c3358d98b2cc9e270db0da26')],
    nativeWidth: 512,
    nativeHeight: 512,
    vramBytes: 8_500_000_000,
    defaults: { steps: 4, cfg: 1, sampler: 'euler_a' },
    pitchKey: 'sdxl-turbo',
  }),
  model({
    id: 'flux-schnell-q4',
    label: 'FLUX.1 schnell (Q4)',
    family: 'flux',
    license: 'Apache 2.0',
    licenseUrl: `${HF}/second-state/FLUX.1-schnell-GGUF`,
    files: [
      file('diffusion', 'second-state/FLUX.1-schnell-GGUF', 'flux1-schnell-Q4_0.gguf', 6_688_845_536, 'b338a7ab5c81600a54be46c4cf950edb3761a52ae163e419beafd250976fb566'),
      file('vae', 'second-state/FLUX.1-schnell-GGUF', 'ae.safetensors', 335_304_388, 'afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38'),
      file('clip_l', 'second-state/FLUX.1-schnell-GGUF', 'clip_l.safetensors', 246_144_152, '660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd'),
      file('t5xxl', 'second-state/FLUX.1-schnell-GGUF', 't5xxl-Q8_0.gguf', 5_199_794_784, 'fc07757bf7ad40eaf612acc7ed0c0a7ab71189979e0b8b4d14601017baca22de'),
    ],
    nativeWidth: 1024,
    nativeHeight: 1024,
    vramBytes: 13_000_000_000,
    defaults: { steps: 4, cfg: 1, sampler: 'euler' },
    pitchKey: 'flux-schnell-q4',
  }),
];

export function imageCatalogEntry(id: string): ImageCatalogModel | undefined {
  return LOCAL_IMAGE_CATALOG.find((m) => m.id === id);
}

export { BUILTIN_SD_ID } from './constants';
