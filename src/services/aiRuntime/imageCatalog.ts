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
//
// Companions (below) are the second kind of asset: not a model the server is
// launched to serve, but a file it is pointed at — a ControlNet the context is
// built with, an ESRGAN the hires pass upscales through. They live in their
// own folders, they are pinned the same way, and they are useless on their own.

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
    /**
     * `sample_params.guidance.distilled_guidance`. Left unset the family rule
     * applies (1 for FLUX, 3.5 elsewhere), which is right for the step-distilled
     * models but wrong for FLUX Kontext dev, which wants about 2.5.
     */
    distilledGuidance?: number;
  };
  /**
   * The model conditions on `ref_images`. Only the Kontext-style editing models
   * do; every other model silently ignores the array, so the studio must not
   * offer reference images for them.
   */
  refImages?: boolean;
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
  model({
    id: 'flux-kontext-dev-q4',
    label: 'FLUX.1 Kontext dev (Q4)',
    family: 'flux',
    license: 'FLUX.1 [dev] Non-Commercial License',
    licenseUrl: `${HF}/black-forest-labs/FLUX.1-Kontext-dev/blob/main/LICENSE.md`,
    files: [
      file('diffusion', 'QuantStack/FLUX.1-Kontext-dev-GGUF', 'flux1-kontext-dev-Q4_0.gguf', 6_797_337_888, '859f06ce2b492a2a88b675ed55fed97a2d57d43b9d9aeffb5b6d4ce3b155259e'),
      // The dev autoencoder and text encoders are byte-identical to the schnell
      // ones already pinned above — same sizes, same digests — so a reader who
      // has both models downloads these four files once.
      file('vae', 'second-state/FLUX.1-dev-GGUF', 'ae.safetensors', 335_304_388, 'afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38'),
      file('clip_l', 'second-state/FLUX.1-dev-GGUF', 'clip_l.safetensors', 246_144_152, '660c6f5b1abae9dc498ac2d21e1347d2abdb0cf6c0c0c8576cd796491d9a6cdd'),
      file('t5xxl', 'second-state/FLUX.1-dev-GGUF', 't5xxl-Q8_0.gguf', 5_199_794_784, 'fc07757bf7ad40eaf612acc7ed0c0a7ab71189979e0b8b4d14601017baca22de'),
    ],
    nativeWidth: 1024,
    nativeHeight: 1024,
    vramBytes: 13_200_000_000,
    // Kontext dev is not step-distilled: it wants real steps and a distilled
    // guidance around 2.5, while `cfg` stays at 1 as for every FLUX.
    defaults: { steps: 20, cfg: 1, sampler: 'euler', distilledGuidance: 2.5 },
    pitchKey: 'flux-kontext-dev-q4',
    refImages: true,
  }),
];

/**
 * Where a companion file has to sit for the runtime to find it.
 *
 * `controlnet` is passed to the server as `--control-net <file>`: it is a
 * context option, so the server must be restarted to change it. `upscaler`
 * files are scanned out of `--hires-upscalers-dir` by stem, and named back in
 * a request as `hires.upscaler`.
 */
export type ImageCompanionKind = 'controlnet' | 'upscaler';

export interface ImageCompanionAsset {
  id: string;
  label: string;
  kind: ImageCompanionKind;
  /** Base models this file is trained against; empty means "any". */
  families: readonly ImageModelFamily[];
  license: string;
  licenseUrl: string;
  fileName: string;
  url: string;
  sizeBytes: number;
  sha256: string;
  /** i18n key suffix: `settings.ai.imageCompanions.<key>` */
  pitchKey: string;
}

function companion(entry: Omit<ImageCompanionAsset, 'url'> & { repo: string }): ImageCompanionAsset {
  const { repo, ...rest } = entry;
  return { ...rest, url: `${HF}/${repo}/resolve/main/${rest.fileName}` };
}

