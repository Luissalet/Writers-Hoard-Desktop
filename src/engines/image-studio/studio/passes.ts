// ============================================================================
// The pass chain — base → hires → detail → upscale, as a list you can edit
// ============================================================================
//
// Every expert result anyone has ever posted is a chain, not a single call:
// a base generation, a second pass at a larger size, a face pass, sometimes an
// upscale. Modelling it as three unrelated checkboxes scattered down a panel
// hides the one thing that actually explains the result — the ORDER, and what
// each pass was allowed to change.
//
// A list makes "why does this one look better" answerable, it maps onto both
// backends (sd.cpp does the first two in one job; a node graph does all four),
// and it is the mental model every tutorial in the field already uses.
//
// Denoise is the parameter this whole file exists to make visible. At 0.3–0.5
// a second pass adds detail to the picture you had; at 0.7 it generates a
// different picture at a larger size and throws yours away. The default is 0.4
// and the band is drawn in the UI, because nothing else about a second pass
// matters half as much.

import { generateId } from '@/utils/idGenerator';
import type { HiresPassRequest, RequestSupportMap } from '../operations';
import type { FieldState } from './capabilities';

export type PassKind = 'base' | 'hires' | 'detail' | 'upscale';

export const PASS_KINDS: readonly PassKind[] = ['base', 'hires', 'detail', 'upscale'];

/** Below this a second pass sharpens; above it, it reimagines. */
export const HIRES_DENOISE_DEFAULT = 0.4;
export const HIRES_DENOISE_SAFE_MAX = 0.55;
export const DETAIL_DENOISE_DEFAULT = 0.45;

export interface StudioPass {
  id: string;
  kind: PassKind;
  enabled: boolean;
  /** Overrides the base prompt for this pass alone. Empty means "reuse it". */
  prompt?: string;
  /** 0..1. How far this pass is allowed to move from what it was handed. */
  denoise?: number;
  steps?: number;
  /** hires and upscale: the multiplier on the base size. */
  scale?: number;
  /** A name from `hires_upscaler_to_str`, or the stem of a file on disk. */
  upscaler?: string;
  /** detail: which detector finds the region to repaint. */
  detector?: string;
  padding?: number;
  maskBlur?: number;
  confidence?: number;
}

export function defaultPass(kind: PassKind, id = generateId('pass')): StudioPass {
  switch (kind) {
    case 'base':
      return { id, kind, enabled: true };
    case 'hires':
      return {
        id,
        kind,
        enabled: true,
        scale: 1.5,
        steps: 15,
        denoise: HIRES_DENOISE_DEFAULT,
        upscaler: 'Latent',
      };
    case 'detail':
      return {
        id,
        kind,
        enabled: true,
        detector: 'face',
        denoise: DETAIL_DENOISE_DEFAULT,
        padding: 32,
        maskBlur: 4,
        confidence: 0.3,
      };
    case 'upscale':
      return { id, kind, enabled: true, scale: 2, upscaler: 'Lanczos', denoise: 0 };
  }
}

/** A new chain: the base pass alone, which is what "generate" has always meant. */
export function newChain(): StudioPass[] {
  return [defaultPass('base')];
}

/**
 * Base first, exactly one of it, and never disabled.
 *
 * Not a style rule: a chain whose base pass is off or second has nothing to
 * hand its second pass, so it would produce no image and the writer would have
 * no way to tell that from a backend failure.
 */
export function normalizeChain(passes: readonly StudioPass[]): StudioPass[] {
  const base = passes.find((pass) => pass.kind === 'base') ?? defaultPass('base');
  const rest = passes.filter((pass) => pass.kind !== 'base' && pass !== base);
  return [{ ...base, enabled: true }, ...rest];
}

export function addPass(passes: readonly StudioPass[], kind: PassKind): StudioPass[] {
  return normalizeChain([...passes, defaultPass(kind)]);
}

export function removePass(passes: readonly StudioPass[], id: string): StudioPass[] {
  return normalizeChain(passes.filter((pass) => pass.kind === 'base' || pass.id !== id));
}

export function togglePass(passes: readonly StudioPass[], id: string): StudioPass[] {
  return normalizeChain(passes.map((pass) => (
    pass.id === id && pass.kind !== 'base' ? { ...pass, enabled: !pass.enabled } : pass
  )));
}

export function updatePass(
  passes: readonly StudioPass[],
  id: string,
  changes: Partial<Omit<StudioPass, 'id' | 'kind'>>,
): StudioPass[] {
  return normalizeChain(passes.map((pass) => (pass.id === id ? { ...pass, ...changes } : pass)));
}

/** Move one pass by `delta` places. The base pass stays where it is. */
export function movePass(passes: readonly StudioPass[], id: string, delta: number): StudioPass[] {
  const list = [...passes];
  const from = list.findIndex((pass) => pass.id === id);
  if (from < 0 || list[from].kind === 'base') return normalizeChain(list);
  // Clamped to index 1: swapping past the base would put a second pass first.
  const to = Math.max(1, Math.min(list.length - 1, from + delta));
  if (to === from) return normalizeChain(list);
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return normalizeChain(list);
}

