// ============================================
// AI bridge — a text effect on a phrase of a chapter
// ============================================
// As the editor's "Efecto de texto": wraps the n-th occurrence of an exact
// phrase (within one run of text) in a glow, shake, wave, rainbow, pulse or
// blur effect, or takes the effect off it with effect null.

import { TEXT_EFFECTS } from '@/components/editor/blocks/extensions';
import { BridgeError } from './bridgeError';
import { assertEngineEnabled, assertRowInScope, optNumber, optString, requireString, type ToolArgs } from './shared';
import { mustGetWriting, replaceWritingHtml } from './writings';

export async function whTextEffect(args: ToolArgs): Promise<unknown> {
  const writing = await mustGetWriting(requireString(args, 'writingId'), args);
  assertRowInScope(args, writing.projectId);
  await assertEngineEnabled(writing.projectId, 'writings');
  const phrase = requireString(args, 'text');
  const effect = args.effect === null ? null : optString(args, 'effect');
  if (effect !== null && !(TEXT_EFFECTS as readonly string[]).includes(effect ?? '')) throw new BridgeError('bad-args', `effect is one of ${TEXT_EFFECTS.join(', ')}, or null to remove it.`);
  const occurrence = optNumber(args, 'occurrence') ?? 1;
  if (!Number.isInteger(occurrence) || occurrence < 1) throw new BridgeError('bad-args', 'occurrence counts from 1.');
  const body = new DOMParser().parseFromString(writing.content ?? '', 'text/html').body;
  if (effect === null) {
    const spans = [...body.querySelectorAll('span[data-wh-effect]')].filter(span => span.textContent === phrase);
    const span = spans[occurrence - 1];
    if (!span) throw new BridgeError('not-found', `No effect on "${phrase}" (occurrence ${occurrence}).`);
    span.replaceWith(...span.childNodes);
  } else {
    const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let seen = 0, done = false;
    for (let node = walker.nextNode() as Text | null; node && !done; node = walker.nextNode() as Text | null) {
      let from = 0;
      for (let at = node.data.indexOf(phrase, from); at >= 0; at = node.data.indexOf(phrase, from)) {
        if (++seen === occurrence) {
          const target = node.splitText(at);
          target.splitText(phrase.length);
          const span = body.ownerDocument.createElement('span');
          span.setAttribute('data-wh-effect', effect!);
          span.className = `wh-effect wh-effect-${effect}`;
          target.replaceWith(span);
          span.appendChild(target);
          done = true;
          break;
        }
        from = at + phrase.length;
      }
    }
    if (!done) throw new BridgeError('not-found', `"${phrase}" occurs ${seen} time(s) within single runs of text in "${writing.title}".`);
  }
  const written = await replaceWritingHtml(args, writing, body.innerHTML, effect ? `set the ${effect} effect on "${phrase}" in "${writing.title}"` : `removed the effect from "${phrase}" in "${writing.title}"`) as Record<string, unknown>;
  return { ...written, effect, text: phrase, occurrence };
}
