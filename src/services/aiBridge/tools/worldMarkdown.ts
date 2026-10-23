// ============================================
// AI bridge — whole-world Markdown vault (read-only)
// ============================================
// Builds the same ZIP the "Export as Markdown" button makes and hands it back
// as base64, with a summary of what went in. Nothing is stored or changed.

import { db } from '@/db';
import { buildWorldMarkdownVault, estimateWorldMarkdownVault } from '@/services/worldMarkdownExport';
import { BridgeError, optBoolean, optString, resolveProjectId, type ToolArgs } from './shared';

export const WORLD_MARKDOWN_MAX_BYTES = 25 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export async function whWorldMarkdownExport(args: ToolArgs): Promise<unknown> {
  const projectId = resolveProjectId(args);
  if (!await db.projects.get(projectId)) throw new BridgeError('not-found', 'Project not found.');
  if (args.includeMedia !== undefined && typeof args.includeMedia !== 'boolean') throw new BridgeError('bad-args', 'includeMedia is true or false.');
  const locale = optString(args, 'locale');
  if (locale !== undefined && locale !== 'es' && locale !== 'en') throw new BridgeError('bad-args', 'locale is "es" or "en".');
  const includeMedia = optBoolean(args, 'includeMedia') === true;
  const tooLarge = (bytes: number) => new BridgeError('too-large', `The vault would be about ${(bytes / 1048576).toFixed(1)} MB, over the ${WORLD_MARKDOWN_MAX_BYTES / 1048576} MB limit of this tool.${includeMedia ? ' Call again with includeMedia: false (the text alone is much smaller) or use the Export as Markdown button in the app.' : ' Use the Export as Markdown button in the app instead.'}`);
  const estimate = await estimateWorldMarkdownVault(projectId);
  const expected = includeMedia ? estimate.estimatedBytesWithMedia : estimate.estimatedBytes;
  if (expected > WORLD_MARKDOWN_MAX_BYTES) throw tooLarge(expected);
  const result = await buildWorldMarkdownVault(projectId, { includeMedia, lang: locale === 'en' ? 'en' : 'es' });
  if (result.bytes > WORLD_MARKDOWN_MAX_BYTES) throw tooLarge(result.bytes);
  const base64 = toBase64(new Uint8Array(await result.blob.arrayBuffer()));
  return {
    fileName: result.fileName,
    files: result.files,
    bytes: result.bytes,
    includeMedia,
    summary: result.summary,
    ...(result.warnings.length ? { warnings: result.warnings } : {}),
    base64,
  };
}
