// ============================================================================
// ComfyUI — which pack provides which node class
// ============================================================================
//
// A missing node class must never reach the user as a raw class name. Every
// class a shipped template needs that is NOT part of ComfyUI itself is listed
// here with the pack that provides it, so a capability check can say "Detail
// pass needs ComfyUI-Impact-Pack and ComfyUI-Impact-Subpack" instead of
// "UltralyticsDetectorProvider".

export interface ComfyNodePack {
  pack: string;
  url: string;
}

const PACK_BY_CLASS: Record<string, ComfyNodePack> = {
  UltimateSDUpscale: {
    pack: 'ComfyUI_UltimateSDUpscale',
    url: 'https://github.com/ssitu/ComfyUI_UltimateSDUpscale',
  },
  FaceDetailer: {
    pack: 'ComfyUI-Impact-Pack',
    url: 'https://github.com/ltdrdata/ComfyUI-Impact-Pack',
  },
  SAMLoader: {
    pack: 'ComfyUI-Impact-Pack',
    url: 'https://github.com/ltdrdata/ComfyUI-Impact-Pack',
  },
  UltralyticsDetectorProvider: {
    pack: 'ComfyUI-Impact-Subpack',
    url: 'https://github.com/ltdrdata/ComfyUI-Impact-Subpack',
  },
};

export function packForClass(className: string): ComfyNodePack | null {
  return PACK_BY_CLASS[className] ?? null;
}

/** Distinct pack names for a set of missing classes, in a stable order. */
export function packsForClasses(classNames: readonly string[]): ComfyNodePack[] {
  const seen = new Map<string, ComfyNodePack>();
  for (const name of classNames) {
    const pack = packForClass(name);
    if (pack && !seen.has(pack.pack)) seen.set(pack.pack, pack);
  }
  return [...seen.values()];
}

/** English list: "a", "a and b", "a, b and c". */
export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
