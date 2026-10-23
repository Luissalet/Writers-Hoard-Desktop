// Guided cards: the questions, the dialog one step at a time, and the bridge.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { db } from '@/db';
import type { CodexEntry, Project } from '@/types';
import GuidedCardDialog from '@/components/codex/GuidedCardDialog';
import { CARD_GUIDES, cardGuide, guideAnswers } from '@/engines/codex/guides';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const P = 'synthetic-codex-guided';

export async function testCodexGuided(): Promise<string[]> {
  const passed: string[] = [];
  const character = cardGuide('character')!;
  const made = guideAnswers(character, ['Una contrabandista del puerto', '  Pagar la deuda de su hermano ', '', 'Que la reconozcan'], 'es');
  assert(JSON.stringify(made.fields) === JSON.stringify({ 'En pocas palabras': 'Una contrabandista del puerto', Objetivo: 'Pagar la deuda de su hermano', Secreto: 'Que la reconozcan' }) && made.content === '<p>Una contrabandista del puerto</p>', `Answers: ${JSON.stringify(made)}`);
  assert(CARD_GUIDES.length === 5 && CARD_GUIDES.every(guide => guide.steps.length >= 4), 'Five guides');
  passed.push('Guides for a character, a location, an event, a faction and an item (4 to 6 questions each); each answer fills its field, blank ones nothing, and the first opens the description');
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null, created: CodexEntry | null = null;
  const setText = async (selector: string, value: string) => { const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement; assert(el, selector); await act(async () => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); await pause(); }); };
  const click = async (selector: string) => { const el = document.querySelector(selector) as HTMLButtonElement; assert(el && !el.disabled, `${selector} clickable`); await act(async () => { el.click(); await pause(); }); };
  try {
    await act(async () => { root = createRoot(host); root.render(<GuidedCardDialog projectId={P} open locale="es" onClose={() => undefined} onCreate={async entry => { created = entry; }} />); await pause(300); });
    for (let i = 0; i < 30 && !document.querySelector('[data-testid="guided-type-location"]'); i++) await act(async () => { await pause(80); });
    await click('[data-testid="guided-type-location"]');
    assert(/Paso 1 de 7/.test(document.querySelector('[data-testid="guided-step"]')?.textContent ?? ''), 'Step 1 of 7');
    await setText('[data-testid="guided-title"]', 'El puerto viejo');
    await click('[data-testid="guided-next"]');
    await setText('[data-testid="guided-answer"]', 'Un muelle de piedra hundido a medias');
    await click('[data-testid="guided-next"]');
    await click('[data-testid="guided-skip"]');
    await setText('[data-testid="guided-answer"]', 'Gaviotas, brea y pescado');
    await click('[data-testid="guided-skip"]');
    await click('[data-testid="guided-skip"]');
    await click('[data-testid="guided-skip"]');
    assert(/Paso 7 de 7/.test(document.querySelector('[data-testid="guided-step"]')?.textContent ?? ''), 'Last step');
    await setText('[data-testid="guided-answer"]', 'Un túnel de contrabando bajo la lonja');
    await click('[data-testid="guided-done"]');
    for (let i = 0; i < 20 && !created; i++) await act(async () => { await pause(50); });
    const entry = created as CodexEntry | null;
    assert(entry && entry.type === 'location' && entry.title === 'El puerto viejo' && JSON.stringify(entry.fields) === JSON.stringify({ 'En pocas palabras': 'Un muelle de piedra hundido a medias', 'Sonidos y olores': 'Gaviotas, brea y pescado', Secreto: 'Un túnel de contrabando bajo la lonja' }), `Created: ${JSON.stringify(entry)}`);
    passed.push('"Ficha guiada" → Lugar: the name, then one question at a time (the gist answered, \"Al llegar\" skipped, the sounds answered, two more skipped, the secret answered) makes "El puerto viejo" with those three fields');
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }
  try {
    await db.projects.put({ id: P, title: 'Guías', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex'], createdAt: 1, updatedAt: 1 } satisfies Project);
    const guides = await runBridgeTool('wh_codex_guides', { type: 'faction', locale: 'en' });
    const steps = (guides.result as { guides: Array<{ steps: Array<{ field: string; question: string }> }> }).guides[0].steps;
    assert(guides.ok && steps[1].field === 'Wants' && /want/.test(steps[1].question), `Guides: ${JSON.stringify(guides).slice(0, 300)}`);
    const card = await runBridgeTool('wh_codex_guided_create', { projectId: P, type: 'faction', title: 'La Orden de la Sal', answers: ['Una orden de navegantes', 'Controlar las rutas'] });
    assert(card.ok, JSON.stringify(card));
    const stored = await db.codexEntries.get((card.result as { id: string }).id);
    assert(stored?.type === 'faction' && stored.fields.Quiere === 'Controlar las rutas' && /Una orden de navegantes/.test(stored.content), `Stored: ${JSON.stringify(stored)}`);
    const tooMany = await runBridgeTool('wh_codex_guided_create', { projectId: P, type: 'item', title: 'x', answers: ['1', '2', '3', '4', '5'] });
    assert(!tooMany.ok && /up to 4/.test(tooMany.error ?? ''), 'Too many answers refused');
    passed.push('Bridge: wh_codex_guides gives the questions and the field each fills; wh_codex_guided_create makes the card from the answers (too many answers refused)');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
