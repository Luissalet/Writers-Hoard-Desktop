// ============================================================================
// Critical test — native AI runtime
// ============================================================================
//
// Pure contracts that would rot silently:
//   1. address normalisation and the loopback/LAN/remote policy;
//   2. the hardware-fit estimate against fixtures (this machine, a laptop,
//      a CPU-only box);
//   3. per-turn tool selection: bounded, deterministic, read-only-safe;
//   4. permission, scope and argument coercion policy;
//   5. THE equivalence: a bridge call and a copilot call through the shared
//      executor relay the same arguments and write the same audit line;
//   6. history replay from stored rows never starts with an orphan tool turn.

import { BRIDGE_TOOLS, getBridgeTool } from '@/services/aiBridge/manifest';
import { SCOPE_KEY } from '@/services/aiBridge/schema';
import { computeFit, estimateKvCacheBytes, inferActiveParams, parseParameterSize, quantBitsFromLabel, withMeasuredSpeed } from '@/services/aiRuntime/fit';
import { mergeSpeedSample, speedFromTiming } from '@/services/aiRuntime/metrics';
import { pickBestChatModel, rankChatModels } from '@/services/aiRuntime/pickModel';
import { imageCatalogEntry, imageCompanionAsset, LOCAL_IMAGE_CATALOG, LOCAL_IMAGE_COMPANIONS } from '@/services/aiRuntime/imageCatalog';
import {
  buildSdJobPayload,
  buildSdServerArgs,
  clampControlStrength,
  computeImageFit,
  formatExtraSampleArgs,
  isSdCacheMode,
  isSdSampler,
  isSdScheduler,
  SD_BUILTIN_HIRES_UPSCALERS,
  SD_CONTROL_STRENGTH_DEFAULT,
  SD_MAX_STEPS,
  SD_SERVER_PORT,
  sdProfileRestartReasons,
  sdRuntimeProfileHash,
  snap,
  type SdRuntimeProfile,
} from '@/services/aiRuntime/sdServer';
import {
  canonicalJson,
  checkRecipeReplay,
  diffRecipes,
  recipeEnvelope,
  recipeHash,
  RECIPE_ENVELOPE_KIND,
  recipeToRequest,
  recoverRecipe,
  requestToRecipe,
  sha256Hex,
} from '@/services/aiRuntime/recipe';
import {
  PARAMETERS_KEYWORD,
  parseA1111Parameters,
  readPngMetadata,
  readSdcppRecord,
  WRITERS_HOARD_KEYWORD,
  writePngMetadata,
} from '@/services/imageMetadata';
import type { ImageGenerationInfo } from '@/types';
import { catalogEntry, LOCAL_MODEL_CATALOG } from '@/services/aiRuntime/catalog';
import { createToolExecutor, type AuditLine } from '@/services/aiRuntime/executorCore';
import { buildCopilotSystemPrompt } from '@/services/aiRuntime/prompts';
import {
  applyProjectScope,
  decidePermission,
  toolAnnotations,
  validateToolArgs,
} from '@/services/aiRuntime/toolPolicy';
import { CORE_TOOL_NAMES, selectToolsForTurn } from '@/services/aiRuntime/toolSelection';
import type { AiModelDescriptor, HardwareProfile } from '@/services/aiRuntime/types';
import { classifyHost, isTransportAcceptable, LOCAL_DETECT_TARGETS, normaliseBaseUrl, openAiBase, ollamaBase } from '@/services/aiRuntime/urlPolicy';
import { historyFromMessages } from '@/services/copilot/threads';
import type { AiMessage } from '@/services/copilot/types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Key-order-independent JSON, so two equal objects compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

function testUrlPolicy(): void {
  const bare = normaliseBaseUrl('192.168.1.20:1234');
  assert(bare.ok && bare.baseUrl === 'http://192.168.1.20:1234' && bare.locality === 'lan', 'bare ip:port not normalised to LAN http');
  const trailing = normaliseBaseUrl('http://localhost:8080/v1/');
  assert(trailing.ok && trailing.baseUrl === 'http://localhost:8080/v1' && trailing.locality === 'loopback', 'trailing slash or loopback misread');
  const remote = normaliseBaseUrl('https://api.example.com');
  assert(remote.ok && remote.locality === 'remote' && remote.protocol === 'https:', 'public host not remote');
  for (const bad of ['', 'ftp://x', 'http://user:pw@host', 'http://host/?k=v', 'http://host/#frag', 'http://host:abc']) {
    assert(!normaliseBaseUrl(bad).ok, `accepted a bad address: ${bad}`);
  }
  assert(openAiBase('http://h:1') === 'http://h:1/v1' && openAiBase('http://h:1/v1') === 'http://h:1/v1', 'openAiBase mishandles /v1');
  assert(ollamaBase('http://h:11434/v1') === 'http://h:11434', 'ollamaBase keeps /v1');
  assert(classifyHost('10.0.0.5') === 'lan' && classifyHost('::1') === 'loopback' && classifyHost('example.org') === 'remote', 'host classification drifted');
  // A hostname is not an IP literal just because it starts like one, and a
  // single label is not automatically the LAN: both used to classify as local,
  // which sent the API key over cleartext and skipped the remote-consent prompt.
  for (const spoof of ['127.0.0.1.evil.com', '127.grab-my-key.example.net', 'mybox', '[2606:4700:4700::1111]', '10.0.0.5.attacker.io']) {
    assert(classifyHost(spoof) === 'remote', `host spoof classified as local: ${spoof}`);
  }
  assert(classifyHost('localhost') === 'loopback' && classifyHost('192.168.1.20') === 'lan', 'genuine local hosts must stay local');
  const plainRemote = normaliseBaseUrl('http://api.example.com');
  assert(plainRemote.ok && !isTransportAcceptable(plainRemote, undefined) && isTransportAcceptable(plainRemote, true), 'plain HTTP to a remote host must need an opt-in');
  const plainLan = normaliseBaseUrl('http://192.168.0.9:11434');
  assert(plainLan.ok && isTransportAcceptable(plainLan, undefined), 'plain HTTP on the LAN must be fine');
  assert(LOCAL_DETECT_TARGETS.length < 12 && LOCAL_DETECT_TARGETS.every((t) => t.port > 0 && t.port < 65536), 'detect allowlist grew or broke');
}

const THIS_MACHINE: HardwareProfile = {
  platform: 'win32-x64', cpuModel: 'cpu', cpuCores: 16,
  ramTotalBytes: 128e9, ramFreeBytes: 90e9,
  gpus: [{ name: 'RTX 4070 Ti', vendor: 'nvidia', vramTotalBytes: 12.88e9, vramFreeBytes: 11e9 }],
  source: 'nvidia-smi', gpuConfidence: 'measured', detectedAt: 0,
};
const LAPTOP: HardwareProfile = { ...THIS_MACHINE, ramTotalBytes: 16e9, gpus: [{ name: 'RTX 3050', vendor: 'nvidia', vramTotalBytes: 4.3e9, vramFreeBytes: 4e9 }] };
const CPU_ONLY: HardwareProfile = { ...THIS_MACHINE, ramTotalBytes: 32e9, gpus: [], source: 'os-only', gpuConfidence: 'none' };

function fitOf(hardware: HardwareProfile, tag: string) {
  const entry = catalogEntry(tag);
  assert(entry, `catalogue lost ${tag}`);
  return computeFit(hardware, {
    sizeBytes: entry.sizeBytes, paramsB: entry.paramsB, activeParamsB: entry.activeParamsB,
    layers: entry.layers, quantBits: entry.quantBits, family: entry.family,
    vision: entry.capabilities.includes('vision'),
  }, 32_768);
}

function testHardwareFit(): void {
  assert(fitOf(THIS_MACHINE, 'qwen3.5:9b').label === 'perfect', '9B should fit a 12 GB card with headroom');
  assert(fitOf(THIS_MACHINE, 'gemma4:12b').label !== 'no-fit', '12B should at least run split on this machine');
  const big = fitOf(THIS_MACHINE, 'qwen3.8:27b');
  assert(big.label === 'tight' && big.placement === 'split', '27B dense on a 12 GB card must be tight/split');
  const moe = fitOf(THIS_MACHINE, 'qwen3.5:35b-a3b');
  assert(moe.label === 'good' || moe.label === 'tight', 'MoE with 3B active should be usable with 128 GB RAM');
  assert(moe.placement === 'split', 'MoE 24 GB cannot be fully on a 12 GB card');
  assert(fitOf(LAPTOP, 'qwen3.5:4b').label !== 'no-fit', '4B must run on a 4 GB laptop somehow');
  assert(fitOf(LAPTOP, 'qwen3.8:27b').label === 'no-fit', '27B on a 4 GB / 16 GB laptop must be refused');
  assert(fitOf(CPU_ONLY, 'qwen3.5:4b').label === 'tight' && fitOf(CPU_ONLY, 'qwen3.5:4b').placement === 'cpu', 'CPU-only small model should be tight on CPU');
  const cpuBig = fitOf(CPU_ONLY, 'qwen3.8:27b');
  assert(cpuBig.label !== 'perfect' && cpuBig.label !== 'good' && cpuBig.speedHint !== 'fast' && cpuBig.speedHint !== 'ok', 'CPU-only 27B must read as painful');
  // A mixture of experts is recognised from Ollama's family/tag even without the catalogue.
  assert(inferActiveParams('qwen3-coder:30b', 'qwen3moe', 30.5) === 3.3, 'qwen3moe active params not inferred');
  assert(inferActiveParams('qwen3.5:122b-a10b', 'qwen35', 122) === 10, 'active params not read from the tag');
  assert(inferActiveParams('gemma4:12b', 'gemma4', 12) === 12, 'dense model treated as MoE');
  const moeInstalled = computeFit(THIS_MACHINE, { sizeBytes: 18.6e9, paramsB: 30.5, family: 'qwen3moe', tag: 'qwen3-coder:30b', measured: true }, 32_768);
  assert(moeInstalled.label === 'good' && moeInstalled.placement === 'split', 'an installed 30B-A3B MoE should run well split on this machine');
  const denseQ8 = computeFit(THIS_MACHINE, { sizeBytes: 30e9, paramsB: 27.3, family: 'qwen35', tag: 'qwen3.8:27b-q8_0', quantBits: 8.25, measured: true }, 32_768);
  assert(denseQ8.label === 'tight' && denseQ8.speedHint === 'slow', 'a 30 GB dense model with 128 GB RAM fits, slowly');
  // KV cache grows with context and shrinks for hybrid families.
  const dense = estimateKvCacheBytes({ paramsB: 8, layers: 32, family: 'llama' }, 32_768);
  const hybrid = estimateKvCacheBytes({ paramsB: 8, layers: 32, family: 'qwen3.5' }, 32_768);
  assert(dense > hybrid && estimateKvCacheBytes({ paramsB: 8, layers: 32, family: 'llama' }, 8_192) < dense, 'KV estimate ignores context or family');
  assert(parseParameterSize('27.3B') === 27.3 && parseParameterSize('800M') === 0.8 && parseParameterSize(undefined) === undefined, 'parameter size parser');
  assert(quantBitsFromLabel('Q4_K_M') === 4.5 && quantBitsFromLabel('Q8_0') === 8.25 && quantBitsFromLabel('F16') === 16, 'quant bits parser');
  // Every catalogue entry must be internally consistent.
  for (const entry of LOCAL_MODEL_CATALOG) {
    assert(entry.sizeBytes > 0 && entry.paramsB > 0 && entry.activeParamsB <= entry.paramsB && entry.layers > 0, `catalogue entry ${entry.tag} is malformed`);
    assert(entry.capabilities.includes('tools'), `catalogue entry ${entry.tag} cannot run the copilot (no tools)`);
  }
}

