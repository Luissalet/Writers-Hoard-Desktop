// ============================================
// Brainstorm Engine — Type Definitions
// ============================================

export interface BrainstormBoard {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export type BrainstormItemType = 'note' | 'image' | 'entity-ref' | 'text-block' | 'section';

export interface BrainstormItem {
  id: string;
  boardId: string;
  projectId: string;
  type: BrainstormItemType;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  // For 'note' type
  content?: string;
  color?: string;
  // For 'image' type
  imageData?: string;
  imageDataOriginal?: string;
  // For 'entity-ref' type
  refEntityId?: string;
  refEntityType?: string;
  refPreviewData?: string; // JSON stringified preview
  // For 'text-block' type
  richContent?: string;
  // For 'section' type
  label?: string;
  sectionColor?: string;
  createdAt: number;
  updatedAt: number;
}

export interface BrainstormConnection {
  id: string;
  boardId: string;
  sourceId: string;
  targetId: string;
  label?: string;
  color?: string;
  style?: 'solid' | 'dashed' | 'dotted';
}
