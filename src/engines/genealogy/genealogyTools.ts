import { validateGenealogy } from './validate.ts';
import type { GenealogyLink } from './validate.ts';
import {
  GenealogyOpError,
  applyGenealogy,
  queryGenealogy,
  undoGenealogy,
} from './genealogyOps.ts';
import type { GenealogyApplication } from './genealogyOps.ts';

/**
 * Despachador puro de las herramientas MCP del contrato genealógico (§5).
 * No toca I/O ni el bridge: el transporte real (MCP stdio/HTTP) consume
 * `GENEALOGY_TOOLS` y llama a `dispatchGenealogyTool` con el estado del
 * documento. Los límites del contrato se aplican aquí:
 * - preview/validate: solo lectura, nunca mutan el estado.
 * - apply: aplica solo los aceptados y registra la aplicación.
 * - query: solo enlaces genealógicos, sin inferencia.
 * - undo: exige revisión actual (guarda de revisión).
 */

export interface GenealogyToolState {
  characters: ReadonlyArray<{ id: string; [key: string]: unknown }>;
  links: readonly GenealogyLink[];
  applications: Readonly<Record<string, GenealogyApplication>>;
}

export interface GenealogyToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const GENEALOGY_TOOLS: GenealogyToolSpec[] = [
  {
    name: 'genealogy_preview',
    description:
      'Vista previa de una propuesta de enlaces genealógicos: valida y devuelve aceptados/rechazados con cadenas de ciclo. Solo lectura.',
    inputSchema: {
      type: 'object',
      required: ['links'],
      properties: { links: { type: 'array', items: { type: 'object' } } },
    },
  },
  {
    name: 'genealogy_validate',
    description:
      'Valida una propuesta de enlaces genealógicos sin efectos sobre el estado. Igual que genealogy_preview.',
    inputSchema: {
      type: 'object',
      required: ['links'],
      properties: { links: { type: 'array', items: { type: 'object' } } },
    },
  },
  {
    name: 'genealogy_apply',
    description:
      'Aplica una propuesta validada: añade solo los enlaces aceptados y registra la aplicación con revisiones antes/después.',
    inputSchema: {
      type: 'object',
      required: ['links', 'applyId'],
      properties: {
        links: { type: 'array', items: { type: 'object' } },
        applyId: { type: 'string', minLength: 1 },
      },
    },
  },
  {
    name: 'genealogy_query',
    description:
      'Consulta los parentescos de un personaje: padres, hijos, guardianes y pareja. Solo enlaces genealógicos, sin inferencia.',
    inputSchema: {
      type: 'object',
      required: ['characterId'],
      properties: { characterId: { type: 'string', minLength: 1 } },
    },
  },
  {
    name: 'genealogy_undo',
    description:
      'Deshace una aplicación registrada, solo si la revisión actual del estado coincide con la registrada al aplicar.',
    inputSchema: {
      type: 'object',
      required: ['applyId', 'currentRevision'],
      properties: {
        applyId: { type: 'string', minLength: 1 },
        currentRevision: { type: 'string', minLength: 1 },
      },
    },
  },
];

export interface GenealogyToolResult {
  tool: string;
  validation?: ReturnType<typeof validateGenealogy>;
  appliedLinkIds?: string[];
  links?: GenealogyLink[];
  application?: GenealogyApplication;
  rejected?: { link: unknown; issues: { code: string; detail: string; chain?: string[] }[] }[];
  query?: ReturnType<typeof queryGenealogy>;
  removedLinkIds?: string[];
}

export function dispatchGenealogyTool(
  state: GenealogyToolState,
  tool: string,
  args: Record<string, unknown>,
): GenealogyToolResult {
  switch (tool) {
    case 'genealogy_preview':
    case 'genealogy_validate': {
      const proposal = args.links;
      if (!Array.isArray(proposal)) {
        throw new GenealogyOpError('invalid_links', 'links debe ser un array');
      }
      return { tool, validation: validateGenealogy(state.characters, proposal) };
    }
    case 'genealogy_apply': {
      const proposal = args.links;
      if (!Array.isArray(proposal)) {
        throw new GenealogyOpError('invalid_links', 'links debe ser un array');
      }
      const result = applyGenealogy(
        state.characters,
        state.links,
        proposal,
        args.applyId as string,
        state.applications,
      );
      return {
        tool,
        appliedLinkIds: result.appliedLinkIds,
        links: result.links,
        application: result.application,
        rejected: result.rejected,
      };
    }
    case 'genealogy_query': {
      const characterId = args.characterId;
      if (typeof characterId !== 'string' || characterId.length === 0) {
        throw new GenealogyOpError('invalid_character_id', 'characterId debe ser un string no vacío');
      }
      return { tool, query: queryGenealogy(state.links, characterId) };
    }
    case 'genealogy_undo': {
      const applyId = args.applyId;
      const currentRevision = args.currentRevision;
      if (typeof applyId !== 'string' || applyId.length === 0) {
        throw new GenealogyOpError('invalid_apply_id', 'applyId debe ser un string no vacío');
      }
      if (typeof currentRevision !== 'string' || currentRevision.length === 0) {
        throw new GenealogyOpError('invalid_revision', 'currentRevision debe ser un string no vacío');
      }
      const result = undoGenealogy(state.links, state.applications, applyId, currentRevision);
      return { tool, links: result.links, removedLinkIds: result.removedLinkIds };
    }
    default:
      throw new GenealogyOpError('unknown_tool', `herramienta genealógica desconocida: ${tool}`);
  }
}
