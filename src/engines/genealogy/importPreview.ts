// Vista previa de importación genealógica (W6): clasifica los enlaces entrantes
// frente a los ya existentes en additions / duplicates / conflicts, con ids
// derivados para las entradas sin id. Función pura, sin I/O, sin mutar entradas.
//
// Reglas de clasificación (en este orden, primera coincidencia gana):
//  - duplicado por id: el id entrante ya existe (en lo existente o ya visto en
//    esta misma importación) -> duplicates
//  - duplicado semántico: mismo from/to/kind ya existente -> duplicates
//    (la etiqueta no cambia la semántica del enlace)
//  - conflicto: mismo from/to con kind distinto -> conflicts
//  - resto -> additions

import { deriveLinkIds } from './genealogyStore.ts';
import type { GenealogyLink } from './validate';

export interface ImportPreviewIssue {
  index: number;
  reason: string;
}

export interface ImportPreview {
  additions: GenealogyLink[];
  duplicates: { incoming: string; existing: string }[];
  conflicts: {
    incoming: string;
    existing: string;
    incomingKind: string;
    existingKind: string;
  }[];
  issues: ImportPreviewIssue[];
}

const KINDS = ['biological_parent', 'adoptive_parent', 'guardian', 'partner'];

function isLink(value: unknown): value is GenealogyLink {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.id === undefined || typeof v.id === 'string') &&
    typeof v.from === 'string' &&
    typeof v.to === 'string' &&
    typeof v.kind === 'string' &&
    KINDS.includes(v.kind)
  );
}

export function previewGenealogyImport(input: {
  incoming: unknown[];
  existing: GenealogyLink[];
}): ImportPreview {
  const additions: GenealogyLink[] = [];
  const duplicates: { incoming: string; existing: string }[] = [];
  const conflicts: ImportPreview['conflicts'] = [];
  const issues: ImportPreviewIssue[] = [];

  const existingById = new Map<string, GenealogyLink>();
  for (const link of input.existing) existingById.set(link.id, link);
  const existingByTriple = new Map<string, GenealogyLink>();
  const existingByPair = new Map<string, GenealogyLink>();
  for (const link of input.existing) {
    existingByTriple.set(`${link.from}\u0000${link.to}\u0000${link.kind}`, link);
    existingByPair.set(`${link.from}\u0000${link.to}`, link);
  }

  // Ids derivados (review r3/r4): reservar primero los ids explícitos del
  // lote y los existentes, y solo después derivar g1..gN para los que no
  // llevan. deriveLinkIds already reserves the batch's explicit ids
  // internally; the returned array is aligned with the FILTERED list, so the
  // consumer must walk it with its own cursor over the valid entries instead
  // of indexing by the raw position (review r4 P2: with an invalid entry
  // before a valid id-less one, the raw index pointed at the wrong id).
  const validIncoming = input.incoming.filter((raw) => isLink(raw));
  const ids = deriveLinkIds(
    validIncoming as unknown as Record<string, unknown>[],
    new Set(existingById.keys()),
  );
  let derivedCursor = 0;

  for (let index = 0; index < input.incoming.length; index++) {
    const raw = input.incoming[index];
    if (!isLink(raw)) {
      issues.push({ index, reason: 'invalid_link' });
      continue;
    }
    const incoming: GenealogyLink = { ...raw, id: raw.id ?? '' };
    if (incoming.id === '') {
      // ids is aligned with the valid entries: explicit-id entries occupy a
      // slot too, so the cursor must advance past them (review r4 P2).
      while (validIncoming[derivedCursor]?.id !== undefined && validIncoming[derivedCursor].id !== '') {
        derivedCursor++;
      }
      incoming.id = ids[derivedCursor];
      derivedCursor++;
    }

    const byId = existingById.get(incoming.id);
    if (byId) {
      duplicates.push({ incoming: incoming.id, existing: byId.id });
      continue;
    }

    const triple = `${incoming.from}\u0000${incoming.to}\u0000${incoming.kind}`;
    const byTriple = existingByTriple.get(triple);
    if (byTriple) {
      duplicates.push({ incoming: incoming.id, existing: byTriple.id });
      continue;
    }

    // Conflicto: mismo from/to con kind distinto contra lo existente o lo ya
    // aceptado en esta importación.
    const opposite = existingByPair.get(`${incoming.from}\u0000${incoming.to}`);
    // La coexistencia biologico/adoptivo del mismo par es valida (el apply la
    // acepta), asi que no se marca como conflicto.
    const coexistible =
      (incoming.kind === 'biological_parent' && opposite?.kind === 'adoptive_parent') ||
      (incoming.kind === 'adoptive_parent' && opposite?.kind === 'biological_parent');
    if (opposite && !coexistible) {
      conflicts.push({
        incoming: incoming.id,
        existing: opposite.id,
        incomingKind: incoming.kind,
        existingKind: opposite.kind,
      });
      continue;
    }

    additions.push(incoming);
    existingById.set(incoming.id, incoming);
    existingByTriple.set(triple, incoming);
    existingByPair.set(`${incoming.from}\u0000${incoming.to}`, incoming);
  }

  return { additions, duplicates, conflicts, issues };
}
