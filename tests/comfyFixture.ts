// ============================================================================
// Test fixture — a ComfyUI /object_info document
// ============================================================================
//
// Hand-built from ComfyUI's own node definitions (comfyanonymous/ComfyUI
// nodes.py and comfy_extras/*.py, ssitu/ComfyUI_UltimateSDUpscale usdu_nodes.py,
// ltdrdata/ComfyUI-Impact-Pack and -Subpack), NOT captured from a running
// server — there is none in this environment. Its job is to fail the test
// suite the moment a template names a node class or an input that ComfyUI does
// not define, which is the mistake that turns into a 400 on submit.

type Spec = string | string[];

function node(required: Record<string, Spec>, optional: Record<string, Spec> = {}): unknown {
  const wrap = (specs: Record<string, Spec>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(specs).map(([name, spec]) => [name, [spec, {}]]));
  return { input: { required: wrap(required), optional: wrap(optional) }, output: [], output_name: [] };
}

export const SAMPLER_NAMES = ['euler', 'euler_cfg_pp', 'euler_ancestral', 'euler_ancestral_cfg_pp', 'heun', 'dpm_2', 'dpmpp_2s_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'ddim', 'lcm', 'ipndm', 'ipndm_v', 'res_multistep', 'er_sde', 'gradient_estimation', 'uni_pc'];
export const SCHEDULER_NAMES = ['simple', 'sgm_uniform', 'karras', 'exponential', 'ddim_uniform', 'beta', 'normal', 'linear_quadratic', 'kl_optimal'];

export const CHECKPOINTS = ['sdxl/juggernautXL_v9.safetensors', 'illustriousXL_v01.safetensors'];
export const LORAS = ['style/inkwash.safetensors', 'character/mara.safetensors'];
export const CONTROLNETS = ['xl/openpose.safetensors', 'xl/depth.safetensors', 'xl/lineart.safetensors'];
export const UPSCALE_MODELS = ['4x-UltraSharp.pth', 'RealESRGAN_x4plus.pth'];
export const DETECTORS = ['bbox/face_yolov8m.pt', 'bbox/hand_yolov8s.pt', 'segm/person_yolov8m-seg.pt'];
export const INPUT_IMAGES = ['example.png'];

const IMAGE_SCALE_METHODS = ['nearest-exact', 'bilinear', 'area', 'bicubic', 'lanczos'];
const LATENT_SCALE_METHODS = ['nearest-exact', 'bilinear', 'area', 'bicubic', 'bislerp'];
const CROP_METHODS = ['disabled', 'center'];
const CHANNELS = ['red', 'green', 'blue', 'alpha'];

export function comfyObjectInfoFixture(options: { omit?: string[] } = {}): Record<string, unknown> {
  const classes: Record<string, unknown> = {
    CheckpointLoaderSimple: node({ ckpt_name: CHECKPOINTS }),
    LoraLoader: node({ model: 'MODEL', clip: 'CLIP', lora_name: LORAS, strength_model: 'FLOAT', strength_clip: 'FLOAT' }),
    CLIPTextEncode: node({ text: 'STRING', clip: 'CLIP' }),
    EmptyLatentImage: node({ width: 'INT', height: 'INT', batch_size: 'INT' }),
    KSampler: node({
      model: 'MODEL',
      seed: 'INT',
      steps: 'INT',
      cfg: 'FLOAT',
      sampler_name: SAMPLER_NAMES,
      scheduler: SCHEDULER_NAMES,
      positive: 'CONDITIONING',
      negative: 'CONDITIONING',
      latent_image: 'LATENT',
      denoise: 'FLOAT',
    }),
    VAEDecode: node({ samples: 'LATENT', vae: 'VAE' }),
    SaveImage: node({ images: 'IMAGE', filename_prefix: 'STRING' }),
    PreviewImage: node({ images: 'IMAGE' }),
    LatentUpscale: node({ samples: 'LATENT', upscale_method: LATENT_SCALE_METHODS, width: 'INT', height: 'INT', crop: CROP_METHODS }),
    LoadImage: node({ image: INPUT_IMAGES }),
    LoadImageMask: node({ image: INPUT_IMAGES, channel: ['alpha', 'red', 'green', 'blue'] }),
    ConditioningSetMask: node({ conditioning: 'CONDITIONING', mask: 'MASK', strength: 'FLOAT', set_cond_area: ['default', 'mask bounds'] }),
    ConditioningCombine: node({ conditioning_1: 'CONDITIONING', conditioning_2: 'CONDITIONING' }),
    ImageCrop: node({ image: 'IMAGE', width: 'INT', height: 'INT', x: 'INT', y: 'INT' }),
    ImageScale: node({ image: 'IMAGE', upscale_method: IMAGE_SCALE_METHODS, width: 'INT', height: 'INT', crop: CROP_METHODS }),
    ImageToMask: node({ image: 'IMAGE', channel: CHANNELS }),
    VAEEncodeForInpaint: node({ pixels: 'IMAGE', vae: 'VAE', mask: 'MASK', grow_mask_by: 'INT' }),
    ImageCompositeMasked: node(
      { destination: 'IMAGE', source: 'IMAGE', x: 'INT', y: 'INT', resize_source: 'BOOLEAN' },
      { mask: 'MASK' },
    ),
    ControlNetLoader: node({ control_net_name: CONTROLNETS }),
    ControlNetApplyAdvanced: node(
      {
        positive: 'CONDITIONING',
        negative: 'CONDITIONING',
        control_net: 'CONTROL_NET',
        image: 'IMAGE',
        strength: 'FLOAT',
        start_percent: 'FLOAT',
        end_percent: 'FLOAT',
      },
      { vae: 'VAE' },
    ),
    UpscaleModelLoader: node({ model_name: UPSCALE_MODELS }),
    ImageUpscaleWithModel: node({ upscale_model: 'UPSCALE_MODEL', image: 'IMAGE' }),
    UltimateSDUpscale: node({
      image: 'IMAGE',
      model: 'MODEL',
      positive: 'CONDITIONING',
      negative: 'CONDITIONING',
      vae: 'VAE',
      upscale_by: 'FLOAT',
      seed: 'INT',
      steps: 'INT',
      cfg: 'FLOAT',
      sampler_name: SAMPLER_NAMES,
      scheduler: SCHEDULER_NAMES,
      denoise: 'FLOAT',
      upscale_model: 'UPSCALE_MODEL',
      mode_type: ['Linear', 'Chess', 'None'],
      tile_width: 'INT',
      tile_height: 'INT',
      mask_blur: 'INT',
      tile_padding: 'INT',
      seam_fix_mode: ['None', 'Band Pass', 'Half Tile', 'Half Tile + Intersections'],
      seam_fix_denoise: 'FLOAT',
      seam_fix_width: 'INT',
      seam_fix_mask_blur: 'INT',
      seam_fix_padding: 'INT',
      force_uniform_tiles: 'BOOLEAN',
      tiled_decode: 'BOOLEAN',
      batch_size: 'INT',
    }),
    UltralyticsDetectorProvider: node({ model_name: DETECTORS }),
    SAMLoader: node({ model_name: ['sam_vit_b_01ec64.pth'], device_mode: ['AUTO', 'Prefer GPU', 'CPU'] }),
    FaceDetailer: node(
      {
        image: 'IMAGE',
        model: 'MODEL',
        clip: 'CLIP',
        vae: 'VAE',
        guide_size: 'FLOAT',
        guide_size_for: 'BOOLEAN',
        max_size: 'FLOAT',
        seed: 'INT',
        steps: 'INT',
        cfg: 'FLOAT',
        sampler_name: SAMPLER_NAMES,
        scheduler: SCHEDULER_NAMES,
        positive: 'CONDITIONING',
        negative: 'CONDITIONING',
        denoise: 'FLOAT',
        feather: 'INT',
        noise_mask: 'BOOLEAN',
        force_inpaint: 'BOOLEAN',
        bbox_threshold: 'FLOAT',
        bbox_dilation: 'INT',
        bbox_crop_factor: 'FLOAT',
        sam_detection_hint: ['center-1', 'horizontal-2', 'vertical-2', 'rect-4', 'diamond-4', 'mask-area', 'mask-points', 'mask-point-bbox', 'none'],
        sam_dilation: 'INT',
        sam_threshold: 'FLOAT',
        sam_bbox_expansion: 'INT',
        sam_mask_hint_threshold: 'FLOAT',
        sam_mask_hint_use_negative: ['False', 'Small', 'Outter'],
        drop_size: 'INT',
        bbox_detector: 'BBOX_DETECTOR',
        wildcard: 'STRING',
        cycle: 'INT',
      },
      { sam_model_opt: 'SAM_MODEL', segm_detector_opt: 'SEGM_DETECTOR', detailer_hook: 'DETAILER_HOOK' },
    ),
    PerturbedAttentionGuidance: node({ model: 'MODEL', scale: 'FLOAT' }),
    SelfAttentionGuidance: node({ model: 'MODEL', scale: 'FLOAT', blur_sigma: 'FLOAT' }),
    FreeU_V2: node({ model: 'MODEL', b1: 'FLOAT', b2: 'FLOAT', s1: 'FLOAT', s2: 'FLOAT' }),
    RescaleCFG: node({ model: 'MODEL', multiplier: 'FLOAT' }),
  };
  for (const name of options.omit ?? []) delete classes[name];
  return classes;
}
