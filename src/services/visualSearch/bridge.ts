import { db } from '@/db';
import { resolveProjectForEngine, requireString, optString, type ToolArgs } from '@/services/aiBridge/tools/shared';
import { searchVisualImages, visualSearchApi } from './search';
export const VISUAL_SEARCH_HANDLERS = {
  wh_visual_search_status: () => visualSearchApi().status(),
  wh_visual_search_prepare: () => visualSearchApi().prepare(),
  async wh_visual_search_images(args: ToolArgs) {
    const projectId = await resolveProjectForEngine(args, 'gallery'), collectionId = optString(args, 'collectionId');
    const images = (await db.inspirationImages.where('projectId').equals(projectId).toArray()).filter(image => !collectionId || image.collectionId === collectionId);
    return { projectId, scope: 'shared-project-gallery', ...await searchVisualImages(projectId, requireString(args, 'query'), images) };
  },
};
