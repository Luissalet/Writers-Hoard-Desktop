export interface Scene {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  order: number;
  setting?: string;
  tags: string[];
  /** Manually assigned scene number (auto-generated if not locked) */
  sceneNumber?: number;
  /** When true, sceneNumber won't be recalculated on reorder */
  isLocked?: boolean;
  /** Omitted scenes are hidden from output but preserved in the project */
  isOmitted?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type DialogBlockType =
  | 'dialog'
  | 'stage-direction'
  | 'action'
  | 'transition'
  | 'note'
  | 'slug';

export interface BlockFormatting {
  fontFamily?: 'serif' | 'sans' | 'mono';
  fontSize?: 'xs' | 'sm' | 'base' | 'lg';
}

export interface DialogBlock {
  id: string;
  sceneId: string;
  projectId: string;
  type: DialogBlockType;
  characterId?: string;
  characterName: string;
  characterColor: string;
  content: string;
  order: number;
  parenthetical?: string;
  formatting?: BlockFormatting;
  /** Group ID for dual/parallel dialogue — blocks sharing the same dualGroupId render side-by-side */
  dualGroupId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SceneCast {
  id: string;
  sceneId: string;
  characterId?: string;
  characterName: string;
  color: string;
  shortcut?: string;
}
