// ============================================
// AI Features — Summary, Characters, Consistency, Worldbuilding
// ============================================

import { callAi } from './aiService';
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

  try {
    return JSON.parse(response);
  } catch {
    // If AI wrapped it in markdown code blocks, strip them
    const cleaned = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  }
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

  try {
    return JSON.parse(response);
  } catch {
    const cleaned = response.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  }
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
