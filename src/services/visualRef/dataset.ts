// ============================================================================
// The dataset export — 5% of the work, 60% of the LoRA's value
// ============================================================================
//
// Writers Hoard deliberately does NOT train. Training is multi-hour,
// VRAM-hostile, dependency-hostile, the recipe changes every quarter, and
// picking the checkpoint that actually looks like her is a human judgement made
// by eye. An app that shipped a trainer would ship a stale one.
//
// What it can do — and what nobody else can do as well, because only a writing
// app has the character's prose — is prepare the folder: the images, a caption
// beside each one drafted from the codex entry, and a config file for the
// trainer the writer already uses. Then get out of the way and say "open this
// in AI Toolkit".
//
// Everything here is pure: it returns a description of files. Writing them is
// the caller's job, which is what makes the whole shape testable without a disk.

import type { VisualRef } from '@/types/visualRef';

export interface DatasetTextFile {
  path: string;
  text: string;
}

export interface DatasetImageFile {
  path: string;
  /** The Gallery row's data URL; the caller turns it into bytes. */
  dataUrl: string;
  imageId: string;
}

export interface DatasetBundle {
  /** The folder everything sits under, named after the reference. */
  folder: string;
  /** The trigger word this dataset trains. */
  trigger: string;
  images: DatasetImageFile[];
  captions: DatasetTextFile[];
  configs: DatasetTextFile[];
  readme: DatasetTextFile;
}

export interface DatasetItem {
  imageId: string;
  dataUrl: string;
  /** The caption for this image, already drafted or edited by the writer. */
  caption: string;
}

export interface DatasetOptions {
  ref: Pick<VisualRef, 'name' | 'triggerWord' | 'lora'>;
  items: readonly DatasetItem[];
  /** Base checkpoint the writer intends to train against. */
  baseModel?: string;
  /** Square training resolution. 1024 for SDXL/FLUX, 512 for SD 1.5. */
  resolution?: number;
  steps?: number;
}

/** A filesystem-safe, lower-case, ASCII-ish name. Never empty. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'reference';
}

/** `image/png` → `png`, and anything unrecognised → `png`. */
function extensionOf(dataUrl: string): string {
  const match = /^data:image\/([a-z0-9.+-]+);base64,/i.exec(dataUrl);
  if (!match) return 'png';
  const raw = match[1].toLowerCase();
  return raw === 'jpeg' ? 'jpg' : raw;
}

/** The trigger word a dataset trains: the ref's own, or one made from its name. */
export function datasetTrigger(ref: Pick<VisualRef, 'name' | 'triggerWord'>): string {
  const explicit = ref.triggerWord?.trim();
  if (explicit) return explicit;
  // A made-up token, not the plain name: `elena` also means every other Elena
  // the base model ever saw, and training onto it fights the prior instead of
  // carving a new one.
  return `${slugify(ref.name).replace(/-/g, '')}_ohwx`;
}

// ---------------------------------------------------------------------------
// Trainer configs
// ---------------------------------------------------------------------------

/**
 * ai-toolkit (ostris) job file. `folder_path` is relative to the config, so the
 * whole folder can be moved anywhere and still train.
 */
export function buildAiToolkitYaml(options: DatasetOptions, trigger: string, name: string): string {
  const resolution = options.resolution ?? 1024;
  const steps = options.steps ?? 2000;
  const base = options.baseModel ?? 'black-forest-labs/FLUX.1-dev';
  return [
    '---',
    'job: extension',
    'config:',
    `  name: ${name}`,
    '  process:',
    '    - type: sd_trainer',
    '      training_folder: output',
    '      device: cuda:0',
    `      trigger_word: "${trigger}"`,
    '      network:',
    '        type: lora',
    '        linear: 16',
    '        linear_alpha: 16',
    '      save:',
    '        dtype: float16',
    '        save_every: 250',
    '        max_step_saves_to_keep: 4',
    '      datasets:',
    '        - folder_path: dataset',
    '          caption_ext: txt',
    '          caption_dropout_rate: 0.05',
    '          shuffle_tokens: false',
    '          cache_latents_to_disk: true',
    `          resolution: [${resolution}]`,
    '      train:',
    '        batch_size: 1',
    `        steps: ${steps}`,
    '        gradient_accumulation_steps: 1',
    '        train_unet: true',
    '        train_text_encoder: false',
    '        gradient_checkpointing: true',
    '        noise_scheduler: flowmatch',
    '        optimizer: adamw8bit',
    '        lr: 0.0001',
    '        dtype: bf16',
    '      model:',
    `        name_or_path: "${base}"`,
    '        quantize: true',
    '      sample:',
    '        sampler: flowmatch',
    '        sample_every: 250',
    `        width: ${resolution}`,
    `        height: ${resolution}`,
    '        prompts:',
    `          - "${trigger}, standing in a doorway"`,
    `          - "${trigger}, close portrait, side light"`,
    '        neg: ""',
    '        seed: 42',
    '        walk_seed: true',
    '        guidance_scale: 4',
    '        sample_steps: 20',
    'meta:',
    `  name: "${name}"`,
    "  version: '1.0'",
    '',
  ].join('\n');
}

