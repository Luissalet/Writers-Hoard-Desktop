// ============================================================================
// Visual references — the resolver, the store, and the training export
// ============================================================================
//
// Runs inside the critical harness (a real Chromium window with a real
// IndexedDB), so the migration test upgrades an actual v28 database and the
// render test mounts the actual React tree. Each exported `testVisualRef…`
// throws on failure; `critical.browser.ts` calls them in `run()`.
//
// The state tested FIRST is the one with no image backend at all: a reference
// that is a name, a fragment and an uploaded portrait has to be useful before
// a single pixel is generated, or the whole object is just a settings panel
// for a feature the writer may never install.

import Dexie from 'dexie';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/db';
import type { InspirationImage } from '@/types';
import type { VisualRef } from '@/types/visualRef';
import { emptyVisualRef } from '@/types/visualRef';
import {
  NEGATIVE_PROMPT_MIN_CFG,
  POSE_CONTROL_WEIGHT,
  adaptDialect,
  buildDataset,
  datasetTrigger,
  describeResolverModel,
  diffRecipes,
  draftCaption,
  joinInDialect,
  mentionToken,
  parseMentions,
  readRecipe,
  resolve,
  variationSeeds,
  type ResolverModel,
} from '@/services/visualRef';
import {
  addToReferenceSet,
  createVisualRef,
  deleteVisualRef,
  listVisualRefs,
  pinHeroSeed,
  removeFromReferenceSet,
  setCanonicalImage,
} from '@/engines/image-studio/refs';
import ImageStudioEngine from '@/engines/image-studio/ImageStudioEngine';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const PROJECT = 'vref-project';

function ref(overrides: Partial<VisualRef> = {}): VisualRef {
  return { ...emptyVisualRef('vref-elena', PROJECT, 'Elena', 1_000), ...overrides };
}

function model(overrides: Partial<ResolverModel> = {}): ResolverModel {
  return {
    connectionId: 'conn',
    modelId: 'test-model',
    dialect: 'prose',
    supportsLora: false,
    supportsReferenceImages: false,
    supportsPhotoMaker: false,
    supportsControlNet: false,
    supportsInitImage: false,
    ...overrides,
  };
}

const codes = (steps: readonly { code: string }[]): string[] => steps.map((step) => step.code);

// ---------------------------------------------------------------------------
// 1. The state with no backend at all
// ---------------------------------------------------------------------------

export function testVisualRefBareRefResolves(): void {
  // A reference that is nothing but a name — the day-one object — must still
  // produce a prompt. Anything that throws here makes the visual bible
  // unusable until the writer has filled in fields they do not have yet.
  const bare = ref();
  const resolved = resolve([bare], '', '', model(), { seedMode: 'explore' });
  assert(resolved.prompt === 'Elena.', `bare ref resolved to "${resolved.prompt}"`);
  assert(resolved.negativePrompt === undefined, 'a bare ref invented a negative prompt');
  assert(resolved.loras.length === 0 && resolved.referenceImages.length === 0, 'a bare ref attached something');
  assert(resolved.strategies[bare.id] === 'prompt-only', 'a bare ref did not fall through to words');

  // And with no refs at all: the composer must not need one to work.
  const empty = resolve([], 'a lighthouse at dawn', 'oil painting', model(), { seedMode: 'explore' });
  assert(empty.prompt === 'a lighthouse at dawn. oil painting.', `empty cast resolved to "${empty.prompt}"`);
}

// ---------------------------------------------------------------------------
// 2. The resolver's order, branch by branch
// ---------------------------------------------------------------------------

