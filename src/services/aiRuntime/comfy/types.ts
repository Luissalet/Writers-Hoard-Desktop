// ============================================================================
// ComfyUI — graph, template and recipe contracts (pure data)
// ============================================================================
//
// The Bench renders a recipe by binding it into a ComfyUI template. Nothing
// here touches the network, the DOM or Node: the same types describe a
// template asset on disk, the graph the adapter submits and the fixture the
// tests replay, which is what lets the whole binding layer be tested without a
// ComfyUI instance.

/** A link: the id of the producing node and the index of its output. */
export type ComfyLink = [string, number];

export type ComfyInputValue = string | number | boolean | ComfyLink | null;

export interface ComfyNode {
  class_type: string;
  inputs: Record<string, ComfyInputValue>;
  /**
   * ComfyUI copies the node's title here when it exports API format. Bindings
   * resolve by title first, so a template survives a re-export that renumbers
   * every node.
   */
  _meta?: { title?: string };
}

/** API-format prompt: node id → node. Ids are strings, and they are stable. */
export type ComfyGraph = Record<string, ComfyNode>;

export type ComfyBindingKind = 'text' | 'number' | 'boolean' | 'choice' | 'image' | 'seed';

export interface ComfyBinding {
  /** `_meta.title` of the target node. Tried first. */
  title?: string;
  /** Node id, used when no node carries the title. */
  node?: string;
  input: string;
  kind: ComfyBindingKind;
}

/**
 * One optional occurrence of a repeatable feature (a LoRA, a region, a
 * ControlNet, a detail pass). `remove` is every node that belongs to it;
 * `passthrough` says which input each of its outputs collapses to when the
 * occurrence is dropped, so removing it rewires the graph instead of leaving
 * a dangling link.
 */
export interface ComfySlotInstance {
  remove: string[];
  passthrough?: Array<{ node: string; output: number; input: string }>;
}

export interface ComfyTemplate {
  id: string;
  label: string;
  description: string;
  /** Node classes this graph cannot run without. Checked against /object_info. */
  requires: string[];
  bindings: Record<string, ComfyBinding>;
  slots?: Record<string, ComfySlotInstance[]>;
  graph: ComfyGraph;
}

// ---------------------------------------------------------------------------
// The recipe, as the Bench sees it
// ---------------------------------------------------------------------------

/**
 * Named guidance presets. The raw node parameters are baked into the template
 * assets on purpose: a writer picks "Coherent", never a PAG scale.
 */
export type ComfyGuidancePreset = 'none' | 'coherent' | 'detailed' | 'distilled-negatives';

/** A masked region. `mask` is the name /upload/image returned for the mask. */
export interface ComfyRegion {
  prompt: string;
  mask: string;
  strength: number;
}

export interface ComfyControl {
  /** ControlNet file name as /object_info lists it. */
  model: string;
  /** Uploaded hint image (pose, depth, lineart) — already preprocessed. */
  image: string;
  strength: number;
  startPercent: number;
  endPercent: number;
}

export interface ComfyDetailStage {
  /** Ultralytics detector as /object_info lists it, e.g. "bbox/face_yolov8m.pt". */
  detector: string;
  prompt: string;
  denoise: number;
}

/** The rectangle an "only masked" inpaint works in, in source pixels. */
export interface ComfyCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComfyRecipe {
  templateId: string;
  checkpoint: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  batchSize: number;
  seed: number;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  denoise: number;
  filenamePrefix: string;
  loras: Array<{ name: string; weight: number }>;
  guidance: ComfyGuidancePreset;
  regions?: ComfyRegion[];
  controls?: ComfyControl[];
  detail?: ComfyDetailStage[];
  /** Uploaded source image name, for inpaint / upscale / detail. */
  sourceImage?: string;
  /** Uploaded mask image name (white repaints), for inpaint. */
  maskImage?: string;
  growMaskBy?: number;
  /** "Only masked": the rect to cut out, and the size it is worked at. */
  crop?: ComfyCropRect;
  workWidth?: number;
  workHeight?: number;
  hires?: { width: number; height: number; steps: number; denoise: number };
  upscale?: { model: string; by: number; denoise: number; tileWidth: number; tileHeight: number };
}
