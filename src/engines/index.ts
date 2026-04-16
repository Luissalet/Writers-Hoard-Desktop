// ============================================
// Engine System — Initialization
// ============================================

// Import all engine definitions to register them
import '@/engines/codex';
import '@/engines/writings';
import '@/engines/timeline';
import '@/engines/yarn-board';
import '@/engines/maps';
import '@/engines/gallery';
import '@/engines/links';
import '@/engines/storyboard';
import '@/engines/dialog-scene';
import '@/engines/brainstorm';
import '@/engines/video-planner';
import '@/engines/scrapper';
import '@/engines/biography';
import '@/engines/diary';
import '@/engines/outline';
import '@/engines/writing-stats';

// Re-export registry functions and types for consumer code
export {
  registerEngine,
  getEngine,
  getAllEngines,
  getEnginesForMode,
  getSuggestedEnginesForMode,
  getEnginesByIds,
  PROJECT_MODES,
  type EngineDefinition,
  type ProjectMode,
  type ProjectModeConfig,
  type EngineComponentProps,
  type EngineCategory,
  type EntityPreview,
} from './_registry';
