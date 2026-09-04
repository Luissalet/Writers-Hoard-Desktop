// ============================================================================
// From the runtime's answer to the resolver's question
// ============================================================================
//
// The resolver is pure and knows nothing about connections, servers or
// downloaded weights. This is the one place that reads the runtime and turns it
// into the small factual object the resolver takes — and, just as importantly,
// into the REASONS the composer shows next to every control it has to disable.
//
// A feature that cannot run must be visible and disabled with a reason. Hiding
// it teaches the writer that the feature does not exist, and then they go
// looking for another program.

import type { AiModelDescriptor, AiRouteSelection } from '@/services/aiRuntime/types';
import { imageCatalogEntry } from '@/services/aiRuntime/imageCatalog';
import { BUILTIN_SD_ID } from '@/services/aiRuntime/constants';
import { describeResolverModel, type ResolverModel } from '@/services/visualRef';

/** Why one control is unavailable. `reasonKey` is a locale key, never a sentence. */
export interface Availability {
  enabled: boolean;
  reasonKey?: string;
}

export const AVAILABLE: Availability = { enabled: true };

export function blocked(reasonKey: string): Availability {
  return { enabled: false, reasonKey };
}

export interface StudioModelInput {
  route?: AiRouteSelection;
  descriptor?: AiModelDescriptor;
  /** The managed local server's LoRA answer, when the route points at it. */
  runtimeLorasSupported?: boolean;
  /** Guidance the writer set by hand in the parameters column. */
  cfgOverride?: number;
}

/**
 * The chosen model as the resolver sees it, or `null` when nothing is chosen.
 * `null` is the state the studio opens in for a writer with no image backend
 * installed — the state the reference has to be worth building in anyway.
 */
export function studioResolverModel(input: StudioModelInput): ResolverModel | null {
  if (!input.route) return null;
  const catalog = imageCatalogEntry(input.route.modelId);
  const descriptor = input.descriptor ?? {
    connectionId: input.route.connectionId,
    id: input.route.modelId,
    type: 'image' as const,
    capabilities: [],
    family: catalog?.family,
  };
  return describeResolverModel(descriptor, {
    catalog,
    runtimeLorasSupported: input.runtimeLorasSupported,
    isManagedLocalRuntime: input.route.connectionId === BUILTIN_SD_ID,
    cfgOverride: input.cfgOverride,
  });
}

/**
 * Which parameter fields the chosen model can honour.
 *
 * The existing studio already hides the cfg slider for FLUX; this generalises
 * that instinct instead of special-casing the next family by hand. A field that
 * is shown and does nothing is worse than no field: the writer turns it, sees
 * no change, and concludes the whole panel is decorative.
 */
export interface ParameterVisibility {
  cfg: boolean;
  sampler: boolean;
  scheduler: boolean;
  steps: boolean;
  seed: boolean;
}

/** Which resolved fields the request can actually carry (see `operations.ts`). */
export interface RequestSupport {
  sampler: boolean;
  scheduler: boolean;
}

export function parameterVisibility(
  model: ResolverModel | null,
  supports: RequestSupport,
): ParameterVisibility {
  if (!model) {
    return { cfg: false, sampler: false, scheduler: false, steps: false, seed: false };
  }
  const guided = model.cfg === undefined || model.cfg > 1;
  return {
    // A distilled model runs at a fixed guidance; the slider would be a lie.
    // The negative prompt follows the same rule, but it is not decided here:
    // it belongs to the reference, and the resolver refuses it out loud in the
    // disclosure so the writer sees WHICH model dropped it and why.
    cfg: guided,
    // Samplers and schedulers are a local-diffusion concept, AND the request
    // has to be able to carry them. Both halves matter: the second is why the
    // knobs are refused today rather than turned into a value the gateway drops.
    sampler: supports.sampler && (model.supportsLora || model.supportsInitImage),
    scheduler: supports.scheduler && (model.family === 'sdxl' || model.family === 'sd1'),
    steps: true,
    seed: true,
  };
}
