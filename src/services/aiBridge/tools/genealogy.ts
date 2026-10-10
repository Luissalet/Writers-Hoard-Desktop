// ============================================================================
// AI bridge tools — genealogy (contract §5)
// ============================================================================
//
// Wires the five genealogy contract tools (preview/validate/apply/query/undo)
// into the AI bridge. The pure engine modules do the work; this file only
// adapts them to the bridge surface: argument checks, table access and the
// in-memory application registry that undo needs.
//
// Handlers are exposed through a factory that takes the links table and a
// character loader explicitly, so tests can run without Dexie or the app DB;
// the real registration in tools/index.ts passes the live table.

import type { BridgeTool, BridgeToolSchema } from '../schema';
import type { GenealogyLink } from '../../../engines/genealogy/validate.ts';
import {
  ANCESTRY_KINDS,
  NON_ANCESTRY_KINDS,
  validateGenealogy,
} from '../../../engines/genealogy/validate.ts';
import {
  GenealogyOpError,
  applyGenealogy,
  queryGenealogy,
  undoGenealogy,
  type GenealogyApplication,
} from '../../../engines/genealogy/genealogyOps.ts';
import { previewGenealogyImport } from '../../../engines/genealogy/importPreview.ts';
import { importGenealogyObsidian } from '../../../engines/genealogy/obsidianImport.ts';
import { importGenealogyNotion } from '../../../engines/genealogy/notionImport.ts';
import { importGenealogyWorldAnvil } from '../../../engines/genealogy/worldAnvilImport.ts';
import { importGenealogyCampfire } from '../../../engines/genealogy/campfireImport.ts';
import {
  deleteGenealogyLink,
  loadGenealogyLinks,
  saveGenealogyLinks,
  type GenealogyTableLike,
} from '../../../engines/genealogy/genealogyRepo.ts';

const ALL_KINDS = [...ANCESTRY_KINDS, ...NON_ANCESTRY_KINDS] as const;

const LINKS_SCHEMA: BridgeToolSchema = {
  type: 'object',
  required: ['projectId', 'links'],
  properties: {
    projectId: { type: 'string', description: 'Project the links belong to.' },
    links: {
      type: 'array',
      items: { type: 'object' },
      description:
        'Genealogy links: { id, from, to, kind, label? } with kind one of biological_parent, adoptive_parent, guardian, partner.',
    },
  },
  additionalProperties: false,
};

