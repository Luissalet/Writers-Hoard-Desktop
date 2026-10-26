import '@/services/aiBridge/dispatch';
import { db } from '@/db';
import { deleteProject } from '@/db/operations';
import type { Project } from '@/types';
import { assetBytes, assetFromFiles, addModelAsset, validateGlb } from '@/engines/model-viewer/model';
import { readWorldDocument, saveEraDocument, saveWorldEra } from '@/services/worldEras/store';
import { defineLocalTool, type LocalToolJson } from '@/engines/local/sdk';
import { createLocalToolClient } from '@/engines/local/storage';
import { installNavigator } from '@/engines/_shared/anchoring';
import { onDataChanged } from '@/engines/_shared/dataChanged';
import { clearUndoJournal, getUndoJournal } from '@/services/undoJournal';
import { modelAnimationPresentationFixture } from './model-animation-presentation-fixture';

// Real private renderer/DB. This fixture never mounts Source, CSS or a WebGL viewport.
async function prepare() {
  await db.open();
  if (await db.projects.count()) throw Error('Native clips profile must begin empty');
  const initialTables = await Promise.all(db.tables.map(async table => ({ name: table.name, rows: await table.toArray() })));
  clearUndoJournal();
  const projectId = 'native-clips-' + crypto.randomUUID(), controlId = projectId + '-control';
  const navigation: string[] = [], notices: unknown[] = [];
  installNavigator(path => { navigation.push(path); });
  const project: Project = { id: projectId, title: 'Private native clips', description: 'Synthetic transport fixture.', mode: 'custom', type: 'standalone', status: 'draft', color: '#957648', enabledEngines: ['model-viewer'], engineOrder: ['model-viewer'], createdAt: 1, updatedAt: 1 };
  await db.projects.bulkAdd([project, { ...project, id: controlId, title: 'Untouched control' }]);
  for (const [id, name] of [['inherited', 'Inherited'], ['own', 'Own'], ['sibling', 'Sibling']]) {
    await saveWorldEra(projectId, { id, name, description: 'Private era.', revision: 1, createdAt: 1, updatedAt: 1 }, null);
  }
  const bytes = await modelAnimationPresentationFixture(), json = validateGlb(bytes);
  const animations = json.animations as Array<{ name?: string; channels: unknown[] }>;
  if (JSON.stringify(animations.map(clip => clip.name)) !== JSON.stringify(['Same name', 'Same name', '']) || animations.some(clip => !clip.channels.length)) throw Error('Authored fixture names or actual channels changed');
  const asset = await assetFromFiles([new File([bytes], 'Three-clips.glb', { type: 'model/gltf-binary' })]);
  if (JSON.stringify([...new Uint8Array(assetBytes(asset))]) !== JSON.stringify([...new Uint8Array(bytes)])) throw Error('Normal import changed canonical bytes');
  if (Object.hasOwn(asset, 'animationPresentation')) throw Error('Normal legacy import materialized presentation');
  await addModelAsset(projectId, asset);
  const companionId = asset.id + '-companion', controlModelId = asset.id + '-control';
  await addModelAsset(projectId, { ...asset, id: companionId, name: 'Companion.glb' });
  await addModelAsset(controlId, { ...asset, id: controlModelId, name: 'Control.glb' });
  const ownScope = { projectId, eraId: 'own' }, inherited = await readWorldDocument(ownScope, 'model-viewer', asset.id);
  if (!inherited || inherited.provenance !== 'base') throw Error('Preparation inheritance positive failed');
  await saveEraDocument(ownScope, 'model-viewer', inherited.document, inherited.version);
  if ((await readWorldDocument(ownScope, 'model-viewer', asset.id))?.provenance !== 'variant') throw Error('Normal own variant preparation failed');

  const definition = defineLocalTool<{ note: string }>({ namespace: 'tests.model-clips-native', name: { en: 'Private query', es: 'Consulta privada' }, description: { en: 'Private readonly query.', es: 'Consulta privada de lectura.' }, initialState: { note: '' }, codec: { version: 1, fields: { note: { kind: 'prose' } } }, validateState: (value: LocalToolJson): value is { note: string } => !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.note === 'string', component: () => null });
  const stopNotices = onDataChanged(notice => { notices.push(notice); });
  const tables = () => Promise.all(db.tables.map(async table => ({ name: table.name, rows: await table.toArray() })));
  Reflect.set(window, '__clipsNativeSnapshot', async () => ({ tables: await tables(), location: location.href, navigation: [...navigation], journal: structuredClone(getUndoJournal()) }));
  Reflect.set(window, '__clipsNativeRead', async (args: { eraId?: string; modelId?: string }) => readWorldDocument({ projectId, eraId: args.eraId }, 'model-viewer', args.modelId ?? asset.id));
  Reflect.set(window, '__clipsNativeQuery', async (args: { eraId?: string; tool: string; args?: Record<string, LocalToolJson> }) => createLocalToolClient(projectId, definition, { eraId: args.eraId, readOnly: true }).callTool(args.tool, args.args ?? {}));
  Reflect.set(window, '__clipsNativeNotices', () => structuredClone(notices));
  Reflect.set(window, '__clipsNativeCleanup', async () => {
    stopNotices(); await deleteProject(projectId); await deleteProject(controlId);
    const after = await tables();
    return { projects: await db.projects.count(), journal: getUndoJournal().length, listeners: 0, initialTablesExact: JSON.stringify(after) === JSON.stringify(initialTables) };
  });
  Reflect.set(window, '__clipsNativeTables', tables);
  Reflect.set(window, '__clipsNativeReady', { projectId, controlId, modelId: asset.id, companionId, controlModelId, eraId: 'inherited', ownEraId: 'own', siblingEraId: 'sibling', clips: animations.map((clip, index) => ({ index, name: clip.name ?? '', label: clip.name || 'animation_' + index })), sourceHostMounted: false, webglMounted: false, importBytesExact: true, originalBytes: asset.size, initialProjects: 0 });
}
void prepare().catch(error => Reflect.set(window, '__clipsNativeFailure', String(error)));
