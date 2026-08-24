// ============================================
// AI text hygiene — model-output sanitizing + JSON extraction
// ============================================
//
// Pure, dependency-free, unit-tested in tests/critical.browser.ts.
//
// Local thinking-family models (Qwen3.5 & co.) can leak `<think>…</think>`
// blocks, prose preambles ("Claro, aquí tienes el JSON:") or markdown fences
// around what should be raw JSON. The old inline parsing in aiFeatures.ts
// only stripped fences, so anything else surfaced as a SyntaxError disguised
// as "unexpected format". These two helpers centralize the cleanup for BOTH
// providers — harmless for Claude, load-bearing for local models.

/**
 * Remove reasoning blocks from a model reply.
 *
 * Handles the three shapes seen in the wild: properly paired
 * `<think>…</think>` blocks, an UNCLOSED `<think>` (generation truncated
 * mid-reasoning — keep only what came before), and an ORPHAN `</think>`
 * (the model skipped the opener — keep only what comes after).
 */
export function sanitizeModelText(raw: string): string {
  let s = raw.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '');

  const openMatch = s.match(/<think\b/i);
  if (openMatch && openMatch.index !== undefined) {
    s = s.slice(0, openMatch.index);
  } else {
    const closeIdx = s.toLowerCase().lastIndexOf('</think>');
    if (closeIdx !== -1) {
      s = s.slice(closeIdx + '</think>'.length);
    }
  }

  return s.trim();
}

/**
 * Parse the JSON a model was ASKED to return, tolerating how models actually
 * answer. Candidates tried in order:
 *
 *   1. the first fenced ``` block's content,
 *   2. the sanitized text as-is,
 *   3. the slice from the first `[`/`{` to the matching last `]`/`}` —
 *      handles preambles and trailing sign-offs.
 *
 * Throws a SyntaxError when nothing parses, ON PURPOSE: safeAiCall already
 * maps SyntaxError to t('ai.unexpectedFormat').
 */
export function parseJsonFromModel<T>(raw: string): T {
  const base = sanitizeModelText(raw);

  const candidates: string[] = [];
  const fence = base.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1]);
  candidates.push(base);

  const firstArray = base.indexOf('[');
  const firstObject = base.indexOf('{');
  const starts = [firstArray, firstObject].filter((i) => i !== -1).sort((a, b) => a - b);
  if (starts.length > 0) {
    const start = starts[0];
    const closer = base[start] === '[' ? ']' : '}';
    const end = base.lastIndexOf(closer);
    if (end > start) candidates.push(base.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    const text = candidate.trim();
    if (!text) continue;
    try {
      return JSON.parse(text) as T;
    } catch {
      /* try the next shape */
    }
  }
  throw new SyntaxError('model output is not valid JSON');
}
