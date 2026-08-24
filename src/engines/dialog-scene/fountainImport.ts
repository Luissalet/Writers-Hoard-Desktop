// ============================================
// Fountain import — plain-text screenplay format
// ============================================
//
// Exact inverse of `fountainExport.ts` where the format allows it, tolerant
// reader of other tools' Fountain where it doesn't. Pure: no Dexie here.
//
// Known, deliberate lossiness (each documented at its branch):
//   • The exporter dot-forces mid-scene `slug` blocks and non-INT/EXT scene
//     headings identically, so the distinction is unrecoverable: EVERY heading
//     (forced or standard) re-imports as a new scene. Nothing maps to `slug`.
//   • `scene.description` is exported as a bare paragraph after the heading —
//     it re-imports as the scene's first action block.
//   • `>centered<` text imports as action (centering is not modeled).
//   • `#sections#` import as note blocks; `=synopses` land in the scene
//     description; boneyards `/* */`, page breaks `===` and the title page are
//     dropped; emphasis and inline `[[notes]]` stay verbatim inside content.
//   • Non-numeric scene numbers ("#A12#") are dropped — `sceneNumber` is a
//     number in the model.

import { ScriptImportError, stripContD, castKeyOf } from './importPersist';
import type { ParsedBlock, ParsedScene, ParsedScript } from './importPersist';

/** Verbatim copy of the exporter's heading test (fountainExport.ts). */
const HEADING_RE = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s]/i;

const TITLE_PAGE_KEY_RE =
  /^(title|credit|authors?|source|draft date|date|contact( info)?|copyright|notes|revision|format|watermark)\s*:/i;

/**
 * Common transitions that don't end in "TO:". Inlined on purpose — importing
 * the autocomplete's suggestion list here would drag UI code into a pure
 * parser.
 */
const KNOWN_TRANSITIONS = new Set([
  'FADE IN:',
  'FADE OUT.',
  'FADE TO BLACK.',
  'IRIS IN:',
  'IRIS OUT.',
  'FREEZE FRAME.',
]);

/** Accent-safe uppercase test (Spanish cues: "MAMÁ", "ÁNGEL"). */
function isUpper(s: string): boolean {
  return s === s.toUpperCase() && /\p{Lu}/u.test(s);
}

export interface FountainImportOptions {
  /** Title for the implicit scene when body text precedes the first heading. */
  preambleTitle: string;
}

