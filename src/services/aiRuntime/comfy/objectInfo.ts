// ============================================================================
// ComfyUI — /object_info, read as capability data
// ============================================================================
//
// One GET answers three questions the Bench needs: which node classes this
// install has (so a template can be greyed out with a remedy instead of
// failing on submit), which files are in the model folders (checkpoints,
// LoRAs, ControlNets, upscalers, detectors) and which sampler/scheduler names
// this build accepts. Everything is read defensively: /object_info is a large
// document assembled from third-party code, and one malformed entry must not
// cost the whole listing.

/** A combo input arrives as its option list; everything else as a type name. */
export interface ComfyInputSpec {
  type: string;
  options?: string[];
}

export interface ComfyClassInfo {
  name: string;
  required: Record<string, ComfyInputSpec>;
  optional: Record<string, ComfyInputSpec>;
}

export interface ComfyObjectInfo {
  classes: Record<string, ComfyClassInfo>;
}

function readInputGroup(raw: unknown): Record<string, ComfyInputSpec> {
  const out: Record<string, ComfyInputSpec> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    const head = value[0];
    if (Array.isArray(head)) {
      out[name] = { type: 'COMBO', options: head.filter((o): o is string => typeof o === 'string') };
    } else if (typeof head === 'string') {
      out[name] = { type: head };
    }
  }
  return out;
}

export function indexObjectInfo(raw: unknown): ComfyObjectInfo {
  const classes: Record<string, ComfyClassInfo> = {};
  if (!raw || typeof raw !== 'object') return { classes };
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const input = (value as { input?: unknown }).input;
    const group = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    classes[name] = {
      name,
      required: readInputGroup(group.required),
      optional: readInputGroup(group.optional),
    };
  }
  return { classes };
}

export function hasClass(info: ComfyObjectInfo, className: string): boolean {
  return Object.prototype.hasOwnProperty.call(info.classes, className);
}

export function inputSpec(info: ComfyObjectInfo, className: string, input: string): ComfyInputSpec | null {
  const entry = info.classes[className];
  if (!entry) return null;
  return entry.required[input] ?? entry.optional[input] ?? null;
}

/** The option list of a combo input — the installed files, in practice. */
export function comboOptions(info: ComfyObjectInfo, className: string, input: string): string[] {
  return inputSpec(info, className, input)?.options ?? [];
}

export function listCheckpoints(info: ComfyObjectInfo): string[] {
  return comboOptions(info, 'CheckpointLoaderSimple', 'ckpt_name');
}

export function listLoras(info: ComfyObjectInfo): string[] {
  return comboOptions(info, 'LoraLoader', 'lora_name');
}

export function listControlNets(info: ComfyObjectInfo): string[] {
  return comboOptions(info, 'ControlNetLoader', 'control_net_name');
}

export function listUpscaleModels(info: ComfyObjectInfo): string[] {
  return comboOptions(info, 'UpscaleModelLoader', 'model_name');
}

export function listDetectors(info: ComfyObjectInfo): string[] {
  return comboOptions(info, 'UltralyticsDetectorProvider', 'model_name');
}

export function listSamplers(info: ComfyObjectInfo): string[] {
  return comboOptions(info, 'KSampler', 'sampler_name');
}

export function listSchedulers(info: ComfyObjectInfo): string[] {
  return comboOptions(info, 'KSampler', 'scheduler');
}