export function testVisualRefResolverOrder(): void {
  const elena = ref({
    promptFragment: 'a tall woman in a grey coat',
    triggerWord: 'elena_ohwx',
    canonicalImageId: 'img-canon',
    lora: { fileName: 'elena-v3', weight: 0.85, baseFamily: 'sdxl' },
  });

  // 1. A LoRA whose family matches wins, and the trigger word goes first.
  const withLora = resolve([elena], 'in the rain', '', model({ supportsLora: true, family: 'sdxl' }), { seedMode: 'explore' });
  assert(withLora.strategies[elena.id] === 'lora', 'a matching LoRA was not applied');
  assert(withLora.prompt.startsWith('elena_ohwx'), `trigger word not first: "${withLora.prompt}"`);
  assert(withLora.loras.length === 1 && withLora.loras[0].weight === 0.85, 'the LoRA weight was lost');
  assert(withLora.referenceImages.length === 0, 'a LoRA generation still attached a reference image');

  // A LoRA from another family is not weak, it is wrong — and the writer is told.
  const wrongFamily = resolve([elena], '', '', model({ supportsLora: true, family: 'flux' }), { seedMode: 'explore' });
  assert(wrongFamily.strategies[elena.id] === 'prompt-only', 'a cross-family LoRA was applied anyway');
  assert(codes(wrongFamily.steps).includes('loraFamilyMismatch'), 'the family mismatch was not disclosed');
  assert(!wrongFamily.prompt.includes('elena_ohwx'), 'an unapplied LoRA still spent its trigger word');

  // A runtime that cannot load LoRAs says so rather than pretending.
  const noLoraRuntime = resolve([elena], '', '', model({ family: 'sdxl' }), { seedMode: 'explore' });
  assert(codes(noLoraRuntime.steps).includes('loraUnsupported'), 'a LoRA-less runtime stayed silent');

  // 2. No LoRA → an edit model takes the canonical portrait as image 1.
  const plain = ref({ promptFragment: 'a tall woman in a grey coat', canonicalImageId: 'img-canon' });
  const edit = resolve([plain], 'in the rain', '', model({ supportsReferenceImages: true }), { seedMode: 'explore' });
  assert(edit.strategies[plain.id] === 'reference-image', 'an edit model did not take the portrait');
  assert(edit.referenceImages[0].imageId === 'img-canon' && edit.referenceImages[0].role === 'identity', 'wrong reference attached');
  assert(edit.prompt.includes('the person in image 1'), `edit instruction missing: "${edit.prompt}"`);

  // The ordinal has to match the attachment order when there are two subjects.
  const marco = { ...plain, id: 'vref-marco', name: 'Marco', canonicalImageId: 'img-marco' };
  const two = resolve([plain, marco], 'arguing', '', model({ supportsReferenceImages: true }), { seedMode: 'explore' });
  assert(two.referenceImages.length === 2, 'the second subject was dropped');
  assert(two.prompt.includes('the person in image 1') && two.prompt.includes('the person in image 2'), `ordinals wrong: "${two.prompt}"`);

  // An edit model with nothing to show is told so, not handed a blank.
  const noPortrait = resolve([ref()], '', '', model({ supportsReferenceImages: true }), { seedMode: 'explore' });
  assert(codes(noPortrait.steps).includes('noCanonical'), 'the missing canonical portrait was not disclosed');
  assert(noPortrait.referenceImages.length === 0, 'an absent portrait was attached anyway');

  // 3. No LoRA, no edit model → PhotoMaker takes the face.
  const photo = resolve([plain], '', '', model({ supportsPhotoMaker: true }), { seedMode: 'explore' });
  assert(photo.strategies[plain.id] === 'photomaker', 'PhotoMaker did not pick the face up');
  assert(photo.referenceImages[0].role === 'face', 'PhotoMaker attached the wrong role');

  // 4. The fragment is spliced whatever carried the face.
  for (const resolved of [withLora, edit, photo]) {
    assert(resolved.prompt.includes('a tall woman in a grey coat'), `the fragment was dropped: "${resolved.prompt}"`);
  }
}

