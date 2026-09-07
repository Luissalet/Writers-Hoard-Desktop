import { lazy } from 'react';

// ============================================
// Image studio — engine registration
// ============================================
//
// Generated pictures are Gallery rows (`inspirationImages`) with
// `source: 'generated'` and their provenance, so Gallery's backup strategy
// already carries them and `wh_list_images` already lists them. The studio adds
// the making, not another picture store.
//
// Its first table is not pictures: `visualRefs`, the
// accumulating description of a character, place, object or style — the words,
// the dialect they are written in, the ids of her reference images, a hero
// seed, a preset, a trained LoRA. It has to survive a backup because it is the
// part the writer built by hand over months; the pictures can be regenerated,
// the judgement about which one is her cannot.
// `imageRecipes` holds the exact runtime account for reproducibility; the
// image bytes still belong solely to Gallery.

import { Sparkles } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine } from '@/engines/_registry';
import { makeSimpleBackupStrategy, registerBackupStrategy } from '@/engines/_shared';
const ImageStudioEngine = lazy(() => import('./ImageStudioEngine'));

const imageStudioEngine: EngineDefinition = {
  id: 'image-studio',
  name: 'Image Studio',
  description: 'Generate reference images with a local or connected model; results land in Gallery',
  icon: Sparkles,
  category: 'creative',
  tables: {
    visualRefs: 'id, projectId, codexEntryId, kind, updatedAt',
    imageRecipes: 'id, projectId, imageId, hash, createdAt',
  },
  component: ImageStudioEngine,
};

registerEngine(imageStudioEngine);

// Plain JSON: a reference row holds ids and text, never image bytes, so there
// is nothing here to externalise. The pictures ride in Gallery's own strategy
// with their ids intact, which is what keeps these references pointing at the
// right faces after a restore.
registerBackupStrategy(makeSimpleBackupStrategy({
  engineId: 'image-studio',
  // An archive made before recipes has no second JSON file; the additive
  // strategy reads that as an empty set and leaves legacy Gallery provenance
  // usable. Recipe rows themselves are plain JSON and need no external assets.
  tables: ['visualRefs', 'imageRecipes'],
}));

export { imageStudioEngine };
