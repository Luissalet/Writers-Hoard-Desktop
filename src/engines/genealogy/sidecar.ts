// ============================================================================
// Genealogy sidecar — exchange format over an intact hoard.world/1 document.
//
// The world/1 document is NEVER modified: the sidecar travels NEXT to it, so
// a receiver without genealogy support sees a perfectly valid world/1 and an
// unknown attachment it must reject explicitly (genealogy_unsupported) — not
// silently drop. A sidecar from a newer contract version is also an explicit
// rejection (genealogy_version_unsupported): we never guess at a future
// schema, and we never convert old labels or lose data.
//
// NOTE on ids: sidecar links carry the LOCAL character ids (A, B, ...). A
// world/1 document references characters as `hoard://writer/codex/<id>` refs
// (see src/services/familyBridge/worldSchema.ts, refCodex). The two id spaces
// are reconciled by `mapGenealogyIds` in `idMap.ts` (explicit caller-supplied
// id table, never name-based) — see docs/GENEALOGY_CONTRACT.md §4.1.
//
// Pure functions only: no I/O, no mutation of the inputs.
// ============================================================================

import { GENEALOGY_CONTRACT_VERSION } from './validate.ts';

export const GENEALOGY_SIDECAR_VERSION = 'hoard.genealogy/1';

/**
 * Explicit capability discovery for the genealogy sidecar exchange.
 *
 * An ABSENT sidecar only means "no genealogy data travelled"; it must not be
 * read as "the peer lacks genealogy support". A peer that DOES implement this
 * contract announces it with a capability record; a peer that does not, or
 * that announces a different contract version, is reported as unsupported so
 * the caller can reject the exchange explicitly instead of guessing.
 *
 * Pure function: no I/O, no mutation.
 */
export function genealogySupport(capabilities: unknown): {
  supported: boolean;
  contractVersion: string | null;
  reason: 'supported' | 'no_capabilities' | 'no_genealogy_capability' | 'version_unsupported';
} {
  if (!isPlainObject(capabilities)) {
    return { supported: false, contractVersion: null, reason: 'no_capabilities' };
  }
  const record = capabilities as Record<string, unknown>;
  const genealogy = record.genealogy;
  if (genealogy === undefined || genealogy === null) {
    return { supported: false, contractVersion: null, reason: 'no_genealogy_capability' };
  }
  if (!isPlainObject(genealogy)) {
    return { supported: false, contractVersion: null, reason: 'no_genealogy_capability' };
  }
  const version = genealogy.contractVersion;
  if (typeof version !== 'string' || version === '') {
    return { supported: false, contractVersion: null, reason: 'no_genealogy_capability' };
  }
  if (version !== GENEALOGY_CONTRACT_VERSION) {
    return { supported: false, contractVersion: version, reason: 'version_unsupported' };
  }
  return { supported: true, contractVersion: version, reason: 'supported' };
}

export interface GenealogySidecar {
  schema: typeof GENEALOGY_SIDECAR_VERSION;
  contractVersion: string;
  /** Genealogy links; ids are the character ids used inside the world doc. */
  links: Array<{
    id: string;
    from: string;
    to: string;
    kind: string;
    label?: string;
  }>;
}

export class GenealogySidecarError extends Error {
  code: 'genealogy_unsupported' | 'genealogy_version_unsupported' | 'genealogy_sidecar_invalid';

