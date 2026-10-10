// Núcleo puro del contrato MCP de genealogía (§5 del contrato):
// apply (aplica solo los aceptados y registra la aplicación), query
// (padres/hijos/guardianes/pareja por dirección) y undo (solo si la
// revisión del estado coincide con la registrada al aplicar).
// Funciones puras: sin I/O, sin mutar entradas.

import { validateGenealogy, type GenealogyLink } from './validate.ts';

export class GenealogyOpError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'GenealogyOpError';
    this.code = code;
  }
}

export interface GenealogyApplication {
  id: string;
  projectId: string;
  appliedLinkIds: string[];
  revisionBefore: string;
  revisionAfter: string;
}

/** Hash determinista e independiente del orden del estado de enlaces. */
export function genealogyRevision(links: readonly GenealogyLink[]): string {
  const canonical = [...links]
    .map((l) => JSON.stringify([l.id, l.from, l.to, l.kind, l.label ?? null]))
    .sort();
  return `rev:${sha256(canonical.join('\n'))}`;
}

// FNV-1a de 64 bits simulado con dos mitades de 32: suficiente como
// huella determinista sin depender de crypto (función pura, sin I/O).
function sha256(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + c) >>> 0;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export interface ApplyResult {
  appliedLinkIds: string[];
  links: GenealogyLink[];
  application: GenealogyApplication;
  rejected: { link: unknown; issues: { code: string; detail: string; chain?: string[] }[] }[];
}

/**
 * Aplica una propuesta: valida, añade solo los aceptados al estado y
 * registra la aplicación con la revisión antes/después. No muta `links`
 * ni `applications`; devuelve el nuevo estado y el registro.
 */
export function applyGenealogy(
  characters: ReadonlyArray<{ id: string; [key: string]: unknown }>,
  links: readonly GenealogyLink[],
  proposal: readonly unknown[],
  applyId: string,
  applications: Readonly<Record<string, GenealogyApplication>> = {},
  projectId = '',
): ApplyResult {
  if (typeof applyId !== 'string' || applyId.length === 0) {
    throw new GenealogyOpError('invalid_apply_id', 'applyId debe ser un string no vacío');
  }
  if (Object.prototype.hasOwnProperty.call(applications, applyId)) {
    throw new GenealogyOpError('duplicate_apply', `la aplicación ${applyId} ya existe`);
  }
  // Ids derivados (contrato §5): las entradas sin id reciben g1..gN saltando
  // los ocupados por el estado; el validador exige id, así que se completa
  // antes de validar.
  const taken = new Set(links.map((l) => l.id));
  let nextDerived = 1;
  const withIds = proposal.map((raw) => {
    if (
      typeof raw === 'object' && raw !== null &&
      typeof (raw as Record<string, unknown>).id === 'string' &&
      ((raw as Record<string, unknown>).id as string) !== ''
    ) {
      return raw;
    }
    while (taken.has(`g${nextDerived}`)) nextDerived++;
    const id = `g${nextDerived}`;
    nextDerived++;
    return { ...(raw as Record<string, unknown>), id };
  });

  const validation = validateGenealogy(characters, withIds);
  const revisionBefore = genealogyRevision(links);
  const appliedLinkIds = validation.accepted.map((l) => l.id);
  const newLinks = [...links, ...validation.accepted.map((l) => ({ ...l }))];
  const application: GenealogyApplication = {
    id: applyId,
    projectId,
    appliedLinkIds,
    revisionBefore,
    revisionAfter: genealogyRevision(newLinks),
  };
  return {
    appliedLinkIds,
    links: newLinks,
    application,
    rejected: validation.rejected,
  };
}

export interface GenealogyQuery {
  characterId: string;
  parents: GenealogyLink[];
  children: GenealogyLink[];
  guardians: GenealogyLink[];
  partners: GenealogyLink[];
}

/** Consulta por personaje, solo con enlaces genealógicos (sin inferencia). */
export function queryGenealogy(links: readonly GenealogyLink[], characterId: string): GenealogyQuery {
  const parents: GenealogyLink[] = [];
  const children: GenealogyLink[] = [];
  const guardians: GenealogyLink[] = [];
  const partners: GenealogyLink[] = [];
  for (const link of links) {
    if (link.kind === 'biological_parent' || link.kind === 'adoptive_parent') {
      if (link.to === characterId) parents.push({ ...link });
      if (link.from === characterId) children.push({ ...link });
    } else if (link.kind === 'guardian') {
      if (link.to === characterId) guardians.push({ ...link });
    } else if (link.kind === 'partner') {
      if (link.from === characterId || link.to === characterId) partners.push({ ...link });
    }
  }
  return { characterId, parents, children, guardians, partners };
}

export interface UndoResult {
  links: GenealogyLink[];
  removedLinkIds: string[];
}

/**
 * Deshace una aplicación: elimina exactamente los enlaces que aplicó,
 * solo si la revisión actual del estado coincide con la registrada al
 * aplicar (nadie ha tocado los enlaces desde entonces).
 */
export function undoGenealogy(
  links: readonly GenealogyLink[],
  applications: Readonly<Record<string, GenealogyApplication>>,
  applyId: string,
  currentRevision: string,
  projectId = '',
): UndoResult {
  const application = applications[applyId];
  if (!application) {
    throw new GenealogyOpError('unknown_apply', `no hay registro de la aplicación ${applyId}`);
  }
  if (application.projectId !== projectId) {
    throw new GenealogyOpError('project_mismatch', 'la aplicación pertenece a otro proyecto');
  }
  if (genealogyRevision(links) !== currentRevision) {
    throw new GenealogyOpError('stale_revision', 'el estado cambió desde la aplicación; undo rechazado');
  }
  const applied = new Set(application.appliedLinkIds);
  const kept: GenealogyLink[] = [];
  const removedLinkIds: string[] = [];
  for (const link of links) {
    if (applied.has(link.id)) {
      removedLinkIds.push(link.id);
    } else {
      kept.push({ ...link });
    }
  }
  return { links: kept, removedLinkIds };
}
