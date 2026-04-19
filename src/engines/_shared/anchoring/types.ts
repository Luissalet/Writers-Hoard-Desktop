// ============================================
// Anchoring — Cross-engine adapter types
// ============================================
//
// Each engine that wants to be annotatable registers an `AnchorAdapter` for
// itself. The Annotations engine consumes these adapters to:
//   - render notes in the margin of any entity
//   - resolve reference-note targets to titles + colors
//   - jump to a target entity when a chip is clicked
//   - run the fuzzy reanchor algorithm against the entity's body text
//     (text-range adapters only)
//
// Two tiers:
//   - All five v1 engines (writings, codex, seeds, maps, yarn-board) provide
//     entity-level anchoring.
//   - Writings + codex additionally implement `getEntityText` so the
//     anchorResolver can verify and (when needed) reanchor text-range notes.

import type { ComponentType } from 'react';

export interface AnchorAdapter {
  /** Engine id — must match EngineDefinition.id and the registry key. */
  engineId: string;
  /** Whether this engine supports text_range anchors (vs. entity-only). */
  supportsTextRange: boolean;
  /** Plain-text body for an entity, used for verify + reanchor. Required when supportsTextRange. */
  getEntityText?: (entityId: string) => Promise<string | null>;
  /** Title shown on the note card and in the reference chip. */
  getEntityTitle: (entityId: string) => Promise<string | null>;
  /** Short label for the chip (e.g. "Seed", "Character", "Map Pin"). */
  getEngineChipLabel: () => string;
  /**
   * Imperatively navigate to the target entity. Implementations typically
   * call into the app router via a thin helper.
   */
  navigateToEntity: (entityId: string) => void;
  /**
   * Optional: render a one-field "create new …" form so the user can spawn
   * a fresh entity from inside a reference note. Returns the new entity's
   * id once persisted. If omitted, the inline-create button is hidden.
   */
  CreateInlineForm?: ComponentType<InlineCreateFormProps>;
}

/**
 * Props passed to an engine's inline-create form when rendered from the
 * NoteCreator. The form persists a new row and resolves with its id so the
 * NoteCreator can attach the reference without an extra round-trip.
 */
export interface InlineCreateFormProps {
  projectId: string;
  /** Initial value (often the selected text). */
  initialTitle?: string;
  onCreated: (entityId: string) => void;
  onCancel: () => void;
}
