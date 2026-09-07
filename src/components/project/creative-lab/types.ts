export const CREATIVE_SOURCE_KINDS = ['note', 'board', 'codex', 'gallery', 'seed'] as const;

export type CreativeSourceKind = (typeof CREATIVE_SOURCE_KINDS)[number];

/**
 * A read-only projection of a canonical record. Creative Lab never persists
 * this object; `key` exists only to distinguish equal ids from different
 * engines inside the temporary session.
 */
export interface CreativeSource {
  key: string;
  kind: CreativeSourceKind;
  id: string;
  projectId: string;
  title: string;
  excerpt: string;
  tags: string[];
  thumbnail?: string;
  revision?: number;
  /** Integration-supplied signal used to surface neglected material. */
  usageCount: number;
}

export interface CreativeSourceCitation {
  kind: CreativeSourceKind;
  id: string;
  projectId: string;
  title: string;
  revision?: number;
}

export type CreativeOperation =
  | 'combine'
  | 'invert'
  | 'remove'
  | 'scale'
  | 'relocate'
  | 'pov'
  | 'cost'
  | 'truth';

export type ConstraintVerb =
  | 'combine'
  | 'remove'
  | 'invert'
  | 'make-inevitable'
  | 'change-who-pays';

export type CreativeMove = CreativeOperation | ConstraintVerb;

export interface CreativeGenerationContext {
  sourceFragments: readonly string[];
  parameters: Readonly<Record<string, string>>;
}

export interface CreativeGenerationTemplates {
  operations: Record<CreativeOperation, (context: CreativeGenerationContext) => string>;
  deck: Record<ConstraintVerb, (context: CreativeGenerationContext) => string>;
}

export type CreativeOperationRequest =
  | { operation: 'combine' }
  | { operation: 'invert'; focus?: string }
  | { operation: 'remove'; element: string }
  | { operation: 'scale'; scale: string }
  | { operation: 'relocate'; place?: string; era?: string }
  | { operation: 'pov'; pointOfView: string }
  | { operation: 'cost'; cost: string }
  | { operation: 'truth' };

export type CreativeOperationIssue =
  | 'select-source'
  | 'select-two-sources'
  | 'missing-remove-element'
  | 'missing-scale'
  | 'missing-place-or-era'
  | 'missing-pov'
  | 'missing-cost';

export type ConstraintDeckIssue = 'select-source' | 'select-two-sources';

export type CreativeGenerationTrace =
  | {
      method: 'deterministic';
      templateVersion: 'creative-lab-v1';
      seed?: number;
      locale?: string;
    }
  | {
      method: 'ai';
      prompt: string;
      model: string;
    };

export interface CreativeProvenance {
  version: 1;
  origin: 'ideas-table' | 'constraint-deck';
  move: CreativeMove;
  parameters: Record<string, string>;
  sources: CreativeSourceCitation[];
  generation: CreativeGenerationTrace;
  createdAt: number;
}

export type CreativePossibilityStatus = 'active' | 'archived' | 'promoted';

export type CreativePromotionTarget =
  | 'note'
  | 'board'
  | 'codex'
  | 'seed'
  | 'outline'
  | 'timeline';

export interface CreativePromotionReceipt {
  target: CreativePromotionTarget;
  entityId: string;
  label?: string;
  promotedAt: number;
}

export interface CreativePossibility {
  id: string;
  projectId: string;
  title: string;
  text: string;
  group: string;
  status: CreativePossibilityStatus;
  provenance: CreativeProvenance;
  promotion?: CreativePromotionReceipt;
  createdAt: number;
  updatedAt: number;
}

export interface CreateCreativePossibilityInput {
  id: string;
  createdAt: number;
  sources: readonly CreativeSource[];
  request: CreativeOperationRequest;
  generation?: CreativeGenerationTemplates;
  generationLocale?: string;
}

export interface ConstraintDeck {
  seed: number;
  verb: ConstraintVerb;
  sourceKeys: Array<string | null>;
}

export interface ConstraintDeckLocks {
  verb: boolean;
  sourceSlots: boolean[];
}

export interface DealConstraintDeckInput {
  sources: readonly CreativeSource[];
  seed: number;
  sourceSlots?: number;
  previous?: ConstraintDeck;
  locks?: ConstraintDeckLocks;
}

export interface CreateDeckPossibilityInput {
  id: string;
  createdAt: number;
  sources: readonly CreativeSource[];
  deck: ConstraintDeck;
  generation?: CreativeGenerationTemplates;
  generationLocale?: string;
}

export interface CreativePromotionRequest {
  version: 1;
  projectId: string;
  target: CreativePromotionTarget;
  possibilityId: string;
  title: string;
  text: string;
  group?: string;
  provenance: CreativeProvenance;
}

export interface CreativePromotionResult {
  entityId: string;
  label?: string;
}

export interface CreativePossibilityGroup {
  id: string;
  label: string;
  possibilities: CreativePossibility[];
}
