// ============================================================================
// Resolution buckets — the sizes the weights were actually trained at
// ============================================================================
//
// Most «why does this look wrong» is an off-bucket size. A model trained on
// 1024-area buckets asked for 900×700 produces the duplicated heads, the
// stretched torsos and the mushy edges that a writer will read as "this model
// is bad". A free width/height box invites exactly that, so the picker offers
// the trained buckets first and NAMES an off-bucket size as one rather than
// quietly generating it.
//
// Every number is a multiple of 64: the latent grid is the image divided by
// eight, and anything else the server rounds on its own terms.

export interface ResolutionBucket {
  id: string;
  width: number;
  height: number;
  /** "3:2", "16:9" — a numeral, the same in every language, so not a locale key. */
  ratio: string;
}

function bucket(width: number, height: number, ratio: string): ResolutionBucket {
  return { id: `${width}x${height}`, width, height, ratio };
}

/** SD 1.x: a 512-area family. Above about 768 it starts duplicating subjects. */
const SD1_BUCKETS: readonly ResolutionBucket[] = [
  bucket(512, 512, '1:1'),
  bucket(512, 768, '2:3'),
  bucket(768, 512, '3:2'),
  bucket(576, 832, '9:13'),
  bucket(832, 576, '13:9'),
  bucket(640, 640, '1:1'),
];

/** The SDXL training buckets, as published. Everything is ~1 megapixel. */
const SDXL_BUCKETS: readonly ResolutionBucket[] = [
  bucket(1024, 1024, '1:1'),
  bucket(1152, 896, '4:3'),
  bucket(896, 1152, '3:4'),
  bucket(1216, 832, '3:2'),
  bucket(832, 1216, '2:3'),
  bucket(1344, 768, '16:9'),
  bucket(768, 1344, '9:16'),
  bucket(1536, 640, '21:9'),
  bucket(640, 1536, '9:21'),
];

/** Flux is trained around 1024 and tolerates more, but the 1-Mpx set is home. */
const FLUX_BUCKETS: readonly ResolutionBucket[] = [
  bucket(1024, 1024, '1:1'),
  bucket(1152, 896, '4:3'),
  bucket(896, 1152, '3:4'),
  bucket(1216, 832, '3:2'),
  bucket(832, 1216, '2:3'),
  bucket(1344, 768, '16:9'),
  bucket(768, 1344, '9:16'),
];

/** With no family reported, offer the 1-Mpx set and say nothing about training. */
const GENERIC_BUCKETS: readonly ResolutionBucket[] = FLUX_BUCKETS;

export function bucketsForFamily(family: string | undefined): readonly ResolutionBucket[] {
  if (family === 'sd1') return SD1_BUCKETS;
  if (family === 'sdxl') return SDXL_BUCKETS;
  if (family === 'flux') return FLUX_BUCKETS;
  return GENERIC_BUCKETS;
}

export function findBucket(family: string | undefined, width: number, height: number): ResolutionBucket | undefined {
  return bucketsForFamily(family).find((entry) => entry.width === width && entry.height === height);
}

/**
 * Whether a size is off-bucket for this family. Only meaningful when the family
 * is known: calling an unknown model's size "off-bucket" is a guess dressed as
 * a warning, and the writer cannot act on it.
 */
export function isOffBucket(family: string | undefined, width: number, height: number): boolean {
  if (!family) return false;
  return findBucket(family, width, height) === undefined;
}

/** The bucket a family opens on — square, the safest thing to be wrong about. */
export function defaultBucket(family: string | undefined): ResolutionBucket {
  return bucketsForFamily(family)[0];
}
