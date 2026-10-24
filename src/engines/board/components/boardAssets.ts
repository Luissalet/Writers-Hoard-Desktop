import {mediaAsset} from '@/engines/media/scope';
import type {LocalMediaAsset} from '@/engines/media/types';
import type {WorldEraScope} from '@/services/worldEras/types';
import type {BoardEntityRef} from '../types';

// What the board's assets rail hands the board: the drag type it puts a
// picture under, and the picture itself as a file the board's upload path takes.
export const BOARD_ASSET_MIME = 'application/x-wh-board-asset';

export const imageFile = async (dataUrl: string, name: string) => { const blob = await (await fetch(dataUrl)).blob(); return new File([blob], name || 'imagen', { type: blob.type || 'image/png' }); };

export const BOARD_MEDIA_MIME = 'application/x-wh-board-media';
export function isBoardMediaRef(ref: BoardEntityRef | undefined): boolean {
  return ref?.engineId === 'media' && ref.entityType === 'local-media';
}
/** Availability for a new reference, shared by the normal canvas and MCP. Never decodes or plays. */
export function isUsableBoardMedia(asset: LocalMediaAsset | undefined): asset is LocalMediaAsset {
  return !!asset && (asset.kind === 'audio' || asset.kind === 'video') && asset.blob instanceof Blob && asset.blob.size > 0;
}
export async function readBoardMedia(scope: WorldEraScope, id: string): Promise<LocalMediaAsset | undefined> {
  if (!id.trim()) return undefined;
  const asset = await mediaAsset(scope.projectId, id, scope.eraId);
  return asset?.id === id && asset.projectId === scope.projectId && isUsableBoardMedia(asset) ? asset : undefined;
}
