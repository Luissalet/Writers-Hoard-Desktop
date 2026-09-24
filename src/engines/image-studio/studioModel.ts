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
import { imageCatalogEntry, imageCompanionAsset } from '@/services/aiRuntime/imageCatalog';
import { BUILTIN_SD_ID } from '@/services/aiRuntime/constants';
import { describeResolverModel, type ResolverModel } from '@/services/visualRef';
import { POSE_CONTROLNET_ID } from './studio/controlNet';

/** The families the pose ControlNet the studio installs was trained against. */
const POSE_CONTROLNET_FAMILIES = imageCompanionAsset(POSE_CONTROLNET_ID)?.families ?? [];

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
  /**
   * The route's model list has not arrived yet (`routeModelsPending`), so
   * whether it holds a ControlNet is unknown rather than "no".
   */
  modelsPending?: boolean;
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
  const model = describeResolverModel(descriptor, {
    catalog,
    runtimeLorasSupported: input.runtimeLorasSupported,
    isManagedLocalRuntime: input.route.connectionId === BUILTIN_SD_ID,
    managedControlNetFamilies: POSE_CONTROLNET_FAMILIES,
    cfgOverride: input.cfgOverride,
  });
  // Until the list arrives a pinned pose is KEPT, with no ControlNet named:
  // the studio then waits on `chooseReportedControlNet(undefined)` instead of
  // the resolver dropping the pose as unsupported and Generate running without
  // it. The list decides once it lands, either way.
  return input.modelsPending ? { ...model, supportsControlNet: true, controlNets: undefined } : model;
}

export interface RouteModelsInput {
  route?: AiRouteSelection;
  descriptor?: AiModelDescriptor;
  /** `modelsByConnection[route.connectionId]`, when the store has one. */
  models?: { loading: boolean };
  connectionsLoaded: boolean;
  /** The route's connection is listed and enabled, so its models WILL load. */
  connectionEnabled: boolean;
}

/**
 * Whether a route that answers through its own model list — ComfyUI reports
 * its ControlNets there — is still waiting for that list.
 *
 * The managed local server never is: its ControlNets are companion files read
 * from the runtime status (`chooseControlNet`). A list that loaded without the
 * model, failed, or belongs to a disabled or unknown connection is settled,
 * not pending: waiting on it would block Generate for good.
 */
export function routeModelsPending(input: RouteModelsInput): boolean {
  if (!input.route || input.descriptor || isManagedLocalRoute(input.route)) return false;
  if (input.models) return input.models.loading;
  return !input.connectionsLoaded || input.connectionEnabled;
}

/**
 * Whether the route points at the app's own stable-diffusion.cpp server.
 *
 * The distinction the capability descriptor turns on: a remote
 * `/v1/images/generations` endpoint takes a prompt and a size, so every
 * diffusion knob is decoration against one, and saying "this model runs at a
 * fixed guidance" about it would be a confident wrong answer.
 */
export function isManagedLocalRoute(route?: AiRouteSelection): boolean {
  return route?.connectionId === BUILTIN_SD_ID;
}
