// Human geography — background worker
// ============================================
// `requestIdleCallback` still runs on the UI thread. The full pass takes more
// than thirteen seconds on a 2048×1024 world, so this worker is the difference
// between an idle callback and an actually responsive map.

import {
  buildHumanGeography,
  type GeoDepth,
  type HumanGeography,
  type HumanGeographyParams,
} from './core/settlements';
import type { WorldData } from './core/types';

export interface GeographyWorkerRequest {
  type: 'build';
  requestId: number;
  world: WorldData;
  depth: GeoDepth;
  params: HumanGeographyParams;
}

/** `LanguageFamily` deliberately carries orthography functions and a Map.
 * They are deterministic from seed but cannot cross structured clone. */
export type TransferableHumanGeography = Omit<HumanGeography, 'languages'>;

export type GeographyWorkerReply =
  | {
    type: 'done'; requestId: number;
    geography: TransferableHumanGeography | HumanGeography;
    languageCount?: number;
  }
  | { type: 'error'; requestId: number; message: string };

const ctx = self as unknown as {
  postMessage(message: GeographyWorkerReply, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<GeographyWorkerRequest>) => void) | null;
};

ctx.onmessage = (event) => {
  const request = event.data;
  if (request.type !== 'build') return;
  try {
    // Build the immutable base. Reader corrections are patched on the main
    // thread at adoption time, against the still-current world revision.
    const geography = buildHumanGeography(request.world, request.params, request.depth, false);
    // Languages have executable orthography rules. Rebuilding those tiny,
    // deterministic objects on the receiver is both cheaper and safer than a
    // bespoke function serializer; everything expensive stays in this worker.
    const { languages, ...transferable } = geography;
    ctx.postMessage(
      {
        type: 'done', requestId: request.requestId,
        geography: transferable,
        languageCount: languages.living.length,
      },
      [geography.realmOf.buffer],
    );
  } catch (error) {
    ctx.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