function testMeasuredSpeedAndPicker(): void {
  // A measured speed replaces the bandwidth guess and re-labels a split model.
  const denseQ8 = computeFit(THIS_MACHINE, { sizeBytes: 30e9, paramsB: 27.3, family: 'qwen35', tag: 'qwen3.8:27b-q8_0', quantBits: 8.25, measured: true }, 32_768);
  assert(denseQ8.speedSource === 'estimated' && typeof denseQ8.tokensPerSecond === 'number', 'estimate must carry its tokens/s');
  const fast = withMeasuredSpeed(denseQ8, 22);
  assert(fast.label === 'good' && fast.speedHint === 'fast' && fast.speedSource === 'measured' && fast.tokensPerSecond === 22, 'measured 22 tok/s must read good/fast');
  const crawl = withMeasuredSpeed(denseQ8, 1);
  assert(crawl.label === 'no-fit' && crawl.speedHint === 'unusable', 'measured 1 tok/s must read as unusable');
  const perfect = computeFit(THIS_MACHINE, { sizeBytes: 6.6e9, paramsB: 9, layers: 36, family: 'qwen3.5', measuredTokensPerSecond: 40 }, 32_768);
  assert(perfect.label === 'perfect' && perfect.speedSource === 'measured' && perfect.tokensPerSecond === 40, 'a GPU-resident model keeps its label and takes the measured speed');
  assert(withMeasuredSpeed(denseQ8, 0) === denseQ8 && withMeasuredSpeed(denseQ8, Number.NaN) === denseQ8, 'bad measurements must be ignored');

  // Smoothing: short answers teach nothing; a server-counted sample resets a character-counted history.
  assert(mergeSpeedSample(undefined, { completionTokens: 5, tokensPerSecond: 99 }) === undefined, 'a 5-token answer must not become a measurement');
  const first = mergeSpeedSample(undefined, { completionTokens: 200, tokensPerSecond: 20 }, 1000);
  assert(first && first.tokensPerSecond === 20 && first.samples === 1, 'first sample not recorded');
  const second = mergeSpeedSample(first, { completionTokens: 300, tokensPerSecond: 40 }, 2000);
  assert(second && second.samples === 2 && second.tokensPerSecond > 20 && second.tokensPerSecond < 40, 'second sample not smoothed');
  // A ceiling as well as a floor: a lying server (10^8 "tokens" over 300 ms) must not poison the figure.
  assert(mergeSpeedSample(first, { completionTokens: 5_000_000, tokensPerSecond: 3.3e8 }, 3000) === first, 'an absurd tokens/s must be ignored');
  const approx = mergeSpeedSample(undefined, { completionTokens: 100, tokensPerSecond: 10, approximate: true }, 1);
  const exact = mergeSpeedSample(approx, { completionTokens: 100, tokensPerSecond: 30 }, 2);
  assert(exact && exact.tokensPerSecond === 30 && exact.samples === 1 && exact.approximate === false, 'exact sample must supersede the approximate history');
  const timing = speedFromTiming(undefined, 800, 1000, 5000);
  assert(timing && timing.approximate && timing.completionTokens === 200 && timing.tokensPerSecond === 50, 'wall-clock speed from characters');
  assert(speedFromTiming(120, 0, 1000, 1100) === null && speedFromTiming(120, 0, null, null) === null, 'too-short or empty windows must not count');

  // The picker: tools first, fit second, speed third, a general model over a coder, then size.
  const model = (id: string, extra: Partial<AiModelDescriptor>): AiModelDescriptor => ({
    connectionId: 'builtin-ollama', id, type: 'chat', capabilities: ['chat', 'streaming', 'tools'], installed: true, ...extra,
  });
  const installed: AiModelDescriptor[] = [
    model('qwen3.8:27b-q8_0', { sizeBytes: 30e9, parameterCountB: 27.3, family: 'qwen35', quantization: 'Q8_0', capabilities: ['chat', 'streaming', 'tools', 'vision'] }),
    model('qwen3-coder:30b', { sizeBytes: 18.6e9, parameterCountB: 30.5, family: 'qwen3moe' }),
    model('qwen3-coder-next:q4_K_M', { sizeBytes: 52e9, parameterCountB: 80, activeParameterCountB: 3, family: 'qwen3next' }),
    model('chatty:7b', { sizeBytes: 4.5e9, parameterCountB: 7, family: 'llama', capabilities: ['chat', 'streaming'] }),
    model('nomic-embed', { type: 'chat', capabilities: [] }),
  ];
  const ranked = rankChatModels(installed, THIS_MACHINE);
  assert(ranked.every((r) => r.model.capabilities.includes('tools')), 'picker offered a model without tools');
  assert(ranked[0]?.model.id === 'qwen3-coder:30b', `picker chose ${ranked[0]?.model.id} on this machine`);
  const measured = installed.map((m) => (m.id === 'qwen3.8:27b-q8_0' ? { ...m, measuredTokensPerSecond: 25 } : m));
  assert(pickBestChatModel(measured, THIS_MACHINE)?.model.id === 'qwen3.8:27b-q8_0', 'a measured fast general model must beat the coder estimate');
  assert(pickBestChatModel(installed, LAPTOP)?.model.id !== 'qwen3-coder-next:q4_K_M', 'picker ignored the laptop');
  assert(pickBestChatModel([], THIS_MACHINE) === null, 'empty pick');
  assert(pickBestChatModel(installed, null)?.model, 'no hardware must still pick something');
}

