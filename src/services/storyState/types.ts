export type NarrativeAnchorKind = 'beat' | 'scene' | 'event';
export type StoryClaimKind = 'fact' | 'belief' | 'world-rule';
export type StoryClaimStatus = 'canonical' | 'hypothesis';

export interface StoryEntityRef {
  engineId: string;
  entityType: string;
  entityId: string;
  title: string;
}

/** Explicit story order. Free-text fictional dates are never compared. */
export interface NarrativeMoment {
  id: string;
  projectId: string;
  label: string;
  order: number;
  anchorKind: NarrativeAnchorKind;
  anchorEngineId: 'outline' | 'dialog-scene' | 'timeline';
  anchorEntityId: string;
  anchorTitle: string;
  createdAt: number;
  updatedAt: number;
}

interface StoryClaimBase {
  id: string;
  projectId: string;
  kind: StoryClaimKind;
  status: StoryClaimStatus;
  source?: StoryEntityRef;
  /** Suppresses warnings, but never rewrites or deletes the underlying fact. */
  intentional?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ContinuityFactType =
  | 'location'
  | 'age'
  | 'injury'
  | 'possession'
  | 'relationship'
  | 'resource'
  | 'biography'
  | 'custom';

export interface StoryFactClaim extends StoryClaimBase {
  kind: 'fact';
  subject: StoryEntityRef;
  factType: ContinuityFactType;
  value: string;
  fromMomentId: string;
  untilMomentId?: string;
}

export type BeliefMode = 'knows' | 'believes' | 'suspects' | 'misled' | 'keeps-secret';

export interface StoryBeliefClaim extends StoryClaimBase {
  kind: 'belief';
  actor: StoryEntityRef;
  proposition: string;
  mode: BeliefMode;
  acquiredAtMomentId: string;
  revealedAtMomentId?: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface StoryWorldRuleClaim extends StoryClaimBase {
  kind: 'world-rule';
  title: string;
  codexEntryId?: string;
  condition: string;
  effect: string;
  cost: string;
  limit: string;
  exceptions: string[];
  evidence: StoryEntityRef[];
  fromMomentId?: string;
  untilMomentId?: string;
}

export type StoryClaim = StoryFactClaim | StoryBeliefClaim | StoryWorldRuleClaim;

export interface ContinuityContradiction {
  id: string;
  subject: StoryEntityRef;
  factType: ContinuityFactType;
  claims: StoryFactClaim[];
  values: string[];
}

export interface StoryStateSnapshot {
  moment: NarrativeMoment;
  facts: StoryFactClaim[];
  beliefs: StoryBeliefClaim[];
  rules: StoryWorldRuleClaim[];
  contradictions: ContinuityContradiction[];
  incomplete: boolean;
}

export type RuleStressScenario = 'extreme-use' | 'abuse' | 'failure' | 'interaction' | 'social';

export interface RuleStressQuestion {
  id: string;
  scenario: RuleStressScenario;
  question: string;
  groundedIn: Array<'condition' | 'effect' | 'cost' | 'limit' | 'exceptions'>;
}