export function testVisualRefNegativeCfgRule(): void {
  const elena = ref({ negativeFragment: 'blurry, extra fingers' });
  const guided = resolve([elena], '', '', model({ cfg: 6.5 }), { seedMode: 'explore' });
  assert(guided.negativePrompt === 'blurry, extra fingers.', `negative lost at cfg 6.5: "${guided.negativePrompt}"`);
  assert(codes(guided.steps).includes('negative'), 'an applied negative was not disclosed');

  // A distilled model at cfg 1 has no negative branch to steer with. Sending
  // the text anyway and showing the field working teaches the writer that
  // their negative prompt did something.
  const distilled = resolve([elena], '', '', model({ cfg: NEGATIVE_PROMPT_MIN_CFG }), { seedMode: 'explore' });
  assert(distilled.negativePrompt === undefined, 'a cfg-1 model was sent a negative prompt');
  assert(codes(distilled.steps).includes('negativeIgnored'), 'the ignored negative was hidden from the writer');

  // Unknown guidance is treated as honoured: dropping the writer's words on a
  // guess is the worse of the two mistakes.
  const unknown = resolve([elena], '', '', model(), { seedMode: 'explore' });
  assert(unknown.negativePrompt === 'blurry, extra fingers.', 'an unknown cfg silently dropped the negative');
}

export function testVisualRefDialect(): void {
  assert(adaptDialect('A tall woman. She wears a grey coat', 'prose', 'tags') === 'A tall woman, She wears a grey coat', 'prose→tags split wrong');
  assert(adaptDialect('1girl, grey coat, rain', 'tags', 'prose') === '1girl, grey coat, rain.', 'tags→prose join wrong');
  assert(adaptDialect('unchanged text', 'tags', 'tags') === 'unchanged text', 'same-dialect text was rewritten');
  assert(joinInDialect(['a', 'b'], 'tags') === 'a, b', 'tag join wrong');
  assert(joinInDialect(['a.', 'b'], 'prose') === 'a. b.', 'prose join doubled a full stop');

  const tagRef = ref({ dialect: 'tags', promptFragment: '1girl, grey coat' });
  const toProse = resolve([tagRef], '', '', model({ dialect: 'prose' }), { seedMode: 'explore' });
  assert(toProse.prompt === '1girl, grey coat.', `tags→prose fragment wrong: "${toProse.prompt}"`);
  assert(codes(toProse.steps).includes('dialectAdapted'), 'the dialect adaptation was not disclosed');

  const same = resolve([tagRef], '', '', model({ dialect: 'tags' }), { seedMode: 'explore' });
  assert(!codes(same.steps).includes('dialectAdapted'), 'a same-dialect fragment claimed an adaptation');

  // The family is what picks the dialect, and it is read from the descriptor.
  const sdxl = describeResolverModel({ connectionId: 'c', id: 'm', family: 'sdxl', capabilities: [] });
  const flux = describeResolverModel({ connectionId: 'c', id: 'm', family: 'flux', capabilities: [] });
  assert(sdxl.dialect === 'tags' && flux.dialect === 'prose', 'family → dialect mapping wrong');
}

export function testVisualRefSeedAndPose(): void {
  const elena = ref({ heroSeed: 4242 });

  const locked = resolve([elena], '', '', model(), { seedMode: 'lock' });
  assert(locked.seed === 4242, `hero seed not used when locked: ${locked.seed}`);
  assert(codes(locked.steps).includes('seedHero'), 'the hero seed was not disclosed');

  // Locking identity on a reference that has no hero seed yet must not invent
  // one: a fabricated seed would be pinned by the next click and be wrong.
  const noHero = resolve([ref()], '', '', model(), { seedMode: 'lock' });
  assert(noHero.seed === undefined, 'a missing hero seed was invented');

  const explore = resolve([elena], '', '', model(), { seedMode: 'explore', exploreSeed: 7 });
  assert(explore.seed === 7, 'explore ignored the seed it was handed');
  assert(codes(explore.steps).includes('seedExplore'), 'explore mode was not disclosed');

  const manual = resolve([elena], '', '', model(), { seedMode: 'manual', manualSeed: 99 });
  assert(manual.seed === 99, 'a typed seed was overridden');

  // A pinned pose only exists if the model can hold one; otherwise it is
  // visibly refused rather than silently dropped.
  const pose = { refId: elena.id, imageId: 'img-pose' };
  const withControl = resolve([elena], '', '', model({ supportsControlNet: true }), { seedMode: 'lock', pose });
  const control = withControl.referenceImages.find((image) => image.role === 'pose');
  assert(control?.imageId === 'img-pose', 'the pinned pose was not attached');
  assert(control?.weight === POSE_CONTROL_WEIGHT, `pose weight ${control?.weight} is outside the working band`);
  assert(POSE_CONTROL_WEIGHT >= 0.4 && POSE_CONTROL_WEIGHT <= 0.7, 'the pose weight left the 0.4–0.7 band');

  const withoutControl = resolve([elena], '', '', model(), { seedMode: 'lock', pose });
  assert(withoutControl.referenceImages.length === 0, 'a pose was attached to a model that cannot hold one');
  assert(codes(withoutControl.steps).includes('poseUnsupported'), 'the refused pose was not explained');
}

