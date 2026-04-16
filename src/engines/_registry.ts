// ============================================
// Engine Registry — Central manifest for all engines
// ============================================

import {
  Globe, Lightbulb, MessageSquare,
  BookUser, Video, PenLine,
} from 'lucide-react';
import type { EngineDefinition, ProjectMode, ProjectModeConfig } from './_types';
import { registerEntityResolver } from './_shared/entityResolverRegistry';

// ---------------------------------------------------------------------------
// Registry store
// ---------------------------------------------------------------------------

const ENGINE_REGISTRY: Map<string, EngineDefinition> = new Map();

export function registerEngine(engine: EngineDefinition): void {
  ENGINE_REGISTRY.set(engine.id, engine);
}

export function getEngine(id: string): EngineDefinition | undefined {
  return ENGINE_REGISTRY.get(id);
}

export function getAllEngines(): EngineDefinition[] {
  return Array.from(ENGINE_REGISTRY.values());
}

export function getEnginesForMode(mode: ProjectMode): EngineDefinition[] {
  const config = PROJECT_MODES.find(m => m.id === mode);
  if (!config) return getAllEngines();
  return config.defaultEngines
    .map(id => ENGINE_REGISTRY.get(id))
    .filter(Boolean) as EngineDefinition[];
}

export function getSuggestedEnginesForMode(mode: ProjectMode): EngineDefinition[] {
  const config = PROJECT_MODES.find(m => m.id === mode);
  if (!config) return [];
  return config.suggestedEngines
    .map(id => ENGINE_REGISTRY.get(id))
    .filter(Boolean) as EngineDefinition[];
}

export function getEnginesByIds(ids: string[]): EngineDefinition[] {
  return ids
    .map(id => ENGINE_REGISTRY.get(id))
    .filter(Boolean) as EngineDefinition[];
}

// ---------------------------------------------------------------------------
// Project Modes — presets for different writer types
// ---------------------------------------------------------------------------

export const PROJECT_MODES: ProjectModeConfig[] = [
  {
    id: 'novelist',
    name: 'Novelist',
    description: 'Fiction writers: novels, short stories, sagas',
    icon: PenLine,
    color: '#c4973b',
    defaultEngines: ['writings', 'codex', 'timeline', 'yarn-board', 'maps', 'gallery', 'outline'],
    suggestedEngines: ['storyboard', 'links', 'diary', 'writing-stats'],
  },
  {
    id: 'biographer',
    name: 'Biographer',
    description: 'Real or fictional biographies',
    icon: BookUser,
    color: '#4a7ec4',
    defaultEngines: ['biography', 'timeline', 'codex', 'gallery', 'scrapper', 'yarn-board'],
    suggestedEngines: ['writings', 'links', 'diary', 'outline', 'writing-stats'],
  },
  {
    id: 'reporter',
    name: 'Reporter',
    description: 'Investigative journalism, research',
    icon: Globe,
    color: '#c4463a',
    defaultEngines: ['scrapper', 'timeline', 'yarn-board', 'codex', 'gallery', 'links'],
    suggestedEngines: ['writings', 'biography', 'writing-stats'],
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description: 'Theater, screenwriting, dialog-heavy work',
    icon: MessageSquare,
    color: '#7c5cbf',
    defaultEngines: ['dialog-scene', 'codex', 'timeline', 'storyboard', 'yarn-board', 'outline'],
    suggestedEngines: ['gallery', 'writings', 'writing-stats'],
  },
  {
    id: 'content-creator',
    name: 'Content Creator',
    description: 'YouTubers, podcasters, video planners',
    icon: Video,
    color: '#4a9e6d',
    defaultEngines: ['video-planner', 'storyboard', 'gallery', 'scrapper', 'timeline'],
    suggestedEngines: ['yarn-board', 'links', 'dialog-scene', 'outline', 'writing-stats'],
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Pick your own engines',
    icon: Lightbulb,
    color: '#d4a843',
    defaultEngines: [],
    suggestedEngines: [],
  },
];

// Re-export entity resolver registration
export { registerEntityResolver };

// Re-export types
export type { EngineDefinition, ProjectMode, ProjectModeConfig, EngineComponentProps, EngineCategory, EntityPreview } from './_types';
