// ============================================================================
// AI bridge tools — image studio: make a picture, keep it in Gallery
// ============================================================================
//
// The same path the studio tab takes: the gateway generates through the
// project's image route (or the global default), the rows go into
// `inspirationImages` with provenance, and the model gets ids plus one small
// thumbnail to look at — never the full base64 inside the JSON text.

import { aiApi } from '@/services/aiRuntime/client';
import { generateAndSave, IMAGE_SIZE_PRESETS } from '@/engines/image-studio/operations';
import { getProjectSettings } from '@/services/copilot/threads';
import {
  BridgeError,
  dataUrlToBlob,
  optNumber,
  optString,
  optStringArray,
  requireString,
  resolveProjectForEngine,
  toVisionJpeg,
  withAudit,
  withMedia,
  type ToolArgs,
} from './shared';

export async function whGenerateImage(args: ToolArgs): Promise<unknown> {
  const projectId = await resolveProjectForEngine(args, 'image-studio');
  const prompt = requireString(args, 'prompt');
  const api = aiApi();
  if (!api) throw new BridgeError('tool-error', 'Image generation needs the desktop app.');

  const settings = await getProjectSettings(projectId);
  const route = settings.imageRoute ?? (await api.getDefaults()).image;
  if (!route) {
    throw new BridgeError(
      'no-image-model',
      'No image model is configured. The user can add an image server (an OpenAI-compatible /v1/images/generations endpoint) in AI settings and pick it as the image default.',
    );
  }

  const presetId = optString(args, 'size');
  const preset = IMAGE_SIZE_PRESETS.find((p) => p.id === presetId);
  // No size asked for: a local model's own training resolution beats a
  // generic 1024² — a 512-pixel UNet only makes soup above its scale.
  let fallback = { width: IMAGE_SIZE_PRESETS[0].width, height: IMAGE_SIZE_PRESETS[0].height };
  if (!preset && optNumber(args, 'width') === undefined && optNumber(args, 'height') === undefined) {
    const listed = await api.listModels(route.connectionId).catch(() => null);
    const model = listed?.ok ? listed.models.find((m) => m.id === route.modelId) : undefined;
    if (model?.nativeWidth && model.nativeHeight) fallback = { width: model.nativeWidth, height: model.nativeHeight };
  }
  const width = optNumber(args, 'width') ?? preset?.width ?? fallback.width;
  const height = optNumber(args, 'height') ?? preset?.height ?? fallback.height;
  const n = Math.max(1, Math.min(4, Math.floor(optNumber(args, 'count') ?? 1)));

  const result = await generateAndSave({
    projectId,
    route,
    prompt,
    negativePrompt: optString(args, 'negativePrompt'),
    width,
    height,
    n,
    seed: optNumber(args, 'seed'),
    steps: optNumber(args, 'steps'),
    quality: optString(args, 'quality'),
    collectionId: optString(args, 'collectionId'),
    tags: optStringArray(args, 'tags'),
  });
  if (!result.ok) {
    throw new BridgeError(result.code ?? 'generation-failed', result.error ?? 'Image generation failed.');
  }

  const first = result.images[0];
  const media = first?.thumbnailData ?? first?.imageData;
  const payload = withAudit(
    {
      created: true,
      projectId,
      images: result.images.map((img) => ({
        id: img.id,
        width: img.generation?.width,
        height: img.generation?.height,
        seed: img.generation?.seed,
        modelId: img.generation?.modelId,
      })),
      hint: 'The pictures are in the Gallery (and the Image Studio tab) tagged "generated". Use wh_tag_image to caption or link them, wh_view_image to look at any of them again.',
    },
    {
      projectId,
      entityId: first?.id,
      // Up to four rows land in one call. Recording only the first left undo
      // deleting one of them and marking the line reverted, with no way back
      // to the other three.
      entityIds: result.images.map((img) => img.id),
      summary: `generated ${result.images.length} image(s): "${prompt.slice(0, 60)}"`,
      table: 'inspirationImages',
    },
  );
  if (!media) return payload;
  return withMedia(payload, [{ ...(await toVisionJpeg(dataUrlToBlob(media))), label: first.id }]);
}