export function testVisualRefResolverIsPure(): void {
  const elena = ref({
    promptFragment: 'a tall woman',
    negativeFragment: 'blurry',
    triggerWord: 'elena_ohwx',
    canonicalImageId: 'img-canon',
    heroSeed: 11,
    lora: { fileName: 'elena-v3', weight: 0.8, baseFamily: 'sdxl' },
  });
  const args = [
    [elena],
    'in the rain',
    'oil painting',
    model({ supportsLora: true, family: 'sdxl', cfg: 7, supportsControlNet: true }),
    { seedMode: 'lock' as const, pose: { refId: elena.id, imageId: 'img-pose' } },
  ] as const;
  const first = resolve(...args);
  const second = resolve(...args);
  assert(JSON.stringify(first) === JSON.stringify(second), 'the resolver is not pure: two identical calls differed');

  // And it does not mutate what it was handed.
  const snapshot = JSON.stringify(elena);
  resolve([elena], 'x', 'y', model(), { seedMode: 'explore' });
  assert(JSON.stringify(elena) === snapshot, 'the resolver mutated the reference it was given');
}

export function testVisualRefMentions(): void {
  const elena = ref();
  const marco = ref({ id: 'vref-marco', name: 'Marco Aurelio' });
  const parsed = parseMentions('@Elena and @{Marco Aurelio} at @Nobody, arguing', [elena, marco]);
  assert(parsed.refs.length === 2 && parsed.refs[0].id === elena.id, 'mentions resolved to the wrong refs');
  assert(parsed.unknown.length === 1 && parsed.unknown[0] === 'Nobody', 'an unmatched mention was swallowed');
  assert(parsed.rest.includes('arguing'), `the rest of the slot was lost: "${parsed.rest}"`);
  assert(mentionToken(marco) === '@{Marco Aurelio}', 'a name with a space was not braced');

  // Accents and case fold, because the writer types the name as the book has it.
  const maria = ref({ id: 'vref-maria', name: 'María' });
  assert(parseMentions('@maria', [maria]).refs.length === 1, 'an accented name did not match');

  // The same reference named twice is one subject, not two.
  assert(parseMentions('@Elena @Elena', [elena]).refs.length === 1, 'a repeated mention duplicated the subject');
}