/**
 * ControlNet v1.1 checkpoints and one ESRGAN, all ungated on Hugging Face and
 * all in formats this pinned build reads: the ControlNet loader strips the
 * `control_model.` prefix these .pth files carry, and the ESRGAN loader maps
 * RRDBNet tensor names (`conv_first`, `body.N.rdbK.convM`, `conv_up1/2`)
 * straight through.
 *
 * Only SD1 ControlNets are listed. The SDXL and FLUX ControlNets in the wild
 * are a zoo of incompatible layouts, and one that loads but conditions wrongly
 * is worse than one that is absent.
 */
export const LOCAL_IMAGE_COMPANIONS: readonly ImageCompanionAsset[] = [
  companion({
    id: 'controlnet-sd15-openpose',
    label: 'ControlNet 1.1 — OpenPose',
    kind: 'controlnet',
    families: ['sd1'],
    license: 'OpenRAIL',
    licenseUrl: `${HF}/lllyasviel/ControlNet-v1-1`,
    repo: 'lllyasviel/ControlNet-v1-1',
    fileName: 'control_v11p_sd15_openpose.pth',
    sizeBytes: 1_445_235_707,
    sha256: 'db97becd92cd19aff71352a60e93c2508decba3dee64f01f686727b9b406a9dd',
    pitchKey: 'controlnet-sd15-openpose',
  }),
  companion({
    id: 'controlnet-sd15-canny',
    label: 'ControlNet 1.1 — Canny',
    kind: 'controlnet',
    families: ['sd1'],
    license: 'OpenRAIL',
    licenseUrl: `${HF}/lllyasviel/ControlNet-v1-1`,
    repo: 'lllyasviel/ControlNet-v1-1',
    fileName: 'control_v11p_sd15_canny.pth',
    sizeBytes: 1_445_234_681,
    sha256: 'f99cfe4c70910e38e3fece9918a4979ed7d3dcf9b81cee293e1755363af5406a',
    pitchKey: 'controlnet-sd15-canny',
  }),
  companion({
    id: 'controlnet-sd15-depth',
    label: 'ControlNet 1.1 — Depth',
    kind: 'controlnet',
    families: ['sd1'],
    license: 'OpenRAIL',
    licenseUrl: `${HF}/lllyasviel/ControlNet-v1-1`,
    repo: 'lllyasviel/ControlNet-v1-1',
    fileName: 'control_v11f1p_sd15_depth.pth',
    sizeBytes: 1_445_235_365,
    sha256: '761077ffe369fe8cf16ae353f8226bd4ca29805b161052f82c0170c7b50f1d99',
    pitchKey: 'controlnet-sd15-depth',
  }),
  companion({
    id: 'realesrgan-x4',
    label: 'Real-ESRGAN ×4',
    kind: 'upscaler',
    families: [],
    license: 'BSD-3-Clause',
    licenseUrl: `${HF}/ai-forever/Real-ESRGAN`,
    repo: 'ai-forever/Real-ESRGAN',
    fileName: 'RealESRGAN_x4.pth',
    sizeBytes: 67_040_989,
    sha256: 'aa00f09ad753d88576b21ed977e97d634976377031b178acc3b5b238df463400',
    pitchKey: 'realesrgan-x4',
  }),
];

export function imageCompanionAsset(id: string): ImageCompanionAsset | undefined {
  return LOCAL_IMAGE_COMPANIONS.find((c) => c.id === id);
}

/** Companions of one kind, in catalogue order. */
export function imageCompanionsOfKind(kind: ImageCompanionKind): ImageCompanionAsset[] {
  return LOCAL_IMAGE_COMPANIONS.filter((c) => c.kind === kind);
}

export function imageCatalogEntry(id: string): ImageCatalogModel | undefined {
  return LOCAL_IMAGE_CATALOG.find((m) => m.id === id);
}

export { BUILTIN_SD_ID } from './constants';
