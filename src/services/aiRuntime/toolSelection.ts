// ============================================================================
// AI runtime — which tools does this turn get? (pure, deterministic)
// ============================================================================
//
// The bridge has close to ninety tools. A 9B model that receives all of them
// on every turn spends its context on schemas and its attention on nothing.
// So each turn gets a small, explainable subset:
//
//   1. a fixed core (context, search, engine switch);
//   2. everything from the engine the user is looking at;
//   3. engines the message clearly talks about, by a bilingual keyword map;
//   4. individual tools whose name or description matches the message;
//   5. tools already used earlier in the conversation, so a follow-up works.
//
// Capped at `max` (16 by default). Write tools are removed outright for a
// read-only conversation — the executor refuses them again at call time, but a
// model that never sees them never proposes them.

import type { BridgeTool } from '@/services/aiBridge/schema';

export interface ToolSelectionInput {
  tools: readonly BridgeTool[];
  message: string;
  openEngine?: string | null;
  enabledEngines?: readonly string[];
  readOnly?: boolean;
  /** Tool names already used in this conversation. */
  usedTools?: readonly string[];
  max?: number;
}

export const CORE_TOOL_NAMES = ['wh_get_context', 'wh_search', 'wh_enable_engine'] as const;

/** Bilingual, accent-free keywords per engine. Matching is on word stems. */
const ENGINE_KEYWORDS: Record<string, string[]> = {
  writings: ['capitul', 'escrit', 'manuscrit', 'borrador', 'texto', 'prosa', 'escena', 'chapter', 'manuscript', 'draft', 'writing', 'prose', 'redact', 'continu', 'sinopsis', 'synops', 'version'],
  codex: ['personaje', 'codex', 'enciclopedia', 'lugar', 'objeto', 'faccion', 'concepto', 'ficha', 'character', 'location', 'item', 'faction', 'concept', 'entry', 'entrada'],
  outline: ['esquema', 'escaleta', 'beat', 'acto', 'estructura', 'outline', 'act', 'structure', 'plantilla', 'template', 'trama', 'plot'],
  notes: ['nota', 'idea', 'cita', 'palabra', 'note', 'quote', 'inbox', 'apunt'],
  diary: ['diario', 'bitacora', 'journal', 'diary', 'sesion', 'session'],
  timeline: ['cronolog', 'linea temporal', 'linea de tiempo', 'evento', 'fecha', 'timeline', 'event', 'date', 'when', 'cuando'],
  scrapper: ['recorte', 'enlace', 'link', 'instagram', 'web', 'pagina', 'articulo', 'clipping', 'snapshot', 'url', 'post', 'coleccion', 'collection', 'descarg', 'download'],
  'dialog-scene': ['dialogo', 'guion', 'escena de dialogo', 'reparto', 'dialog', 'dialogue', 'screenplay', 'script', 'cast', 'replica', 'line'],
  'character-arc': ['arco', 'arc', 'ghost', 'fantasma', 'mentira', 'lie', 'verdad', 'truth', 'want', 'need', 'deseo', 'necesidad', 'evolucion'],
  relationships: ['relacion', 'relationship', 'vinculo', 'bond', 'enemig', 'enemy', 'amig', 'friend', 'amor', 'love', 'famil'],
  seeds: ['semilla', 'seed', 'payoff', 'plantad', 'plant', 'chekhov', 'foreshadow', 'presagi', 'pista', 'clue'],
  biography: ['biograf', 'biography', 'hecho', 'fact', 'fuente', 'source', 'vida', 'life', 'documentad'],
  board: ['tablero', 'corcho', 'tarjeta', 'board', 'card', 'canvas', 'hilo', 'thread', 'mapa mental', 'mind map', 'brainstorm', 'lluvia'],
  gallery: ['galeria', 'imagen', 'foto', 'gallery', 'image', 'photo', 'picture', 'inspiracion', 'inspiration', 'referencia visual'],
  'image-studio': ['genera una imagen', 'generar imagen', 'generate an image', 'generate image', 'ilustra', 'illustrat', 'dibuja', 'draw', 'render', 'portada', 'cover', 'retrato', 'portrait', 'paisaje', 'landscape', 'stable diffusion', 'flux', 'estudio de imagen', 'image studio'],
  maps: ['mapa', 'map', 'pin', 'chincheta', 'region', 'territorio', 'geograf', 'ciudad', 'city', 'reino', 'kingdom'],
  worldgen: ['mundo', 'world', 'worldgen', 'planeta', 'planet', 'continente', 'continent', 'reino', 'realm', 'asentamiento', 'settlement', 'ciudad generada', 'gacetero', 'gazetteer', 'waypoint', 'hito', 'lugar del mundo'],
  'real-atlas': ['atlas', 'lugar real', 'real place', 'mundo real', 'real world', 'divergencia', 'divergence', 'ucron', 'alternate history', 'coordenadas', 'coordinates', 'latitud', 'longitud', 'direccion', 'address', 'historic', 'histor'],
  storyboard: ['storyboard', 'guion grafico', 'panel', 'plano', 'shot', 'vineta'],
  'video-planner': ['video', 'segmento', 'segment', 'teleprompter', 'plan de video', 'youtube', 'podcast', 'grabar', 'record'],
  annotations: ['anotacion', 'annotation', 'nota al margen', 'margin', 'comentario', 'comment', 'marca', 'highlight', 'resalt'],
  'pov-audit': ['pov', 'punto de vista', 'point of view', 'tiempo en pantalla', 'screen time', 'auditor', 'audit', 'equilibrio', 'balance'],
  'writing-stats': ['estadistic', 'stat', 'palabras por', 'words per', 'racha', 'streak', 'objetivo', 'goal', 'progreso', 'progress', 'productividad'],
};