export function testVisualRefRecipes(): void {
  const before = readRecipe({
    prompt: 'elena in the rain', connectionId: 'c', modelId: 'sdxl',
    width: 1024, height: 1024, steps: 20, seed: 5, createdAt: 1,
  });
  const after = readRecipe({
    prompt: 'elena in the rain', connectionId: 'c', modelId: 'sdxl',
    width: 1024, height: 1024, steps: 30, seed: 6, createdAt: 2,
  });
  const differences = diffRecipes(before, after);
  const fields = differences.map((difference) => difference.field);
  assert(fields.includes('steps') && fields.includes('seed'), `diff missed a field: ${fields.join(', ')}`);
  assert(!fields.includes('prompt'), 'an unchanged prompt was reported as changed');
  const steps = differences.find((difference) => difference.field === 'steps');
  assert(steps?.before === '20' && steps.after === '30', 'the steps diff lost its values');

  // The widened generation fields are read when they are there and are simply
  // absent when they are not — this is what has to survive the runtime merge.
  const widened = readRecipe({
    prompt: 'p', connectionId: 'c', modelId: 'm', width: 512, height: 512, createdAt: 1,
    cfg: 7, sampler: 'euler', loras: [{ name: 'elena-v3', weight: 0.8 }],
  } as Parameters<typeof readRecipe>[0]);
  assert(widened.cfg === 7 && widened.sampler === 'euler', 'the widened fields were not read');
  // The slots as typed, which is what «iterate on this» puts back: the
  // resolved prompt cannot be re-entered, because `@Elena` has already become
  // her trigger word and her description by the time it is written down.
  const withSlots = readRecipe({
    prompt: 'elena_ohwx, a tall woman, in the rain', connectionId: 'c', modelId: 'm',
    width: 512, height: 512, createdAt: 1,
    composer: { subjects: '@Elena', scene: 'in the rain', style: 'oil painting' },
  } as Parameters<typeof readRecipe>[0]);
  assert(withSlots.composer?.subjects === '@Elena', 'the composer slots were not read back');
  assert(before.composer === undefined, 'an older row was given composer slots it never had');
  assert(widened.loras.length === 1, 'the widened LoRA list was not read');
  assert(before.cfg === undefined && before.loras.length === 0, 'absent widened fields were invented');

  // Variations step around the seed and never below zero.
  assert(JSON.stringify(variationSeeds(10, 6)) === JSON.stringify([10, 11, 9, 12, 8, 13]), `variation seeds wrong: ${variationSeeds(10, 6)}`);
  assert(variationSeeds(0, 4).every((seed) => seed >= 0), 'a variation seed went negative');
}

// ---------------------------------------------------------------------------
// 3. The training export
// ---------------------------------------------------------------------------

export function testVisualRefCaptions(): void {
  const prose = 'She is tall and wears a long grey coat. Her eyes are pale green. '
    + 'She keeps her hair in a braid and never takes off her round glasses. '
    + 'Her complexion is olive.';
  const drafted = draftCaption('elena_ohwx', [prose]);
  assert(drafted.caption.startsWith('elena_ohwx'), `the trigger word is not first: "${drafted.caption}"`);
  assert(drafted.caption.includes('grey coat'), 'the coat — detachable — was left out of the caption');
  assert(drafted.kept.some((clause) => clause.includes('braid')), 'the hairstyle was left out of the caption');
  assert(drafted.kept.some((clause) => clause.includes('glasses')), 'the glasses were left out of the caption');
  // The counter-intuitive half: captioning her eyes teaches the model that her
  // eyes are optional, and the trained character comes back with new ones.
  assert(!drafted.caption.includes('green'), `eye colour was captioned: "${drafted.caption}"`);
  assert(!drafted.caption.includes('complexion'), `complexion was captioned: "${drafted.caption}"`);
  assert(drafted.omitted.includes('eyes') && drafted.omitted.includes('complexion'), 'the omissions were not reported');
}