/** musubi-tuner dataset config. Paths relative, same reason. */
export function buildMusubiToml(options: DatasetOptions, trigger: string): string {
  const resolution = options.resolution ?? 1024;
  return [
    '# musubi-tuner dataset config',
    `# trigger word: ${trigger}`,
    '',
    '[general]',
    `resolution = [${resolution}, ${resolution}]`,
    'caption_extension = ".txt"',
    'batch_size = 1',
    'enable_bucket = true',
    'bucket_no_upscale = false',
    '',
    '[[datasets]]',
    'image_directory = "dataset"',
    'cache_directory = "cache"',
    'num_repeats = 1',
    '',
  ].join('\n');
}

function buildReadme(options: DatasetOptions, trigger: string, count: number): string {
  return [
    `Training set for ${options.ref.name}`,
    '='.repeat(`Training set for ${options.ref.name}`.length),
    '',
    `${count} image(s), one .txt caption beside each, in dataset/.`,
    `Trigger word: ${trigger}`,
    '',
    'How the captions are written, and why',
    '-------------------------------------',
    'Caption what you do NOT want baked in. Every word a caption names becomes',
    'detachable: the model learns that the word means the hat, so the hat can be',
    'taken off later. Anything the captions stay silent about is absorbed into the',
    'trigger word and comes back in every generation.',
    '',
    'So the drafted captions name the glasses, the hat, the hairstyle, the coat,',
    'the pose and the background — and say nothing about eye colour, face shape or',
    'complexion, which are the person and belong to the trigger word.',
    '',
    'Read them before training. They were drafted from the codex entry, which',
    'describes the character as the book does, not as a dataset does.',
    '',
    'Training it',
    '-----------',
    'AI Toolkit (ostris): open ai-toolkit.yaml as the job file.',
    'musubi-tuner: pass musubi-tuner.toml as the dataset config.',
    '',
    'Pick the checkpoint by eye. The last one is rarely the best one; look for',
    'the step where she is recognisable but still takes direction.',
    '',
  ].join('\n');
}

/**
 * The whole folder as a description. Images keep their Gallery id in the file
 * name so a retrained LoRA can be traced back to exactly what it saw.
 */
export function buildDataset(options: DatasetOptions): DatasetBundle {
  const name = slugify(options.ref.name);
  const trigger = datasetTrigger(options.ref);
  const folder = `${name}-lora`;
  const images: DatasetImageFile[] = [];
  const captions: DatasetTextFile[] = [];
  options.items.forEach((item, index) => {
    const stem = `${String(index + 1).padStart(3, '0')}_${item.imageId}`;
    images.push({
      path: `${folder}/dataset/${stem}.${extensionOf(item.dataUrl)}`,
      dataUrl: item.dataUrl,
      imageId: item.imageId,
    });
    // The trainer pairs an image with its caption BY STEM, so the two names
    // must differ only in extension. Getting this wrong trains on empty
    // captions and the failure is invisible until the LoRA behaves oddly.
    captions.push({ path: `${folder}/dataset/${stem}.txt`, text: `${item.caption.trim()}\n` });
  });
  return {
    folder,
    trigger,
    images,
    captions,
    configs: [
      { path: `${folder}/ai-toolkit.yaml`, text: buildAiToolkitYaml(options, trigger, name) },
      { path: `${folder}/musubi-tuner.toml`, text: buildMusubiToml(options, trigger) },
    ],
    readme: { path: `${folder}/README.txt`, text: buildReadme(options, trigger, options.items.length) },
  };
}

/** Every file in the bundle, text and binary, in a stable order. */
export function datasetPaths(bundle: DatasetBundle): string[] {
  return [
    ...bundle.images.map((file) => file.path),
    ...bundle.captions.map((file) => file.path),
    ...bundle.configs.map((file) => file.path),
    bundle.readme.path,
  ].sort();
}
