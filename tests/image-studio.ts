// ============================================================================
// The studio level — the controls the runtime has always had
// ============================================================================
//
// Runs inside the critical harness (a real Chromium window), so the panel tests
// mount the actual React tree and read the actual text off the page. That is
// deliberate: the claim being tested is "a parameter this model cannot honour
// is visible, disabled, and carries its reason IN THE TEXT", and a tooltip a
// reader never hovers over satisfies a unit test while failing the writer.
//
// The state tested FIRST is the one with no image backend at all, because that
// is the state most writers open this tab in and the level has to be legible
// there — a panel that only makes sense once a model is installed teaches
// nothing to the person deciding whether to install one.

import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import en from '@/locales/en';
import es from '@/locales/es';
import { t as translate } from '@/i18n/useTranslation';
import { SD_SAMPLERS, SD_SCHEDULERS } from '@/services/aiRuntime/sdServer';
import type { ResolverModel } from '@/services/visualRef';
import type { VisualRef } from '@/types/visualRef';
import { REQUEST_SUPPORTS } from '@/engines/image-studio/operations';
import {
  CURATED_SAMPLERS,
  CURATED_SCHEDULERS,
  addPass,
  allSamplers,
  allSchedulers,
  adjustWeight,
  bucketsForFamily,
  buildXyzMatrix,
  chainToRequest,
  defaultsForModel,
  estimateTokens,
  fieldsAtLevel,
  isOffBucket,
  makeManualEntry,
  mergeStack,
  missingTriggers,
  movePass,
  newChain,
  parseAxisValues,
  parsePassChain,
  passAvailability,
  planRun,
  resolveWildcards,
  samplerKey,
  seedsForBatch,
  serializePassChain,
  stackFromReferences,
  stackToSelections,
  studioCapabilities,
  togglePass,
  unsupportedSyntax,
  xyzShape,
  type PassSupportInput,
  type StudioLevel,
} from '@/engines/image-studio/studio';
import ParametersColumn, { type ParametersState } from '@/engines/image-studio/components/ParametersColumn';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SDXL: ResolverModel = {
  connectionId: 'builtin-sd',
  modelId: 'dreamshaper-xl',
  family: 'sdxl',
  dialect: 'tags',
  cfg: 6,
  supportsLora: true,
  supportsReferenceImages: false,
  supportsPhotoMaker: false,
  supportsControlNet: false,
  supportsInitImage: true,
};

/** A distilled checkpoint: runs at guidance 1, so cfg and negatives are inert. */
const TURBO: ResolverModel = { ...SDXL, modelId: 'dreamshaper-xl-turbo', cfg: 1 };

const LOCAL_SUPPORT: PassSupportInput = {
  supports: REQUEST_SUPPORTS,
  managedLocal: true,
  upscalers: ['Latent', 'Lanczos'],
};

const PARAMETERS: ParametersState = {
  sizePreset: '1024x1024',
  customWidth: '',
  customHeight: '',
  steps: '30',
  cfg: '6',
  sampler: 'dpm++2m',
  scheduler: 'karras',
  clipSkip: '',
  seedMode: 'explore',
  manualSeed: '',
  batch: 1,
  batchSeedMode: 'incremental',
};

function capabilitiesFor(model: ResolverModel | null, managedLocal = true) {
  return studioCapabilities({ model, supports: REQUEST_SUPPORTS, managedLocal, loraCount: 0 });
}