export function testVisualRefDatasetExport(): void {
  const elena = ref({ triggerWord: 'elena_ohwx' });
  const items = [
    { imageId: 'img-a', dataUrl: 'data:image/png;base64,AAA', caption: 'elena_ohwx, grey coat' },
    { imageId: 'img-b', dataUrl: 'data:image/jpeg;base64,BBB', caption: 'elena_ohwx, braid' },
  ];
  const bundle = buildDataset({ ref: elena, items, resolution: 1024, baseModel: 'test/base' });

  // A trainer pairs an image with its caption BY STEM. If the two names differ
  // by anything but the extension it trains on empty captions and never says so.
  assert(bundle.images.length === 2 && bundle.captions.length === 2, 'wrong number of dataset files');
  for (const image of bundle.images) {
    const stem = image.path.replace(/\.[^.]+$/, '');
    assert(bundle.captions.some((caption) => caption.path === `${stem}.txt`), `no caption beside ${image.path}`);
  }
  assert(bundle.images[0].path.endsWith('.png') && bundle.images[1].path.endsWith('.jpg'), 'the image extensions were not read from the data URLs');
  assert(bundle.captions[0].text.trim() === 'elena_ohwx, grey coat', 'a caption was rewritten on the way out');

  // A reference with no trigger word yet still gets a token to train onto —
  // a made-up one, because the plain name already means every other Elena the
  // base model ever saw.
  assert(datasetTrigger({ name: 'Elena', triggerWord: undefined }) === 'elena_ohwx', 'the default trigger word is wrong');
  assert(datasetTrigger({ name: 'Elena', triggerWord: 'xyz' }) === 'xyz', 'an explicit trigger word was overridden');

  // The configs have to parse. Not "look right": parse.
  const yaml = bundle.configs.find((config) => config.path.endsWith('.yaml'));
  assert(yaml, 'no ai-toolkit config was written');
  const yamlTree = parseIndentedYaml(yaml.text);
  assert(yamlTree.job === 'extension', `ai-toolkit job wrong: ${JSON.stringify(yamlTree.job)}`);
  assert(yaml.text.includes('trigger_word: "elena_ohwx"'), 'the ai-toolkit config lost the trigger word');
  assert(yaml.text.includes('caption_ext: txt'), 'the ai-toolkit config does not ask for the captions');

  const toml = bundle.configs.find((config) => config.path.endsWith('.toml'));
  assert(toml, 'no musubi-tuner config was written');
  const tomlTree = parseFlatToml(toml.text);
  assert(tomlTree.general?.caption_extension === '".txt"', `musubi caption extension wrong: ${tomlTree.general?.caption_extension}`);
  assert(tomlTree.general?.resolution === '[1024, 1024]', `musubi resolution wrong: ${tomlTree.general?.resolution}`);
  assert(tomlTree.datasets?.image_directory === '"dataset"', 'musubi does not point at the dataset folder');

  // The rule is in the README too, because the person who reads it is about to
  // spend two hours of GPU time on whatever the captions say.
  assert(bundle.readme.text.includes('Caption what you do NOT want baked in'), 'the README lost the captioning rule');
}

/** A deliberately small YAML reader: enough to prove the file has structure. */
function parseIndentedYaml(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#') || line.trim() === '---') continue;
    if (/^\S/.test(line)) {
      const match = /^([\w-]+):\s*(.*)$/.exec(line);
      if (!match) throw new Error(`ai-toolkit YAML has an unreadable top-level line: ${line}`);
      root[match[1]] = match[2] === '' ? {} : match[2];
    } else if (!/^\s+(?:- )?[\w-]+:|^\s+- /.test(line)) {
      throw new Error(`ai-toolkit YAML has an unreadable nested line: ${line}`);
    }
  }
  return root;
}

/** The same for TOML: sections and `key = value`, and nothing else allowed. */
function parseFlatToml(text: string): Record<string, Record<string, string>> {
  const tree: Record<string, Record<string, string>> = {};
  let section = '';
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const header = /^\[\[?([\w.]+)\]?\]$/.exec(trimmed);
    if (header) {
      section = header[1];
      tree[section] = tree[section] ?? {};
      continue;
    }
    const pair = /^([\w_]+)\s*=\s*(.+)$/.exec(trimmed);
    if (!pair) throw new Error(`musubi TOML has an unreadable line: ${line}`);
    if (!section) throw new Error(`musubi TOML has a key outside every section: ${line}`);
    tree[section][pair[1]] = pair[2];
  }
  return tree;
}

// ---------------------------------------------------------------------------
// 4. The store, and the migration into it
// ---------------------------------------------------------------------------

