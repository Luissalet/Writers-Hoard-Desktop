// ============================================================================
// The LoRA stack — N of them, with their weights and their trigger words
// ============================================================================
//
// One LoRA at a time was the hard ceiling, and character fidelity IS LoRAs: a
// character LoRA plus a style LoRA plus a detail LoRA is the ordinary case, not
// an exotic one. The request has carried an array all along.
//
// The trigger word is shown next to every entry because a LoRA whose trigger
// the writer cannot see is a LoRA they will use wrong — the token is what the
// weights were fused onto, and without it in the prompt a correctly loaded LoRA
// does approximately nothing, which reads as "the LoRA is broken".

import { clampLoraWeight, isSdLoraName } from '@/services/aiRuntime/sdServer';
import type { AiLoraSelection } from '@/services/aiRuntime/types';
import type { ResolvedLora } from '@/services/visualRef';
import type { VisualRef } from '@/types/visualRef';

export interface LoraStackEntry {
  /** The name with its extension: what `lora[].path` resolves against. */
  fileName: string;
  /** The stem, which is what the writer recognises. */
  name: string;
  weight: number;
  enabled: boolean;
  /**
   * A reference owns its LoRA — the resolver put it there and the reference
   * editor is where its weight is changed. A manual one belongs to this
   * generation only. Mixing the two silently would let the panel appear to
   * change a character's LoRA weight for good.
   */
  source: 'reference' | 'manual';
  refId?: string;
  refName?: string;
  /** The token the LoRA answers to, when anything knows it. */
  trigger?: string;
}

export const LORA_WEIGHT_MIN = -2;
export const LORA_WEIGHT_MAX = 2;

export function loraStem(fileName: string): string {
  return fileName.replace(/\.(safetensors|ckpt)$/i, '');
}

/**
 * The entries the resolver produced, with each reference's trigger word
 * attached. These are shown at the top of the stack and are not editable here:
 * their weight lives on the reference, where it survives the session.
 */
export function stackFromReferences(
  resolved: readonly ResolvedLora[],
  refs: readonly VisualRef[],
): LoraStackEntry[] {
  return resolved.map((lora) => {
    const ref = refs.find((row) => row.id === lora.refId);
    return {
      fileName: lora.fileName,
      name: loraStem(lora.fileName),
      weight: lora.weight,
      enabled: true,
      source: 'reference' as const,
      refId: lora.refId,
      refName: ref?.name,
      trigger: ref?.triggerWord?.trim() || undefined,
    };
  });
}

/**
 * Reference LoRAs first, then the manual ones, with duplicates dropped.
 *
 * A file loaded twice is not loaded twice as hard: stable-diffusion.cpp applies
 * the last multiplier it reads for a path, so a duplicate silently overrides
 * the reference's weight. Dropping it here keeps the reference in charge of its
 * own character.
 */
export function mergeStack(
  fromReferences: readonly LoraStackEntry[],
  manual: readonly LoraStackEntry[],
): LoraStackEntry[] {
  const seen = new Set(fromReferences.map((entry) => entry.fileName.toLowerCase()));
  const extra = manual.filter((entry) => {
    const key = entry.fileName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...fromReferences, ...extra];
}

/** What goes on the wire: the enabled entries the server can name. */
export function stackToSelections(stack: readonly LoraStackEntry[]): AiLoraSelection[] {
  return stack
    .filter((entry) => entry.enabled && isSdLoraName(entry.name))
    .map((entry) => ({
      name: entry.name,
      fileName: entry.fileName,
      weight: clampLoraWeight(entry.weight),
    }));
}

/**
 * Trigger words that are enabled but missing from the prompt.
 *
 * Not inserted automatically: the resolver already places a reference's trigger
 * first, and a second copy pushed in by this panel would dilute it. This is
 * what the UI warns with.
 */
export function missingTriggers(stack: readonly LoraStackEntry[], prompt: string): string[] {
  const haystack = prompt.toLowerCase();
  return stack
    .filter((entry) => entry.enabled && entry.trigger && !haystack.includes(entry.trigger.toLowerCase()))
    .map((entry) => entry.trigger as string);
}

export function makeManualEntry(fileName: string, weight = 0.8): LoraStackEntry {
  return {
    fileName,
    name: loraStem(fileName),
    weight: clampLoraWeight(weight),
    enabled: true,
    source: 'manual',
  };
}