export function parseFountain(raw: string, opts: FountainImportOptions): ParsedScript {
  let text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  // Boneyard: /* ... */ is invisible to formatters. An unterminated open
  // truncates to EOF (tolerant of a stray marker).
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const openBoneyard = text.indexOf('/*');
  if (openBoneyard !== -1) text = text.slice(0, openBoneyard);

  const lines = text.split('\n');
  const scenes: ParsedScene[] = [];
  let cur: ParsedScene | null = null;
  let nextDualGroup = 0;

  const scene = (): ParsedScene => {
    if (!cur) {
      cur = { title: opts.preambleTitle, blocks: [] };
      scenes.push(cur);
    }
    return cur;
  };

  const isBlank = (line: string | undefined): boolean => line === undefined || line.trim() === '';

  const pushAction = (t: string): void => {
    if (!t) return;
    const s = scene();
    // Inverse of the exporter's omitted-scene rule: a scene whose first body
    // paragraph is exactly OMITTED was exported as an omitted scene.
    if (s.blocks.length === 0 && !s.description && /^OMITTED$/i.test(t)) {
      s.isOmitted = true;
      return;
    }
    s.blocks.push({ type: 'action', content: t });
  };

  /** Read a paragraph (consecutive non-blank lines) starting at `from`. */
  const readParagraph = (from: number): { text: string; next: number } => {
    const para: string[] = [];
    let j = from;
    while (j < lines.length && !isBlank(lines[j])) {
      para.push(lines[j].trim());
      j++;
    }
    return { text: para.join('\n').trim(), next: j };
  };

  let i = 0;

  // --- Title page: first non-empty line is a known key → skip the block ---
  while (i < lines.length && isBlank(lines[i])) i++;
  if (i < lines.length && TITLE_PAGE_KEY_RE.test(lines[i].trim())) {
    while (i < lines.length && lines[i].trim() !== '') i++; // keys + indented values
  }

  // --- Body ---
  while (i < lines.length) {
    const T = lines[i].trim();

    if (T === '') {
      i++;
      continue;
    }

    // Page break
    if (/^={3,}\s*$/.test(T)) {
      i++;
      continue;
    }

    // Synopsis → scene description
    if (/^=(?!=)/.test(T)) {
      const s = scene();
      const syn = T.slice(1).trim();
      if (syn) s.description = s.description ? `${s.description}\n${syn}` : syn;
      i++;
      continue;
    }

    // Section (# Act One) → note block: structure we can't model, but the
    // author's text stays visible. No clash with `#N#` (heading suffix, never
    // line start).
    if (/^#+(\s|$)/.test(T)) {
      const content = T.replace(/^#+\s*/, '').trim();
      if (content) scene().blocks.push({ type: 'note', content });
      i++;
      continue;
    }

    // Scene heading — forced `.X` (but not `..ellipsis`) or standard INT/EXT
    const forcedHeading = /^\.(?!\.)/.test(T);
    if (forcedHeading || HEADING_RE.test(T)) {
      let headingText = forcedHeading ? T.slice(1).trim() : T;
      let sceneNumber: number | undefined;
      const numMatch = headingText.match(/\s*#([^#]+)#\s*$/);
      if (numMatch) {
        headingText = headingText.slice(0, numMatch.index).trim();
        const numRaw = numMatch[1].trim();
        if (/^\d+$/.test(numRaw)) sceneNumber = parseInt(numRaw, 10);
      }
      // `setting` stays unset on purpose: the exporter reads
      // `setting || title`, so title-only round-trips identically.
      cur = { title: headingText || 'SCENE', sceneNumber, blocks: [] };
      scenes.push(cur);
      i++;
      continue;
    }

    // `>` — centered text (`>x<`) → action; otherwise a forced transition
    if (T.startsWith('>')) {
      if (T.length > 1 && T.endsWith('<')) {
        pushAction(T.slice(1, -1).trim());
      } else {
        const content = T.slice(1).trim();
        if (content) scene().blocks.push({ type: 'transition', content });
      }
      i++;
      continue;
    }

    // Unforced transition: UPPERCASE ending in "TO:", or the known set.
    // Checked BEFORE the cue rule — "CUT TO:" followed by text must not
    // become a character.
    if (isUpper(T) && (T.endsWith('TO:') || KNOWN_TRANSITIONS.has(T))) {
      scene().blocks.push({ type: 'transition', content: T });
      i++;
      continue;
    }

    // Note [[...]] — single or multi-line; EOF closes it tolerantly.
    if (T.startsWith('[[')) {
      const collected: string[] = [];
      let j = i;
      let closedAt = -1;
      while (j < lines.length) {
        const lt = lines[j].trim();
        collected.push(lt);
        if (lt.endsWith(']]')) {
          closedAt = j;
          break;
        }
        j++;
      }
      const content = collected
        .join('\n')
        .replace(/^\[\[/, '')
        .replace(/\]\]$/, '')
        .trim();
      if (content) scene().blocks.push({ type: 'note', content });
      i = closedAt === -1 ? lines.length : closedAt + 1;
      continue;
    }

    // Forced action `!` — bypasses cue detection (the escape hatch for
    // uppercase shouts).
    if (T.startsWith('!')) {
      const { text: rest, next } = readParagraph(i + 1);
      const first = T.slice(1).trim();
      pushAction(rest ? `${first}\n${rest}`.trim() : first);
      i = next;
      continue;
    }

    // Character cue — forced `@` (lowercase allowed) or UPPERCASE line, and
    // the spec's "followed by content" rule: a lone shout before a blank line
    // stays action.
    const forcedCue = T.startsWith('@');
    if ((forcedCue || isUpper(T)) && !isBlank(lines[i + 1])) {
      let cue = forcedCue ? T.slice(1).trim() : T;
      let dual = false;
      if (/\s*\^\s*$/.test(cue)) {
        dual = true;
        cue = cue.replace(/\s*\^\s*$/, '');
      }
      const characterName = stripContD(cue);
      const castKey = castKeyOf(characterName);
      if (castKey) {
        i++;
        let parenthetical: string | undefined;
        const speech: string[] = [];
        while (i < lines.length) {
          const rawLine = lines[i];
          if (rawLine.trim() === '') {
            // Whitespace-only line = Fountain's "two spaces" continuation;
            // a truly empty line ends the speech.
            if (/^\s+$/.test(rawLine)) {
              speech.push('');
              i++;
              continue;
            }
            break;
          }
          const lt = rawLine.trim();
          const parenMatch = lt.match(/^\((.*)\)$/);
          if (parenMatch && speech.length === 0 && parenthetical === undefined) {
            // First pre-text parenthetical becomes the model's ONE field;
            // mid-speech parentheticals survive as content lines.
            parenthetical = parenMatch[1].trim();
          } else {
            speech.push(lt);
          }
          i++;
        }
        const s = scene();
        const block: ParsedBlock = {
          type: 'dialog',
          characterName,
          castKey,
          parenthetical,
          content: speech.join('\n').trim(),
        };
        // `^` pairs with the immediately preceding dialog block. Never groups
        // of 3 — the editor renders pairs and drops extras.
        if (dual) {
          const last = s.blocks[s.blocks.length - 1];
          if (last && last.type === 'dialog' && last.dualGroup === undefined) {
            const g = nextDualGroup++;
            last.dualGroup = g;
            block.dualGroup = g;
          }
        }
        s.blocks.push(block);
        continue;
      }
    }

    // `*...*` — a single-line paragraph fully wrapped in single asterisks is
    // our stage-direction (the exporter's convention). `**bold**` and partial
    // emphasis fail the `[^*]+` test and fall through to action.
    if (T.startsWith('*')) {
      const { text: para, next } = readParagraph(i);
      const paraLines = para.split('\n');
      if (paraLines.length === 1 && /^\*[^*]+\*$/.test(paraLines[0])) {
        scene().blocks.push({ type: 'stage-direction', content: paraLines[0].slice(1, -1).trim() });
      } else {
        pushAction(para);
      }
      i = next;
      continue;
    }

    // Everything else: a plain paragraph → action (lyrics `~`, emphasis-bearing
    // text, and any unrecognized construct survive verbatim).
    {
      const { text: para, next } = readParagraph(i);
      pushAction(para);
      i = next;
      continue;
    }
  }

  if (scenes.length === 0) throw new ScriptImportError('empty');
  return { scenes };
}
