// ============================================================================
// Visual references — the object that accumulates
// ============================================================================
//
// A character who is recognisably the same person in chapter 30 as in chapter 1
// is not the product of one lucky prompt; it is the product of layers that
// build up over months. On day 1 a reference is three words and a photograph
// the writer found. On day 30 it is twenty-five curated images, a seed that
// works, a preset, and a LoRA trained from the folder this file can export.
//
// So EVERY field below except identity is optional, and the resolver uses
// whatever happens to be there. That is what makes the object useful with no
// image backend installed at all — as a visual bible — and what lets the
// generation side grow underneath it without a migration.

/** What the reference stands for. Style refs carry no face; they carry a look. */
export type VisualRefKind = 'character' | 'place' | 'object' | 'style';

/**
 * Which language the fragments are written in.
 *
 * Not decoration. Tag-conditioned bases (SDXL, Illustrious, Pony) were trained
 * on comma-separated boorus; prose-conditioned bases (Flux, Qwen, Z-Image) were
 * trained on sentences. A fragment written for one reads badly to the other —
 * a tag salad confuses a T5 encoder and a paragraph dilutes a CLIP one — so the
 * dialect travels with the text and the resolver adapts it at the join.
 */
export type PromptDialect = 'tags' | 'prose';

/**
 * A LoRA trained on this reference. `baseFamily` is the checkpoint family it
 * was trained against ('sd1' | 'sdxl' | 'flux' | whatever a server reports):
 * a LoRA is only meaningful over its own family, and applying one across
 * families produces the noise that makes writers give up on LoRAs.
 */
export interface VisualRefLora {
  fileName: string;
  weight: number;
  baseFamily: string;
  /** Which images it was trained from, so a retrain can start from the same set. */
  trainedFromImageIds?: string[];
  trainedAt?: number;
}

/** The knobs that were found to work for this reference, kept so they can be reused. */
export interface VisualRefPreset {
  modelId: string;
  steps: number;
  cfg: number;
  sampler?: string;
  scheduler?: string;
  width: number;
  height: number;
}

export interface VisualRef {
  id: string;
  projectId: string;
  /** The codex character/place this belongs to, when it belongs to one. */
  codexEntryId?: string;
  kind: VisualRefKind;
  name: string;

  /** The words that describe her, in `dialect`. */
  promptFragment?: string;
  negativeFragment?: string;
  /** The LoRA's token once one is trained; goes first in the prompt. */
  triggerWord?: string;
  dialect: PromptDialect;

  /** Gallery image ids. The bytes stay in `inspirationImages`; this holds ids. */
  referenceImageIds: string[];
  /** "This is her" — the one image an edit model or PhotoMaker is handed. */
  canonicalImageId?: string;
  /** Turnarounds and expression sheets: reference material, not the portrait. */
  sheetImageIds?: string[];

  lora?: VisualRefLora;
  /** The seed that produced her best likeness, reused when identity is locked. */
  heroSeed?: number;
  /** Reusable poses: a pose bank the writer builds up, ControlNet or not. */
  controlImageIds?: string[];
  preset?: VisualRefPreset;

  createdAt: number;
  updatedAt: number;
}

/** A brand-new reference: a name and a dialect, nothing else. */
export function emptyVisualRef(
  id: string,
  projectId: string,
  name: string,
  now: number,
  kind: VisualRefKind = 'character',
  dialect: PromptDialect = 'prose',
): VisualRef {
  return {
    id,
    projectId,
    kind,
    name,
    dialect,
    referenceImageIds: [],
    createdAt: now,
    updatedAt: now,
  };
}
