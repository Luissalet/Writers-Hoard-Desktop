import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from '@/db';
import { buildWorldBible, loadBibleData } from '@/services/worldBible';
import { runBridgeTool } from '@/services/aiBridge/dispatch';
import { BRIDGE_TOOLS } from '@/services/aiBridge/manifest';
import { TOOL_HANDLERS } from '@/services/aiBridge/tools';
import { useLocaleStore } from '@/stores/localeStore';
import WorldBiblePanel from '@/components/project/WorldBiblePanel';
import type { CodexEntry, Project } from '@/types';

function assert(value: unknown, note: string): asserts value { if (!value) throw new Error(note); }
export const BIBLE_FIXTURE_ID = 'qa-world-bible';
export async function seedBibleFixture() {
  const now = 1791532800000;
  const project: Project = { id: BIBLE_FIXTURE_ID, title: 'La ciudad del faro', description: 'Cuaderno de lugares, personas y acontecimientos.', mode: 'novelist', type: 'standalone', color: '#123', status: 'draft', enabledEngines: ['codex', 'timeline', 'maps', 'relationships'], engineOrder: [], createdAt: now, updatedAt: now };
  await db.projects.put(project);
  await db.projects.put({ ...project, id: 'foreign-project', title: 'Foreign' });
  const portrait = document.createElement('canvas'); portrait.width = 160; portrait.height = 180;
  const portraitContext = portrait.getContext('2d')!;
  portraitContext.fillStyle = '#e3ebef'; portraitContext.fillRect(0, 0, 160, 180);
  portraitContext.fillStyle = '#315f86'; portraitContext.font = '64px Georgia'; portraitContext.fillText('A', 55, 115);
  const entry = (id: string, title: string, extra: Partial<CodexEntry> = {}): CodexEntry => ({ id, title, type: 'character', projectId: project.id, fields: { occupation: 'Cartógrafa' }, tags: ['ciudad'], relations: [], content: '<p>Observa el mar desde la torre.</p>', createdAt: now, updatedAt: now, ...extra });
  await db.codexEntries.bulkPut([
    entry('ana', 'Ana Ruiz', { relations: [{ targetId: 'faro', targetTitle: 'El Faro', type: 'located_in' }], avatar: portrait.toDataURL('image/png') }),
    entry('faro', 'El Faro', { type: 'location', content: '<p>Una torre con dos luces.</p>', familySource: { app: 'scheherazade', ref: 'hoard://scheherazade/entity/lighthouse', revision: '1', localHash: 'abc', worldRef: 'hoard://scheherazade/world/w1', importedAt: now } }),
    entry('unsafe', '<script>attack</script>', { content: '<script>window.attack=1</script><img src="http://127.0.0.1:1/private"><a href="javascript:alert(1)">unsafe</a>' }),
    entry('foreign', 'Private outside project', { projectId: 'foreign-project' }),
  ]);
  await db.timelines.put({ id: 't1', projectId: project.id, title: 'Llegada a la ciudad', color: '#123', createdAt: now, updatedAt: now });
  await db.timelineEvents.put({ id: 'event1', timelineId: 't1', projectId: project.id, title: 'Se enciende la segunda luz', description: 'Ana llega al faro.', date: 'Día del viento', dateMode: 'text', eventType: 'point', order: 1, lane: '', color: '#123', linkedEntryId: 'ana', createdAt: now, updatedAt: now });
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#d4e5ed'; context.fillRect(0, 0, 640, 360);
  context.fillStyle = '#e8e2c9'; context.beginPath(); context.moveTo(0, 0); context.lineTo(400, 0); context.bezierCurveTo(480, 120, 210, 130, 340, 360); context.lineTo(0, 360); context.closePath(); context.fill();
  context.fillStyle = '#4e6256'; context.font = '22px Georgia'; context.fillText('Costa norte', 60, 180);
  await db.worldMaps.put({ id: 'map1', projectId: project.id, title: 'Costa norte', backgroundImage: canvas.toDataURL('image/png'), source: 'worldgen', sourceWorldId: 'world1', sourceRevision: 2, createdAt: now, updatedAt: now });
  await db.mapPins.put({ id: 'pin1', projectId: project.id, mapId: 'map1', name: 'Faro', icon: 'port', position: { x: 50, y: 20 }, linkedEntryId: 'faro', description: 'Puerto de la ciudad.' });
  const relationship = { id: 'rel1', projectId: project.id, entityAId: 'ana', entityAType: 'codex-entry', entityAName: 'Ana Ruiz', entityBId: 'faro', entityBType: 'codex-entry', entityBName: 'El Faro', kind: 'other' as const, intensity: 3, label: 'Cuida el faro', notes: 'Visita al anochecer.', state: 'current' as const, directional: true, createdAt: now, updatedAt: now };
  await db.relationships.bulkPut([relationship, { ...relationship, id: 'secret', state: 'secret', notes: 'QA_SECRET_VALUE' }]);
  return project;
}
export async function testWorldBible(): Promise<string[]> {
  const passed: string[] = [];
  const project = await seedBibleFixture();
  const before = JSON.stringify(await loadBibleData(project.id));
  const data = await loadBibleData(project.id);
  const artifact = buildWorldBible(data, {}, 1791532800000);
  const doc = new DOMParser().parseFromString(artifact.html, 'text/html');
  assert(artifact.counts.codex === 3 && artifact.counts.timeline === 1 && artifact.counts.maps === 1 && artifact.counts.relationships === 1, 'counts match selected scoped rows');
  assert(!artifact.html.includes('Private outside project') && !artifact.html.includes('QA_SECRET_VALUE'), 'foreign project and secret excluded');
  for (const link of doc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) assert(doc.getElementById(decodeURIComponent(link.getAttribute('href')!.slice(1))) || doc.getElementById(link.getAttribute('href')!.slice(1)), 'every local link resolves');
  assert(!doc.querySelector('script') && !doc.querySelector('[href^="javascript:"]') && !doc.querySelector('img[src^="http"]'), 'portable artifact strips executable content and remote images');
  assert(doc.querySelector('meta[http-equiv="Content-Security-Policy"]') && artifact.html.includes('hoard://scheherazade/entity/lighthouse') && artifact.html.includes('worldgen:world1@2'), 'CSP and provenance retained');
  passed.push('scoped compilation, index links, safe portable images and provenance');
  const partial = buildWorldBible(data, { entryIds: ['ana'], sections: ['codex', 'relationships'] });
  assert(partial.counts.codex === 1 && partial.html.includes('Fuera de la selección'), 'unselected targets have no broken link');
  assert(buildWorldBible(data, { sections: [] }).counts.codex === 0, 'empty selection is not silently all');
  assert(buildWorldBible(data, { includeSecrets: true }).html.includes('QA_SECRET_VALUE'), 'explicit secret opt-in');
  let rejected = false;
  try { buildWorldBible(data, { entryIds: ['foreign'] }); } catch { rejected = true; }
  assert(rejected, 'foreign explicit ID rejected');
  passed.push('partial and empty selection, secret opt-in, foreign selection rejection');
  const unicode = buildWorldBible({ ...data, entries: [{ ...data.entries[0], id: 'á /%?#' }] }, { sections: ['codex'] });
  const unicodeDocument = new DOMParser().parseFromString(unicode.html, 'text/html');
  const unicodeLink = unicodeDocument.querySelector<HTMLAnchorElement>('nav a[href^="#entry-"]')!;
  assert(unicodeDocument.getElementById(decodeURIComponent(unicodeLink.getAttribute('href')!.slice(1))), 'Unicode and URL-sensitive IDs resolve after fragment decoding');
  assert(BRIDGE_TOOLS.every(tool => !!TOOL_HANDLERS[tool.name]), 'catalogue handler parity');
  const reply = await runBridgeTool('wh_build_world_bible', { projectId: project.id, entryIds: ['ana'], locale: 'en' });
  assert(reply.ok && (reply.result as { html: string }).html.includes('World bible'), 'native bridge compiles selection');
  const bad = await runBridgeTool('wh_build_world_bible', { projectId: project.id, entryIds: ['foreign'] });
  assert(!bad.ok, 'bridge rejects foreign selection');
  assert((await runBridgeTool('wh_export_world_bible', { projectId: project.id, format: 'invalid' })).code === 'bad-args', 'invalid output rejected');
  passed.push('native bridge dispatch and manifest parity');
  await useLocaleStore.getState().setLocale('es');
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  await act(async () => { root.render(<WorldBiblePanel projectId={project.id} />); await new Promise(resolve => setTimeout(resolve, 300)); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
  assert(host.textContent?.includes('Biblia del mundo'), 'panel loads');
  const frame = host.querySelector('iframe');
  assert(frame?.getAttribute('sandbox') === '' && frame.srcdoc.includes('Ana Ruiz'), 'sandboxed preview contains selected data');
  assert(new DOMParser().parseFromString(frame.srcdoc, 'text/html').querySelector('base')?.getAttribute('href') === 'about:srcdoc', 'preview links use their document base, not the host app URL');
  const toggle = [...host.querySelectorAll('label')].find(label => label.textContent?.startsWith('Codex'))?.querySelector('input');
  assert(toggle, 'Codex toggle exists');
  await act(async () => { toggle.click(); await new Promise(resolve => setTimeout(resolve, 60)); });
  assert(!host.querySelector('iframe')!.srcdoc.includes('<article id="entry-'), 'UI deselection changes preview');
  await act(async () => { await useLocaleStore.getState().setLocale('en'); });
  assert(host.textContent?.includes('World bible') && host.querySelector('iframe')!.srcdoc.includes('Contents'), 'UI and document switch language');
  await act(async () => { root.unmount(); });
  assert(JSON.stringify(await loadBibleData(project.id)) === before, 'compilation and UI never mutate project content');
  passed.push('real React panel selection, sandbox, language and data preservation');
  return passed;
}
