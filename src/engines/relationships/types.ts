// ============================================
// Relationship Matrix — Types
// ============================================
//
// A single-table engine that records the connection between any two
// entities in the project. Most commonly used for character-character
// connections, but nothing prevents character-location, faction-faction,
// or other cross-engine pairings.

export type RelationshipKind =
  | 'ally'
  | 'friend'
  | 'family'
  | 'romantic'
  | 'rival'
  | 'enemy'
  | 'mentor'
  | 'subordinate'
  | 'colleague'
  | 'acquaintance'
  | 'other';

export interface Relationship {
  id: string;
  projectId: string;

  // --- Entity A ---
  entityAId: string;
  entityAType: string;   // usually 'codex-entry'; kept generic for cross-engine
  entityAName: string;   // denormalised for matrix rendering speed

  // --- Entity B ---
  entityBId: string;
  entityBType: string;
  entityBName: string;

  /** Which kind of relationship */
  kind: RelationshipKind;

  /** -5 (open hostility) ... 0 (neutral) ... +5 (deep loyalty/love) */
  intensity: number;

  /** Free-form short label ("Ex-wife, amicable") */
  label: string;

  /** Multi-line notes */
  notes: string;

  /** Optional hex color to override the kind's default */
  color?: string;

  /** Whether the relationship is current, past, or secret */
  state: 'current' | 'past' | 'secret';

  /** Is the relationship mutual (A↔B) or asymmetric (A→B)? */
  directional: boolean;

  createdAt: number;
  updatedAt: number;
}

export const RELATIONSHIP_KIND_CONFIG: Record<RelationshipKind, { label: string; color: string; emoji: string }> = {
  ally:         { label: 'Ally',         color: '#3b82f6', emoji: '\ud83e\udd1d' }, // 🤝
  friend:       { label: 'Friend',       color: '#10b981', emoji: '\ud83d\ude42' }, // 🙂
  family:       { label: 'Family',       color: '#8b5cf6', emoji: '\ud83d\udc6a' }, // 👪
  romantic:     { label: 'Romantic',     color: '#ec4899', emoji: '\u2764\ufe0f' }, // ❤️
  rival:        { label: 'Rival',        color: '#f97316', emoji: '\u26a1' },       // ⚡
  enemy:        { label: 'Enemy',        color: '#ef4444', emoji: '\u2694\ufe0f' }, // ⚔️
  mentor:       { label: 'Mentor',       color: '#c4973b', emoji: '\ud83c\udf93' }, // 🎓
  subordinate:  { label: 'Subordinate',  color: '#6366f1', emoji: '\u2193' },       // ↓
  colleague:    { label: 'Colleague',    color: '#64748b', emoji: '\ud83d\udcbc' }, // 💼
  acquaintance: { label: 'Acquaintance', color: '#94a3b8', emoji: '\ud83d\udc4b' }, // 👋
  other:        { label: 'Other',        color: '#6b7280', emoji: '\ud83d\udd17' }, // 🔗
};

export const RELATIONSHIP_STATE_CONFIG: Record<Relationship['state'], { label: string; color: string }> = {
  current: { label: 'Current', color: 'bg-green-500/10 text-green-400' },
  past:    { label: 'Past',    color: 'bg-gray-500/10 text-gray-400' },
  secret:  { label: 'Secret',  color: 'bg-purple-500/10 text-purple-400' },
};

/** For matrix intensity cell coloring — green to red. */
export function intensityColor(intensity: number): string {
  if (intensity >= 4) return '#10b981';
  if (intensity >= 2) return '#22c55e';
  if (intensity >= 1) return '#84cc16';
  if (intensity >= -1) return '#6b7280';
  if (intensity >= -2) return '#f97316';
  if (intensity >= -4) return '#ef4444';
  return '#b91c1c';
}
