import { lazy } from 'react';

// ============================================
// Image studio — engine registration
// ============================================
//
// Tableless engine: generated pictures are Gallery rows (`inspirationImages`)
// with `source: 'generated'` and their provenance, so Gallery's backup
// strategy already carries them and `wh_list_images` already lists them. The
// studio adds the making, not another store.

import { Sparkles } from 'lucide-react';
import type { EngineDefinition } from '@/engines/_types';
import { registerEngine } from '@/engines/_registry';
const ImageStudioEngine = lazy(() => import('./ImageStudioEngine'));

const imageStudioEngine: EngineDefinition = {
  id: 'image-studio',
  name: 'Image Studio',
  description: 'Generate reference images with a local or connected model; results land in Gallery',
  icon: Sparkles,
  category: 'creative',
  // No tables — Gallery owns the rows.
  tables: {},
  component: ImageStudioEngine,
};

registerEngine(imageStudioEngine);

export { imageStudioEngine };
