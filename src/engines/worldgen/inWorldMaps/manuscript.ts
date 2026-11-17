import { notifyDataChanged } from '@/engines/_shared/dataChanged';
import { assertEngineEnabled, assertRowInScope, BridgeError, type ToolArgs, withAudit } from '@/services/aiBridge/tools/shared';
import { mustGetWriting, replaceWritingHtml } from '@/services/aiBridge/tools/writings';
import { rasterizePlate } from './export';
import { escapePlateText } from './plate';

async function imageStamp(source: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}

function pngTags(content: string) {
  return [...content.matchAll(/<img\s[^>]*\ssrc=(?:"(data:image\/png;base64,[a-z\d+/=]+)"|'(data:image\/png;base64,[a-z\d+/=]+)')[^>]*>|<img src="(data:image\/png;base64,[a-z\d+/=]+)"[^>]*>/gi)]
    .map(match => ({ tag: match[0], source: match[1] ?? match[2] ?? match[3], index: match.index }));
}

export async function insertMapPlate(
  args: ToolArgs, projectId: string, writingId: string, title: string, plate: { svg: string; height: number },
) {
  const writing = await mustGetWriting(writingId, args);
  assertRowInScope(args, writing.projectId);
  if (writing.projectId !== projectId || writing.isGoogleDoc || writing.manuscriptSource) {
    throw new BridgeError('bad-args', 'Choose a local chapter of this project.');
  }
  await assertEngineEnabled(projectId, 'writings');
  const canvas = await rasterizePlate(plate.svg, plate.height, 1300);
  const source = canvas.toDataURL('image/png');
  const content = writing.content ?? '';
  if (pngTags(content).some(tag => tag.source === source)) return { id: writing.id, inserted: false };
  const image = '<img src="' + source + '" alt="' + escapePlateText(title) + '" title="' + escapePlateText(title) + '">';
  const stamp = await imageStamp(source);
  await replaceWritingHtml(args, writing, image + content, 'inserted a map plate');
  notifyDataChanged({ source: 'other', table: 'writings', projectId, entityId: writing.id });
  return withAudit({ id: writing.id, inserted: true }, {
    projectId, entityId: writing.id, table: 'writings', kind: 'update',
    summary: 'inserted a map plate in "' + writing.title + '"', before: { __inWorldMapPlate: stamp },
  });
}

export async function revertMapPlate(args: ToolArgs, projectId: string, writingId: string, stamp: string) {
  const writing = await mustGetWriting(writingId, args);
  if (writing.projectId !== projectId) throw new BridgeError('cannot-undo', 'The chapter belongs to a different project.');
  const content = writing.content ?? '';
  const matches = await Promise.all(pngTags(content).map(async tag => await imageStamp(tag.source) === stamp ? tag : null));
  const found = matches.filter(tag => tag !== null);
  if (found.length !== 1) throw new BridgeError('cannot-undo', 'The inserted map was removed, changed or duplicated.');
  const tag = found[0];
  await replaceWritingHtml(args, writing, content.slice(0, tag.index) + content.slice(tag.index + tag.tag.length), 'removed the inserted map plate');
}
