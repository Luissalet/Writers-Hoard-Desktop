import { lazy } from 'react';
import { Dices } from 'lucide-react';
import { registerEngine } from '../_registry';
import type { EngineDefinition } from '../_types';

const fictionEngine: EngineDefinition = {
  id: 'fiction', name: 'Interactive fiction',
  description: 'World state, continuity, sessions, dice, threads and clocks',
  icon: Dices, category: 'creative', tables: {},
  component: lazy(() => import('./FictionEngine')),
};
registerEngine(fictionEngine);
