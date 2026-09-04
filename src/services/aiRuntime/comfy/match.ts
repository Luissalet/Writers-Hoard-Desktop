// ============================================================================
// ComfyUI — naming a model the server does not have
// ============================================================================
//
// A recipe carries the checkpoint or LoRA the writer chose on the machine that
// made it. On another install the file may sit in a subfolder, carry a
// different extension or be absent. Substituting silently is the one thing
// that must not happen: a picture generated with a different model is not the
// picture the recipe describes. So the caller is told which name is missing
// and what the nearest installed file is, and chooses.

function normalise(name: string): string {
  return name.toLowerCase().replace(/\\/g, '/').replace(/\.(safetensors|ckpt|pt|pth|sft|bin)$/i, '');
}

function stem(name: string): string {
  const path = normalise(name);
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

function tokens(name: string): string[] {
  return stem(name).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Exact match first, then same file name in another folder, then token overlap. */
export function resolveModelName(wanted: string, installed: readonly string[]): { exact: string | null; nearest: string | null } {
  if (installed.includes(wanted)) return { exact: wanted, nearest: wanted };
  const sameStem = installed.find((candidate) => stem(candidate) === stem(wanted));
  if (sameStem) return { exact: null, nearest: sameStem };
  const wantedTokens = new Set(tokens(wanted));
  let best: string | null = null;
  let bestScore = 0;
  for (const candidate of installed) {
    const candidateTokens = tokens(candidate);
    if (candidateTokens.length === 0) continue;
    let shared = 0;
    for (const token of candidateTokens) if (wantedTokens.has(token)) shared += 1;
    const score = shared / Math.max(wantedTokens.size, candidateTokens.length);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  // Below a third of the tokens in common the "nearest" file is noise, and
  // offering noise as a substitute is how a recipe quietly renders wrong.
  return { exact: null, nearest: bestScore >= 0.34 ? best : null };
}

export function missingModelMessage(kind: string, wanted: string, installed: readonly string[]): string {
  const { nearest } = resolveModelName(wanted, installed);
  const head = `This ComfyUI has no ${kind} called "${wanted}".`;
  if (nearest) return `${head} The nearest one installed there is "${nearest}".`;
  if (installed.length === 0) return `${head} Its ${kind} folder is empty.`;
  return `${head} Nothing installed there resembles it.`;
}

/** First installed name matching a pattern — how a detail stage finds its detector. */
export function firstMatching(installed: readonly string[], pattern: RegExp): string | null {
  return installed.find((candidate) => pattern.test(candidate)) ?? null;
}
