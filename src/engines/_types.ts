// ============================================
// Engine System — Core Type Definitions
// ============================================

import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Categories group engines in the UI (project creation, engine picker, etc.)
 */
export type EngineCategory = 'core' | 'creative' | 'research' | 'planning';

/**
 * Project modes — presets that determine which engines are shown by default.
 * Users can always add or remove engines after creation.
 */
export type ProjectMode =
  | 'essentials'
  | 'novelist'
  | 'biographer'
  | 'reporter'
  | 'playwright'
  | 'content-creator'
  | 'custom';

/**
 * Every feature module in the app implements this interface.
 * The engine registry collects these and the ProjectDetail page
 * renders whichever ones the current project has enabled.
 */
export interface EngineDefinition {
  /** Unique slug: 'yarn-board', 'timeline', 'dialog-scene', etc. */
  id: string;
  /** Display name shown in tabs and menus */
  name: string;
  /** One-liner shown during project setup */
  description: string;
  /** Lucide icon for the tab */
  icon: LucideIcon;
  /** Grouping category */
  category: EngineCategory;
  /**
   * Dexie table specs this engine needs.
   * Format: { tableName: 'indexSpec' }
   * Example: { scenes: 'id, projectId, order', dialogBlocks: 'id, sceneId, order' }
   */
  tables: Record<string, string>;
  /**
   * The root component for this engine's tab.
   * Receives at minimum: { projectId: string }
   */
  component: ComponentType<EngineComponentProps>;
  /**
   * Optional default config values for this engine (per-project overrides).
   */
  defaultConfig?: Record<string, unknown>;
  /**
   * Optional sidebar badge component. If present, the Sidebar will render
   * this tiny component alongside the tab label — e.g. an orphan count,
   * completion percentage, unread indicator. Receives `{ projectId }`.
   *
   * Keeping this as a component (not a hook) sidesteps the rule-of-hooks
   * problem that conditional hook invocation would cause in the Sidebar:
   * each engine owns its own badge logic, and the Sidebar stays dumb.
   */
  SidebarBadge?: ComponentType<EngineComponentProps>;
}

/**
 * Props that every engine root component receives.
 */
export interface EngineComponentProps {
  projectId: string;
}

/**
 * Configuration for a project mode — which engines are on by default.
 */
export interface ProjectModeConfig {
  id: ProjectMode;
  name: string;
  description: string;
  icon: LucideIcon;
  color: string;
  defaultEngines: string[];
  suggestedEngines: string[];
}

/**
 * Cross-engine entity reference — used by Brainstorm, Timeline, etc.
 * to link to items from any engine.
 */
export interface EntityPreview {
  id: string;
  type: string;
  engineId: string;
  title: string;
  subtitle?: string;
  thumbnail?: string;
  color?: string;
}
