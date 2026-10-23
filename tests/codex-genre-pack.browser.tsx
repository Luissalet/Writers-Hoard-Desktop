// Codex types seeded from the world's genres: the pack, the template manager's
// button and wh_codex_seed_genre_types (dry run, adding, never twice, undo).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { Project } from '@/types';
import CodexTemplateManager from '@/components/codex/CodexTemplateManager';
import { GENRE_PACKS, genrePackTemplates, genrePackTypes } from '@/engines/codex/genrePacks';
import { validateTemplatePresentation } from '@/engines/codex/templateTypes';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { useLocaleStore } from '@/stores/localeStore';

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
const P = 'synthetic-codex-genre-pack';

export async function testCodexGenrePack(): Promise<string[]> {
  const passed: string[] = [];
  const all = genrePackTypes(Object.keys(GENRE_PACKS));
  for (const type of all) validateTemplatePresentation({ icon: type.icon, color: type.color });
  assert(all.length === 56, `Pack size: ${all.length}`);
  const fantasy = genrePackTemplates(['Fantasy'], [{ name: 'hechizo' }], 'es');
  assert(fantasy.map(t => t.name).join() === 'Protagonista,Asentamiento,Acontecimiento,Reino,Criatura,Artefacto,Orden', `Fantasy without the existing "Hechizo": ${fantasy.map(t => t.name)}`);
  assert(genrePackTemplates(['Sci-Fi'], [], 'en').find(t => t.name === 'Starship')?.fields.Drive === '', 'English names and fields');
  assert(genrePackTemplates(['Unknown genre'], [], 'es').length === 3, 'An unknown genre still gets the base types');
  passed.push(`The genre pack holds ${all.length} types over ${Object.keys(GENRE_PACKS).length} genres (each with a valid icon and colour); a type whose name the project already uses is left out, accents and case aside; Spanish or English names and fields`);
  useLocaleStore.setState({ locale: 'es' });
  await db.projects.put({ id: P, title: 'Géneros', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex'], genres: ['Fantasy', 'Horror'], createdAt: 1, updatedAt: 1 } satisfies Project);
  const host = document.getElementById('root'); assert(host, 'root');
  let root: Root | null = null;
  try {
    await act(async () => { root = createRoot(host); root.render(<MemoryRouter><CodexTemplateManager projectId={P} open onClose={() => undefined} onUse={() => undefined} /></MemoryRouter>); await pause(300); });
    let button: HTMLButtonElement | null = null;
    for (let i = 0; i < 40 && !button; i++) { button = document.querySelector('[data-testid="codex-seed-genres"]'); if (!button) await act(async () => { await pause(80); }); }
    assert(button && /Crear 11 tipos/.test(button.textContent ?? ''), `Offered: ${button?.textContent}`);
    await act(async () => { button!.click(); await pause(600); });
    const status = document.querySelector('[data-testid="codex-seeded"]')?.textContent ?? '';
    const names = ((await db.projects.get(P))!.codexTemplates ?? []).map(t => t.name);
    assert(/11 tipos creados/.test(status) && names.includes('Entidad') && names.includes('Hechizo') && names.length === 11, `Seeded: ${status} ${names}`);
    for (let i = 0; i < 20 && !/Ya tienes/.test(document.querySelector('[data-testid="codex-seed-genres"]')?.textContent ?? ''); i++) await act(async () => { await pause(80); });
    assert((document.querySelector('[data-testid="codex-seed-genres"]') as HTMLButtonElement).disabled, 'Nothing more to add');
    passed.push(`Type manager: for "Fantasy, Horror" it offers "Crear 11 tipos de tus géneros", creates them (${names.slice(0, 5).join(', ')}…) and then has nothing more to add`);
  } finally {
    await act(async () => { root?.unmount(); await pause(); });
  }
  try {
    const dry = await runBridgeTool('wh_codex_seed_genre_types', { projectId: P, genres: ['Sci-Fi'], locale: 'en', dryRun: true });
    const would = (dry.result as { wouldAdd: Array<{ name: string }> }).wouldAdd.map(t => t.name);
    assert(dry.ok && would.join() === 'Protagonist,Settlement,Event,Starship,Planet,Species,Technology,Corporation' && ((await db.projects.get(P))!.codexTemplates ?? []).length === 11, `Dry run: ${would}`);
    const made = await runBridgeTool('wh_codex_seed_genre_types', { projectId: P, genres: ['Sci-Fi'], locale: 'es' });
    const added = (made.result as { added: string[] }).added;
    assert(made.ok && added.join() === 'Nave estelar,Planeta,Especie,Tecnología,Corporación', `Only the missing ones: ${added}`);
    const audit = (made.result as { __audit: { entityId: string; projectId: string; before: unknown } }).__audit;
    const undone = await runBridgeTool('__undo', { entry: { tool: 'wh_codex_seed_genre_types', kind: 'update', entityId: audit.entityId, projectId: audit.projectId, before: audit.before, summary: 'seed' } });
    assert(undone.ok && ((await db.projects.get(P))!.codexTemplates ?? []).length === 11, `Undo removes them: ${JSON.stringify(undone).slice(0, 200)}`);
    await db.projects.update(P, { genres: [] });
    const none = await runBridgeTool('wh_codex_seed_genre_types', { projectId: P });
    assert(!none.ok && /no genres/.test(none.error ?? ''), 'No genres refused');
    passed.push('Bridge: wh_codex_seed_genre_types lists the Sci-Fi types as a dry run without adding, adds only the five the project lacks, undo removes them, and a project without genres is refused');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
