// ============================================
// Storyboard Engine — Type Definitions
// ============================================

export interface Storyboard {
  id: string;
  projectId: string;
  title: string;
  columns: number; // default 3
  createdAt: number;
  updatedAt: number;
}

export interface StoryboardPanel {
  id: string;
  storyboardId: string;
  projectId: string;
  order: number;
  imageData?: string; // base64 (cropped for display)
  imageDataOriginal?: string; // base64 — original uncropped source
  imageRef?: string; // reference to gallery image ID
  subtitle: string;
  description?: string;
  duration?: string; // for video storyboards "00:15-00:23"
  linkedSceneId?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface StoryboardConnector {
  id: string;
  storyboardId: string;
  sourceId: string; // from/source panel ID
  targetId: string; // to/target panel ID
  type: 'arrow' | 'note' | 'cut' | 'fade' | 'dissolve' | 'custom';
  label?: string;
  symbol?: string;
}