// ---- round trip -------------------------------------------------------------
//
// A chain is recorded on the row that a generation produced, so "iterate on
// this" can put the whole chain back and a comparison can diff it. That means
// it has to survive JSON in both directions with its ids intact — a chain that
// comes back with new ids reorders differently and diffs as entirely changed.

export function serializePassChain(passes: readonly StudioPass[]): string {
  return JSON.stringify(normalizeChain(passes));
}

function numberIn(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : undefined;
}

/** Read a stored chain back. Anything unrecognised is dropped, never guessed. */
export function parsePassChain(text: string | undefined): StudioPass[] {
  if (!text) return newChain();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return newChain();
  }
  if (!Array.isArray(raw)) return newChain();
  const passes: StudioPass[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const kind = row.kind;
    if (typeof kind !== 'string' || !(PASS_KINDS as readonly string[]).includes(kind)) continue;
    passes.push({
      id: typeof row.id === 'string' && row.id ? row.id : generateId('pass'),
      kind: kind as PassKind,
      enabled: row.enabled !== false,
      prompt: typeof row.prompt === 'string' && row.prompt ? row.prompt : undefined,
      denoise: numberIn(row.denoise, 0, 1),
      steps: numberIn(row.steps, 1, 150),
      scale: numberIn(row.scale, 1, 4),
      upscaler: typeof row.upscaler === 'string' && row.upscaler ? row.upscaler : undefined,
      detector: typeof row.detector === 'string' && row.detector ? row.detector : undefined,
      padding: numberIn(row.padding, 0, 256),
      maskBlur: numberIn(row.maskBlur, 0, 64),
      confidence: numberIn(row.confidence, 0, 1),
    });
  }
  return normalizeChain(passes);
}

// ---- what the backend can honour -------------------------------------------

export interface PassSupportInput {
  supports: RequestSupportMap;
  /** True only for the app's own stable-diffusion.cpp server. */
  managedLocal: boolean;
  /** Upscaler names the runtime will resolve: the builtins plus installed files. */
  upscalers: readonly string[];
}

/**
 * Whether a pass of this kind can run at all. Refused kinds still appear in
 * the "add a pass" menu, disabled, carrying this reason — a writer who has read
 * about ADetailer has to be able to find out that it is coming, rather than
 * conclude this app has never heard of it.
 */
export function passAvailability(kind: PassKind, input: PassSupportInput): FieldState {
  if (kind === 'base') return { enabled: true };
  if (kind === 'upscale') {
    // This build has no standalone upscale job: `upscale_repeats` is parsed and
    // then read only by the CLI. ESRGAN is reachable, but through the hires
    // pass, so the honest answer is to say where it went.
    return { enabled: false, reasonKey: 'imageStudio.reason.upscaleInHires' };
  }
  if (kind === 'detail') {
    return input.supports.detailer
      ? { enabled: true }
      : { enabled: false, reasonKey: 'imageStudio.reason.noRequestField' };
  }
  if (!input.supports.hiresFix) return { enabled: false, reasonKey: 'imageStudio.reason.noRequestField' };
  if (!input.managedLocal) return { enabled: false, reasonKey: 'visualRef.reason.serverChoosesSampler' };
  if (input.upscalers.length === 0) return { enabled: false, reasonKey: 'imageStudio.reason.noUpscaler' };
  return { enabled: true };
}

export interface ChainRequest {
  hires?: HiresPassRequest;
  /** Passes that are on but cannot run, and why. Shown, never swallowed. */
  refused: { id: string; kind: PassKind; reasonKey: string }[];
}

/**
 * The chain as the request can carry it.
 *
 * One hires block, because that is what `SDGenerationParams` has room for: a
 * second enabled hires pass is REFUSED out loud rather than merged into the
 * first, since merging would generate at a scale nobody asked for.
 */
export function chainToRequest(passes: readonly StudioPass[], input: PassSupportInput): ChainRequest {
  const refused: ChainRequest['refused'] = [];
  let hires: HiresPassRequest | undefined;
  for (const pass of normalizeChain(passes)) {
    if (!pass.enabled || pass.kind === 'base') continue;
    const availability = passAvailability(pass.kind, input);
    if (!availability.enabled) {
      refused.push({ id: pass.id, kind: pass.kind, reasonKey: availability.reasonKey ?? 'visualRef.reason.unavailable' });
      continue;
    }
    if (pass.kind === 'hires') {
      if (hires) {
        refused.push({ id: pass.id, kind: pass.kind, reasonKey: 'imageStudio.reason.oneHiresPass' });
        continue;
      }
      hires = {
        upscaler: pass.upscaler ?? 'Latent',
        scale: pass.scale ?? 1.5,
        steps: pass.steps,
        denoisingStrength: pass.denoise ?? HIRES_DENOISE_DEFAULT,
      };
    }
  }
  return { hires, refused };
}

/**
 * The size the chain ends at, so the panel can show it before anything runs.
 * Counts only the passes that will actually run: promising 2048 px from an
 * upscale pass this backend cannot perform is exactly the silent lie the whole
 * refusal machinery exists to prevent.
 */
export function chainOutputSize(
  passes: readonly StudioPass[],
  width: number,
  height: number,
  input: PassSupportInput,
): { width: number; height: number } {
  const { hires } = chainToRequest(passes, input);
  const scale = hires?.scale ?? 1;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
