import {
  Anchor,
  BookOpen,
  Brain,
  Camera,
  Castle,
  Compass,
  Crown,
  Drama,
  Eye,
  Feather,
  Flame,
  Gem,
  Ghost,
  Globe,
  Heart,
  Layers,
  Library,
  Lightbulb,
  Map,
  Moon,
  Mountain,
  Music,
  PenTool,
  Puzzle,
  Rocket,
  Scroll,
  Shield,
  Skull,
  Sparkles,
  Star,
  Sun,
  Sword,
  Target,
  Trees,
  Wand2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ProjectIconCatalog } from './fullLucideIconCatalog';

export const featuredProjectIconNames = [
  'BookOpen', 'Feather', 'Scroll', 'PenTool', 'Library', 'Lightbulb',
  'Layers', 'Globe', 'Map', 'Compass', 'Castle', 'Crown',
  'Sword', 'Shield', 'Flame', 'Star', 'Moon', 'Sun',
  'Heart', 'Skull', 'Ghost', 'Trees', 'Mountain', 'Anchor',
  'Gem', 'Sparkles', 'Wand2', 'Drama', 'Music', 'Camera',
  'Eye', 'Brain', 'Rocket', 'Zap', 'Puzzle', 'Target',
] as const;

export const curatedProjectIconCatalog: ProjectIconCatalog = {
  Anchor,
  BookOpen,
  Brain,
  Camera,
  Castle,
  Compass,
  Crown,
  Drama,
  Eye,
  Feather,
  Flame,
  Gem,
  Ghost,
  Globe,
  Heart,
  Layers,
  Library,
  Lightbulb,
  Map,
  Moon,
  Mountain,
  Music,
  PenTool,
  Puzzle,
  Rocket,
  Scroll,
  Shield,
  Skull,
  Sparkles,
  Star,
  Sun,
  Sword,
  Target,
  Trees,
  Wand2,
  Zap,
};

let fullCatalogPromise: Promise<ProjectIconCatalog> | null = null;

export function loadFullProjectIconCatalog(): Promise<ProjectIconCatalog> {
  fullCatalogPromise ??= import('./fullLucideIconCatalog')
    .then(module => module.fullLucideIconCatalog)
    .catch(error => {
      fullCatalogPromise = null;
      throw error;
    });
  return fullCatalogPromise;
}

export function resolveCuratedProjectIcon(name?: string): LucideIcon | null {
  if (!name) return null;
  return curatedProjectIconCatalog[name] ?? null;
}
