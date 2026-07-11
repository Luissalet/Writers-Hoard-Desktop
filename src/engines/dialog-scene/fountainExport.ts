// ============================================
// Fountain export — plain-text screenplay format
// ============================================
//
// Fountain (https://fountain.io) is the open interchange format every
// screenwriting tool reads (Final Draft, Highland, Slugline, Fade In…).
// This turns the project's scenes + dialog blocks into a valid .fountain
// document:
//
//   • slug          → scene heading (forced with "." when not INT/EXT)
//   • action        → plain paragraph
//   • stage-direction → italicized action (*…*), the theater convention
//   • dialog        → CHARACTER (uppercase) + (parenthetical) + lines;
//                     dual dialogue marks the 2nd speaker with "^"
//   • transition    → forced with "> " (right-aligned in renderers)
//   • note          → [[inline note]] (ignored by formatters)
//   • omitted scenes → "OMITTED" heading, body skipped

import type { Scene, DialogBlock } from './types';
import { stripHtml } from '@/utils/text';

const HEADING_RE = /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[. ]/i;

function sceneHeading(scene: Scene): string {
  const raw = (scene.setting || scene.title || '').trim();
  const upper = raw.toUpperCase();
  const heading = HEADING_RE.test(upper) ? upper : `.${upper || 'SCENE'}`;
  const num = scene.sceneNumber !== undefined ? ` #${scene.sceneNumber}#` : '';
  return `${heading}${num}`;
}

function cleanText(content: string): string {
  // Blocks are stored as plain-ish text/HTML; normalize to plain lines.
  return stripHtml(content).trim();
}

function blockToFountain(block: DialogBlock, isDualSecond: boolean): string {
  const text = cleanText(block.content);
  switch (block.type) {
    case 'slug':
      // Slugs inside a scene act as sub-headings; force with "."
      return text ? `.${text.toUpperCase()}` : '';
    case 'action':
      return text;
    case 'stage-direction':
      return text ? `*${text}*` : '';
    case 'transition': {
      if (!text) return '';
      const upper = text.toUpperCase();
      return upper.endsWith('TO:') ? upper : `> ${upper}`;
    }
    case 'note':
      return text ? `[[${text}]]` : '';
    case 'dialog': {
      if (!text && !block.parenthetical) return '';
      const name = (block.characterName || 'CHARACTER').toUpperCase();
      const lines: string[] = [`${name}${isDualSecond ? ' ^' : ''}`];
      if (block.parenthetical?.trim()) {
        const p = block.parenthetical.trim();
        lines.push(p.startsWith('(') ? p : `(${p})`);
      }
      lines.push(text || ' ');
      return lines.join('\n');
    }
    default:
      return text;
  }
}

export interface FountainExportInput {
  projectTitle: string;
  author?: string;
  scenes: Scene[];
  /** Blocks for ALL exported scenes, any order — grouped internally. */
  blocks: DialogBlock[];
}

export function buildFountain({ projectTitle, author, scenes, blocks }: FountainExportInput): string {
  const bySceneId = new Map<string, DialogBlock[]>();
  for (const b of blocks) {
    const list = bySceneId.get(b.sceneId) ?? [];
    list.push(b);
    bySceneId.set(b.sceneId, list);
  }

  const parts: string[] = [];

  // --- Title page ---
  parts.push(`Title: ${projectTitle}`);
  if (author) parts.push(`Author: ${author}`);
  parts.push(`Draft date: ${new Date().toISOString().slice(0, 10)}`);
  parts.push(''); // blank line ends the title page

  const ordered = [...scenes].sort((a, b) => a.order - b.order);

  for (const scene of ordered) {
    parts.push('');
    parts.push(sceneHeading(scene));

    if (scene.isOmitted) {
      parts.push('');
      parts.push('OMITTED');
      continue;
    }

    if (scene.description?.trim()) {
      parts.push('');
      parts.push(cleanText(scene.description));
    }

    const sceneBlocks = (bySceneId.get(scene.id) ?? []).sort((a, b) => a.order - b.order);
    const seenDualGroups = new Set<string>();

    for (const block of sceneBlocks) {
      let isDualSecond = false;
      if (block.type === 'dialog' && block.dualGroupId) {
        if (seenDualGroups.has(block.dualGroupId)) isDualSecond = true;
        else seenDualGroups.add(block.dualGroupId);
      }
      const rendered = blockToFountain(block, isDualSecond);
      if (!rendered) continue;
      parts.push('');
      parts.push(rendered);
    }
  }

  return parts.join('\n').replace(/\n{4,}/g, '\n\n\n') + '\n';
}