function testLocalImageRuntime(): void {
  // Every catalogue entry is pinned: https on huggingface.co, a size, a 64-hex digest, roles that make a launchable set.
  const ids = new Set<string>();
  for (const entry of LOCAL_IMAGE_CATALOG) {
    assert(/^[a-z0-9][a-z0-9-]*$/.test(entry.id) && !ids.has(entry.id), `image catalogue id ${entry.id} is malformed or duplicated`);
    ids.add(entry.id);
    assert(entry.files.length > 0 && entry.totalBytes === entry.files.reduce((sum, f) => sum + f.sizeBytes, 0), `${entry.id}: total bytes drifted from its files`);
    for (const file of entry.files) {
      assert(file.url.startsWith('https://huggingface.co/') && /\/resolve\/main\//.test(file.url), `${entry.id}: ${file.fileName} is not a pinned Hugging Face file`);
      assert(file.sizeBytes > 1_000_000 && /^[0-9a-f]{64}$/.test(file.sha256), `${entry.id}: ${file.fileName} lacks a size or a SHA-256`);
      assert(!/[\\/]/.test(file.fileName), `${entry.id}: ${file.fileName} must be a bare file name`);
    }
    const roles = entry.files.map((f) => f.role);
    const launchable = roles.includes('model') || (roles.includes('diffusion') && roles.includes('vae') && roles.includes('clip_l') && roles.includes('t5xxl'));
    assert(launchable, `${entry.id}: its files cannot start sd-server`);
    assert(entry.vramBytes > 0 && entry.nativeWidth % 64 === 0 && entry.nativeHeight % 64 === 0 && entry.defaults.steps > 0, `${entry.id}: fit facts missing`);
    assert(entry.license && entry.licenseUrl.startsWith('https://'), `${entry.id}: licence not declared`);
  }

  // Fit on this machine: SD1 fits with margin, SDXL fits, FLUX Q4 must go split with 128 GB of RAM.
  const sd15 = imageCatalogEntry('sd15-q8');
  const xl = imageCatalogEntry('dreamshaper-xl-turbo');
  const flux = imageCatalogEntry('flux-schnell-q4');
  assert(sd15 && xl && flux, 'image catalogue lost an entry the tests know');
  assert(computeImageFit(THIS_MACHINE, sd15).label === 'perfect', 'SD1.5 must be perfect on a 12 GB card');
  assert(computeImageFit(THIS_MACHINE, xl).label === 'perfect' || computeImageFit(THIS_MACHINE, xl).label === 'good', 'SDXL must fit a 12 GB card');
  const fluxFit = computeImageFit(THIS_MACHINE, flux);
  assert(fluxFit.label === 'tight' && fluxFit.placement === 'split', 'FLUX Q4 on 12 GB must be tight/split');
  assert(computeImageFit(LAPTOP, flux).label === 'no-fit' && computeImageFit(LAPTOP, sd15).label !== 'no-fit', 'laptop image fit');
  assert(computeImageFit(CPU_ONLY, sd15).placement === 'cpu' && computeImageFit(CPU_ONLY, xl).label === 'no-fit', 'CPU-only image fit');

  // Server arguments: every file by role, loopback only, the model's defaults, offload when asked.
  const args = buildSdServerArgs(flux, {
    paths: { diffusion: 'D:/m/flux.gguf', vae: 'D:/m/ae.safetensors', clip_l: 'D:/m/clip_l.safetensors', t5xxl: 'D:/m/t5.gguf' },
    offloadToCpu: true,
    flashAttention: true,
  });
  assert(args.includes('--listen-ip') && args[args.indexOf('--listen-ip') + 1] === '127.0.0.1', 'sd-server must bind loopback');
  assert(args[args.indexOf('--listen-port') + 1] === String(SD_SERVER_PORT), 'sd-server port');
  assert(args[args.indexOf('--diffusion-model') + 1] === 'D:/m/flux.gguf' && args.includes('--vae') && args.includes('--clip_l') && args.includes('--t5xxl'), 'FLUX files not all passed');
  assert(args.includes('--offload-to-cpu') && args.includes('--diffusion-fa') && args.includes('--vae-tiling'), 'memory flags');
  const single = buildSdServerArgs(sd15, { paths: { model: 'D:/m/sd15.gguf' } });
  assert(single[single.indexOf('--model') + 1] === 'D:/m/sd15.gguf' && !single.includes('--offload-to-cpu') && !single.includes('--diffusion-fa'), 'single-file launch');
  let threw = false;
  try {
    buildSdServerArgs(flux, { paths: { diffusion: 'x' } });
  } catch {
    threw = true;
  }
  assert(threw, 'a missing role must refuse to launch');

  // Job payload: sizes snap to 64, seed -1 means random, defaults fill the gaps.
  const payload = buildSdJobPayload({ connectionId: 'builtin-sd', modelId: 'sd15-q8', prompt: 'a lighthouse', width: 500, height: 700, n: 2 }, sd15) as {
    width: number; height: number; seed: number; batch_count: number; sample_params: { sample_steps: number; sample_method: string; guidance: { txt_cfg: number } };
  };
  assert(payload.width === 512 && payload.height === 704 && payload.seed === -1 && payload.batch_count === 2, 'payload geometry');
  assert(payload.sample_params.sample_steps === 20 && payload.sample_params.sample_method === 'euler_a' && payload.sample_params.guidance.txt_cfg === 7, 'payload defaults');
  const custom = buildSdJobPayload({ connectionId: 'builtin-sd', modelId: 'sd15-q8', prompt: 'x', width: 512, height: 512, n: 9, seed: 42, steps: 500, guidance: 3 }, sd15) as typeof payload;
  // 100, not 150: routes_sdcpp.cpp resolves with strict = true, which clamps
  // sample_steps to 1..100. Sending 150 got a 100-step picture labelled 150.
  assert(custom.seed === 42 && custom.batch_count === 4 && custom.sample_params.sample_steps === 100 && custom.sample_params.guidance.txt_cfg === 3, 'payload clamps');
  assert(snap(100) === 256 && snap(3000) === 2048 && snap(1000) === 1024, 'snap');
  // img2img: init_image + strength ride at the top level (sd-server schema); a
  // plain txt2img call carries neither, and strength clamps into [0,1].
  assert(!('init_image' in payload) && !('strength' in payload), 'txt2img payload must not carry img2img fields');
  const img2img = buildSdJobPayload(
    { connectionId: 'builtin-sd', modelId: 'sd15-q8', prompt: 'x', width: 512, height: 512, n: 1, initImage: 'data:image/png;base64,AAAA', strength: 1.7 },
    sd15,
  ) as { init_image?: string; strength?: number };
  assert(img2img.init_image === 'data:image/png;base64,AAAA', 'img2img must pass init_image through');
  assert(img2img.strength === 1, 'img2img strength must clamp to [0,1]');
  const loneStrength = buildSdJobPayload(
    { connectionId: 'builtin-sd', modelId: 'sd15-q8', prompt: 'x', width: 512, height: 512, n: 1, strength: 0.5 },
    sd15,
  ) as { init_image?: string; strength?: number };
  assert(!('init_image' in loneStrength) && !('strength' in loneStrength), 'strength without an init image must not leak into txt2img');
}

/**
 * The request surface of the managed stable-diffusion.cpp server.
 *
 * Every key asserted here was read out of the server's own parser
 * (`SDGenerationParams::from_json_str`) at the pinned build, not out of the CLI
 * help — the two disagree, and a key the parser does not read is worse than a
 * missing feature because the request still succeeds and the studio then claims
 * the reference image or the mask was used.
 */
function testSdRequestSurface(): void {
  const sd15 = imageCatalogEntry('sd15-q8');
  const kontext = imageCatalogEntry('flux-kontext-dev-q4');
  assert(sd15 && kontext, 'image catalogue lost an entry these tests need');
  const base = { connectionId: 'builtin-sd', modelId: 'sd15-q8', prompt: 'a lighthouse', width: 512, height: 512, n: 1 };

  // THE compatibility guarantee: a request that asks for none of the new
  // fields still produces exactly the payload it did before, key for key and
  // in the same order. Only `embed_image_metadata` moved, deliberately.
  const plain = buildSdJobPayload(base, sd15);
  assert(
    JSON.stringify(plain) ===
      JSON.stringify({
        prompt: 'a lighthouse',
        negative_prompt: '',
        width: 512,
        height: 512,
        seed: -1,
        batch_count: 1,
        sample_params: {
          sample_method: 'euler_a',
          sample_steps: 20,
          guidance: { txt_cfg: 7, distilled_guidance: 3.5 },
        },
        output_format: 'png',
        embed_image_metadata: true,
      }),
    `a plain request no longer produces the payload it used to: ${JSON.stringify(plain)}`,
  );
  for (const key of ['ref_images', 'increase_ref_index', 'auto_resize_ref_image', 'control_image', 'control_strength', 'mask_image', 'hires', 'lora', 'init_image', 'strength']) {
    assert(!(key in plain), `an unrequested field leaked into the payload: ${key}`);
  }

  // Reference images: the server name is `ref_images`, and only a model that
  // actually conditions on them may be sent them.
  const refs = ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'];
  const withRefs = buildSdJobPayload({ ...base, modelId: 'flux-kontext-dev-q4', refImages: refs, increaseRefIndex: true, disableAutoResizeRefImage: true }, kontext) as Record<string, unknown>;
  assert(JSON.stringify(withRefs.ref_images) === JSON.stringify(refs), 'ref_images must pass through in order');
  assert(withRefs.increase_ref_index === true, 'increase_ref_index not sent');
  assert(withRefs.auto_resize_ref_image === false, 'disabling the auto resize must send auto_resize_ref_image: false');
  const refsOnSd15 = buildSdJobPayload({ ...base, refImages: refs }, sd15) as Record<string, unknown>;
  assert(!('ref_images' in refsOnSd15), 'a model that ignores references must not be sent them');
  const noRefFlags = buildSdJobPayload({ ...base, modelId: 'flux-kontext-dev-q4', refImages: refs }, kontext) as Record<string, unknown>;
  assert(!('increase_ref_index' in noRefFlags) && !('auto_resize_ref_image' in noRefFlags), 'reference flags must stay off the wire unless asked for');

  // ControlNet: the hint is `control_image`, its weight `control_strength`, and
  // the weight lives in the band that holds a pose without dragging the
  // reference's clothes and hair along with it.
  const control = buildSdJobPayload({ ...base, controlImage: 'data:image/png;base64,CCCC' }, sd15) as Record<string, unknown>;
  assert(control.control_image === 'data:image/png;base64,CCCC', 'control_image not sent');
  assert(control.control_strength === SD_CONTROL_STRENGTH_DEFAULT && SD_CONTROL_STRENGTH_DEFAULT === 0.55, 'control strength must default to 0.55');
  assert(clampControlStrength(1.4) === 0.9 && clampControlStrength(0) === 0.1 && clampControlStrength(0.62) === 0.62, 'control strength band');
  assert(clampControlStrength(Number.NaN) === 0.55 && clampControlStrength('0.7') === 0.55, 'a non-number control strength must fall back to the default');
  const strengthOnly = buildSdJobPayload({ ...base, controlStrength: 0.7 }, sd15) as Record<string, unknown>;
  assert(!('control_strength' in strengthOnly), 'a control strength without a hint image must not leak');

  // Inpainting: `mask_image`, and only ever beside an init image.
  const masked = buildSdJobPayload({ ...base, initImage: 'data:image/png;base64,DDDD', maskImage: 'data:image/png;base64,EEEE' }, sd15) as Record<string, unknown>;
  assert(masked.mask_image === 'data:image/png;base64,EEEE' && masked.init_image === 'data:image/png;base64,DDDD', 'mask_image not sent with its init image');
  const loneMask = buildSdJobPayload({ ...base, maskImage: 'data:image/png;base64,EEEE' }, sd15) as Record<string, unknown>;
  assert(!('mask_image' in loneMask), 'a mask without an init image would repaint the whole frame');

  // Hires fix: a nested `hires` object, `denoising_strength` rather than the
  // CLI's spelling, and an upscaler the runtime can actually name.
  const hires = buildSdJobPayload({ ...base, hiresFix: { upscaler: 'Latent', scale: 9, steps: 12, denoisingStrength: 2, tileSize: 256 } }, sd15) as { hires?: Record<string, unknown> };
  assert(hires.hires?.enabled === true && hires.hires.upscaler === 'Latent', 'hires block not sent');
  assert(hires.hires?.scale === 4 && hires.hires.steps === 12 && hires.hires.denoising_strength === 1 && hires.hires.upscale_tile_size === 256, 'hires values must clamp and use the server spelling');
  assert((SD_BUILTIN_HIRES_UPSCALERS as readonly string[]).includes('Latent') && (SD_BUILTIN_HIRES_UPSCALERS as readonly string[]).includes('Lanczos'), 'built-in upscaler names');

  // LoRA: the structured field, because this build refuses to read a
  // <lora:...> token out of a prompt on any server API — it would reach the
  // text encoder as literal words instead.
  const lora = buildSdJobPayload({ ...base, loras: [{ name: 'sombra', weight: 0.8, fileName: 'sombra.safetensors' }] }, sd15) as { prompt: string; lora?: { path: string; multiplier: number }[] };
  assert(lora.prompt === 'a lighthouse', 'the prompt must stay the text the author wrote');
  assert(lora.lora?.length === 1 && lora.lora[0].path === 'sombra.safetensors' && lora.lora[0].multiplier === 0.8, 'lora must ride in the structured field, keyed by file name');
  const badLora = buildSdJobPayload({ ...base, loras: [{ name: 'a:b', weight: 1 }] }, sd15) as Record<string, unknown>;
  assert(!('lora' in badLora), 'a name the server could not resolve must not be sent');

  // Sampler and scheduler: the server drops a name it does not know and uses
  // its default, silently. So an unknown name must never leave here.
  assert(isSdSampler('dpm++2m') && isSdSampler('euler_a') && !isSdSampler('DPM++ 2M Karras'), 'sampler table');
  assert(isSdScheduler('karras') && !isSdScheduler('Karras'), 'scheduler table');
  const sampled = buildSdJobPayload({ ...base, sampler: 'heun', scheduler: 'exponential' }, sd15) as { sample_params: Record<string, unknown> };
  assert(sampled.sample_params.sample_method === 'heun' && sampled.sample_params.scheduler === 'exponential', 'a valid sampler and scheduler must reach the server');
  const bogus = buildSdJobPayload({ ...base, sampler: 'nonesuch', scheduler: 'nonesuch' }, sd15) as { sample_params: Record<string, unknown> };
  assert(bogus.sample_params.sample_method === 'euler_a' && !('scheduler' in bogus.sample_params), 'an unknown name must fall back rather than be sent');

  // Kontext is not step-distilled: its distilled guidance is the catalogue's,
  // not the family's 1.
  const kontextPayload = buildSdJobPayload({ ...base, modelId: 'flux-kontext-dev-q4' }, kontext) as { sample_params: { guidance: Record<string, number> } };
  assert(kontextPayload.sample_params.guidance.distilled_guidance === 2.5, 'Kontext must carry its own distilled guidance');
  const schnell = imageCatalogEntry('flux-schnell-q4');
  assert(schnell && (buildSdJobPayload({ ...base, modelId: 'flux-schnell-q4' }, schnell) as { sample_params: { guidance: Record<string, number> } }).sample_params.guidance.distilled_guidance === 1, 'the FLUX family rule must still apply where no default is set');

  // Companions are pinned exactly as models are, and the ControlNet ones are
  // only ever offered for the family they were trained against.
  const companionIds = new Set<string>();
  for (const companion of LOCAL_IMAGE_COMPANIONS) {
    assert(/^[a-z0-9][a-z0-9-]*$/.test(companion.id) && !companionIds.has(companion.id), `companion id ${companion.id} malformed or duplicated`);
    companionIds.add(companion.id);
    assert(companion.url.startsWith('https://huggingface.co/') && /\/resolve\/main\//.test(companion.url), `${companion.id} is not a pinned Hugging Face file`);
    assert(companion.sizeBytes > 1_000_000 && /^[0-9a-f]{64}$/.test(companion.sha256), `${companion.id} lacks a size or a SHA-256`);
    assert(!/[\\/]/.test(companion.fileName), `${companion.id}: the file name must be bare`);
    assert(companion.license.length > 0 && companion.licenseUrl.startsWith('https://'), `${companion.id}: licence not declared`);
    assert(companion.kind === 'controlnet' || companion.kind === 'upscaler', `${companion.id}: unknown kind`);
  }
  assert(imageCompanionAsset('realesrgan-x4')?.kind === 'upscaler', 'the ESRGAN companion went missing');
  assert(imageCompanionAsset('controlnet-sd15-openpose')?.families.includes('sd1'), 'the OpenPose ControlNet must declare its family');

  // Launch arguments: a ControlNet is a context option, so it is spelled on the
  // command line, never in a job.
  const args = buildSdServerArgs(sd15, { paths: { model: 'D:/m/sd15.gguf' }, controlNetPath: 'D:/c/openpose.pth', hiresUpscalersDir: 'D:/u' });
  assert(args[args.indexOf('--control-net') + 1] === 'D:/c/openpose.pth', 'the ControlNet must be a launch argument');
  assert(args[args.indexOf('--hires-upscalers-dir') + 1] === 'D:/u', 'the upscaler folder must be a launch argument');
  const bare = buildSdServerArgs(sd15, { paths: { model: 'D:/m/sd15.gguf' } });
  assert(!bare.includes('--control-net') && !bare.includes('--hires-upscalers-dir'), 'neither flag may appear when nothing is installed');

  // The provenance record: a row written before it was widened still reads, and
  // the new fields simply come back undefined.
  const oldRow: ImageGenerationInfo = {
    prompt: 'a lighthouse', connectionId: 'builtin-sd', modelId: 'sd15-q8',
    width: 512, height: 512, createdAt: 1,
  };
  assert(oldRow.cfg === undefined && oldRow.sampler === undefined && oldRow.loras === undefined, 'an old generation row must read without its new fields');
  const newRow: ImageGenerationInfo = {
    ...oldRow, cfg: 7, sampler: 'euler_a', scheduler: 'karras', backend: 'local-sd',
    loras: [{ name: 'sombra', weight: 0.8, fileName: 'sombra.safetensors' }],
    controlNetModel: 'controlnet-sd15-openpose', controlStrength: 0.55,
  };
  assert(newRow.loras?.[0].weight === 0.8 && newRow.controlStrength === 0.55, 'the widened row must hold what it claims');
}

/** An independent CRC-32, so a bug in the module cannot also bless its own test. */
function testCrc32(bytes: number[]): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function testChunk(type: string, data: number[]): number[] {
  const body = [...type].map((c) => c.charCodeAt(0)).concat(data);
  const crc = testCrc32(body);
  return [
    (data.length >>> 24) & 0xff, (data.length >>> 16) & 0xff, (data.length >>> 8) & 0xff, data.length & 0xff,
    ...body,
    (crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff,
  ];
}

/** A structurally valid 1×1 PNG, built here rather than imported as a fixture. */
function tinyPng(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...testChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    ...testChunk('IDAT', [0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]),
    ...testChunk('IEND', []),
  ]);
}

function testPngMetadata(): void {
  const png = tinyPng();
  assert(Object.keys(readPngMetadata(png)).length === 0, 'a PNG with no text chunks must read back empty');

  // Round trip, including a prompt that is not Latin-1 — the whole ecosystem
  // puts UTF-8 in a tEXt chunk, and a reader that assumed otherwise would hand
  // back mojibake for half the prompts this app writes.
  const parameters = 'un faro — 灯台\nNegative prompt: borroso\nSteps: 20, CFG scale: 7.0, Seed: 42, Size: 512x512, Model: sd15, Sampler: euler_a karras';
  const record = { schema: 'writershoard/1', loras: [{ name: 'sombra', weight: 0.8 }], seed: 42 };
  const written = writePngMetadata(png, { parameters, writersHoard: record });
  const read = readPngMetadata(written);
  assert(read.parameters === parameters, 'the parameters chunk did not round trip');
  assert(JSON.stringify(read.writersHoard) === JSON.stringify(record), 'the writershoard chunk did not round trip');
  assert(written.length > png.length, 'writing metadata must add bytes');

  // The image survives: every original chunk is still in the output, in order.
  const tail = written.subarray(written.length - 12);
  assert(String.fromCharCode(tail[4], tail[5], tail[6], tail[7]) === 'IEND', 'IEND must stay last');
  const asString = Array.from(written).map((b) => String.fromCharCode(b)).join('');
  assert(asString.indexOf('IHDR') === 12, 'IHDR must stay first');
  assert(asString.indexOf(PARAMETERS_KEYWORD) > asString.indexOf('IHDR') && asString.indexOf(PARAMETERS_KEYWORD) < asString.indexOf('IDAT'), 'text chunks belong between IHDR and IDAT');
  assert(asString.includes(WRITERS_HOARD_KEYWORD), 'our own chunk must be written');

  // Writing twice replaces rather than accumulates: two conflicting recipes in
  // one file is worse than none.
  const rewritten = writePngMetadata(written, { parameters: 'otro faro\nSteps: 4, Seed: 1, Sampler: euler' });
  assert(readPngMetadata(rewritten).parameters === 'otro faro\nSteps: 4, Seed: 1, Sampler: euler', 'a rewrite must win');
  assert(readPngMetadata(rewritten).writersHoard === undefined, 'a rewrite must drop the record it replaced');
  assert(rewritten.length < written.length, 'a rewrite must not accumulate chunks');

  // Damage: a truncated file, a chunk claiming more bytes than exist, a
  // non-PNG, and an empty buffer all read back empty instead of throwing.
  for (const broken of [written.subarray(0, 30), new Uint8Array(0), new Uint8Array([1, 2, 3]), tinyPng().subarray(0, 8)]) {
    let threw = false;
    let result: Record<string, unknown> = {};
    try {
      result = readPngMetadata(broken) as Record<string, unknown>;
    } catch {
      threw = true;
    }
    assert(!threw, 'a damaged PNG must not take down the reader');
    assert(Object.keys(result).length === 0, 'a damaged PNG must not invent metadata');
  }
  const lying = new Uint8Array([...tinyPng().subarray(0, 8), 0x7f, 0xff, 0xff, 0xff, 0x74, 0x45, 0x58, 0x74]);
  assert(Object.keys(readPngMetadata(lying)).length === 0, 'a chunk longer than the file must be ignored');
  const notPng = new Uint8Array([1, 2, 3, 4]);
  assert(writePngMetadata(notPng, { parameters: 'x' }) === notPng, 'writing to a non-PNG must hand the bytes straight back');
  // A `writershoard` chunk that is not JSON is somebody else's; the rest of the
  // file still reads.
  const alien = writePngMetadata(png, { parameters: 'ok\nSteps: 1, Seed: 1' });
  const spoiled = new Uint8Array(alien);
  const keywordAt = Array.from(spoiled).map((b) => String.fromCharCode(b)).join('').indexOf(PARAMETERS_KEYWORD);
  assert(keywordAt > 0, 'the fixture lost its keyword');

  // The A1111 line, parsed back into something a studio can prefill.
  const parsed = parseA1111Parameters(parameters);
  assert(parsed.prompt === 'un faro — 灯台', `prompt misread: ${parsed.prompt}`);
  assert(parsed.negativePrompt === 'borroso', 'negative prompt misread');
  assert(parsed.fields.Steps === '20' && parsed.fields.Seed === '42' && parsed.fields['CFG scale'] === '7.0' && parsed.fields.Size === '512x512', 'settings misread');
  assert(parseA1111Parameters('just a prompt').prompt === 'just a prompt', 'a bare prompt with no settings line must still read');
  assert(readSdcppRecord('x\nSteps: 1, Version: stable-diffusion.cpp, SDCPP: {"seed":7}')?.seed === 7, 'the sdcpp JSON tail must be preferred when present');
  assert(readSdcppRecord('x\nSteps: 1') === undefined && readSdcppRecord('x, SDCPP: {broken') === undefined, 'a missing or broken sdcpp tail must be absent, not thrown');
}

function testToolSelection(): void {
  const base = { tools: BRIDGE_TOOLS, enabledEngines: ['writings', 'codex', 'outline'] };
  const codex = selectToolsForTurn({ ...base, message: 'Crea un personaje llamado Marta en el codex' });
  const names = codex.map((t) => t.name);
  for (const core of CORE_TOOL_NAMES) assert(names.includes(core), `core tool ${core} missing`);
  assert(names.includes('wh_create_codex_entry'), 'codex request did not offer wh_create_codex_entry');
  assert(!names.includes('wh_list_projects'), 'wh_list_projects offered without cross-project intent');
  assert(codex.length <= 16, `selection exceeded the cap: ${codex.length}`);
  const cross = selectToolsForTurn({ ...base, message: 'lista mis proyectos' });
  assert(cross.some((t) => t.name === 'wh_list_projects'), 'cross-project intent did not offer wh_list_projects');
  const readOnly = selectToolsForTurn({ ...base, message: 'borra el capítulo 3', readOnly: true });
  assert(readOnly.every((t) => !t.writes), 'read-only selection leaked a write tool');
  const del = selectToolsForTurn({ ...base, message: 'borra el capítulo 3' });
  assert(del.some((t) => t.name === 'wh_delete'), 'delete intent did not offer wh_delete');
  const open = selectToolsForTurn({ ...base, message: 'qué te parece esto', openEngine: 'timeline' });
  assert(open.some((t) => t.engineId === 'timeline'), 'open engine tools not offered for a vague message');
  const again = selectToolsForTurn({ ...base, message: 'sigue', usedTools: ['wh_get_writing'] });
  assert(again.some((t) => t.name === 'wh_get_writing'), 'a tool used earlier in the thread dropped out');
  const a = selectToolsForTurn({ ...base, message: 'resume el capítulo dos' }).map((t) => t.name).join(',');
  const b = selectToolsForTurn({ ...base, message: 'resume el capítulo dos' }).map((t) => t.name).join(',');
  assert(a === b, 'selection is not deterministic');
  const image = selectToolsForTurn({ ...base, message: 'genera una imagen de la torre' });
  assert(image.some((t) => t.name === 'wh_generate_image'), 'image intent did not offer wh_generate_image');
  // The world engine has more tools than the cap leaves room for: the ones the
  // message names must survive the cut, whatever their declaration order.
  const worldTools = BRIDGE_TOOLS.filter((t) => t.engineId === 'worldgen').length;
  assert(worldTools + CORE_TOOL_NAMES.length > 16, `fixture assumes worldgen overflows the cap (has ${worldTools})`);
  const link = selectToolsForTurn({ ...base, message: 'link the place Ravenhold to the scene where they meet', openEngine: 'worldgen' });
  assert(link.length <= 16, `world selection exceeded the cap: ${link.length}`);
  assert(link.some((t) => t.name === 'wh_link_place'), 'a named world tool was cut by the cap');
  const summary = selectToolsForTurn({ ...base, message: 'give me the gazetteer summary of the world', openEngine: 'worldgen' });
  assert(summary.some((t) => t.name === 'wh_world_summary'), 'wh_world_summary was cut by the cap despite being named');
}

function testPolicy(): void {
  const write = getBridgeTool('wh_create_codex_entry');
  const read = getBridgeTool('wh_search');
  const del = getBridgeTool('wh_delete');
  assert(write && read && del, 'policy fixtures missing');
  const bridge = { origin: 'bridge' as const };
  assert(decidePermission(read, bridge, false).allowed, 'bridge read refused with writes off');
  const off = decidePermission(write, bridge, false);
  assert(!off.allowed && off.code === 'writes-disabled', 'bridge write allowed with writes off');
  assert(decidePermission(write, bridge, true).allowed, 'bridge write refused with writes on');
  const ro = decidePermission(write, { origin: 'copilot', actionPolicy: 'read-only' }, true);
  assert(!ro.allowed && ro.code === 'read-only', 'read-only conversation wrote');
  const ask = decidePermission(write, { origin: 'copilot', actionPolicy: 'ask' }, true);
  assert(ask.allowed && ask.needsApproval, 'ask conversation did not ask');
  const askDelete = decidePermission(del, { origin: 'copilot', actionPolicy: 'ask' }, true);
  assert(askDelete.allowed && !askDelete.needsApproval, 'wh_delete must not be double-asked: its handler asks');
  const allow = decidePermission(write, { origin: 'copilot', actionPolicy: 'allow' }, true);
  assert(allow.allowed && !allow.needsApproval, 'allow conversation asked');
  // The bridge switch does not gate the copilot, and vice versa.
  assert(decidePermission(write, { origin: 'copilot', actionPolicy: 'allow' }, false).allowed, 'bridge write switch leaked into the copilot');
  assert(!decidePermission(write, { origin: 'feature' }, true).allowed, 'internal feature may write');

  const scoped = applyProjectScope(write, { title: 'x' }, { origin: 'copilot', projectId: 'p1' });
  assert(scoped.ok && scoped.args.projectId === 'p1', 'copilot scope not injected');
  const foreign = applyProjectScope(write, { title: 'x', projectId: 'p2' }, { origin: 'copilot', projectId: 'p1' });
  assert(!foreign.ok && foreign.code === 'scope', 'copilot allowed to act on another project');
  const bridgeScope = applyProjectScope(write, { title: 'x', projectId: 'p2' }, bridge);
  assert(bridgeScope.ok && bridgeScope.args.projectId === 'p2', 'bridge scope must be untouched');

  const coerced = validateToolArgs(write.schema, { title: 'Marta', type: 'character', tags: 'a, b', bogus: 1 });
  assert(coerced.ok && Array.isArray(coerced.args.tags) && coerced.args.tags.length === 2 && !('bogus' in coerced.args), 'argument coercion');
  const missing = validateToolArgs(write.schema, { type: 'character' });
  assert(!missing.ok && missing.code === 'bad-args', 'missing required field accepted');
  const badEnum = validateToolArgs(del.schema, { type: 'spaceship', id: 'x' });
  assert(!badEnum.ok, 'enum violation accepted');
  const num = validateToolArgs(getBridgeTool('wh_search')!.schema, { query: 'q', limit: '5' });
  assert(num.ok && num.args.limit === 5, 'numeric string not coerced');

  const ann = toolAnnotations(read);
  assert(ann.readOnlyHint && !ann.destructiveHint, 'read annotations');
  assert(toolAnnotations(del).destructiveHint, 'delete annotation');
  assert(!toolAnnotations(write).readOnlyHint, 'write marked read-only');
}

async function testExecutorEquivalence(): Promise<void> {
  const relays: Array<{ tool: string; args: Record<string, unknown>; timeoutMs?: number }> = [];
  const lines: AuditLine[] = [];
  let writes = true;
  const execute = createToolExecutor({
    writesEnabled: async () => writes,
    relay: async (tool, args, timeoutMs) => {
      relays.push({ tool, args, timeoutMs });
      return {
        ok: true,
        result: { created: true, id: 'row-1', __audit: { projectId: 'p1', entityId: 'row-1', summary: 'made a thing', before: null } },
      };
    },
    audit: async (line) => {
      lines.push(line);
      return lines.length - 1;
    },
    now: () => 1234,
  });

  const viaBridge = await execute(
    { tool: 'wh_create_codex_entry', args: { projectId: 'p1', title: 'Marta', type: 'character' } },
    { origin: 'bridge', clientLabel: 'mcp-stdio' },
  );
  const viaCopilot = await execute(
    { tool: 'wh_create_codex_entry', args: { title: 'Marta', type: 'character' } },
    { origin: 'copilot', projectId: 'p1', conversationId: 'thr-1', actionPolicy: 'allow', clientLabel: 'copilot' },
  );
  assert(viaBridge.ok && viaCopilot.ok, 'shared executor refused an allowed call');
  // The TOOL sees the same call either way — that is the equivalence that
  // matters. What differs is the envelope: a copilot call is pinned to its
  // conversation's project, and carries that pin for the handler to check
  // against any row it loads BY ID (an id in the arguments travels; a
  // `projectId` beside it says nothing about the row that id names). A bridge
  // call has no conversation and so no pin.
  const withoutScope = (args: Record<string, unknown>) => {
    const { [SCOPE_KEY]: _pin, ...rest } = args;
    return rest;
  };
  assert(
    canonical(withoutScope(relays[0].args)) === canonical(withoutScope(relays[1].args)),
    'bridge and copilot relayed different arguments',
  );
  assert(relays[1].args[SCOPE_KEY] === 'p1', 'a copilot call reached the handler without its project pin');
  assert(!(SCOPE_KEY in relays[0].args), 'a bridge call carried a project pin it has no conversation for');
  assert(relays[0].tool === relays[1].tool && relays[0].timeoutMs === relays[1].timeoutMs, 'bridge and copilot relayed differently');
  assert(!('__audit' in (viaBridge.result as object)) && !('__audit' in (viaCopilot.result as object)), 'audit envelope leaked to a caller');
  assert(viaBridge.auditIndex === 0 && viaCopilot.auditIndex === 1, 'audit indices not returned');
  const strip = (line: AuditLine) => ({ ...line, origin: undefined, client: undefined, conversationId: undefined });
  assert(canonical(strip(lines[0])) === canonical(strip(lines[1])), 'bridge and copilot wrote different audit lines');
  assert(lines[0].origin === 'bridge' && lines[1].origin === 'copilot' && lines[1].conversationId === 'thr-1', 'audit provenance missing');
  assert(lines[0].kind === 'create' && lines[0].projectId === 'p1' && lines[0].summary === 'made a thing', 'audit line lost its facts');

  // Reads log nothing; the bridge switch gates only the bridge.
  const read = await execute({ tool: 'wh_search', args: { query: 'Marta' } }, { origin: 'bridge' });
  assert(read.ok && lines.length === 2, 'a read was audited');
  writes = false;
  const refused = await execute({ tool: 'wh_create_codex_entry', args: { title: 'x', type: 'character' } }, { origin: 'bridge' });
  assert(!refused.ok && refused.code === 'writes-disabled' && relays.length === 3, 'bridge write ran with the switch off');
  const copilotStill = await execute(
    { tool: 'wh_create_codex_entry', args: { title: 'x', type: 'character' } },
    { origin: 'copilot', projectId: 'p1', actionPolicy: 'allow' },
  );
  assert(copilotStill.ok, 'copilot was gated by the bridge switch');
  writes = true;

  // "Ask": nobody answers → refused; approval → runs; rejection → refused.
  const silent = await execute({ tool: 'wh_create_codex_entry', args: { title: 'x', type: 'character' } }, { origin: 'copilot', projectId: 'p1', actionPolicy: 'ask' });
  assert(!silent.ok && silent.code === 'rejected', 'ask with no approver ran a write');
  let asked = 0;
  const approved = await execute(
    { tool: 'wh_create_codex_entry', args: { title: 'x', type: 'character' } },
    { origin: 'copilot', projectId: 'p1', actionPolicy: 'ask' },
    { approve: async () => { asked += 1; return true; } },
  );
  assert(approved.ok && asked === 1, 'approved write did not run');
  const rejected = await execute(
    { tool: 'wh_create_codex_entry', args: { title: 'x', type: 'character' } },
    { origin: 'copilot', projectId: 'p1', actionPolicy: 'ask' },
    { approve: async () => false },
  );
  assert(!rejected.ok && rejected.code === 'rejected', 'rejected write ran');
  const readOnly = await execute({ tool: 'wh_create_codex_entry', args: { title: 'x', type: 'character' } }, { origin: 'copilot', projectId: 'p1', actionPolicy: 'read-only' });
  assert(!readOnly.ok && readOnly.code === 'read-only', 'read-only conversation wrote');
  const unknown = await execute({ tool: 'wh_nope', args: {} }, { origin: 'bridge' });
  assert(!unknown.ok && unknown.code === 'unknown-tool', 'unknown tool not refused');
}

function testPromptAndHistory(): void {
  const prompt = buildCopilotSystemPrompt({
    projectId: 'p1', projectTitle: 'Novela', enabledEngines: ['writings'], openEngine: 'writings',
    locale: 'es', policy: 'ask', toolsAvailable: true, offeredTools: ['wh_search'],
  });
  assert(prompt.includes('wh_get_context') && prompt.includes('Novela') && prompt.includes('ASKS BEFORE CHANGING'), 'system prompt lost its parts');
  const chatOnly = buildCopilotSystemPrompt({ projectId: 'p1', projectTitle: 'N', enabledEngines: [], locale: 'en', policy: 'read-only', toolsAvailable: false });
  assert(chatOnly.includes('cannot call tools') && chatOnly.includes('READ-ONLY'), 'chat-only prompt missing');

  const base = { threadId: 't', projectId: 'p', status: 'complete' as const };
  const rows: AiMessage[] = [
    { ...base, id: '1', role: 'tool', content: 'orphan', createdAt: 1, toolCall: { callId: 'c0', tool: 'wh_search', args: {}, risk: 'read', state: 'done', ok: true, resultText: '{}' } },
    { ...base, id: '2', role: 'user', content: 'hola', createdAt: 2 },
    { ...base, id: '3', role: 'assistant', content: '', createdAt: 3, toolCalls: [{ id: 'c1', name: 'wh_search', args: { query: 'x' } }] },
    { ...base, id: '4', role: 'tool', content: '{"hits":[]}', createdAt: 4, toolCall: { callId: 'c1', tool: 'wh_search', args: {}, risk: 'read', state: 'done', ok: true, resultText: '{"hits":[]}' } },
    { ...base, id: '5', role: 'assistant', content: 'nada', createdAt: 5 },
    { ...base, id: '6', role: 'assistant', content: '', createdAt: 6, status: 'streaming' },
  ];
  const { history, usedTools } = historyFromMessages(rows);
  assert(history[0].role === 'user', 'replay started with an orphan tool turn');
  assert(history.length === 4 && history[1].toolCalls?.length === 1 && history[2].role === 'tool' && history[2].toolCallId === 'c1', 'replay lost the tool exchange');
  assert(!history.some((m) => m.role === 'assistant' && m.content === '' && !m.toolCalls), 'streaming placeholder replayed');
  assert(usedTools.includes('wh_search'), 'used tools not collected');

  // The character budget keeps the most recent turn even when it alone blows
  // the budget, and drops the older ones — never an empty history.
  const huge = 'x'.repeat(61_000);
  const budgeted = historyFromMessages([
    { ...base, id: 'a', role: 'user', content: 'ancient', createdAt: 1 },
    { ...base, id: 'b', role: 'user', content: huge, createdAt: 2 },
  ]).history;
  assert(budgeted.length === 1 && budgeted[0].content.length === 61_000, 'char budget dropped the most recent turn or kept an old one');

  // A trailing assistant tool REQUEST with no answers must be dropped, or the
  // provider rejects a dangling tool_call at the end of the replay.
  const dangling = historyFromMessages([
    { ...base, id: 'u', role: 'user', content: 'do it', createdAt: 1 },
    { ...base, id: 'v', role: 'assistant', content: '', createdAt: 2, toolCalls: [{ id: 'c9', name: 'wh_search', args: {} }] },
  ]).history;
  assert(dangling.length === 1 && dangling[0].role === 'user', 'a trailing unanswered tool request was replayed');
}

/**
 * The widened request surface. Every key asserted here was read out of
 * `SDGenerationParams::from_json_str` (examples/common/common.cpp) at the
 * pinned commit and cross-checked against `make_img_gen_defaults_json`
 * (examples/server/routes_sdcpp.cpp), which is the server's own statement of
 * the same schema. A key the server does not read costs nothing at request
 * time and everything afterwards: the job succeeds, so the studio reports a
 * setting that never reached the model.
 */
function testSdParameterSurface(): void {
  const sd15 = imageCatalogEntry('sd15-q8');
  assert(sd15, 'the SD1.5 catalogue entry went missing');
  const base = { connectionId: 'c', modelId: 'sd15-q8', prompt: 'a lighthouse', width: 512, height: 512, n: 1 };

  // THE compatibility guarantee: a request naming none of the new fields
  // produces the whole payload it produced before they existed, byte for byte.
  // Pinned as literal JSON rather than as a spot check, because the failure
  // this guards against is a key quietly appearing for every reader who never
  // asked for one.
  assert(
    JSON.stringify(buildSdJobPayload(base, sd15)) ===
      '{"prompt":"a lighthouse","negative_prompt":"","width":512,"height":512,"seed":-1,"batch_count":1,' +
      '"sample_params":{"sample_method":"euler_a","sample_steps":20,"guidance":{"txt_cfg":7,"distilled_guidance":3.5}},' +
      '"output_format":"png","embed_image_metadata":true}',
    'a request with none of the new fields must produce the payload it always did',
  );
  const loaded = {
    ...base, seed: 7, steps: 30, guidance: 6, negativePrompt: 'blur', n: 2, sampler: 'heun', scheduler: 'karras',
    initImage: 'data:1', strength: 0.4, maskImage: 'data:2', controlImage: 'data:3', controlStrength: 0.6,
    loras: [{ name: 'x', weight: 0.5, fileName: 'x.safetensors' }],
    hiresFix: { upscaler: 'Latent', scale: 2, steps: 10, denoisingStrength: 0.5, tileSize: 128 },
  };
  assert(
    JSON.stringify(buildSdJobPayload(loaded, sd15)) ===
      '{"prompt":"a lighthouse","negative_prompt":"blur","width":512,"height":512,"seed":7,"batch_count":2,' +
      '"sample_params":{"sample_method":"heun","sample_steps":30,"guidance":{"txt_cfg":6,"distilled_guidance":3.5},"scheduler":"karras"},' +
      '"output_format":"png","embed_image_metadata":true,"lora":[{"path":"x.safetensors","multiplier":0.5}],' +
      '"init_image":"data:1","strength":0.4,"mask_image":"data:2","control_image":"data:3","control_strength":0.6,' +
      '"hires":{"enabled":true,"upscaler":"Latent","scale":2,"steps":10,"denoising_strength":0.5,"upscale_tile_size":128}}',
    'a request using only the fields that already worked must be unchanged too',
  );

  // Absent unless asked for. This is the other half of the guarantee: the keys
  // exist, and they stay off the wire until somebody sets one.
  const bare = buildSdJobPayload(base, sd15) as Record<string, unknown>;
  for (const key of ['clip_skip', 'cache_mode', 'cache_option', 'vae_tiling_params']) {
    assert(!(key in bare), `${key} must be absent when nothing asked for it`);
  }
  const bareSample = bare.sample_params as Record<string, unknown>;
  for (const key of ['eta', 'flow_shift', 'shifted_timestep', 'custom_sigmas', 'extra_sample_args']) {
    assert(!(key in bareSample), `sample_params.${key} must be absent when nothing asked for it`);
  }
  assert(!('img_cfg' in (bareSample.guidance as Record<string, unknown>)), 'img_cfg must be absent when nothing asked for it');
  assert(!('slg' in (bareSample.guidance as Record<string, unknown>)), 'slg must be absent when nothing asked for it');

  // clip_skip: the runtime spells "unspecified" as <= 0, so 0 must not be sent
  // as though it were a choice.
  assert((buildSdJobPayload({ ...base, clipSkip: 2 }, sd15) as Record<string, unknown>).clip_skip === 2, 'clip_skip not sent');
  assert(!('clip_skip' in (buildSdJobPayload({ ...base, clipSkip: 0 }, sd15) as Record<string, unknown>)), 'clip_skip 0 means unspecified and must not be sent');

  // eta / flow_shift / shifted_timestep are INSIDE sample_params. At the top
  // level the parser never looks for them.
  const inner = buildSdJobPayload({ ...base, eta: 0.7, flowShift: 3, shiftedTimestep: 250 }, sd15) as Record<string, unknown>;
  const innerSample = inner.sample_params as Record<string, unknown>;
  assert(innerSample.eta === 0.7 && innerSample.flow_shift === 3 && innerSample.shifted_timestep === 250, 'eta/flow_shift/shifted_timestep must ride inside sample_params');
  assert(!('eta' in inner) && !('flow_shift' in inner), 'those three must NOT also appear at the top level, where nothing reads them');

  // Custom sigmas replace the scheduler rather than tuning it.
  const sigmas = buildSdJobPayload({ ...base, scheduler: 'karras', customSigmas: [14.6, 7.1, 2.4, 0] }, sd15) as { sample_params: Record<string, unknown> };
  assert(Array.isArray(sigmas.sample_params.custom_sigmas) && !('scheduler' in sigmas.sample_params), 'custom sigmas must replace the scheduler, not sit beside it');
  const badSigmas = buildSdJobPayload({ ...base, customSigmas: [1, Number.NaN] }, sd15) as { sample_params: Record<string, unknown> };
  assert(!('custom_sigmas' in badSigmas.sample_params), 'a sigma array with a NaN would poison the denoising loop and must not be sent');

  // Skip-Layer Guidance, under the nesting the parser actually walks.
  const slgPayload = buildSdJobPayload({ ...base, skipLayerGuidance: { layers: [7, 8, 9], layerStart: 0.01, layerEnd: 0.2, scale: 2.5 } }, sd15) as { sample_params: { guidance: Record<string, unknown> } };
  const slg = slgPayload.sample_params.guidance.slg as Record<string, unknown>;
  assert(JSON.stringify(slg.layers) === '[7,8,9]' && slg.layer_start === 0.01 && slg.layer_end === 0.2 && slg.scale === 2.5, 'slg must sit under sample_params.guidance.slg');
  const noLayers = buildSdJobPayload({ ...base, skipLayerGuidance: { layers: [], scale: 2 } }, sd15) as { sample_params: { guidance: Record<string, unknown> } };
  assert(!('slg' in noLayers.sample_params.guidance), 'SLG without a layer list must not be sent: the runtime default is an SD3-shaped guess');

  // Adaptive Projected Guidance travels as a key=value STRING, not an object.
  assert(formatExtraSampleArgs({ apgEta: 0.6, apgMomentum: -0.5, slgUncond: true }) === 'apg_eta=0.6,apg_momentum=-0.5,slg_uncond=true', 'extra sample args must serialise to the key=value line the runtime parses');
  assert(formatExtraSampleArgs({}) === '' && formatExtraSampleArgs(undefined) === '', 'nothing to say must produce nothing');
  assert(formatExtraSampleArgs({ apgEta: Number.NaN }) === '', 'parse_strict_float rejects trailing text, so a NaN must be dropped rather than written');
  const apg = buildSdJobPayload({ ...base, extraSampleArgs: { apgEta: 0.6, apgNormThreshold: 15 } }, sd15) as { sample_params: Record<string, unknown> };
  assert(apg.sample_params.extra_sample_args === 'apg_eta=0.6,apg_norm_threshold=15', 'APG must reach the server as extra_sample_args');

  // hires: the long spelling. `target_w`/`target_h` are the CLI's and would be
  // ignored without a word.
  const hires = buildSdJobPayload({ ...base, hiresFix: { upscaler: 'Lanczos', scale: 2, targetWidth: 1024, targetHeight: 1536, customSigmas: [10, 5, 0] } }, sd15) as { hires: Record<string, unknown> };
  assert(hires.hires.target_width === 1024 && hires.hires.target_height === 1536, 'hires must use target_width/target_height');
  assert(!('target_w' in hires.hires) && !('target_h' in hires.hires), 'the CLI spelling must never be sent');
  assert(JSON.stringify(hires.hires.custom_sigmas) === '[10,5,0]', 'the hires pass takes its own sigma schedule');

  // Steps clamp to what strict resolution allows, so the recipe records what
  // the runtime actually did.
  assert(SD_MAX_STEPS === 100, 'strict resolution clamps sample_steps to 1..100');
  assert((buildSdJobPayload({ ...base, steps: 150 }, sd15) as { sample_params: { sample_steps: number } }).sample_params.sample_steps === 100, 'steps above the strict ceiling must be clamped here, not silently by the server');

  // Inference cache: an invalid mode is refused by the server outright, unlike
  // an invalid sampler name, so it must never leave.
  assert(isSdCacheMode('easycache') && isSdCacheMode('cache-dit') && !isSdCacheMode('EasyCache') && !isSdCacheMode('nonesuch'), 'cache mode table');
  const cached = buildSdJobPayload({ ...base, cacheMode: 'easycache', cacheOption: 'threshold=0.15' }, sd15) as Record<string, unknown>;
  assert(cached.cache_mode === 'easycache' && cached.cache_option === 'threshold=0.15', 'cache mode not sent');
  assert(!('cache_mode' in (buildSdJobPayload({ ...base, cacheMode: 'nonesuch' }, sd15) as Record<string, unknown>)), 'an unknown cache mode would have the server refuse the whole job');
  assert(!('cache_mode' in (buildSdJobPayload({ ...base, cacheMode: 'disabled' }, sd15) as Record<string, unknown>)), 'disabled is the default and is not worth a key');

  // Tiled VAE.
  const tiled = buildSdJobPayload({ ...base, vaeTiling: { tileSizeX: 256, tileSizeY: 256, targetOverlap: 0.25 } }, sd15) as { vae_tiling_params: Record<string, unknown> };
  assert(tiled.vae_tiling_params.enabled === true && tiled.vae_tiling_params.tile_size_x === 256 && tiled.vae_tiling_params.target_overlap === 0.25, 'vae_tiling_params not sent under its own names');

  // Fields that LOOK available and are not. None of these strings occurs
  // anywhere in the runtime's source at the pinned commit, so each would have
  // been accepted and dropped, and the studio would have claimed it worked.
  const everything = buildSdJobPayload(
    { ...base, clipSkip: 2, eta: 0.5, cacheMode: 'ucache', skipLayerGuidance: { layers: [7] }, extraSampleArgs: { apgEta: 1 },
      hiresFix: { upscaler: 'Latent', scale: 2, targetWidth: 1024, targetHeight: 1024 }, vaeTiling: { enabled: true } },
    sd15,
  );
  const wire = JSON.stringify(everything);
  for (const absent of ['ad_model', 'ad_prompt', 'ad_negative_prompt', 'extra_ad_args', 'ip_adapter', 'guidance_schedule', 'photo_maker', 'pulid']) {
    assert(!wire.includes(absent), `${absent} does not exist at the pinned commit and must never be sent`);
  }
}

/** The recipe: identity, round trip, comparison and honest replay. */
function testRecipe(): void {
  const request = {
    connectionId: 'builtin-sd', modelId: 'sd15-q8', prompt: 'a {colour} lighthouse', negativePrompt: 'blur',
    width: 512, height: 768, n: 1, seed: 99, steps: 28, guidance: 6.5, sampler: 'dpm++2m', scheduler: 'karras',
    clipSkip: 2, eta: 0.4, skipLayerGuidance: { layers: [7, 8, 9], scale: 2.5 },
    extraSampleArgs: { apgEta: 0.6 }, controlStrength: 0.55, controlNetModel: 'controlnet-sd15-openpose',
    loras: [{ name: 'sombra', weight: 0.8, fileName: 'sombra.safetensors' }],
    hiresFix: { upscaler: 'Latent', scale: 2, steps: 12, denoisingStrength: 0.45 },
  };
  const recipe = requestToRecipe(request, {
    id: 'r1', createdAt: 1000, seed: 99, rngMode: 'cuda',
    resolvedPrompt: 'a red lighthouse',
    model: { label: 'SD 1.5', sha256: 'a'.repeat(64) },
    loraAssets: { sombra: { sha256: 'b'.repeat(64) } },
    backendKind: 'sdcpp', backendVersion: 'master-709-92a3b73',
    controlImageId: 'img-control', refImageIds: ['img-a', 'img-b'],
  });

  // The written text and the text that reached the encoder are both kept: with
  // only one of them the recipe reproduces the dice, or loses the intent.
  assert(recipe.prompt.positive === 'a {colour} lighthouse' && recipe.prompt.resolvedPositive === 'a red lighthouse', 'a recipe must keep both the written and the resolved prompt');
  assert(recipe.model.sha256 === 'a'.repeat(64) && recipe.loras[0].sha256 === 'b'.repeat(64), 'assets must be identified by digest, not only by name');
  assert(recipe.seed.seed === 99 && recipe.seed.rngMode === 'cuda', 'the same integer seed gives another picture under another RNG');
  assert(recipe.passes.length === 2 && recipe.passes[1].kind === 'hires', 'the pass chain must record the second pass');
  assert(recipe.inputs.refImages?.length === 2 && recipe.inputs.controlImage?.imageId === 'img-control', 'image inputs ride as Gallery ids, never as bytes');
  assert(!JSON.stringify(recipe).includes('data:'), 'a recipe must never carry image bytes');

  // Round trip: recipe -> request -> recipe reaches the same settings hash.
  const replayed = recipeToRequest(recipe);
  assert(replayed.prompt === 'a red lighthouse', 'a replay must send the resolved text, not the wildcard');
  assert(replayed.seed === 99 && replayed.steps === 28 && replayed.sampler === 'dpm++2m' && replayed.scheduler === 'karras', 'a replay must carry the sampling settings');
  assert(replayed.hiresFix?.upscaler === 'Latent' && replayed.loras?.[0].fileName === 'sombra.safetensors', 'a replay must carry the pass chain and the LoRAs');
  const again = requestToRecipe(replayed, {
    id: 'r2', createdAt: 9999, seed: 99, rngMode: 'cuda',
    resolvedPrompt: 'a red lighthouse',
    model: { label: 'SD 1.5', sha256: 'a'.repeat(64) },
    loraAssets: { sombra: { sha256: 'b'.repeat(64) } },
    backendKind: 'sdcpp', backendVersion: 'master-709-92a3b73',
    controlImageId: 'img-control', refImageIds: ['img-a', 'img-b'],
  });
  // The written prompt is the only thing a replay cannot recover: it sent the
  // resolved text, so that is what the second recipe records as written.
  assert(again.sampling.steps === recipe.sampling.steps && again.seed.seed === recipe.seed.seed && again.size.height === 768, 'the round trip lost a setting');

  // The hash is the identity of the settings, not of the row.
  assert(recipeHash({ ...recipe, id: 'other', createdAt: 5, hash: 'stale' }) === recipeHash(recipe), 'the row id and timestamp must not change the hash');
  const reordered = JSON.parse(JSON.stringify({
    size: recipe.size, backend: recipe.backend, passes: recipe.passes, inputs: recipe.inputs,
    seed: recipe.seed, sampling: recipe.sampling, loras: recipe.loras, model: recipe.model,
    prompt: recipe.prompt, createdAt: recipe.createdAt, id: recipe.id, version: recipe.version,
  })) as typeof recipe;
  assert(recipeHash(reordered) === recipeHash(recipe), 'the hash must be stable across key order');
  assert(recipeHash({ ...recipe, sampling: { ...recipe.sampling, steps: 29 } }) !== recipeHash(recipe), 'one more step is a different picture and must be a different hash');
  assert(recipeHash({ ...recipe, seed: { ...recipe.seed, seed: 100 } }) !== recipeHash(recipe), 'a different seed must be a different hash');
  assert(/^[0-9a-f]{64}$/.test(recipeHash(recipe)), 'the hash must be a SHA-256 in lower-case hex');
  // A known vector, so a bug in the digest cannot bless its own output.
  assert(sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'SHA-256 disagrees with the published vector for "abc"');
  assert(sha256Hex('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'SHA-256 disagrees with the published vector for the empty string');
  // A key present as `undefined` and a key that is missing are the same
  // absence, or the same settings would hash two ways.
  assert(canonicalJson({ a: 1, b: undefined }) === canonicalJson({ a: 1 }), 'an explicit undefined must canonicalise away');
  assert(canonicalJson({ b: 2, a: 1 }) === canonicalJson({ a: 1, b: 2 }), 'canonical JSON must sort its keys');
  assert(canonicalJson([1, 2]) !== canonicalJson([2, 1]), 'array order is meaningful and must survive canonicalisation');

  // The diff names what changed, by path.
  const changed = { ...recipe, sampling: { ...recipe.sampling, steps: 40, cfg: 8 } };
  const diff = diffRecipes(recipe, changed);
  assert(!diff.identical && diff.changes.length === 2, 'the diff must report exactly the two changed fields');
  const paths = diff.changes.map((c) => c.path).sort();
  assert(paths[0] === 'sampling.cfg' && paths[1] === 'sampling.steps', `the diff must name the fields, got ${paths.join(',')}`);
  const stepChange = diff.changes.find((c) => c.path === 'sampling.steps');
  assert(stepChange?.before === 28 && stepChange.after === 40, 'the diff must carry both values');
  assert(diffRecipes(recipe, { ...recipe, id: 'z', createdAt: 7 }).identical, 'the same settings stored twice must compare identical');

  // Replay never substitutes: it reports.
  const missing = checkRecipeReplay(recipe, { installedModelIds: ['flux-schnell-q4'], installedLoraFileNames: [] });
  assert(!missing.ok && missing.missingModel === 'sd15-q8', 'a missing model must be named, never swapped');
  assert(missing.suggestedModels.includes('flux-schnell-q4'), 'the nearest installed model is offered, not applied');
  assert(missing.missingLoras.includes('sombra'), 'a missing LoRA must be named too');
  const present = checkRecipeReplay(recipe, { installedModelIds: ['sd15-q8'], installedLoraFileNames: ['sombra.safetensors'] });
  assert(present.ok && present.suggestedModels.length === 0, 'a replayable recipe must not offer alternatives');
}

/** A PNG the app has never seen gives its recipe back, whoever wrote it. */
function testRecipeRoundTripThroughPng(): void {
  const recipe = requestToRecipe(
    { connectionId: 'builtin-sd', modelId: 'sd15-q8', prompt: 'un faro', width: 512, height: 512, n: 1, seed: 3, steps: 20, guidance: 7, sampler: 'euler_a' },
    { id: 'r9', createdAt: 5, seed: 3, resolvedPrompt: 'un faro rojo' },
  );
  const a1111 = 'un faro rojo\nSteps: 20, CFG scale: 7.000000, Seed: 3, Size: 512x512, Model: sd15-q8, RNG: cuda, Sampler: euler_a karras';
  const png = writePngMetadata(tinyPng(), { parameters: a1111, writersHoard: recipeEnvelope(recipe) });

  // Both chunks survive together: ours for the studio, A1111's for every other
  // tool the reader might open the file in.
  const read = readPngMetadata(png);
  assert(read.parameters === a1111, 'the A1111 line must round-trip beside ours');
  const ours = recoverRecipe(read, { parseParameters: parseA1111Parameters, readRecord: readSdcppRecord });
  assert(ours?.source === 'writers-hoard', 'our own envelope must win when it is there');
  assert(recipeHash(ours.recipe) === recipeHash(recipe), 'our record must come back identical');
  assert(ours.recipe.prompt.resolvedPositive === 'un faro rojo' && ours.recipe.prompt.positive === 'un faro', 'the resolved prompt must survive the file');

  // Without our chunk it falls back to the flat line, and says so.
  const foreign = recoverRecipe({ parameters: a1111 }, { parseParameters: parseA1111Parameters, readRecord: readSdcppRecord });
  assert(foreign?.source === 'a1111', 'a foreign PNG must fall back to the A1111 line');
  assert(foreign.recipe.sampling.sampler === 'euler_a' && foreign.recipe.sampling.scheduler === 'karras', 'the A1111 "Sampler" field carries the scheduler after a space');
  assert(foreign.recipe.sampling.steps === 20 && foreign.recipe.sampling.cfg === 7 && foreign.recipe.seed.seed === 3, 'the flat line must still yield the settings it does carry');
  assert(foreign.recipe.size.width === 512 && foreign.recipe.size.height === 512, 'Size must be read as a size');

  // The runtime's own JSON is richer than the flat line, and is preferred.
  const sdcppTail = ', SDCPP: ' + JSON.stringify({
    schema: 'sdcpp.image.params/v1',
    prompt: { positive: 'un faro', negative: 'borroso' },
    sampling: { sample_method: 'heun', scheduler: 'exponential', sample_steps: 33, guidance: { txt_cfg: 5.5, distilled_guidance: 3.5 } },
    seed: 42, width: 640, height: 384, clip_skip: -1, models: { model: 'sd15-q8.gguf' },
    loras: [{ name: 'sombra', multiplier: 0.7, is_high_noise: false }],
    generator: { name: 'stable-diffusion.cpp', version: 'master-709' },
  });
  const withRecord = recoverRecipe(
    { parameters: 'un faro\nSteps: 33, Seed: 42, Sampler: heun, Version: stable-diffusion.cpp' + sdcppTail },
    { parseParameters: parseA1111Parameters, readRecord: readSdcppRecord },
  );
  assert(withRecord?.source === 'sdcpp', "the runtime's structured record must beat the flat line");
  assert(withRecord.recipe.sampling.sampler === 'heun' && withRecord.recipe.sampling.scheduler === 'exponential' && withRecord.recipe.sampling.cfg === 5.5, 'the sdcpp record must yield the sampling block');
  assert(withRecord.recipe.loras[0].id === 'sombra' && withRecord.recipe.loras[0].weight === 0.7, 'the sdcpp record must yield the LoRA list');
  assert(withRecord.recipe.sampling.clipSkip === undefined, 'clip_skip <= 0 means unspecified and must not become a setting');
  assert(withRecord.recipe.prompt.negative === 'borroso', 'the sdcpp record must yield the negative prompt');

  // That JSON tail is full of commas; splitting the settings line through it
  // used to fill the field map with fragments.
  const parsed = parseA1111Parameters('un faro\nSteps: 33, Seed: 42, Sampler: heun, Version: stable-diffusion.cpp' + sdcppTail);
  assert(parsed.fields.Steps === '33' && parsed.fields.Seed === '42', 'the real fields must still parse');
  assert(!Object.keys(parsed.fields).some((k) => k.includes('{') || k.includes('"')), 'no JSON fragment may leak into the flat field map');

  // Nothing at all is a perfectly good answer, and never an exception.
  assert(recoverRecipe({}, { parseParameters: parseA1111Parameters, readRecord: readSdcppRecord }) === null, 'a PNG that says nothing must read back as nothing');
  assert(recoverRecipe({ parameters: '' }, { parseParameters: parseA1111Parameters, readRecord: readSdcppRecord }) === null, 'an empty parameters string is not a recipe');
  assert(Object.keys(readPngMetadata(tinyPng())).length === 0, 'a PNG with no text chunks must read back empty');
  // Somebody else's `writershoard` chunk must not be mistaken for ours.
  const alien = readPngMetadata(writePngMetadata(tinyPng(), { writersHoard: { kind: 'somebody-else', payload: 1 } }));
  assert(recoverRecipe(alien, { parseParameters: parseA1111Parameters, readRecord: readSdcppRecord }) === null, "another tool's chunk of the same name must not be read as a recipe");
  // A truncated envelope must not take the reader down with it.
  let survived = true;
  try {
    recoverRecipe({ writersHoard: { kind: RECIPE_ENVELOPE_KIND, version: 1, recipe: { version: 1 } } }, { parseParameters: parseA1111Parameters, readRecord: readSdcppRecord });
  } catch {
    survived = false;
  }
  assert(survived, 'a half-written envelope must be refused, not thrown on');
}

/**
 * The runtime profile: which changes cost a restart, and which do not.
 *
 * `ensureSdServer` decides whether the live process can serve the next job by
 * comparing exactly these hashes, so this is that decision under test rather
 * than a model of it.
 */
function testSdRuntimeProfile(): void {
  const running: SdRuntimeProfile = {
    modelId: 'sd15-q8', controlNet: null, loraDir: false,
    upscalersDir: false, offloadToCpu: false, flashAttention: false,
  };
  assert(/^[0-9a-f]{64}$/.test(sdRuntimeProfileHash(running)), 'a profile hash must be a SHA-256 in lower-case hex');

  // Same choices, however the object was built: no restart.
  const rebuilt: SdRuntimeProfile = {
    flashAttention: false, offloadToCpu: false, upscalersDir: false,
    loraDir: false, controlNet: null, modelId: 'sd15-q8',
  };
  assert(sdRuntimeProfileHash(rebuilt) === sdRuntimeProfileHash(running), 'the same launch choices must hash the same whatever order they were written in');
  assert(sdProfileRestartReasons(running, rebuilt).length === 0, 'an unchanged profile must not cost a restart');

  // Every launch flag is part of the identity, and each one alone is enough.
  const changes: Array<[Partial<SdRuntimeProfile>, string]> = [
    [{ modelId: 'flux-schnell-q4' }, 'model'],
    [{ controlNet: 'openpose.pth' }, 'control-net'],
    [{ loraDir: true }, 'lora-folder'],
    [{ upscalersDir: true }, 'upscaler-folder'],
    [{ offloadToCpu: true }, 'memory-placement'],
    [{ flashAttention: true }, 'flash-attention'],
  ];
  for (const [patch, reason] of changes) {
    const wanted = { ...running, ...patch };
    assert(sdRuntimeProfileHash(wanted) !== sdRuntimeProfileHash(running), `changing ${reason} must change the profile hash`);
    const reasons = sdProfileRestartReasons(running, wanted);
    assert(reasons.length === 1 && reasons[0] === reason, `changing ${reason} must be reported as exactly that, got ${reasons.join(',')}`);
  }
  // Two at once are both named, so the reader is told the whole price.
  const both = sdProfileRestartReasons(running, { ...running, modelId: 'flux-schnell-q4', controlNet: 'openpose.pth' });
  assert(both.length === 2 && both.includes('model') && both.includes('control-net'), 'both changes must be named');
  // Nothing is running yet, so nothing is being reloaded: a cold start is not
  // a restart and must not be announced as one.
  assert(sdProfileRestartReasons(null, running).length === 0, 'a cold start costs no restart');

  // The profile and the command line must describe the same process: a flag
  // that appears without a field would take effect only by accident, when
  // something else happened to restart the server.
  const sd15 = imageCatalogEntry('sd15-q8');
  assert(sd15, 'the SD1.5 catalogue entry went missing');
  const full = buildSdServerArgs(sd15, {
    paths: { model: 'D:/m/sd15.gguf' }, offloadToCpu: true, flashAttention: true,
    loraDir: 'D:/l', controlNetPath: 'D:/c/openpose.pth', hiresUpscalersDir: 'D:/u',
  });
  for (const flag of ['--offload-to-cpu', '--diffusion-fa', '--lora-model-dir', '--control-net', '--hires-upscalers-dir']) {
    assert(full.includes(flag), `${flag} is a launch choice and must appear when its profile field is set`);
  }
  const none = buildSdServerArgs(sd15, { paths: { model: 'D:/m/sd15.gguf' } });
  for (const flag of ['--offload-to-cpu', '--diffusion-fa', '--lora-model-dir', '--control-net', '--hires-upscalers-dir']) {
    assert(!none.includes(flag), `${flag} must be absent when its profile field is not set`);
  }
}

export async function testAiRuntimeContracts(): Promise<string> {
  testUrlPolicy();
  testHardwareFit();
  testMeasuredSpeedAndPicker();
  testLocalImageRuntime();
  testSdRequestSurface();
  testSdParameterSurface();
  testPngMetadata();
  testRecipe();
  testRecipeRoundTripThroughPng();
  testSdRuntimeProfile();
  testToolSelection();
  testPolicy();
  await testExecutorEquivalence();
  testPromptAndHistory();
  return 'AI runtime: URL policy, hardware fit, measured speed + picker, local image runtime, sd-server request surface, widened sd-server parameter surface, PNG generation metadata, recipe identity/round-trip/diff, recipe recovery from a foreign PNG, runtime profile restart cost, tool selection, permissions/scope, executor equivalence bridge≡copilot, history replay';
}
