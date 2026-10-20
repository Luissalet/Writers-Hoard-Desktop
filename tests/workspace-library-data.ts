import { db } from '@/db';
import type { Project } from '@/types';

export async function seedWorkspaceLibrary(P: string): Promise<Project> {
  const project: Project = { id: P, title: 'El atlas del viento', type: 'standalone', mode: 'custom', color: '#d5b575', description: '', status: 'draft', enabledEngines: ['codex', 'writings', 'maps', 'board', 'timeline', 'notes', 'media', 'dictionary', 'tables'], engineOrder: ['codex', 'writings'], createdAt: 1, updatedAt: 1,
    dictionaries: [{ id: `${P}-language`, name: 'Lengua del estuario', description: '', scriptMapping: '', detectInManuscript: false, words: [] }],
    dataTables: [{ id: `${P}-table`, title: 'Rutas comerciales', mode: 'table', columns: [{ id: 'route', name: 'Ruta', kind: 'text' }], rows: [{ id: 'one', cells: { route: 'Puerto del Viento → Salinas' } }] }],
    relationTrees: [{ id: `${P}-tree`, title: 'Casa del río', nodes: [], edges: [], revision: 0, createdAt: 1, updatedAt: 1 }],
    characterSheets: [{ id: `${P}-sheet`, title: 'Nora · Exploradora', preset: 'custom', details: {}, numbers: {}, traits: [], skills: [], resources: [], rows: [], rolls: [], revision: 0, createdAt: 1, updatedAt: 1 }],
    radarCharts: [{ id: `${P}-radar`, title: 'Equilibrio de facciones', description: '', axes: [], series: [], revision: 0, createdAt: 1, updatedAt: 1 }],
  };
  await db.projects.put(project);
  await db.codexEntries.put({ id: `${P}-entry`, projectId: P, type: 'location', title: 'Puerto del Viento', fields: {}, content: '<p>La ciudad conserva sus cartas.</p>', tags: ['coast'], relations: [], createdAt: 1, updatedAt: 1 });
  await db.writings.put({ id: `${P}-writing`, projectId: P, title: 'La última carta', content: '<p>El río cambió de dirección.</p>', wordCount: 6, status: 'draft', tags: [], createdAt: 1, updatedAt: 1 });
  await db.worldMaps.put({ id: `${P}-map`, projectId: P, title: 'Estuario del norte', features: [], createdAt: 1, updatedAt: 1 });
  await db.boards.put({ id: `${P}-board`, projectId: P, title: 'Hilos de la tormenta', surface: 'slate', createdAt: 1, updatedAt: 1 });
  await db.timelines.put({ id: `${P}-timeline`, projectId: P, title: 'Año de las mareas', color: '#d5b575', createdAt: 1, updatedAt: 1 });
  await db.notes.put({ id: `${P}-note`, projectId: P, kind: 'idea', text: 'La brújula apunta al pasado\nPista para el segundo acto.', tags: [], pinned: false, createdAt: 1, updatedAt: 1 });
  const bytes = new Uint8Array(44 + 1600), header = new DataView(bytes.buffer), text = (offset: number, value: string) => [...value].forEach((letter, index) => { bytes[offset + index] = letter.charCodeAt(0); });
  text(0, 'RIFF'); header.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true); header.setUint32(24, 8000, true); header.setUint32(28, 16000, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true); text(36, 'data'); header.setUint32(40, 1600, true);
  await db.localMediaAssets.put({ id: `${P}-media`, projectId: P, title: 'Lluvia en el muelle', kind: 'audio', mime: 'audio/wav', blob: new Blob([bytes], { type: 'audio/wav' }), size: bytes.length, notes: '', tags: [], linkedEntryIds: [], createdAt: 1, updatedAt: 1 });
  return project;
}
