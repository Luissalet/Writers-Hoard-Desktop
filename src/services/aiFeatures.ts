// ============================================
// AI Features — Summary, Characters, Consistency, Worldbuilding, Tagging
// ============================================

import { callAi } from './aiService';
import { parseJsonFromModel } from './aiText';
import { stripHtml } from '@/utils/googleDocsHtmlCleaner';
import { t } from '@/i18n/useTranslation';
import type { AiConfig, ExtractedCharacter, ConsistencyIssue } from '@/types';

/**
 * Generate a narrative summary in Spanish
 */
export async function generateSummary(
  htmlContent: string,
  config: AiConfig
): Promise<string> {
  const plainText = stripHtml(htmlContent);

  if (plainText.length < 50) {
    throw new Error(t('ai.textTooShort.summary'));
  }

  const systemPrompt = `Eres un asistente literario. Resume el siguiente texto narrativo
en 2-3 párrafos en español, manteniendo los puntos narrativos clave, los personajes
que aparecen, los eventos importantes y el tono general. No añadas interpretaciones,
solo resume lo que ocurre.`;

  return callAi(systemPrompt, plainText, config);
}

/**
 * Extract characters from a narrative text
 */
export async function extractCharacters(
  htmlContent: string,
  config: AiConfig
): Promise<ExtractedCharacter[]> {
  const plainText = stripHtml(htmlContent);

  if (plainText.length < 50) {
    throw new Error(t('ai.textTooShort.characters'));
  }

  const systemPrompt = `Eres un asistente literario. Lee el siguiente texto y extrae
TODOS los personajes que aparecen. Para cada uno devuelve un JSON array con objetos:
{
  "nombre": "string",
  "descripcionFisica": "string (si se menciona, si no 'No descrito')",
  "personalidad": "string (rasgos observados en el texto)",
  "relaciones": "string (con quién interactúa y cómo)",
  "citasRelevantes": ["frases textuales cortas que definen al personaje"],
  "rol": "protagonista | secundario | mencionado"
}

Responde SOLO con el JSON array válido. Sin markdown, sin backticks, sin explicaciones.`;

  const response = await callAi(systemPrompt, plainText, config);
  // Tolerates fences, preambles and <think> leakage (local models); a
  // SyntaxError still maps to ai.unexpectedFormat via safeAiCall.
  return parseJsonFromModel<ExtractedCharacter[]>(response);
}

/**
 * Check consistency across multiple chapters
 */
export async function checkConsistency(
  writings: { title: string; content: string }[],
  config: AiConfig
): Promise<ConsistencyIssue[]> {
  const combined = writings
    .map((w, i) => `=== ${w.title} (Capítulo ${i + 1}) ===\n${stripHtml(w.content)}`)
    .join('\n\n');

  // If text is too long, process in pairs
  if (combined.length > 100000) {
    const results: ConsistencyIssue[] = [];
    for (let i = 0; i < writings.length - 1; i++) {
      const pair = [writings[i], writings[i + 1]];
      const pairResults = await checkConsistency(pair, config);
      results.push(...pairResults);
    }
    return results;
  }

  const systemPrompt = `Eres un editor literario meticuloso. Analiza los siguientes
capítulos buscando inconsistencias narrativas:
- Contradicciones en descripciones físicas de personajes
- Errores de continuidad (objetos que aparecen/desaparecen sin explicación)
- Cambios de nombre o atributos no intencionados
- Líneas temporales que no cuadran
- Personajes que están en dos sitios a la vez

Devuelve un JSON array:
[{
  "tipo": "descripcion | continuidad | nombre | temporal | ubicacion",
  "descripcion": "qué inconsistencia encontraste",
  "capitulos": ["nombres de los capítulos afectados"],
  "gravedad": "alta | media | baja"
}]

Si no encuentras inconsistencias, devuelve [].
Responde SOLO con el JSON array válido.`;

  const response = await callAi(systemPrompt, combined, config);
  return parseJsonFromModel<ConsistencyIssue[]>(response);
}

/**
 * Expand worldbuilding for a Codex entry
 */
export async function expandWorldbuilding(
  codexEntry: {
    title: string;
    type: string;
    fields: Record<string, string>;
    content: string;
  },
  config: AiConfig
): Promise<string> {
  const entryText = [
    `Tipo: ${codexEntry.type}`,
    `Título: ${codexEntry.title}`,
    ...Object.entries(codexEntry.fields)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `${k}: ${v}`),
    `Descripción actual: ${stripHtml(codexEntry.content)}`,
  ].join('\n');

  const systemPrompt = `Eres un asistente de worldbuilding para un universo de fantasía
con tono entre Terry Pratchett y fantasía clásica. Dado el siguiente elemento del mundo,
sugiere expansiones y detalles adicionales que enriquezcan la entrada.

Mantén coherencia con lo que ya existe. Escribe en español.
Ofrece 3-5 sugerencias concretas, cada una como un párrafo breve y separado.
No repitas lo que ya está escrito. Sé creativo pero coherente.`;

  return callAi(systemPrompt, entryText, config);
}

/**
 * Suggest which of a project's EXISTING Scrapper tags apply to an imported
 * item, from its caption alone. Deliberately constrained to the existing
 * vocabulary — the point is "tag with what I already use", not "let the
 * model invent new tags" — so a caption that matches nothing returns []
 * rather than a fabricated new tag. Used by ImportCollectionModal's review
 * step (one call per imported post, run sequentially — a local single-GPU
 * Ollama model can't usefully serve concurrent generations anyway).
 */
export async function suggestSnapshotTags(
  caption: string,
  existingTags: string[],
  config: AiConfig
): Promise<string[]> {
  const text = caption.trim();
  if (!text || existingTags.length === 0) return [];

  const systemPrompt = `Eres un asistente que etiqueta recortes guardados (de Instagram u otras
webs) para un escritor. Estas son las etiquetas que YA EXISTEN en su aplicación:
${existingTags.map((tag) => `- ${tag}`).join('\n')}

Dado el texto (caption) de una publicación, devuelve un JSON array SOLO con las etiquetas de
esa lista que encajen con el contenido. Reglas:
- Usa EXCLUSIVAMENTE etiquetas de la lista de arriba, copiadas EXACTAMENTE igual (mismo texto).
- No inventes etiquetas nuevas, aunque creas que encajarían mejor.
- Si ninguna etiqueta de la lista encaja, devuelve [].
- Como mucho 5 etiquetas, las más relevantes primero.

Responde SOLO con el JSON array. Sin markdown, sin backticks, sin explicaciones.`;

  const response = await callAi(systemPrompt, text, config);
  const parsed = parseJsonFromModel<unknown>(response);
  if (!Array.isArray(parsed)) return [];

  // Defense in depth against the model paraphrasing or re-casing a tag
  // instead of copying it verbatim: keep only matches against the existing
  // vocabulary (case-insensitive), mapped back to that vocabulary's own casing.
  const byLower = new Map(existingTags.map((tag) => [tag.toLowerCase(), tag] as const));
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    const match = byLower.get(item.trim().toLowerCase());
    if (match && !out.includes(match)) out.push(match);
  }
  return out;
}
