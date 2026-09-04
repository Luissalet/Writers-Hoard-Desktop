// ============================================================================
// What the chosen model can actually honour
// ============================================================================
//
// The resolver must never assume a capability. A LoRA offered against a model
// that cannot load one, a negative prompt shown next to a distilled model that
// ignores it, a ControlNet slot on a server with no ControlNet — each of those
// teaches the writer something false about the tool, and a false model of the
// tool is worse than a missing feature.
//
// So capabilities are DETECTED, once, here, and the resolver is handed the
// answer. Some of them can be detected today; others are waiting on fields the
// AI-runtime branch is adding. Every one of those is read as optional, so this
// file compiles against today's types and simply says `true` more often once
// the wider shapes land.

import type { AiCapability, AiModelDescriptor } from '@/services/aiRuntime/types';
import type { ImageCatalogModel } from '@/services/aiRuntime/imageCatalog';
import type { PromptDialect } from '@/types/visualRef';
import { dialectForFamily } from './dialect';

/**
 * Capabilities the AI-runtime branch is expected to report, none of which
 * exist yet. Declared as optional here rather than waited for: the resolver
 * needs to be written and tested now, and every one of these reads `false`
 * until the day the runtime starts answering.
 */
interface WidenedModelDescriptor {
  /** Reference/identity adapters the server can run for this model. */
  identityAdapters?: string[];
  /** ControlNet preprocessors the server has weights for. */
  controlNets?: string[];
  /** LoRA loading, reported per model rather than per server. */
  lorasSupported?: boolean;
  /** Guidance the model is actually run at; a distilled model reports 1. */
  cfg?: number;
  /** The weights' content hash, so a stored recipe can tell that they changed. */
  fileHash?: string;
}

/** Everything the resolver is allowed to know about the destination model. */
export interface ResolverModel {
  connectionId: string;
  modelId: string;
  /** 'sd1' | 'sdxl' | 'flux' | whatever a server reports. Drives LoRA matching. */
  family?: string;
  /** The dialect this base reads; fragments are adapted into it. */
  dialect: PromptDialect;
  /**
   * The guidance the generation will run at. `undefined` means nobody knows,
   * which is treated as "negatives are honoured" — a remote API almost always
   * does, and the alternative is silently dropping the writer's negative text.
   */
  cfg?: number;
  /** Can load LoRA files. Only the managed local server does today. */
  supportsLora: boolean;
  /** Takes an input image as an instruction subject ("the person in image 1"). */
  supportsReferenceImages: boolean;
  /** Has a PhotoMaker-style face adapter. */
  supportsPhotoMaker: boolean;
  /** Has ControlNet weights for a pose. */
  supportsControlNet: boolean;
  /** img2img denoise, which is not identity but is worth not confusing with it. */
  supportsInitImage: boolean;
  fileHash?: string;
}

export interface DescribeModelOptions {
  /** The curated catalogue entry, when this is a model the app downloaded. */
  catalog?: Pick<ImageCatalogModel, 'family' | 'defaults'>;
  /** The managed local server's LoRA answer: `false` only once it has refused. */
  runtimeLorasSupported?: boolean;
  /** True when the route points at the app's own image server. */
  isManagedLocalRuntime?: boolean;
  /** Guidance the user set by hand, which beats every default. */
  cfgOverride?: number;
}

function has(capabilities: readonly AiCapability[] | undefined, wanted: AiCapability): boolean {
  return Array.isArray(capabilities) && capabilities.includes(wanted);
}

/**
 * Fold a model descriptor, the catalogue and the runtime's own report into the
 * one shape the resolver reads. Pure: everything it needs is an argument.
 */
export function describeResolverModel(
  descriptor: Pick<AiModelDescriptor, 'connectionId' | 'id' | 'family' | 'capabilities'>,
  options: DescribeModelOptions = {},
): ResolverModel {
  const widened = descriptor as typeof descriptor & Partial<WidenedModelDescriptor>;
  const family = descriptor.family ?? options.catalog?.family;
  const cfg = options.cfgOverride
    ?? (typeof widened.cfg === 'number' ? widened.cfg : undefined)
    ?? options.catalog?.defaults.cfg;
  const identityAdapters = Array.isArray(widened.identityAdapters) ? widened.identityAdapters : [];
  const controlNets = Array.isArray(widened.controlNets) ? widened.controlNets : [];
  // A managed local model can load LoRA files unless this runtime build has
  // been seen to refuse the folder flag; a remote endpoint never can.
  const supportsLora = options.isManagedLocalRuntime === true
    ? (widened.lorasSupported ?? options.runtimeLorasSupported ?? true)
    : false;
  return {
    connectionId: descriptor.connectionId,
    modelId: descriptor.id,
    family,
    dialect: dialectForFamily(family),
    cfg,
    supportsLora,
    supportsReferenceImages: has(descriptor.capabilities, 'image-editing'),
    supportsPhotoMaker: identityAdapters.some((name) => name.toLowerCase().includes('photomaker')),
    supportsControlNet: controlNets.length > 0,
    // Classic denoise-strength img2img is an SD thing; FLUX does not do it.
    supportsInitImage: family === 'sd1' || family === 'sdxl',
    fileHash: typeof widened.fileHash === 'string' ? widened.fileHash : undefined,
  };
}

/**
 * A model that exists only as a name — what a stored recipe leaves behind when
 * its weights have been deleted. The resolver can still run against it; the UI
 * is what must say the model is gone rather than quietly picking another.
 */
export function absentResolverModel(connectionId: string, modelId: string): ResolverModel {
  return {
    connectionId,
    modelId,
    dialect: 'prose',
    supportsLora: false,
    supportsReferenceImages: false,
    supportsPhotoMaker: false,
    supportsControlNet: false,
    supportsInitImage: false,
  };
}