  constructor(code: GenealogySidecarError['code'], message: string) {
    super(message);
    this.name = 'GenealogySidecarError';
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural checks shared by encode and decode. Everything except `schema`
 * (checked by the callers, because its failure code differs) must hold:
 *   - contractVersion: present and EXACTLY the implemented contract version;
 *     a different version is a version rejection, an absent one is malformed.
 *   - links: an array of plain objects with non-empty string id/from/to/kind
 *     and an optional string label. `null`, numbers or half-formed links are
 *     rejected, never coerced.
 */
function sidecarIssues(record: Record<string, unknown>): Array<{ code: GenealogySidecarError['code']; message: string }> {
  const issues: Array<{ code: GenealogySidecarError['code']; message: string }> = [];

  if (typeof record.contractVersion !== 'string' || record.contractVersion === '') {
    issues.push({
      code: 'genealogy_sidecar_invalid',
      message: 'sidecar.contractVersion must be a non-empty string',
    });
  } else if (record.contractVersion !== GENEALOGY_CONTRACT_VERSION) {
    issues.push({
      code: 'genealogy_version_unsupported',
      message: `unsupported genealogy contract version: ${record.contractVersion} (expected ${GENEALOGY_CONTRACT_VERSION})`,
    });
  }

  if (!Array.isArray(record.links)) {
    issues.push({ code: 'genealogy_sidecar_invalid', message: 'sidecar.links must be an array' });
    return issues;
  }
  record.links.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      issues.push({
        code: 'genealogy_sidecar_invalid',
        message: `sidecar.links[${index}] is not an object`,
      });
      return;
    }
    for (const field of ['id', 'from', 'to', 'kind'] as const) {
      if (typeof entry[field] !== 'string' || (entry[field] as string) === '') {
        issues.push({
          code: 'genealogy_sidecar_invalid',
          message: `sidecar.links[${index}].${field} must be a non-empty string`,
        });
      }
    }
    if (entry.label !== undefined && typeof entry.label !== 'string') {
      issues.push({
        code: 'genealogy_sidecar_invalid',
        message: `sidecar.links[${index}].label must be a string when present`,
      });
    }
  });
  return issues;
}

/**
 * Attach a genealogy sidecar to a world/1 document WITHOUT touching it.
 * Returns the same document (same content, same key order) plus the sidecar.
 * Malformed links are rejected here too: nothing malformed is ever emitted.
 */
export function encodeGenealogySidecar(
  worldDoc: Record<string, unknown>,
  links: ReadonlyArray<GenealogySidecar['links'][number]>,
): { worldDoc: Record<string, unknown>; sidecar: GenealogySidecar } {
  if (!isPlainObject(worldDoc)) {
    throw new GenealogySidecarError('genealogy_sidecar_invalid', 'no world document provided');
  }
  const sidecar: GenealogySidecar = {
    schema: GENEALOGY_SIDECAR_VERSION,
    contractVersion: GENEALOGY_CONTRACT_VERSION,
    links: structuredClone([...links]),
  };
  const issues = sidecarIssues(sidecar as unknown as Record<string, unknown>);
  if (issues.length > 0) {
    throw new GenealogySidecarError(issues[0].code, issues[0].message);
  }
  // The document is returned as-is (no genealogy fields injected into it).
  return { worldDoc, sidecar };
}

/**
 * Read a genealogy sidecar that arrived next to a world/1 document.
 *
 * - No sidecar (null/undefined) -> GenealogySidecarError 'genealogy_unsupported':
 *   the receiver must reject explicitly instead of silently losing the data.
 *   NOTE: an absent sidecar only means "no genealogy data travelled"; it does
 *   NOT prove the sender or receiver lacks genealogy support. Explicit
 *   capability discovery is pending (see docs/GENEALOGY_CONTRACT.md).
 * - Unknown schema or contract version -> 'genealogy_version_unsupported'.
 * - Malformed sidecar (not an object, links not an array, entries not plain
 *   objects with string id/from/to/kind) -> 'genealogy_sidecar_invalid'.
 *
 * The world document itself is only checked for presence, never modified.
 */
export function decodeGenealogySidecar(
  worldDoc: Record<string, unknown> | null | undefined,
  sidecar: unknown,
): { worldDoc: Record<string, unknown>; links: GenealogySidecar['links'] } {
  if (!isPlainObject(worldDoc)) {
    throw new GenealogySidecarError('genealogy_sidecar_invalid', 'no world document provided');
  }
  if (sidecar === null || sidecar === undefined) {
    throw new GenealogySidecarError(
      'genealogy_unsupported',
      'no genealogy sidecar present: receiver without genealogy support must reject explicitly',
    );
  }
  if (!isPlainObject(sidecar)) {
    throw new GenealogySidecarError('genealogy_sidecar_invalid', 'sidecar is not an object');
  }
  const record = sidecar as Record<string, unknown>;
  if (record.schema !== GENEALOGY_SIDECAR_VERSION) {
    throw new GenealogySidecarError(
      'genealogy_version_unsupported',
      `unsupported genealogy sidecar schema: ${String(record.schema)} (expected ${GENEALOGY_SIDECAR_VERSION})`,
    );
  }
  const issues = sidecarIssues(record);
  if (issues.length > 0) {
    throw new GenealogySidecarError(issues[0].code, issues[0].message);
  }
  return { worldDoc, links: structuredClone(record.links) as GenealogySidecar['links'] };
}