export async function testVisualRefMigrationKeepsRows(): Promise<void> {
  await db.close();
  await Dexie.delete('WritersHoardDB');

  // A v28 database with rows in it — exactly what a user who has been writing
  // in this app for a year has on disk.
  const legacy = new Dexie('WritersHoardDB');
  legacy.version(28).stores({
    projects: 'id, mode, type, parentId, status, updatedAt',
    codexEntries: 'id, projectId, type, *tags, updatedAt',
    inspirationImages: 'id, projectId, collectionId, *tags, *linkedEntryIds',
  });
  await legacy.open();
  assert(legacy.verno === 28, `the legacy fixture opened at v${legacy.verno}`);
  await legacy.table('projects').add({
    id: PROJECT, title: 'Old book', mode: 'novelist', type: 'standalone', color: '#fff',
    description: '', status: 'draft', enabledEngines: [], engineOrder: [], createdAt: 1, updatedAt: 1,
  });
  await legacy.table('codexEntries').add({
    id: 'codex-elena', projectId: PROJECT, type: 'character', title: 'Elena',
    fields: { physicalDescription: 'She wears a long grey coat. Her eyes are pale green.' },
    content: '', tags: [], relations: [], createdAt: 1, updatedAt: 1,
  });
  await legacy.table('inspirationImages').add({
    id: 'img-canon', projectId: PROJECT, imageData: 'data:image/png;base64,AAA',
    tags: [], notes: 'a portrait', createdAt: 1,
  });
  legacy.close();

  await db.open();
  assert(db.verno === 29, `the upgrade landed on v${db.verno}, not 29`);
  // The whole point: an additive version that loses a row is unforgivable in a
  // writing app, and nothing in v29 reads or rewrites an existing table.
  assert((await db.projects.get(PROJECT))?.title === 'Old book', 'the v29 upgrade lost a project');
  assert((await db.codexEntries.get('codex-elena'))?.title === 'Elena', 'the v29 upgrade lost a codex entry');
  assert((await db.inspirationImages.get('img-canon'))?.notes === 'a portrait', 'the v29 upgrade lost a Gallery image');
  assert(db.tables.some((table) => table.name === 'visualRefs'), 'v29 did not create visualRefs');
  assert((await db.visualRefs.count()) === 0, 'v29 invented reference rows');
}

export async function testVisualRefStoreActions(): Promise<void> {
  const created = await createVisualRef(PROJECT, 'Elena', 'character', 'prose', 'codex-elena');
  assert(created.referenceImageIds.length === 0 && created.canonicalImageId === undefined, 'a new reference was born full');

  const others = await createVisualRef('another-project', 'Someone else');
  const listed = await listVisualRefs(PROJECT);
  assert(listed.length === 1 && listed[0].id === created.id, 'the reference list leaked across projects');

  await addToReferenceSet(created.id, 'img-canon');
  await addToReferenceSet(created.id, 'img-canon');
  assert((await db.visualRefs.get(created.id))?.referenceImageIds.length === 1, 'the same image was added twice');

  await setCanonicalImage(created.id, 'img-second');
  const canonical = await db.visualRefs.get(created.id);
  assert(canonical?.canonicalImageId === 'img-second', 'the canonical portrait was not set');
  assert(canonical?.referenceImageIds.includes('img-second'), 'the canonical portrait was left out of the reference set');

  // Culling the canonical portrait out of the set has to clear the portrait
  // too, or every edit generation goes on being handed a picture the writer
  // has deliberately thrown away.
  await removeFromReferenceSet(created.id, 'img-second');
  const culled = await db.visualRefs.get(created.id);
  assert(culled?.canonicalImageId === undefined, 'a culled image stayed the canonical portrait');

  await pinHeroSeed(created.id, 1234);
  assert((await db.visualRefs.get(created.id))?.heroSeed === 1234, 'the hero seed was not pinned');

  // Project deletion has to sweep this table like every other project-scoped
  // one. It does so generically, through the `projectId` index — which is
  // exactly why it is worth pinning: the guarantee is a property of the schema
  // line, and a future index change could quietly take it away.
  const { deleteProject } = await import('@/db/operations');
  const doomedProject = 'vref-doomed-project';
  const doomedRef = await createVisualRef(doomedProject, 'Ghost');
  await deleteProject(doomedProject);
  assert((await db.visualRefs.get(doomedRef.id)) === undefined, 'deleting a project left a visual reference behind');

  // Deleting a reference must not delete the writer's pictures with it.
  await deleteVisualRef(created.id);
  assert((await db.visualRefs.get(created.id)) === undefined, 'the reference survived its deletion');
  assert((await db.inspirationImages.get('img-canon')) !== undefined, 'deleting a reference deleted a Gallery image');
  await db.visualRefs.delete(others.id);
}

