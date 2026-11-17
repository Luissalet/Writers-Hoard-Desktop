// ============================================================================
// Writers Hoard — the skills an agent receives when it connects over MCP stdio
// ============================================================================
//
// The family keeps a library of procedures (how to do a kind of work well). The
// hub copies the ones this app asks for into `<data>/skills/` (index.json plus
// one folder per skill). This module only READS that copy, so the skills are
// there whether the app, the hub or Faustus is open. Plain Node, no Electron.
//
//   skills_list / skill_read   answered here, from the copy
//   prompts skill-<slug>       the same procedures as MCP prompts
//   instructions               the skills are named at the end of the briefing
//
// Where the copy lives: WH_SKILLS_DIR when set (the manifest passes it), else
// the `backups/skills` folder beside the app's `aibridge` token folder. With
// nothing there, or HOARD_SKILLS=0, nothing is added and nothing fails.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ShelfSkill {
  slug: string;
  name: string;
  description: string;
  version: string;
  category: string;
  tags: string[];
  why: string;
  files: string[];
}

const SLUG = /^[a-z0-9][a-z0-9._-]{0,80}$/;
const MAX_FILE_BYTES = 400_000;

export const SKILL_TOOL_NAMES = ['skills_list', 'skill_read'] as const;

/** The folder holding the shelf's copy (index.json and one folder per skill). */
export function shelfDir(tokenFile = ''): string {
  const told = process.env.WH_SKILLS_DIR?.trim();
  if (told) return told;
  if (tokenFile) return path.join(path.dirname(path.dirname(tokenFile)), 'backups', 'skills');
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'writers-hoard', 'backups', 'skills');
}

function off(): boolean {
  return ['0', 'false', 'no', 'off'].includes((process.env.HOARD_SKILLS ?? '1').trim().toLowerCase());
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function words(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** The skills on the shelf; an unreadable or missing copy is an empty shelf. */
export function shelfSkills(dir: string): ShelfSkill[] {
  if (off() || !dir) return [];
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8').replace(/^\ufeff/, '')) as { skills?: unknown };
    if (!Array.isArray(data.skills)) return [];
    const rows: ShelfSkill[] = [];
    for (const item of data.skills) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const slug = text(row.slug);
      if (!SLUG.test(slug)) continue;
      rows.push({
        slug, name: text(row.name) || slug, description: text(row.description), version: text(row.version),
        category: text(row.category), tags: words(row.tags), why: text(row.why), files: words(row.files),
      });
    }
    return rows;
  } catch {
    return [];
  }
}

function appOf(dir: string): string {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8').replace(/^\ufeff/, '')) as { app?: unknown };
    return text(data.app) || 'writer';
  } catch {
    return 'writer';
  }
}

/** The briefing with the skills named at its end (unchanged when there are none). */
export function skillsInstructions(rows: ShelfSkill[], base = ''): string {
  if (!rows.length) return base;
  const lines = [
    'Skills. This app carries procedures from the family\'s skill library for the work it does. Before a task one of them covers, '
    + 'read it with skill_read and follow it; skills_list gives them again.',
    ...rows.map((row) => `- ${row.slug}: ${row.description}`),
  ];
  return [base, lines.join('\n')].filter(Boolean).join('\n\n');
}

/** The two tools, as `tools/list` entries. */
export function skillTools(): Array<Record<string, unknown>> {
  const annotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
  return [
    {
      name: 'skills_list',
      description: 'The skills this app carries: procedures from the family\'s skill library for the kind of work done here '
        + '(slug, what each is for and when to use it, version, reference files). Read the one that fits with skill_read before starting.',
      inputSchema: { type: 'object', properties: {} },
      annotations,
    },
    {
      name: 'skill_read',
      description: 'The full text of one of this app\'s skills: when to use it, the procedure step by step, its pitfalls and how to '
        + 'verify the result. Follow it while doing that work with this app\'s tools.',
      inputSchema: {
        type: 'object',
        required: ['slug'],
        properties: {
          slug: { type: 'string', description: 'The skill\'s slug, from skills_list.' },
          file: { type: 'string', description: 'One of the skill\'s reference files (from its `files`); empty = the procedure itself.' },
        },
      },
      annotations,
    },
  ];
}

export function isSkillTool(name: string): boolean {
  return (SKILL_TOOL_NAMES as readonly string[]).includes(name);
}

function findRow(rows: ShelfSkill[], wanted: string): ShelfSkill | undefined {
  const slug = wanted.trim().toLowerCase().replace(/^skill-/, '');
  return rows.find((row) => row.slug === slug || row.name.toLowerCase() === slug);
}

/** The text of one skill (or one of its reference files); throws a plain Error a model can act on. */
export function readSkill(dir: string, slug: string, file = ''): Record<string, unknown> {
  const rows = shelfSkills(dir);
  const row = findRow(rows, slug);
  if (!row) throw new Error(`No skill called ${JSON.stringify(slug)} on this app's shelf. skills_list names the ones there are.`);
  const rel = (file || 'SKILL.md').replace(/\\/g, '/');
  if (rel !== 'SKILL.md' && !row.files.includes(rel)) {
    throw new Error(`The skill ${row.slug} has no file ${JSON.stringify(rel)}. Its files: ${row.files.join(', ') || 'none'}.`);
  }
  const target = path.join(dir, row.slug, ...rel.split('/'));
  if (path.relative(path.join(dir, row.slug), target).startsWith('..')) throw new Error('That file is outside the skill.');
  let body: string;
  try {
    if (fs.statSync(target).size > MAX_FILE_BYTES) throw new Error('too large');
    body = fs.readFileSync(target, 'utf8');
  } catch (error) {
    throw new Error(`The copy of ${row.slug}/${rel} cannot be read (${(error as Error).message}).`);
  }
  return { slug: row.slug, name: row.name, version: row.version, file: rel, files: row.files, text: body };
}

/** Answer a skill tool call: `{ body, isError }`. */
export function callSkillTool(dir: string, name: string, args: Record<string, unknown>): { body: Record<string, unknown>; isError: boolean } {
  try {
    if (name === 'skills_list') return { body: { app: appOf(dir), skills: shelfSkills(dir) }, isError: false };
    return { body: readSkill(dir, text(args.slug), text(args.file)), isError: false };
  } catch (error) {
    return { body: { error: (error as Error).message, code: 'not_found' }, isError: true };
  }
}

/** `prompts/list` entries: `skill-<slug>`. */
export function skillPrompts(rows: ShelfSkill[]): Array<Record<string, unknown>> {
  return rows.map((row) => ({ name: `skill-${row.slug}`, description: row.description.slice(0, 900) }));
}

/** `prompts/get` result for one skill, without the front matter the library keeps. */
export function skillPrompt(dir: string, name: string): Record<string, unknown> {
  const row = readSkill(dir, name);
  let body = String(row.text);
  if (body.startsWith('---') && body.indexOf('\n---', 3) >= 0) body = body.slice(body.indexOf('\n---', 3) + 4).replace(/^\n+/, '');
  return {
    description: String(row.name || name),
    messages: [{ role: 'user', content: { type: 'text', text: `Follow this procedure with the tools of ${appOf(dir)}.\n\n${body}` } }],
  };
}