/** Mount the panel and hand back everything the assertions need to read. */
async function renderPanel(options: {
  model: ResolverModel | null;
  level: StudioLevel;
  managedLocal?: boolean;
  appliedDefaults?: Parameters<typeof ParametersColumn>[0]['appliedDefaults'];
}): Promise<{ host: HTMLElement; unmount: () => Promise<void> }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(MemoryRouter, null, createElement(ParametersColumn, {
      route: options.model ? { connectionId: options.model.connectionId, modelId: options.model.modelId } : undefined,
      onRoute: () => {},
      level: options.level,
      onLevel: () => {},
      capabilities: capabilitiesFor(options.model, options.managedLocal ?? true),
      value: PARAMETERS,
      onChange: () => {},
      family: options.model?.family,
      size: { width: 1024, height: 1024 },
      appliedDefaults: options.appliedDefaults ?? null,
      onUndoDefaults: () => {},
      onReapplyDefaults: () => {},
      showAllSamplers: false,
      onShowAllSamplers: () => {},
      hasHeroSeed: false,
      passes: newChain(),
      onPasses: () => {},
      passSupport: LOCAL_SUPPORT,
      upscalers: ['Latent'],
      loraStack: [],
      loraManual: [],
      onLoraManual: () => {},
      availableLoras: [],
      resolvedPrompt: 'a lighthouse',
    })));
  });
  return {
    host,
    unmount: async () => {
      if (root) await act(async () => { (root as Root).unmount(); });
      host.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// 1. No image backend at all — tested first
// ---------------------------------------------------------------------------

export async function testStudioNoBackend(): Promise<void> {
  const capabilities = capabilitiesFor(null);
  // Every knob is refused for the SAME reason, and it is not a claim about a
  // model the writer has not picked. Saying "this model runs at a fixed
  // guidance" here would be a confident wrong answer.
  for (const [field, state] of Object.entries(capabilities)) {
    if (field === 'model') {
      assert(state.enabled, 'the model picker was refused, which traps the writer in the reason it shows');
      continue;
    }
    assert(!state.enabled, `${field} was offered with no model chosen`);
    assert(state.reasonKey === 'visualRef.reason.noModel', `${field} blamed the wrong thing: ${state.reasonKey}`);
  }

  // And the panel is still a panel: it renders at every level, and the reason
  // is on the page rather than in a tooltip nobody hovers.
  const noModel = translate('visualRef.reason.noModel');
  for (const level of ['simple', 'studio', 'expert'] as StudioLevel[]) {
    const panel = await renderPanel({ model: null, level });
    try {
      const text = panel.host.textContent ?? '';
      assert(text.includes(noModel), `the ${level} panel never said the image model is missing`);
      const disabled = [...panel.host.querySelectorAll('input, select')]
        .filter((node) => (node as HTMLInputElement).disabled);
      assert(disabled.length > 0, `nothing was disabled at ${level} with no model`);
    } finally {
      await panel.unmount();
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Three levels, and a refusal that names itself
// ---------------------------------------------------------------------------

export function testStudioLevels(): void {
  const simple = fieldsAtLevel('simple');
  const studio = fieldsAtLevel('studio');
  const expert = fieldsAtLevel('expert');
  // A higher level shows everything a lower one does. A control that exists at
  // exactly one level cannot be found from either neighbour.
  for (const field of simple) assert(studio.includes(field), `${field} vanished at Studio`);
  for (const field of studio) assert(expert.includes(field), `${field} vanished at Expert`);
  assert(!simple.includes('sampler'), 'the sampler is a Studio control, not a Simple one');
  assert(studio.includes('sampler') && studio.includes('passChain') && studio.includes('loraStack'),
    'Studio is missing the controls that are the entire reason it exists');
  assert(!studio.includes('sigmas') && expert.includes('sigmas'), 'sigmas belong to Expert alone');
}

export function testStudioRefusalsAreSpecific(): void {
  const guided = capabilitiesFor(SDXL);
  const distilled = capabilitiesFor(TURBO);
  const remote = capabilitiesFor(SDXL, false);

  assert(guided.cfg.enabled, 'a guided model was refused its guidance slider');
  assert(!distilled.cfg.enabled, 'a distilled model was offered a guidance slider that does nothing');
  assert(distilled.cfg.reasonKey === 'visualRef.reason.cfgFixed', 'the distilled refusal named the wrong cause');
  assert(!distilled.negativePrompt.enabled, 'at guidance 1 there is no negative branch to steer with');

  // Three different facts, three different sentences. Collapsing them into one
  // "unavailable" is what makes a panel untrustworthy.
  assert(guided.sampler.enabled, 'the local sampler is live now that the request carries one');
  assert(!remote.sampler.enabled, 'a remote images endpoint was offered a sampler it cannot use');
  assert(remote.sampler.reasonKey === 'visualRef.reason.serverChoosesSampler', 'the remote refusal named the wrong cause');
  // CLIP-skip's field landed, so "the request has no field" would now be a lie.
  // The only honest refusal left for it is a model with no CLIP stack, and a
  // guided SDXL is not that — it must simply be offered.
  assert(guided.clipSkip.enabled, 'CLIP-skip is on the request now and was still refused');
  assert(guided.variationSeed.reasonKey === 'imageStudio.reason.noSubseed',
    'the variation seed must say sd.cpp has none, not that it is coming');
  assert(guided.rawJson.reasonKey === 'imageStudio.reason.noPassthrough', 'raw JSON named the wrong cause');

  const reasons = new Set([
    distilled.cfg.reasonKey, remote.sampler.reasonKey,
    guided.variationSeed.reasonKey, guided.rawJson.reasonKey,
  ]);
  assert(reasons.size === 4, 'two refusals share a reason, so one of them is saying something untrue');
}

export async function testStudioPanelShowsTheReason(): Promise<void> {
  const panel = await renderPanel({ model: TURBO, level: 'expert' });
  try {
    const text = panel.host.textContent ?? '';
    // The refusal is IN THE TEXT. A `title` satisfies a unit test and fails a
    // reader who never hovers, and fails every touch screen outright.
    assert(text.includes(translate('visualRef.reason.cfgFixed')), 'the fixed-guidance reason was not on the page');
    assert(text.includes(translate('imageStudio.reason.noDetailer')), 'the missing detailer reason was not on the page');
    assert(text.includes(translate('imageStudio.reason.noSubseed')), 'the missing variation seed was not explained');

    // Present AND disabled — not removed. A vanished slider teaches "this app
    // has no CFG" instead of "this model has a fixed one".
    const inputs = [...panel.host.querySelectorAll('input')] as HTMLInputElement[];
    const cfg = inputs.find((input) => input.value === PARAMETERS.cfg);
    assert(cfg, 'the guidance field was removed rather than refused');
    assert(cfg.disabled, 'the guidance field was left usable on a model that ignores it');
  } finally {
    await panel.unmount();
  }
}

// ---------------------------------------------------------------------------
// 3. Family working points, applied with their reason
// ---------------------------------------------------------------------------

export function testStudioFamilyDefaults(): void {
  const sdxl = defaultsForModel({ modelId: 'some-sdxl-checkpoint', family: 'sdxl' });
  assert(sdxl.source === 'sdxl' && sdxl.cfg === 6 && sdxl.scheduler === 'karras', 'the SDXL working point is wrong');
  assert(sdxl.bucketId === '1024x1024', 'SDXL should open on a one-megapixel bucket');

  const flux = defaultsForModel({ modelId: 'flux-dev', family: 'flux' });
  assert(flux.cfg === 1 && flux.scheduler === 'simple', 'Flux is guidance-distilled and wants a simple schedule');

  const turbo = defaultsForModel({ modelId: 'dreamshaper-xl-turbo', family: 'sdxl' });
  assert(turbo.source === 'distilled' && turbo.steps <= 8 && turbo.cfg === 1,
    'a Turbo checkpoint was given SDXL numbers, which is slower AND worse');

  const anime = defaultsForModel({ modelId: 'anything-v5', family: 'sd1' });
  assert(anime.source === 'sd1Anime' && anime.clipSkip === 2, 'an anime SD1 checkpoint wants CLIP-skip 2');
  const photo = defaultsForModel({ modelId: 'realistic-vision', family: 'sd1' });
  assert(photo.source === 'sd1' && photo.clipSkip === 1, 'a photo SD1 checkpoint does not want CLIP-skip 2');

  // The catalogue was measured against these exact weights and beats the rule.
  const catalogued = defaultsForModel({
    modelId: 'dreamshaper-8',
    family: 'sd1',
    catalog: { family: 'sd1', defaults: { steps: 25, cfg: 6.5, sampler: 'dpm++2m', scheduler: 'karras' } },
  });
  assert(catalogued.source === 'catalog' && catalogued.cfg === 6.5, 'the catalogue entry lost to the family rule');

  // Every source has a line that says WHY, in both languages: an invisible
  // retune is worse than no retune.
  for (const source of ['catalog', 'distilled', 'flux', 'sdxl', 'sd1Anime', 'sd1', 'generic']) {
    const key = `imageStudio.why.${source}` as keyof typeof en;
    assert(en[key], `no English reason for the ${source} working point`);
    assert((es as Record<string, string>)[key], `no Spanish reason for the ${source} working point`);
  }
}

export async function testStudioPanelShowsWhy(): Promise<void> {
  const panel = await renderPanel({ model: SDXL, level: 'studio', appliedDefaults: 'sdxl' });
  try {
    const text = panel.host.textContent ?? '';
    assert(text.includes(translate('imageStudio.why.sdxl')), 'the knobs moved without saying why');
    assert(text.includes(translate('imageStudio.why.undo')), 'there was no way to put the writer’s own numbers back');
  } finally {
    await panel.unmount();
  }
}

// ---------------------------------------------------------------------------
// 4. The vocabulary is the runtime's, and every entry explains itself
// ---------------------------------------------------------------------------

export function testStudioSamplerVocabulary(): void {
  // A name the server does not recognise is DROPPED and the request succeeds
  // with the default quietly in its place: a picture made with one sampler and
  // labelled with another, which the Gallery would then repeat forever.
  for (const entry of CURATED_SAMPLERS) {
    assert((SD_SAMPLERS as readonly string[]).includes(entry.id), `${entry.id} is not a sampler this runtime parses`);
  }
  for (const entry of CURATED_SCHEDULERS) {
    assert((SD_SCHEDULERS as readonly string[]).includes(entry.id), `${entry.id} is not a scheduler this runtime parses`);
  }
  assert(CURATED_SAMPLERS.length <= 10, 'the curated list has grown into the dropdown it was meant to replace');

  const everySampler = allSamplers().map((entry) => entry.id);
  assert(everySampler.length === SD_SAMPLERS.length, 'Expert does not offer every sampler the runtime knows');
  assert(new Set(everySampler).size === everySampler.length, 'a sampler is listed twice');
  assert(allSchedulers().length === SD_SCHEDULERS.length, 'Expert does not offer every scheduler');

  // Every one carries the line that says what it is FOR: this is exactly the
  // vocabulary a novelist does not have and cannot acquire from a dropdown.
  for (const id of SD_SAMPLERS) {
    const key = `imageStudio.sampler.${samplerKey(id)}`;
    assert((en as Record<string, string>)[key], `no English explanation for the sampler ${id}`);
    assert((es as Record<string, string>)[key], `no Spanish explanation for the sampler ${id}`);
  }
  for (const id of SD_SCHEDULERS) {
    const key = `imageStudio.scheduler.${samplerKey(id)}`;
    assert((en as Record<string, string>)[key], `no English explanation for the scheduler ${id}`);
    assert((es as Record<string, string>)[key], `no Spanish explanation for the scheduler ${id}`);
  }
}

export function testStudioBuckets(): void {
  for (const family of ['sd1', 'sdxl', 'flux']) {
    for (const bucket of bucketsForFamily(family)) {
      assert(bucket.width % 64 === 0 && bucket.height % 64 === 0,
        `${family} bucket ${bucket.id} is not a multiple of 64, which the latent grid needs`);
    }
  }
  assert(bucketsForFamily('sdxl').some((bucket) => bucket.id === '1216x832'), 'the SDXL training buckets are incomplete');
  assert(!isOffBucket('sdxl', 1024, 1024), '1024×1024 is an SDXL bucket');
  assert(isOffBucket('sdxl', 900, 700), '900×700 is where the duplicated heads come from and must be named');
  // Calling an unknown model's size off-bucket is a guess dressed as a warning.
  assert(!isOffBucket(undefined, 900, 700), 'an unknown family cannot have an off-bucket size');
}

// ---------------------------------------------------------------------------
// 5. The pass chain
// ---------------------------------------------------------------------------

export function testStudioPassChain(): void {
  let chain = newChain();
  assert(chain.length === 1 && chain[0].kind === 'base', 'a new chain is the base pass alone');

  chain = addPass(chain, 'hires');
  chain = addPass(chain, 'detail');
  assert(chain.map((pass) => pass.kind).join('>') === 'base>hires>detail', 'the chain did not build in order');

  // Reorder.
  const detailId = chain[2].id;
  chain = movePass(chain, detailId, -1);
  assert(chain.map((pass) => pass.kind).join('>') === 'base>detail>hires', 'the pass did not move');
  // The base pass stays first and stays on: a chain whose base is second has
  // nothing to hand its second pass, and the writer could not tell that from a
  // backend failure.
  chain = movePass(chain, chain[0].id, 2);
  assert(chain[0].kind === 'base', 'the base pass was moved out of first place');
  chain = togglePass(chain, chain[0].id);
  assert(chain[0].enabled, 'the base pass was switched off, which would generate nothing');

  const hires = chain.find((pass) => pass.kind === 'hires');
  assert(hires, 'the hires pass disappeared');
  chain = togglePass(chain, hires.id);
  assert(chain.find((pass) => pass.id === hires.id)?.enabled === false, 'the hires pass would not toggle');

  // Round trip: ids, order, toggles and numbers survive. A chain that comes
  // back with new ids reorders differently and diffs as entirely changed.
  const restored = parsePassChain(serializePassChain(chain));
  const shape = (passes: readonly { id: string; kind: string; enabled: boolean }[]) =>
    passes.map((pass) => `${pass.id}:${pass.kind}:${pass.enabled}`).join('|');
  assert(shape(restored) === shape(chain), 'ids, order or toggles did not survive the round trip');
  assert(restored.find((pass) => pass.kind === 'hires')?.denoise === 0.4, 'the denoise did not survive the round trip');
  assert(serializePassChain(restored) === serializePassChain(parsePassChain(serializePassChain(restored))),
    'a second round trip changed the chain, so it never settles');
  assert(parsePassChain('not json').length === 1, 'a corrupt chain must fall back to the base pass, not throw');
  assert(parsePassChain(JSON.stringify([{ kind: 'nonsense' }])).length === 1, 'an unknown pass kind was invented');

  // What the request can carry.
  const built = chainToRequest(addPass(newChain(), 'hires'), LOCAL_SUPPORT);
  assert(built.hires?.upscaler === 'Latent' && built.hires.denoisingStrength === 0.4,
    'the hires pass did not reach the request with the disciplined denoise');
  const two = chainToRequest(addPass(addPass(newChain(), 'hires'), 'hires'), LOCAL_SUPPORT);
  assert(two.refused.some((refusal) => refusal.reasonKey === 'imageStudio.reason.oneHiresPass'),
    'a second hires pass was silently merged instead of refused');

  // The kinds this build cannot run are refused with the truth about where the
  // capability went, not with a shrug.
  assert(passAvailability('upscale', LOCAL_SUPPORT).reasonKey === 'imageStudio.reason.upscaleInHires',
    'the upscale pass must say that ESRGAN lives in the hires pass here');
  assert(passAvailability('detail', LOCAL_SUPPORT).reasonKey === 'imageStudio.reason.noDetailer',
    'the detailer must say the request has no field for it yet');
  assert(passAvailability('hires', { ...LOCAL_SUPPORT, upscalers: [] }).reasonKey === 'imageStudio.reason.noUpscaler',
    'a hires pass with no upscaler installed must say so');
  assert(passAvailability('hires', { ...LOCAL_SUPPORT, managedLocal: false }).enabled === false,
    'a remote images endpoint cannot run a hires pass');

  const remoteChain = chainToRequest(addPass(newChain(), 'hires'), { ...LOCAL_SUPPORT, managedLocal: false });
  assert(!remoteChain.hires && remoteChain.refused.length === 1, 'a refused pass was dropped instead of reported');
}

// ---------------------------------------------------------------------------
// 6. The LoRA stack
// ---------------------------------------------------------------------------

export function testStudioLoraStack(): void {
  const elena = {
    id: 'ref-elena',
    name: 'Elena',
    triggerWord: 'elenaxyz',
  } as VisualRef;
  const fromRefs = stackFromReferences(
    [{ fileName: 'elena-v3.safetensors', weight: 0.85, refId: 'ref-elena' }],
    [elena],
  );
  assert(fromRefs[0].trigger === 'elenaxyz', 'the trigger word was lost, which is how a LoRA gets used wrong');
  assert(fromRefs[0].source === 'reference', 'a reference LoRA must be marked as owned by the reference');

  // A file loaded twice is not loaded twice as hard: the last multiplier wins,
  // so a duplicate would silently override the reference's own weight.
  const merged = mergeStack(fromRefs, [
    makeManualEntry('ELENA-V3.safetensors', 0.2),
    makeManualEntry('film-grain.safetensors', 0.6),
  ]);
  assert(merged.length === 2, 'the duplicate LoRA was kept and the reference lost its weight');
  assert(merged[0].weight === 0.85, 'the reference no longer owns its own weight');

  const selections = stackToSelections(merged);
  assert(selections.length === 2 && selections[0].fileName === 'elena-v3.safetensors',
    'the stack did not reach the request as an array with file names');
  assert(stackToSelections(merged.map((entry) => ({ ...entry, enabled: false }))).length === 0,
    'a switched-off LoRA was still sent');

  assert(missingTriggers(merged, 'a portrait of a woman').includes('elenaxyz'),
    'a trigger word missing from the prompt was not named');
  assert(missingTriggers(merged, 'elenaxyz, a portrait').length === 0, 'a present trigger was reported as missing');
}

// ---------------------------------------------------------------------------
// 7. Wildcards, resolved client-side
// ---------------------------------------------------------------------------

export function testStudioWildcards(): void {
  const files = { lighting: ['golden hour', 'overcast'] };

  const once = resolveWildcards('a {red|blue|green} coat', 7);
  const twice = resolveWildcards('a {red|blue|green} coat', 7);
  assert(once.text === twice.text, 'the same seed made a different choice, so no recipe is reproducible');
  assert(/a (red|blue|green) coat/.test(once.text), `the wildcard did not resolve: ${once.text}`);
  assert(once.picks.length === 1 && once.picks[0].token === '{red|blue|green}', 'the pick was not recorded');
  assert(!once.text.includes('{'), 'a brace survived, so the model would be handed one');

  // Nested: `{a|{b|c}}` has two options, not three.
  const nested = resolveWildcards('{plain|{silk|velvet}}', 3);
  assert(['plain', 'silk', 'velvet'].includes(nested.text), `nested wildcards broke: ${nested.text}`);

  const named = resolveWildcards('a portrait, __lighting__', 11, files);
  assert(['golden hour', 'overcast'].some((line) => named.text.includes(line)), 'a named list was not read');

  // A name with no list is LEFT EXACTLY AS TYPED and reported. Deleting it
  // would send a prompt the writer never wrote.
  const unknown = resolveWildcards('a portrait, __camera__', 11, files);
  assert(unknown.text.includes('__camera__'), 'an unresolved wildcard was rewritten behind the writer’s back');
  assert(unknown.unresolved.includes('camera'), 'an unresolved wildcard was not reported');

  // Seeds differ → picks differ, which is what makes a batch explore.
  const seen = new Set([0, 1, 2, 3, 4, 5].map((seed) => resolveWildcards('{a|b|c|d}', seed).text));
  assert(seen.size > 1, 'every seed made the same pick, so a batch would be four identical prompts');
}

// ---------------------------------------------------------------------------
// 8. Prompt craft
// ---------------------------------------------------------------------------

export function testStudioPromptCraft(): void {
  const wrapped = adjustWeight('a red coat', 2, 5, 0.1);
  assert(wrapped?.text === 'a (red:1.1) coat', `weighting a selection produced: ${wrapped?.text}`);

  // Pressing the key again must edit the number, never nest another pair:
  // `(((red)))` is 1.33 and nobody can then edit it by hand.
  const again = adjustWeight(wrapped.text, wrapped.start, wrapped.end, 0.1);
  assert(again?.text === 'a (red:1.2) coat', `a second press produced: ${again?.text}`);
  const back = adjustWeight(again.text, again.start, again.end, -0.2);
  assert(back?.text === 'a red coat', `returning to neutral left noise behind: ${back?.text}`);

  const short = estimateTokens('a lighthouse at dawn');
  assert(short.chunks === 1 && short.tokens > 0, 'a short prompt was not counted');
  const long = estimateTokens(new Array(120).fill('lighthouse').join(', '));
  assert(long.chunks > 1 && long.boundaries.length === long.chunks - 1,
    'a long prompt did not report the chunk boundary where it stops interacting with itself');

  // The two tricks every A1111 tutorial teaches and this runtime does not do.
  assert(unsupportedSyntax('a [cat:dog:0.4] on a mat').includes('scheduling'), 'prompt scheduling was not caught');
  assert(unsupportedSyntax('a cat BREAK a dog').includes('break'), 'BREAK was not caught');
  assert(unsupportedSyntax('a cat <lora:x:0.8>').includes('loraToken'), 'a prompt LoRA tag was not caught');
  assert(unsupportedSyntax('a plain prompt').length === 0, 'an ordinary prompt was flagged');
}

export function testStudioSeeds(): void {
  assert(seedsForBatch(100, 4, 'incremental').join() === '100,101,102,103', 'an incremental batch did not walk');
  assert(seedsForBatch(100, 4, 'fixed').join() === '100,100,100,100', 'a fixed batch did not hold its seed');
  assert(seedsForBatch(100, 0, 'incremental').length === 1, 'a batch of zero must still make one picture');
}

// ---------------------------------------------------------------------------
// 9. X/Y/Z — the matrix, built without running anything
// ---------------------------------------------------------------------------

export function testStudioXyzMatrix(): void {
  assert(parseAxisValues('steps', '20, 30, 40').join() === '20,30,40', 'a comma list did not parse');
  assert(parseAxisValues('steps', '20-40 (10)').join() === '20,30,40', 'a range did not expand');
  // "euler-lcm" is a writer typing a name with a hyphen, not arithmetic.
  assert(parseAxisValues('sampler', 'euler-lcm').join() === 'euler-lcm', 'a sampler name was read as a range');
  assert(parseAxisValues('steps', '   ').length === 0, 'an empty axis produced values');

  const cells = buildXyzMatrix([
    { field: 'steps', values: ['20', '30'] },
    { field: 'cfg', values: ['5', '7', '9'] },
  ]);
  assert(cells.length === 6, `the matrix is the product of the axes, got ${cells.length}`);
  // X varies fastest, which is what makes the first axis a ROW — every grid
  // anyone has ever posted is read that way.
  assert(cells[0].overrides.steps === 20 && cells[1].overrides.steps === 30,
    'the X axis did not vary fastest, so the grid would not match its labels');
  assert(cells[0].overrides.cfg === 5 && cells[2].overrides.cfg === 7, 'the Y axis did not advance after a full row');
  assert(cells[3].coords.length === 2, 'a cell lost its label');

  const shape = xyzShape([
    { field: 'steps', values: ['20', '30'] },
    { field: 'cfg', values: ['5', '7', '9'] },
  ]);
  assert(shape.columns === 2 && shape.rows === 3 && shape.sheets === 1, 'the grid shape is wrong');

  const three = buildXyzMatrix([
    { field: 'steps', values: ['20', '30'] },
    { field: 'cfg', values: ['5', '7'] },
    { field: 'sampler', values: ['euler', 'dpm++2m'] },
  ]);
  assert(three.length === 8 && three[7].overrides.sampler === 'dpm++2m', 'the third axis did not apply');

  // The cap is enforced where the matrix is built, so the honest refusal and
  // the thing it refuses cannot drift apart.
  const huge = buildXyzMatrix([{ field: 'steps', values: new Array(200).fill('20') }]);
  assert(huge.length === 64, `the cell cap was not applied, got ${huge.length}`);
}

// ---------------------------------------------------------------------------
// 10. One run, planned — what actually goes on the wire
// ---------------------------------------------------------------------------

export function testStudioPlanRun(): void {
  const chain = addPass(addPass(newChain(), 'hires'), 'detail');
  const plan = planRun({
    projectId: 'p1',
    route: { connectionId: 'builtin-sd', modelId: 'dreamshaper-xl' },
    resolved: {
      prompt: 'elenaxyz, a portrait, __lighting__',
      negativePrompt: 'blurry',
      seed: 42,
      seedMode: 'manual',
      loras: [],
      referenceImages: [],
      strategies: {},
      dialect: 'tags',
      steps: [],
    },
    composer: { subjects: '@Elena', scene: 'a portrait', style: '' },
    width: 1024,
    height: 1024,
    seed: 42,
    n: 1,
    steps: 30,
    cfg: 6,
    sampler: 'dpm++2m',
    scheduler: 'karras',
    passes: chain,
    passSupport: LOCAL_SUPPORT,
    loraStack: [makeManualEntry('film-grain.safetensors', 0.6)],
    wildcardFiles: { lighting: ['golden hour'] },
    visualRefIds: ['ref-elena'],
  });

  // The RESOLVED text is what is recorded. A stored prompt holding an
  // unresolved wildcard reproduces a different picture every time it is run.
  assert(plan.options.prompt === 'elenaxyz, a portrait, golden hour',
    `the recorded prompt was not the resolved one: ${plan.options.prompt}`);
  assert(plan.options.wildcards?.length === 1, 'the wildcard pick was not recorded on the row');
  assert(plan.options.loras?.[0].fileName === 'film-grain.safetensors', 'the LoRA stack did not reach the request');
  assert(plan.options.hires?.scale === 1.5, 'the hires pass did not reach the request');
  // The detail pass is on and cannot run: reported, never swallowed.
  assert(plan.refusedPasses.some((refusal) => refusal.kind === 'detail'), 'a refused pass vanished from the plan');
  assert(plan.options.passChain, 'the chain was not recorded, so «iterate on this» could not put it back');
  assert(parsePassChain(plan.options.passChain).length === 3, 'the recorded chain did not survive the round trip');
  assert(plan.options.visualRefIds?.[0] === 'ref-elena', 'the references this came from were not recorded');
}

// ---------------------------------------------------------------------------

export async function runImageStudioTests(): Promise<string[]> {
  await testStudioNoBackend();
  testStudioLevels();
  testStudioRefusalsAreSpecific();
  await testStudioPanelShowsTheReason();
  testStudioFamilyDefaults();
  await testStudioPanelShowsWhy();
  testStudioSamplerVocabulary();
  testStudioBuckets();
  testStudioPassChain();
  testStudioLoraStack();
  testStudioWildcards();
  testStudioPromptCraft();
  testStudioSeeds();
  testStudioXyzMatrix();
  testStudioPlanRun();
  return [
    'Studio: with no image backend every knob is refused, and for the right reason',
    'Studio: three levels, each a superset of the one below',
    'Studio: five refusals, five different reasons, none of them a shrug',
    'Studio: the panel puts the refusal in the text, and keeps the control',
    'Studio: family working points, the catalogue winning where it has an entry',
    'Studio: the knobs move on a model switch and the panel says why',
    'Studio: every sampler and scheduler is one the runtime parses, and explains itself',
    'Studio: resolution buckets are on the grid, and an off-bucket size is named',
    'Studio: the pass chain reorders, toggles, refuses and survives a round trip',
    'Studio: the LoRA stack keeps triggers, drops duplicates and reaches the request',
    'Studio: wildcards resolve client-side, reproducibly, and say what they could not',
    'Studio: weighting, the token estimate, and the two A1111 tricks sd.cpp cannot do',
    'Studio: a batch walks its seed, or holds it',
    'Studio: X/Y/Z builds the right matrix, X fastest, capped',
    'Studio: one run planned — the resolved prompt is what is recorded',
  ];
}