/** Words that mean "across projects" — the only time wh_list_projects is offered. */
const CROSS_PROJECT_HINTS = ['otro proyecto', 'otros proyectos', 'mis proyectos', 'todos los proyectos', 'lista de proyectos', 'listar proyectos', 'que proyectos', 'other project', 'my projects', 'all projects', 'list projects', 'which projects', 'switch project', 'cambiar de proyecto', 'abre el proyecto', 'open the project', 'open project'];

/** Default order when the message gives no hint: what a writer reaches for. */
const DEFAULT_ENGINE_ORDER = ['writings', 'codex', 'outline', 'notes', 'timeline', 'diary'];

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOf(text: string): string[] {
  return fold(text).split(' ').filter((token) => token.length > 2);
}

export function selectToolsForTurn(input: ToolSelectionInput): BridgeTool[] {
  const max = Math.max(4, input.max ?? 16);
  const readOnly = input.readOnly === true;
  const enabled = new Set(input.enabledEngines ?? []);
  const folded = fold(input.message);
  const tokens = new Set(tokensOf(input.message));
  const used = new Set(input.usedTools ?? []);
  const byName = new Map(input.tools.map((tool) => [tool.name, tool]));
  const usable = (tool: BridgeTool | undefined): tool is BridgeTool =>
    Boolean(tool) && !(readOnly && (tool as BridgeTool).writes);

  const chosen: BridgeTool[] = [];
  const has = new Set<string>();
  const add = (tool: BridgeTool | undefined): void => {
    if (!usable(tool) || has.has(tool.name) || chosen.length >= max) return;
    has.add(tool.name);
    chosen.push(tool);
  };

  // 1. Core.
  for (const name of CORE_TOOL_NAMES) add(byName.get(name));
  // Explicit actions and conversation continuity outrank optional context.
  // Otherwise an expanding engine catalog can crowd out the requested action.
  if (/\b(borra|borrar|elimina|eliminar|quita|quitar|delete|remove)\b/.test(folded)) add(byName.get('wh_delete'));
  for (const tool of input.tools) {
    if (input.message.includes(tool.name)) add(tool);
  }
  if (CROSS_PROJECT_HINTS.some((hint) => folded.includes(hint))) add(byName.get('wh_list_projects'));
  for (const name of used) add(byName.get(name));
  add(byName.get('wh_get_editorial_context'));
  // Evidence must remain reachable before broad engine catalogs fill the budget.
  if (['writings', 'scrapper', 'biography'].includes(input.openEngine ?? '') ||
      /\b(investig\w*|fuente\w*|evidenc\w*|cita\w*|contrast\w*|verific\w*|periodis\w*|articul\w*|ensayo\w*|entrevist\w*|revisa\w*|research\w*|source\w*|fact\w*|report\w*|interview\w*|essay\w*|review\w*)\b/.test(folded)) {
    add(byName.get('wh_get_research_evidence'));
  }

  // 2/3. Engines, scored: the open one first, then keyword hits, then defaults.
  const scores = new Map<string, number>();
  for (const [engineId, words] of Object.entries(ENGINE_KEYWORDS)) {
    let score = 0;
    for (const word of words) {
      if (word.includes(' ') ? folded.includes(word) : [...tokens].some((tok) => tok.startsWith(word))) {
        score += word.includes(' ') ? 3 : 2;
      }
    }
    if (score > 0) scores.set(engineId, score);
  }
  if (input.openEngine) scores.set(input.openEngine, (scores.get(input.openEngine) ?? 0) + 4);
  for (const tool of input.tools) {
    if (tool.engineId && used.has(tool.name)) {
      scores.set(tool.engineId, (scores.get(tool.engineId) ?? 0) + 2);
    }
  }
  // An engine the message names is offered even when the project has it
  // switched off: the handler's own guard then tells the model to call
  // wh_enable_engine (or ask), which is more useful than silence.
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([engineId]) => engineId);

  // 4. Individual tools the words point at (delete, versions, tag, image…).
  //    The scores also order the tools WITHIN an engine below: an engine with
  //    more tools than the cap leaves room for (the world engine has close to
  //    twenty) keeps the ones the message names and drops the rest, instead
  //    of keeping whichever were declared first.
  const lexScore = new Map<string, number>();
  for (const tool of input.tools) {
    if (!usable(tool)) continue;
    const haystack = fold(`${tool.name.replace(/^wh_/, '').replace(/_/g, ' ')} ${tool.description.slice(0, 160)}`);
    let score = 0;
    for (const tok of tokens) {
      if (tok.length < 4) continue;
      if (haystack.includes(tok)) score += 1;
    }
    if (/\b(borra|borrar|elimina|eliminar|quita|quitar|delete|remove)\b/.test(folded) && tool.name === 'wh_delete') score += 5;
    if (score > 0) lexScore.set(tool.name, score);
  }
  const lexical = input.tools
    .filter((tool) => lexScore.has(tool.name) && !has.has(tool.name))
    .map((tool) => ({ tool, score: lexScore.get(tool.name) ?? 0 }))
    .sort((a, b) => b.score - a.score);

  // Declaration order, except that tools the message points at come first.
  const engineTools = (engineId: string): BridgeTool[] =>
    input.tools
      .map((tool, index) => ({ tool, index }))
      .filter(({ tool }) => tool.engineId === engineId)
      .sort((a, b) =>
        (lexScore.get(b.tool.name) ?? 0) - (lexScore.get(a.tool.name) ?? 0) || a.index - b.index)
      .map(({ tool }) => tool);

  for (const engineId of ranked) {
    for (const tool of engineTools(engineId)) add(tool);
  }
  for (const { tool, score } of lexical) {
    if (score >= 2) add(tool);
  }
  if (ranked.length === 0) {
    for (const engineId of DEFAULT_ENGINE_ORDER) {
      if (enabled.size && !enabled.has(engineId)) continue;
      for (const tool of engineTools(engineId)) add(tool);
    }
  }
  for (const { tool } of lexical) add(tool);

  return chosen;
}

/** Stable, human-readable summary for the debug line under a turn. */
export function describeSelection(tools: readonly BridgeTool[]): string {
  const groups = new Map<string, number>();
  for (const tool of tools) {
    const key = tool.engineId ?? tool.group ?? 'core';
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()].map(([key, count]) => `${key}×${count}`).join(', ');
}
