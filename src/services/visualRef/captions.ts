// ============================================================================
// Drafting a training caption from what the book already says
// ============================================================================
//
// The counter-intuitive rule every LoRA practitioner converges on: caption what
// you do NOT want baked into the trigger word. Anything named in the caption
// becomes detachable — the model learns "this word means the hat", so the hat
// can be removed later. Anything the caption is SILENT about is absorbed into
// the trigger word itself and comes back in every generation.
//
// So: name the glasses, the hat, the hairstyle, the coat, the pose, the
// background. Say nothing about eye colour, face shape or complexion — those
// are the person, and they are what the trigger word is for.
//
// A writing app has an unfair advantage here, which is the entire reason this
// file exists: the codex entry already describes the character in prose, and
// nobody had to type it twice.

/** Words that mark a clause as describing something detachable. */
const DETACHABLE: Readonly<Record<string, readonly string[]>> = {
  eyewear: ['glasses', 'spectacles', 'sunglasses', 'monocle', 'goggles', 'gafas', 'lentes', 'anteojos', 'monoculo'],
  headwear: ['hat', 'cap', 'hood', 'helmet', 'crown', 'veil', 'headscarf', 'sombrero', 'gorra', 'capucha', 'casco', 'corona', 'velo', 'panuelo'],
  hair: ['ponytail', 'braid', 'braids', 'bun', 'updo', 'fringe', 'bangs', 'short hair', 'long hair', 'coleta', 'trenza', 'trenzas', 'mono', 'flequillo', 'pelo corto', 'pelo largo', 'melena'],
  clothing: ['coat', 'cloak', 'dress', 'gown', 'armour', 'armor', 'uniform', 'shirt', 'jacket', 'robe', 'boots', 'gloves', 'apron', 'scarf', 'abrigo', 'capa', 'vestido', 'armadura', 'uniforme', 'camisa', 'chaqueta', 'tunica', 'botas', 'guantes', 'delantal', 'bufanda'],
  pose: ['standing', 'sitting', 'seated', 'kneeling', 'running', 'walking', 'portrait', 'close-up', 'full body', 'from behind', 'de pie', 'sentada', 'sentado', 'arrodillada', 'corriendo', 'caminando', 'retrato', 'primer plano', 'cuerpo entero', 'de espaldas'],
  background: ['forest', 'city', 'street', 'indoors', 'outdoors', 'night', 'snow', 'rain', 'desert', 'ship', 'tavern', 'bosque', 'ciudad', 'calle', 'interior', 'exterior', 'noche', 'nieve', 'lluvia', 'desierto', 'barco', 'taberna'],
  expression: ['smiling', 'frowning', 'crying', 'laughing', 'shouting', 'sonriendo', 'llorando', 'riendo', 'gritando', 'ceno fruncido'],
};

/**
 * Words that mean the clause is describing the PERSON. A clause containing one
 * of these is dropped from the caption on purpose: captioning her eye colour
 * teaches the model that the eye colour is optional, and the trained character
 * then comes back with different eyes in half the generations.
 */
const FUSED: readonly string[] = [
  'eyes', 'eye colour', 'eye color', 'iris', 'freckles', 'complexion', 'skin', 'jaw', 'jawline',
  'cheekbones', 'nose', 'face shape', 'scar', 'birthmark', 'mole',
  'ojos', 'pecas', 'tez', 'piel', 'mandibula', 'pomulos', 'nariz', 'cicatriz', 'lunar',
];

/** Lower case, accents folded: the form every keyword test is made in. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Split prose into the short phrases a caption is made of. */
function clauses(text: string): string[] {
  return text
    .split(/[.;\n\r,]+/)
    .map((clause) => clause.replace(/\s+/g, ' ').trim())
    .filter((clause) => clause.length >= 3 && clause.length <= 90);
}

function hasAny(folded: string, words: readonly string[]): string | undefined {
  return words.find((word) => folded.includes(word));
}

export interface DraftedCaption {
  /** The caption text, trigger word first. */
  caption: string;
  /** The detachable phrases that were kept, in order. */
  kept: string[];
  /** Words found and deliberately left out, so the UI can say why. */
  omitted: string[];
}

/** How many detachable phrases one caption carries before it stops helping. */
export const MAX_CAPTION_PHRASES = 8;

/**
 * Draft one image's caption from the character's prose. Pure.
 *
 * `trigger` goes first and is never omitted — a caption whose trigger word is
 * buried mid-sentence trains a token the writer then cannot summon.
 */
export function draftCaption(trigger: string, sources: readonly string[]): DraftedCaption {
  const kept: string[] = [];
  const omitted: string[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const clause of clauses(source)) {
      const folded = fold(clause);
      const fused = hasAny(folded, FUSED);
      if (fused) {
        if (!omitted.includes(fused)) omitted.push(fused);
        continue;
      }
      const detachable = Object.values(DETACHABLE).some((words) => hasAny(folded, words) !== undefined);
      if (!detachable) continue;
      const key = folded;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(clause);
      if (kept.length >= MAX_CAPTION_PHRASES) break;
    }
    if (kept.length >= MAX_CAPTION_PHRASES) break;
  }
  const token = trigger.trim();
  return { caption: [token, ...kept].filter(Boolean).join(', '), kept, omitted };
}
