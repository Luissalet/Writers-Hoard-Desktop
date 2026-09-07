import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SceneLab } from '@/components/project/creative-lab';
import { db } from '@/db';
import {
  buildSceneVariantPromotionPreview,
  createSceneVariant,
  stageSceneVariantAsBranch,
  type SceneVariantPromotionPreview,
} from '@/services/sceneLab';
import { runSceneLabCoreTests, SCENE_LAB_SOURCE, SCENE_LAB_TARGET } from './scene-lab';

declare global {
  interface Window {
    __sceneLabResult?: { ok: boolean; tests: string[]; error?: string };
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function setControlValue(control: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  }
  throw new Error(message);
}

async function seedDatabase(): Promise<void> {
  await db.delete();
  await db.open();
  await db.projects.add({
    id: SCENE_LAB_SOURCE.projectId,
    title: 'Scene laboratory fixture',
    mode: 'novelist',
    type: 'standalone',
    color: '#c4973b',
    description: '',
    status: 'draft',
    enabledEngines: ['dialog-scene', 'outline'],
    engineOrder: ['dialog-scene', 'outline'],
    createdAt: 1,
    updatedAt: 1,
  });
  await db.scenes.add({
    id: SCENE_LAB_SOURCE.id,
    projectId: SCENE_LAB_SOURCE.projectId,
    title: SCENE_LAB_SOURCE.title,
    description: 'Canonical scene description',
    order: 0,
    tags: [],
    createdAt: 1,
    updatedAt: SCENE_LAB_SOURCE.revision ?? 1,
  });
  await db.outlines.add({
    id: 'outline-source',
    projectId: SCENE_LAB_SOURCE.projectId,
    title: 'Fixture outline',
    createdAt: 1,
    updatedAt: 1,
  });
  await db.outlineBeats.add({
    id: SCENE_LAB_TARGET.entityId,
    outlineId: 'outline-source',
    projectId: SCENE_LAB_TARGET.projectId,
    order: 0,
    level: 'scene',
    title: SCENE_LAB_TARGET.title,
    description: SCENE_LAB_TARGET.description,
    status: 'outlined',
    createdAt: 1,
    updatedAt: SCENE_LAB_TARGET.revision,
  });
}

async function runTests(): Promise<string[]> {
  const passed = runSceneLabCoreTests();
  await seedDatabase();

  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const callbacks: SceneVariantPromotionPreview[] = [];
  await act(async () => {
    root.render(
      <SceneLab
        projectId={SCENE_LAB_SOURCE.projectId}
        scenes={[SCENE_LAB_SOURCE]}
        structuralTargets={[SCENE_LAB_TARGET]}
        locale="es"
        createVariantId={() => 'ui-variant'}
        now={() => 700}
        onPromote={async (preview) => {
          callbacks.push(preview);
          return stageSceneVariantAsBranch(preview);
        }}
      />,
    );
  });

  assert(host.querySelector('section[aria-labelledby]'), 'the scene laboratory has no programmatic heading');
  assert(host.querySelector('form textarea'), 'the declared variable has no editable control');
  const change = host.querySelector<HTMLTextAreaElement>('form textarea');
  assert(change, 'the declared change control is unavailable');
  await act(async () => setControlValue(change, 'El testigo cuenta la escena y oculta la salida.'));
  const create = host.querySelector<HTMLButtonElement>('form button[type="submit"]');
  assert(create && !create.disabled, 'a valid local take cannot be created from the keyboard');
  await act(async () => create.click());

  assert(host.querySelector('input[type="range"][aria-valuetext]'), 'tension has no accessible scale');
  assert(host.querySelector('table'), 'the original and first variant were not compared');
  assert(host.textContent?.includes('Intención') && host.textContent.includes('Tensión') && host.textContent.includes('Voz') && host.textContent.includes('Texto'), 'comparison omits a required scene dimension');
  assert(host.textContent?.includes('canon intacto'), 'the ephemeral boundary is not visible');

  const review = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.includes('Revisar delta estructural'));
  assert(review, 'structural review action is missing');
  await act(async () => review.click());
  assert(callbacks.length === 0, 'opening a preview mutated the branch kernel');
  assert(host.textContent?.includes('Vista previa de la rama'), 'structural preview did not open');
  const confirm = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.includes('Preparar rama'));
  assert(confirm && !confirm.disabled, 'reviewed branch cannot be staged');
  await act(async () => confirm.click());
  await waitFor(() => callbacks.length === 1 && Boolean(host.textContent?.includes('Preparada como rama')), 'branch callback did not finish');

  const canonicalBeat = await db.outlineBeats.get(SCENE_LAB_TARGET.entityId);
  assert(canonicalBeat?.title === SCENE_LAB_TARGET.title, 'Scene Lab wrote directly into canonical structure');
  assert(canonicalBeat.description === SCENE_LAB_TARGET.description, 'Scene Lab replaced canonical description');
  const branches = await db.creativeBranches.where('projectId').equals(SCENE_LAB_SOURCE.projectId).toArray();
  assert(branches.length === 1 && branches[0].status === 'active', 'the adapter did not create one active branch');
  const deltas = await db.creativeBranchDeltas.where('branchId').equals(branches[0].id).toArray();
  assert(deltas.length === 1 && deltas[0].targetKind === 'outline-beat', 'the adapter did not reuse the structural branch kernel');
  assert(!JSON.stringify(deltas[0]).includes(SCENE_LAB_SOURCE.text), 'the branch delta contains source prose');
  const links = await db.entityLinks.where('projectId').equals(SCENE_LAB_SOURCE.projectId).toArray();
  assert(links.length === 1 && links[0].sourceEntityId === SCENE_LAB_SOURCE.id, 'branch provenance is not linked to the real scene');
  assert(links[0].notes?.includes('scene-lab') && links[0].notes.includes('declaredVariable'), 'persisted provenance lost the experiment');

  const staleVariant = createSceneVariant({
    id: 'stale-variant',
    source: SCENE_LAB_SOURCE,
    variable: 'cost',
    value: 'Mara loses the evidence',
    createdAt: 800,
  });
  const stalePreview = buildSceneVariantPromotionPreview({
    variant: staleVariant,
    target: SCENE_LAB_TARGET,
    title: 'Stale proposal',
    description: 'Must not be staged.',
  });
  await db.outlineBeats.update(SCENE_LAB_TARGET.entityId, { updatedAt: SCENE_LAB_TARGET.revision + 1 });
  try {
    await stageSceneVariantAsBranch(stalePreview);
    throw new Error('stale preview reached the branch kernel');
  } catch (error) {
    assert(error instanceof Error && error.message.includes('changed after the preview'), 'stale preview failed without an actionable conflict');
  }
  assert(await db.creativeBranches.count() === 1, 'stale staging left a partial branch');
  assert(await db.entityLinks.count() === 1, 'stale staging left partial provenance');

  await act(async () => root.unmount());
  host.remove();
  await db.delete();

  return [
    ...passed,
    'accessible UI compares all four scene dimensions and calls the host only after preview',
    'branch adapter is atomic, provenance-linked, stale-safe, and never mutates canon',
  ];
}

void runTests().then(
  (tests) => { window.__sceneLabResult = { ok: true, tests }; },
  (error: unknown) => {
    window.__sceneLabResult = {
      ok: false,
      tests: [],
      error: error instanceof Error ? `${error.stack ?? error.message}` : String(error),
    };
  },
);