// ---------------------------------------------------------------------------
// 5. The studio with no image backend at all
// ---------------------------------------------------------------------------

export async function testVisualRefNoBackendUi(): Promise<void> {
  const image: InspirationImage = {
    id: 'img-canon', projectId: PROJECT, imageData: 'data:image/png;base64,AAA',
    tags: [], notes: 'a portrait', createdAt: 1,
  };
  await db.inspirationImages.put(image);
  const elena = await createVisualRef(PROJECT, 'Elena', 'character', 'prose', 'codex-elena');
  await setCanonicalImage(elena.id, image.id);

  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  try {
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(MemoryRouter, null, createElement(ImageStudioEngine, { projectId: PROJECT })));
    });
    // Let the reference load settle: everything below is about what the writer
    // sees when no model is installed, which is the state most writers open
    // this tab in and the one that has to be worth opening.
    await act(async () => { await new Promise((done) => setTimeout(done, 60)); });

    const text = host.textContent ?? '';
    assert(text.includes('Elena'), 'the cast did not render the reference');

    const disabled = [...host.querySelectorAll('button')].filter((button) => button.disabled);
    assert(disabled.length > 0, 'nothing was disabled with no backend — the studio pretended it could generate');
    // Hiding an action teaches the writer the feature does not exist. Every
    // disabled control has to carry the reason it is disabled.
    for (const button of disabled) {
      const reason = button.getAttribute('title') ?? button.getAttribute('aria-label') ?? '';
      assert(reason.trim().length > 0, `a disabled control carries no reason: "${button.textContent?.trim()}"`);
    }
  } finally {
    if (root) await act(async () => { (root as Root).unmount(); });
    host.remove();
    await db.visualRefs.delete(elena.id);
  }
}

/** Everything above, in the order the harness should read them. */
export async function runVisualRefTests(): Promise<string[]> {
  testVisualRefBareRefResolves();
  testVisualRefResolverOrder();
  testVisualRefNegativeCfgRule();
  testVisualRefDialect();
  testVisualRefSeedAndPose();
  testVisualRefResolverIsPure();
  testVisualRefMentions();
  testVisualRefRecipes();
  testVisualRefCaptions();
  testVisualRefDatasetExport();
  await testVisualRefMigrationKeepsRows();
  await testVisualRefStoreActions();
  await testVisualRefNoBackendUi();
  return [
    'Visual refs: a reference with nothing but a name still resolves',
    'Visual refs: the resolver order — LoRA, reference image, PhotoMaker, words',
    'Visual refs: a negative prompt is refused, and explained, at cfg 1',
    'Visual refs: fragments are adapted between the tag and prose dialects',
    'Visual refs: hero seed, explore, and a pose only when the model can hold one',
    'Visual refs: the resolver is pure and mutates nothing',
    'Visual refs: @mentions resolve, fold accents and never duplicate a subject',
    'Visual refs: recipes read the widened fields, diff, and step their seeds',
    'Visual refs: captions name what must stay detachable and omit the face',
    'Visual refs: the dataset export pairs every image with its caption and parses',
    'Visual refs: the v28 → v29 upgrade keeps every row',
    'Visual refs: the store actions a reference accumulates through',
    'Visual refs: the studio with no image backend, disabled with its reasons',
  ];
}
