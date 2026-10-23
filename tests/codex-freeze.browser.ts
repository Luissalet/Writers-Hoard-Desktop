import { db } from '@/db';
import type { CodexEntry, Project } from '@/types';
import { bindPropertyFormulas, projectCodexEntry } from '@/engines/codex/properties';
import type { CodexTemplate } from '@/engines/codex/templateTypes';
import { freezeCodexEntry } from '@/engines/codex/freeze';
import { runBridgeTool } from '@/services/aiBridge/dispatch';

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message); }

/** A card frozen from its type keeps what it shows, calculations included, and no longer follows the type. */
export async function testCodexFreeze(): Promise<string[]> {
  const P = 'synthetic-codex-freeze';
  const template: CodexTemplate = bindPropertyFormulas({ id: `${P}-t`, name: 'Barco', category: 'item', fields: { carga: '3', estado: '', puerto: 'Sal' }, propertyDefinitions: [
    { id: 'carga-id', key: 'carga', label: 'Carga', kind: 'number' },
    { id: 'estado-id', key: 'estado', label: 'Estado', kind: 'text', formula: '=IF(@[Carga]>2,"Cargado","Vacío")' },
  ], content: '', revision: 1, createdAt: 1, updatedAt: 1 });
  const entry: CodexEntry = { id: `${P}-e`, projectId: P, title: 'La Gaviota', type: 'item', templateId: template.id, fields: { carga: '4' }, content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1 };
  const frozen = freezeCodexEntry(entry, [template]);
  assert(frozen.templateId === undefined && frozen.fields.carga === '4' && frozen.fields.estado === 'Cargado' && frozen.fields.puerto === 'Sal', `Frozen values: ${JSON.stringify(frozen.fields)}`);
  assert(frozen.propertyDefinitions?.length === 2 && frozen.propertyDefinitions.every(d => !d.formula && !d.formulaBindings) && frozen.propertyDefinitions[0].kind === 'number', `Kinds kept, formulas gone: ${JSON.stringify(frozen.propertyDefinitions)}`);
  const passed = ['Freezing a card from its type: its inherited default ("Sal") and its calculated value ("Cargado") become its own values, the property kinds stay, the formulas go'];
  try {
    await db.projects.put({ id: P, title: 'Congelar', description: '', mode: 'custom', type: 'standalone', color: '#888888', status: 'draft', enabledEngines: ['codex'], codexTemplates: [template], createdAt: 1, updatedAt: 1 } satisfies Project);
    await db.codexEntries.put(entry);
    const loose = await runBridgeTool('wh_create_codex_entry', { projectId: P, title: 'Suelta' });
    const looseId = (loose.result as { id: string }).id;
    const refused = await runBridgeTool('wh_update_codex_entry', { id: looseId, freeze: true });
    assert(!refused.ok && /no type/.test(refused.error ?? ''), 'A card without a type cannot be frozen');
    const done = await runBridgeTool('wh_update_codex_entry', { id: entry.id, freeze: true });
    assert(done.ok, JSON.stringify(done));
    const stored = (await db.codexEntries.get(entry.id))!;
    assert(!stored.templateId && stored.fields.estado === 'Cargado', `Stored: ${JSON.stringify(stored)}`);
    // The type changes; the frozen card does not.
    const changed = bindPropertyFormulas({ ...template, fields: { ...template.fields, puerto: 'Bruma' }, propertyDefinitions: template.propertyDefinitions!.map(d => d.key === 'estado' ? { ...d, formula: '="Hundido"', formulaBindings: undefined } : d) });
    await db.projects.update(P, { codexTemplates: [changed] });
    const projected = projectCodexEntry(stored, [changed]);
    assert(projected.fields.estado === 'Cargado' && projected.fields.puerto === 'Sal', `Still its own: ${JSON.stringify(projected.fields)}`);
    passed.push('Bridge: wh_update_codex_entry freeze:true unlinks "La Gaviota" from its type with "Cargado" kept; a later change of the type (a new default, a new formula) does not reach it; a card with no type is refused');
  } finally {
    for (const table of db.tables) if (table.name !== 'projects' && table.schema.idxByName.projectId) await table.where('projectId').equals(P).delete();
    await db.projects.delete(P);
  }
  return passed;
}