export const GENEALOGY_BRIDGE_TOOLS: BridgeTool[] = [
  {
    name: 'wh_genealogy_preview',
    description:
      'Preview a genealogy link proposal against the links already stored in the project: returns additions, duplicates and conflicts without writing anything.',
    writes: false,
    schema: LINKS_SCHEMA,
  },
  {
    name: 'wh_genealogy_validate',
    description:
      'Validate a genealogy link proposal (shape, kinds, self-links, cycles) and return per-link issues without writing anything.',
    writes: false,
    schema: {
      type: 'object',
      required: ['projectId', 'characters', 'links'],
      properties: {
        projectId: { type: 'string', description: 'Project the links belong to.' },
        characters: {
          type: 'array',
          items: { type: 'object' },
          description: 'Project characters the links may reference (at least id and name).',
        },
        links: {
          type: 'array',
          items: { type: 'object' },
          description: 'Genealogy links to validate.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_genealogy_apply',
    description:
      'Apply a genealogy link proposal: validates, stores only the accepted links and registers the application so it can be undone. Returns applied and rejected links with an applyId.',
    writes: true,
    schema: LINKS_SCHEMA,
  },
  {
    name: 'wh_genealogy_import',
    description:
      'Parse an export from a supported format (obsidian, notion, worldanvil, campfire) into a genealogy link proposal with a preview (additions/duplicates/conflicts). Read-only: returns the proposal; apply it with wh_genealogy_apply.',
    writes: false,
    schema: {
      type: 'object',
      required: ['projectId', 'format', 'text'],
      properties: {
        projectId: { type: 'string', description: 'Project the import belongs to.' },
        format: {
          type: 'string',
          description: 'One of: obsidian, notion, worldanvil, campfire.',
        },
        text: {
          type: 'string',
          description: 'Export content (markdown for obsidian/notion/worldanvil, JSON for campfire).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_genealogy_query',
    description:
      'Query the genealogy of one character: parents, children, guardians and partners by direction, from the stored links.',
    writes: false,
    schema: {
      type: 'object',
      required: ['projectId', 'characterId'],
      properties: {
        projectId: { type: 'string', description: 'Project to query.' },
        characterId: { type: 'string', description: 'Character whose relations are queried.' },
        kind: {
          type: 'string',
          description: `Optional kind filter: one of ${ALL_KINDS.join(', ')}.`,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wh_genealogy_undo',
    description:
      'Undo a previous genealogy apply: removes exactly the links that application stored, only if the stored links have not changed since (revision guard).',
    writes: true,
    schema: {
      type: 'object',
      required: ['projectId', 'applyId', 'revision'],
      properties: {
        projectId: { type: 'string', description: 'Project the application belongs to.' },
        applyId: { type: 'string', description: 'applyId returned by wh_genealogy_apply.' },
        revision: {
          type: 'string',
          description: 'revisionAfter returned by the same wh_genealogy_apply call.',
        },
      },
      additionalProperties: false,
    },
  },
];

type CharacterLoader = (
  projectId: string,
) => Promise<ReadonlyArray<{ id: string; [key: string]: unknown }>>;

function errorReply(err: unknown): { ok: false; code: string; error: string } {
  if (err instanceof GenealogyOpError) {
    return { ok: false, code: err.code, error: err.message };
  }
  return {
    ok: false,
    code: 'internal_error',
    error: err instanceof Error ? err.message : String(err),
  };
}

export function createGenealogyBridgeHandlers(
  table: GenealogyTableLike,
  loadCharacters: CharacterLoader,
): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
  const applications = new Map<string, GenealogyApplication>();

  const requireProjectId = (args: Record<string, unknown>): string => {
    const projectId = args.projectId;
    if (typeof projectId !== 'string' || projectId.length === 0) {
      throw new GenealogyOpError('invalid_project', 'projectId debe ser un string no vacío');
    }
    return projectId;
  };

  const requireLinks = (args: Record<string, unknown>): unknown[] => {
    if (!Array.isArray(args.links)) {
      throw new GenealogyOpError('invalid_links', 'links debe ser un array');
    }
    return args.links;
  };

  return {
    wh_genealogy_import: async (args) => {
      try {
        requireProjectId(args);
        const format = args.format;
        const text = args.text;
        if (typeof format !== 'string' || format.length === 0) {
          throw new GenealogyOpError('invalid_format', 'format debe ser un string no vacío');
        }
        if (typeof text !== 'string' || text.length === 0) {
          throw new GenealogyOpError('invalid_text', 'text debe ser un string no vacío');
        }
        const parsed =
          format === 'obsidian'
            ? importGenealogyObsidian(text)
            : format === 'notion'
              ? importGenealogyNotion(text)
              : format === 'worldanvil'
                ? importGenealogyWorldAnvil(text)
                : format === 'campfire'
                  ? importGenealogyCampfire(JSON.parse(text))
                  : null;
        if (!parsed) {
          throw new GenealogyOpError(
            'invalid_format',
            `formato desconocido: ${format} (soportados: obsidian, notion, worldanvil, campfire)`,
          );
        }
        const existing = await loadGenealogyLinks(table, args.projectId as string);
        const preview = previewGenealogyImport({ incoming: parsed.links, existing });
        return { ok: true, format, proposal: parsed.links, issues: parsed.issues, preview };
      } catch (err) {
        return errorReply(err);
      }
    },

    wh_genealogy_preview: async (args) => {
      try {
        const projectId = requireProjectId(args);
        const incoming = requireLinks(args);
        const existing = await loadGenealogyLinks(table, projectId);
        const preview = previewGenealogyImport({ incoming, existing });
        return { ok: true, preview };
      } catch (err) {
        return errorReply(err);
      }
    },

    wh_genealogy_validate: async (args) => {
      try {
        const projectId = requireProjectId(args);
        const links = requireLinks(args);
        const characters = await loadCharacters(projectId);
        const validation = validateGenealogy(characters, links);
        const issues = validation.rejected.flatMap((r) => r.issues);
        return { ok: issues.length === 0, issues, accepted: validation.accepted };
      } catch (err) {
        return errorReply(err);
      }
    },

    wh_genealogy_apply: async (args) => {
      try {
        const projectId = requireProjectId(args);
        const proposal = requireLinks(args);
        const characters = await loadCharacters(projectId);
        const existing = await loadGenealogyLinks(table, projectId);
        const applyId = `genealogy-${crypto.randomUUID()}`;
        const result = applyGenealogy(
          characters,
          existing,
          proposal,
          applyId,
          Object.fromEntries(applications),
          projectId,
        );
        let receipt: Awaited<ReturnType<typeof saveGenealogyLinks>>;
        try {
          receipt = await saveGenealogyLinks(table, projectId, result.links);
        } catch (err) {
          throw new GenealogyOpError(
            'save_failed',
            `save threw: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        if (receipt.saved !== result.links.length) {
          throw new GenealogyOpError(
            'save_failed',
            `save wrote ${receipt.saved} of ${result.links.length} links`,
          );
        }
        applications.set(applyId, result.application);
        return {
          ok: true,
          applyId,
          revisionAfter: result.application.revisionAfter,
          applied: result.appliedLinkIds,
          rejected: result.rejected,
        };
      } catch (err) {
        return errorReply(err);
      }
    },

    wh_genealogy_query: async (args) => {
      try {
        const projectId = requireProjectId(args);
        const characterId = args.characterId;
        if (typeof characterId !== 'string' || characterId.length === 0) {
          throw new GenealogyOpError('invalid_character_id', 'characterId debe ser un string no vacío');
        }
        const kind = args.kind;
        if (kind !== undefined && !ALL_KINDS.includes(kind as (typeof ALL_KINDS)[number])) {
          throw new GenealogyOpError('invalid_kind', `kind debe ser uno de: ${ALL_KINDS.join(', ')}`);
        }
        const links = await loadGenealogyLinks(table, projectId);
        const filtered =
          kind === undefined ? links : links.filter((l: GenealogyLink) => l.kind === kind);
        const query = queryGenealogy(filtered, characterId);
        return { ok: true, ...query };
      } catch (err) {
        return errorReply(err);
      }
    },

    wh_genealogy_undo: async (args) => {
      try {
        const projectId = requireProjectId(args);
        const applyId = args.applyId;
        if (typeof applyId !== 'string' || applyId.length === 0) {
          throw new GenealogyOpError('invalid_apply_id', 'applyId debe ser un string no vacío');
        }
        const revision = args.revision;
        if (typeof revision !== 'string') {
          throw new GenealogyOpError('invalid_revision', 'revision debe ser un string');
        }
        const links = await loadGenealogyLinks(table, projectId);
        const result = undoGenealogy(links, Object.fromEntries(applications), applyId, revision, projectId);
        for (const id of result.removedLinkIds) {
          await deleteGenealogyLink(table, projectId, id);
        }
        applications.delete(applyId);
        return { ok: true, removed: result.removedLinkIds };
      } catch (err) {
        return errorReply(err);
      }
    },
  };
}
