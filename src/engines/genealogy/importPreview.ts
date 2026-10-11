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

  // Ids derivados (review r3/r4/r5): deriveLinkIds corre sobre la lista RAW
  // (las entradas inválidas conservan su hueco) para que la asignación sea
  // idéntica a la de applyGenealogy (review r5 P2-2: en un lote mixto
  // [inválida, sin id] preview y apply prometían ids distintos). Los ids
  // existentes del proyecto se reservan aquí también (review r5 P2-1).
  const ids = deriveLinkIds(
    input.incoming as unknown as Record<string, unknown>[],
    new Set(existingById.keys()),
  );

  for (let index = 0; index < input.incoming.length; index++) {
    const raw = input.incoming[index];
    if (!isLink(raw)) {
      issues.push({ index, reason: 'invalid_link' });
      continue;
    }
    const incoming: GenealogyLink = { ...raw, id: raw.id ?? '' };
    if (incoming.id === '') {
      incoming.id = ids[index];
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
