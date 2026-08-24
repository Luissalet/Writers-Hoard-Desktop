// ============================================
// FDX import — Final Draft XML
// ============================================
//
// Zero-dependency: DOMParser with 'application/xml' (same tool the Google
// Docs cleaner and the page capture already use for HTML). Pure: no Dexie.
//
// Mapping to our six block types:
//
//   Scene Heading → new scene (Number attr → sceneNumber when numeric)
//   Action        → action        General / unknown types → action (verbatim)
//   Character     → pending cue   (dual via container OR attribute, see below)
//   Parenthetical → the dialog's one parenthetical field when it precedes the
//                   speech; later ones survive as "(x)" lines in the content
//   Dialogue      → dialog block (consecutive Dialogue paragraphs merge —
//                   Final Draft splits long speeches)
//   Transition    → transition
//   Shot          → slug (FD's sub-scene heading — the only slug producer)
//   Cast List     → note (metadata, kept visible)
//   <TitlePage>   → skipped (it nests its OWN <Content>; only the direct
//                   child of <FinalDraft> is walked)
//
// Dual dialogue varies by FD version: a <DualDialogue> container wrapping the
// paragraph pairs (fully supported — first two dialog blocks pair) or a
// DualDialogue attribute on the Character paragraph (best-effort: any value
// not looking like "first"/"left" pairs with the preceding dialog block).
// Omitted scenes also vary; an Omitted="Yes" attribute probe plus the shared
// OMITTED-body rule cover the known forms — worst case an omitted scene
// imports visibly with an "OMITTED" action block, never destructively.

import { ScriptImportError, stripContD, castKeyOf } from './importPersist';
import type { ParsedBlock, ParsedScene, ParsedScript } from './importPersist';

export interface FdxImportOptions {
  /** Title for the implicit scene when content precedes the first heading. */
  preambleTitle: string;
}

export function parseFdx(xml: string, opts: FdxImportOptions): ParsedScript {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new ScriptImportError('invalid-xml');
  }
  const root = doc.documentElement;
  if (root.nodeName !== 'FinalDraft') throw new ScriptImportError('invalid-fdx');
  const content = Array.from(root.children).find((el) => el.nodeName === 'Content');
  if (!content) throw new ScriptImportError('invalid-fdx');

  const scenes: ParsedScene[] = [];
  let cur: ParsedScene | null = null;
  let nextDualGroup = 0;
  let pendingCue: { name: string; castKey: string; dualSecond: boolean } | null = null;
  let pendingParen: string | undefined;
  let lastDialog: ParsedBlock | null = null;

  const scene = (): ParsedScene => {
    if (!cur) {
      cur = { title: opts.preambleTitle, blocks: [] };
      scenes.push(cur);
    }
    return cur;
  };

  /** Only <Text> element children — <ScriptNote> etc. are skipped for free. */
  const paraText = (p: Element): string =>
    Array.from(p.children)
      .filter((c) => c.nodeName === 'Text')
      .map((c) => c.textContent ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();

  const pushAction = (text: string): void => {
    if (!text) return;
    const s = scene();
    if (s.blocks.length === 0 && !s.description && /^OMITTED$/i.test(text)) {
      s.isOmitted = true;
      return;
    }
    s.blocks.push({ type: 'action', content: text });
  };

  const flushCue = (): void => {
    pendingCue = null;
    pendingParen = undefined;
  };

  const handleParagraph = (p: Element, inDualContainer: boolean): void => {
    const type = p.getAttribute('Type') ?? 'Action';
    const text = paraText(p);

    switch (type) {
      case 'Scene Heading': {
        flushCue();
        lastDialog = null;
        let sceneNumber: number | undefined;
        const numAttr = p.getAttribute('Number');
        if (numAttr && /^\d+$/.test(numAttr.trim())) sceneNumber = parseInt(numAttr.trim(), 10);
        cur = { title: text || 'SCENE', sceneNumber, blocks: [] };
        if ((p.getAttribute('Omitted') ?? '').toLowerCase() === 'yes') cur.isOmitted = true;
        scenes.push(cur);
        break;
      }
      case 'Character': {
        lastDialog = null;
        let cue = text;
        let dualSecond = false;
        if (/\s*\^\s*$/.test(cue)) {
          dualSecond = true;
          cue = cue.replace(/\s*\^\s*$/, '');
        }
        const dualAttr = p.getAttribute('DualDialogue');
        if (!inDualContainer && dualAttr && !/first|left/i.test(dualAttr)) dualSecond = true;
        const characterName = stripContD(cue);
        const castKey = castKeyOf(characterName);
        if (castKey) {
          pendingCue = { name: characterName, castKey, dualSecond };
          pendingParen = undefined;
        }
        break;
      }
      case 'Parenthetical': {
        const inner = (text.match(/^\((.*)\)$/)?.[1] ?? text).trim();
        if (!inner) break;
        if (pendingCue && pendingParen === undefined && !lastDialog) {
          pendingParen = inner;
        } else if (lastDialog) {
          lastDialog.content = lastDialog.content ? `${lastDialog.content}\n(${inner})` : `(${inner})`;
        }
        break;
      }
      case 'Dialogue': {
        if (pendingCue) {
          const s = scene();
          const block: ParsedBlock = {
            type: 'dialog',
            characterName: pendingCue.name,
            castKey: pendingCue.castKey,
            parenthetical: pendingParen,
            content: text,
          };
          if (pendingCue.dualSecond) {
            const last = s.blocks[s.blocks.length - 1];
            if (last && last.type === 'dialog' && last.dualGroup === undefined) {
              const g = nextDualGroup++;
              last.dualGroup = g;
              block.dualGroup = g;
            }
          }
          s.blocks.push(block);
          lastDialog = block;
          flushCue();
        } else if (lastDialog) {
          lastDialog.content = lastDialog.content ? `${lastDialog.content}\n${text}` : text;
        } else {
          pushAction(text);
        }
        break;
      }
      case 'Transition': {
        flushCue();
        lastDialog = null;
        if (text) scene().blocks.push({ type: 'transition', content: text });
        break;
      }
      case 'Shot': {
        flushCue();
        lastDialog = null;
        if (text) scene().blocks.push({ type: 'slug', content: text });
        break;
      }
      case 'Cast List': {
        flushCue();
        lastDialog = null;
        if (text) scene().blocks.push({ type: 'note', content: text });
        break;
      }
      default: {
        // Action, General, New Act, Teaser… — verbatim fallback.
        flushCue();
        lastDialog = null;
        pushAction(text);
        break;
      }
    }
  };

  for (const el of Array.from(content.children)) {
    if (el.nodeName === 'Paragraph') {
      handleParagraph(el, false);
    } else if (el.nodeName === 'DualDialogue') {
      const s = scene();
      const startIdx = s.blocks.length;
      for (const p of Array.from(el.children)) {
        if (p.nodeName === 'Paragraph') handleParagraph(p, true);
      }
      const emitted = s.blocks.slice(startIdx).filter((b) => b.type === 'dialog');
      if (
        emitted.length >= 2 &&
        emitted[0].dualGroup === undefined &&
        emitted[1].dualGroup === undefined
      ) {
        const g = nextDualGroup++;
        emitted[0].dualGroup = g;
        emitted[1].dualGroup = g;
      }
      flushCue();
      lastDialog = null;
    }
  }

  if (scenes.length === 0) throw new ScriptImportError('empty');
  return { scenes };
}
