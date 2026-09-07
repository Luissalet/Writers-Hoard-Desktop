// ============================================================================
// Image studio — three columns, not a chat log
// ============================================================================
//
// Cast on the left, composer and results in the middle, parameters on the
// right. The chat metaphor is actively wrong for this work: it hides the
// parameters behind the prose, it makes history unbrowsable, and it has nowhere
// to put a reference that accumulates. What makes a character look the same in
// chapter 30 as in chapter 1 is not a better sentence; it is a resolver that
// applies the same LoRA, the same portrait, the same seed and the same words
// every time, and shows the writer exactly what it did.
//
// The state this opens in for a writer with no image model installed is not an
// error state. It is the visual bible: the cast, the portraits, the fragments,
// the chapters each character appears in. Generation is what is missing, and it
// says so — visibly, in the place the button lives.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitCompare, Grid3x3, ImagePlus, Loader2, Settings2, Sparkles, Square, XCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';
import type { EngineComponentProps } from '@/engines/_types';
import type { CodexEntry, InspirationImage } from '@/types';
import type { VisualRef } from '@/types/visualRef';
import { db } from '@/db';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import { useImageRuntimeStore } from '@/stores/imageRuntimeStore';
import type { AiRouteSelection } from '@/services/aiRuntime/types';
import type { ImageHandle } from '@/services/aiRuntime/client';
import { SD_BUILTIN_HIRES_UPSCALERS } from '@/services/aiRuntime/sdServer';
import { imageCatalogEntry } from '@/services/aiRuntime/imageCatalog';
import { getProjectSettings, saveProjectSettings } from '@/services/copilot/threads';
import { toast } from '@/components/common/toast';
import {
  mentionToken,
  parseMentions,
  readRecipe,
  resolve,
  variationSeeds,
  type ResolveOptions,
  type ResolverModel,
} from '@/services/visualRef';
import {
  REQUEST_SUPPORTS,
  deleteGeneratedImage,
  listGeneratedImages,
  saveGenerated,
  startGeneration,
} from './operations';
import {
  bucketsForFamily,
  defaultBucket,
  defaultsForModel,
  mergeStack,
  newChain,
  parsePassChain,
  planRun,
  readStudioPrefs,
  rollSeed,
  seedsForBatch,
  stackFromReferences,
  studioCapabilities,
  wildcardFilesFromRefs,
  writeStudioPrefs,
  type DefaultsSource,
  type LoraStackEntry,
  type PassSupportInput,
  type StudioLevel,
  type StudioPass,
  type XyzCell,
} from './studio';
import {
  addToReferenceSet,
  createVisualRef,
  deleteVisualRef,
  listVisualRefs,
  loadRefImages,
  pinHeroSeed,
  setCanonicalImage,
  updateVisualRef,
} from './refs';
import { AVAILABLE, blocked, isManagedLocalRoute, studioResolverModel, type Availability } from './studioModel';
import CastColumn from './components/CastColumn';
import ParametersColumn, { type ParametersState } from './components/ParametersColumn';
import ReferenceEditor from './components/ReferenceEditor';
import ResolvedPrompt from './components/ResolvedPrompt';
import ResultsGrid, { type ResultBatch } from './components/ResultsGrid';
import CompareDialog from './components/CompareDialog';
import DatasetExportDialog from './components/DatasetExportDialog';
import PromptCraftBar from './components/PromptCraftBar';
import { onWeightKeyDown } from './components/weightKeys';
import XyzPlotDialog from './components/XyzPlotDialog';

const INITIAL_PARAMETERS: ParametersState = {
  sizePreset: '1024x1024',
  customWidth: '',
  customHeight: '',
  steps: '',
  cfg: '',
  sampler: '',
  scheduler: '',
  clipSkip: '',
  seedMode: 'explore',
  manualSeed: '',
  batch: 1,
  batchSeedMode: 'incremental',
};

/** Variations are a batch of six: enough to see a trend, few enough to look at. */
const VARIATION_COUNT = 6;

/**
 * The stamp every picture of one press shares, so the results grid groups them.
 *
 * At module scope for the same reason the dice are: the clock is impure, and a
 * component that reads it in its own body is a component React is allowed to
 * render twice and get two answers from.
 */
function batchStamp(): number {
  return Date.now();
}

/**
 * The model the disclosure resolves against when nothing is installed. The
 * writer still gets to see what their reference WOULD send: the disclosure is
 * the teaching surface, and withholding it until a backend exists teaches
 * nothing at all.
 */
const ABSENT_MODEL: ResolverModel = {
  connectionId: '',
  modelId: '',
  dialect: 'prose',
  supportsLora: false,
  supportsReferenceImages: false,
  supportsPhotoMaker: false,
  supportsControlNet: false,
  supportsInitImage: false,
};

export default function ImageStudioEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const runtime = useAiRuntimeStore();
  const sdStatus = useImageRuntimeStore((state) => state.status);

  const [refs, setRefs] = useState<VisualRef[]>([]);
  const [entries, setEntries] = useState<CodexEntry[]>([]);
  const [selectedRefId, setSelectedRefId] = useState<string | null>(null);
  const [pane, setPane] = useState<'composer' | 'reference'>('composer');
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  const [subjects, setSubjects] = useState('');
  const [scene, setScene] = useState('');
  const [style, setStyle] = useState('');
  const [parameters, setParameters] = useState<ParametersState>(INITIAL_PARAMETERS);

  // The studio's own state: the level, the chain and the stack. Kept together
  // so that the one place they are persisted is the one place they change.
  const [level, setLevel] = useState<StudioLevel>('simple');
  const [passes, setPasses] = useState<StudioPass[]>(() => newChain());
  const [loraManual, setLoraManual] = useState<LoraStackEntry[]>([]);
  const [showAllSamplers, setShowAllSamplers] = useState(false);
  const [appliedDefaults, setAppliedDefaults] = useState<DefaultsSource | null>(null);
  const [beforeDefaults, setBeforeDefaults] = useState<ParametersState | null>(null);
  const [plotting, setPlotting] = useState(false);

  const [route, setRoute] = useState<AiRouteSelection | undefined>(undefined);
  const [handle, setHandle] = useState<ImageHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<InspirationImage[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportImages, setExportImages] = useState<InspirationImage[]>([]);
  const [pendingDiscard, setPendingDiscard] = useState<InspirationImage | null>(null);
  const [pendingRefDelete, setPendingRefDelete] = useState<VisualRef | null>(null);

  const reloadRefs = useCallback(async () => {
    const rows = await listVisualRefs(projectId);
    setRefs(rows);
    const portraitIds = rows.map((row) => row.canonicalImageId).filter((id): id is string => Boolean(id));
    if (portraitIds.length === 0) {
      setThumbnails({});
      return;
    }
    const portraits = await db.inspirationImages.bulkGet(portraitIds);
    setThumbnails(Object.fromEntries(
      portraits
        .filter((row): row is InspirationImage => Boolean(row))
        .map((row) => [row.id, row.thumbnailData ?? row.imageData]),
    ));
  }, [projectId]);

  const reloadImages = useCallback(() => {
    void listGeneratedImages(projectId).then(setImages);
  }, [projectId]);

  useEffect(() => {
    let live = true;
    void (async () => {
      // Everything is set after an await on purpose: a synchronous setState
      // inside an effect cascades a second render before the first has painted.
      const [codex, settings] = await Promise.all([
        db.codexEntries.where('projectId').equals(projectId).toArray(),
        getProjectSettings(projectId),
        reloadRefs(),
      ]);
      if (!live) return;
      setEntries(codex);
      if (settings.imageRoute) setRoute(settings.imageRoute);
      const prefs = readStudioPrefs(projectId);
      setLevel(prefs.level);
      setPasses(prefs.passChain);
      setShowAllSamplers(prefs.showAllSamplers);
      setParameters((current) => ({ ...current, batchSeedMode: prefs.batchSeedMode }));
      reloadImages();
      void runtime.loadConnections();
      void runtime.loadDefaults();
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // --- the model, and what it can honour ------------------------------------
  const effectiveRoute = route ?? runtime.defaults.image;
  const descriptor = effectiveRoute
    ? runtime.modelsByConnection[effectiveRoute.connectionId]?.models.find((model) => model.id === effectiveRoute.modelId)
    : undefined;
  const cfgOverride = parameters.cfg.trim() ? Number(parameters.cfg) : undefined;
  const model = useMemo(
    () => studioResolverModel({
      route: effectiveRoute,
      descriptor,
      runtimeLorasSupported: sdStatus?.lorasSupported,
      cfgOverride,
    }),
    [effectiveRoute, descriptor, sdStatus?.lorasSupported, cfgOverride],
  );
  const managedLocal = isManagedLocalRoute(effectiveRoute);
  const family = model?.family;
  const capabilities = useMemo(
    () => studioCapabilities({
      model,
      supports: REQUEST_SUPPORTS,
      managedLocal,
      loraCount: sdStatus?.loras?.length ?? 0,
    }),
    [model, managedLocal, sdStatus?.loras?.length],
  );
  const nativeSize = useMemo(
    () => (descriptor?.nativeWidth && descriptor.nativeHeight
      ? { width: descriptor.nativeWidth, height: descriptor.nativeHeight }
      : undefined),
    [descriptor],
  );
  const size = useMemo(() => {
    if (parameters.sizePreset === 'native' && nativeSize) return nativeSize;
    if (parameters.sizePreset === 'custom') {
      const width = Number(parameters.customWidth) || defaultBucket(family).width;
      const height = Number(parameters.customHeight) || defaultBucket(family).height;
      return { width, height };
    }
    const buckets = bucketsForFamily(family);
    return buckets.find((bucket) => bucket.id === parameters.sizePreset) ?? defaultBucket(family);
  }, [parameters.sizePreset, parameters.customWidth, parameters.customHeight, nativeSize, family]);

  // Upscalers the server will resolve: the names every build knows without a
  // file, plus whatever is actually sitting in the upscalers folder. Offering
  // one it cannot find makes it refuse the whole request.
  const upscalers = useMemo(() => [
    ...SD_BUILTIN_HIRES_UPSCALERS,
    ...(sdStatus?.companions ?? []).filter((file) => file.kind === 'upscaler').map((file) => file.name),
  ], [sdStatus?.companions]);
  const passSupport: PassSupportInput = useMemo(
    () => ({ supports: REQUEST_SUPPORTS, managedLocal, upscalers }),
    [managedLocal, upscalers],
  );

  /** The level, the chain and the batch mode are remembered per project. */
  const persist = useCallback((changes: Partial<{
    level: StudioLevel;
    passChain: StudioPass[];
    showAllSamplers: boolean;
    batchSeedMode: ParametersState['batchSeedMode'];
  }>) => {
    writeStudioPrefs(projectId, {
      level,
      passChain: passes,
      showAllSamplers,
      batchSeedMode: parameters.batchSeedMode,
      ...changes,
    });
  }, [projectId, level, passes, showAllSamplers, parameters.batchSeedMode]);

  // --- the resolution -------------------------------------------------------
  const mentions = useMemo(() => parseMentions(subjects, refs), [subjects, refs]);
  const resolveOptions: ResolveOptions = useMemo(() => ({
    seedMode: parameters.seedMode,
    manualSeed: parameters.manualSeed.trim() ? Number(parameters.manualSeed) : undefined,
  }), [parameters.seedMode, parameters.manualSeed]);
  // Resolved against a nameless placeholder model when nothing is installed, so
  // the writer can still see what their reference WOULD send. The disclosure is
  // the teaching surface; withholding it until a model exists teaches nothing.
  const previewModel = useMemo(() => model ?? ABSENT_MODEL, [model]);
  const resolved = useMemo(
    () => resolve(mentions.refs, [mentions.rest, scene].filter(Boolean).join(', '), style, previewModel, resolveOptions),
    [mentions.refs, mentions.rest, scene, style, previewModel, resolveOptions],
  );

  // References own their LoRAs; the stack adds the writer's own on top and
  // drops duplicates, because a file loaded twice is not loaded twice as hard —
  // the last multiplier wins and the reference silently loses its weight.
  const loraStack = useMemo(
    () => mergeStack(stackFromReferences(resolved.loras, refs), loraManual),
    [resolved.loras, refs, loraManual],
  );
  // Wildcard lists are the project's own reusable fragments: this engine owns
  // one table and it is not a wildcard store, so `__lighting__` reads the
  // reference called "lighting" rather than a file nobody can see.
  const wildcardFiles = useMemo(() => wildcardFilesFromRefs(refs), [refs]);

  const selectedRef = refs.find((row) => row.id === selectedRefId) ?? null;
  const heroRef = mentions.refs.find((row) => typeof row.heroSeed === 'number') ?? null;
  const busy = handle !== null;

  // --- availability, with reasons -------------------------------------------
  const generateAction: Availability = !model
    ? blocked('visualRef.reason.noModel')
    : busy
      ? blocked('visualRef.reason.busy')
      : !resolved.prompt.trim()
        ? blocked('visualRef.reason.noPrompt')
        : AVAILABLE;
  const refActions: Availability = selectedRef ? AVAILABLE : blocked('visualRef.reason.noRefSelected');
  const seedAction = useCallback(
    (image: InspirationImage): Availability => {
      if (!selectedRef) return blocked('visualRef.reason.noRefSelected');
      if (image.generation?.seed === undefined) return blocked('visualRef.reason.noSeedRecorded');
      return AVAILABLE;
    },
    [selectedRef],
  );
  const compareAction: Availability = compareIds.length >= 2 && compareIds.length <= 4
    ? AVAILABLE
    : blocked('visualRef.reason.compareCount');

  // --- generating -----------------------------------------------------------

  /** A field the model cannot honour is never sent, whatever is in the box. */
  const numeric = (text: string): number | undefined => (text.trim() ? Number(text) : undefined);

  /**
   * Everything one run needs, in one place.
   *
   * The composer's preview, the X/Y/Z plot and "vary this one" all go through
   * this and then through `planRun`, because a preview built by a second code
   * path is a preview of something else — and the resolved-prompt disclosure
   * only means anything if what it shows is what is sent.
   */
  const planFor = (input: {
    seed: number;
    wildcardSeed?: number;
    prompt?: string;
    negative?: string;
    cell?: XyzCell;
    references?: { identity: string[]; control: { image: string; weight: number }[] };
    refImageIds?: string[];
    controlImageId?: string;
    stamp?: number;
    tags?: string[];
  }) => {
    const cell = input.cell?.overrides;
    const chain = cell?.hiresDenoise === undefined
      ? passes
      : passes.map((pass) => (pass.kind === 'hires' ? { ...pass, denoise: cell.hiresDenoise } : pass));
    return {
      projectId,
      route: effectiveRoute as AiRouteSelection,
      resolved: {
        ...resolved,
        prompt: input.prompt ?? resolved.prompt,
        negativePrompt: input.negative ?? resolved.negativePrompt,
      },
      composer: { subjects, scene, style },
      width: size.width,
      height: size.height,
      seed: cell?.seed ?? input.seed,
      wildcardSeed: input.wildcardSeed,
      n: 1,
      steps: cell?.steps ?? numeric(parameters.steps),
      cfg: capabilities.cfg.enabled ? cell?.cfg ?? numeric(parameters.cfg) : undefined,
      sampler: capabilities.sampler.enabled ? (cell?.sampler ?? (parameters.sampler || undefined)) : undefined,
      scheduler: capabilities.scheduler.enabled ? (cell?.scheduler ?? (parameters.scheduler || undefined)) : undefined,
      clipSkip: capabilities.clipSkip.enabled ? cell?.clipSkip ?? numeric(parameters.clipSkip) : undefined,
      passes: chain,
      passSupport,
      loraStack,
      wildcardFiles,
      referenceImages: input.references?.identity,
      controlNets: input.references?.control,
      refImageIds: input.refImageIds,
      controlImageId: input.controlImageId,
      visualRefIds: mentions.refs.map((row) => row.id),
      promptSuffix: cell?.promptSuffix,
      stamp: input.stamp,
      gridLabel: input.cell?.coords.map((coord) => `${t(`imageStudio.xyz.field.${coord.field}`)} ${coord.value}`).join(' · '),
      tags: input.tags,
    };
  };

  const runGeneration = async (override?: {
    seeds?: number[];
    prompt?: string;
    negative?: string;
    /** One X/Y/Z cell: what this run changes about the recipe on screen. */
    cell?: XyzCell;
    /** Shared by every picture the writer asked for in one press. */
    stamp?: number;
    tags?: string[];
  }) => {
    if (!model || !effectiveRoute || busy) return;
    setError(null);
    // The dice are rolled HERE, not in the resolver: a pure resolver is what
    // makes a recipe reproducible and a diff meaningful.
    const base = resolved.seedMode === 'explore' ? rollSeed() : resolved.seed ?? rollSeed();
    const seeds = override?.seeds ?? seedsForBatch(base, parameters.batch, parameters.batchSeedMode);
    const references = await resolveReferenceData();
    const stamp = override?.stamp ?? batchStamp();
    const refImageIds = resolved.referenceImages.filter((row) => row.role !== 'pose').map((row) => row.imageId);
    const controlImageId = resolved.referenceImages.find((row) => row.role === 'pose')?.imageId;

    for (const [index, seed] of seeds.entries()) {
      const request = planRun(planFor({
        seed,
        // A fixed-seed batch varies only the wording: same noise, different
        // wildcard picks, which is the only way that mode is worth having.
        wildcardSeed: parameters.batchSeedMode === 'fixed' ? seed + index : seed,
        prompt: override?.prompt,
        negative: override?.negative,
        cell: override?.cell,
        references,
        refImageIds,
        controlImageId,
        stamp,
        tags: override?.tags,
      })).options;
      const started = startGeneration(request);
      setHandle(started);
      try {
        const saved = await saveGenerated(request, await started.result);
        if (!saved.ok && saved.code !== 'cancelled') setError(saved.error ?? t('imageStudio.error.generic'));
      } catch (caught) {
        setError(t('imageStudio.error.saveFailed').replace('{error}', caught instanceof Error ? caught.message : String(caught)));
      } finally {
        setHandle(null);
      }
    }
    reloadImages();
  };

  /**
   * The prompt as it will actually be sent, resolved against the seed on
   * screen. Shown under the composer so a wildcard is never a surprise: a
   * recipe holding an unresolved `{a|b|c}` is not a recipe.
   */
  const preview = effectiveRoute ? planRun(planFor({ seed: resolved.seed ?? 0 })) : null;

  /** Turn the resolved image ids into the bytes the request would carry. */
  const resolveReferenceData = async (): Promise<{ identity: string[]; control: { image: string; weight: number }[] }> => {
    if (resolved.referenceImages.length === 0) return { identity: [], control: [] };
    const rows = await db.inspirationImages.bulkGet(resolved.referenceImages.map((image) => image.imageId));
    const identity: string[] = [];
    const control: { image: string; weight: number }[] = [];
    resolved.referenceImages.forEach((reference, index) => {
      const row = rows[index];
      if (!row) return;
      const data = row.imageDataOriginal ?? row.imageData;
      if (reference.role === 'pose') control.push({ image: data, weight: reference.weight ?? 0.55 });
      else identity.push(data);
    });
    return { identity, control };
  };

  // --- actions on a result --------------------------------------------------
  const iterate = (image: InspirationImage) => {
    if (!image.generation) return;
    const recipe = readRecipe(image.generation);
    // Read defensively: these ride on the row whether or not the shared type
    // has grown a field for them, the same way `readRecipe` reads the rest.
    const stored = image.generation as typeof image.generation & { passChain?: string; clipSkip?: number };
    // The model this was made with may be gone. Say so — never quietly pick the
    // nearest installed one, because then every stored recipe reproduces by
    // luck and the writer stops being able to trust any of them.
    if (recipe.modelId !== effectiveRoute?.modelId) {
      const installed = runtime.connections
        .flatMap((connection) => runtime.modelsByConnection[connection.id]?.models ?? [])
        .some((candidate) => candidate.id === recipe.modelId);
      // Named, never substituted. The selected model is offered as the nearest
      // thing available — as an offer the writer can see and refuse, not as a
      // swap made behind their back, which would make every stored recipe
      // reproduce by luck and none of them worth keeping.
      const current = effectiveRoute?.modelId ?? '—';
      toast.info(
        (installed ? t('visualRef.iterate.otherModel') : t('visualRef.iterate.modelGone'))
          .replace('{model}', recipe.modelId)
          .replace('{current}', current),
      );
    }
    // The slots as they were typed when the recipe carries them; the resolved
    // prompt only as a fallback for rows made before the studio recorded them.
    setSubjects(recipe.composer?.subjects ?? recipe.prompt);
    setScene(recipe.composer?.scene ?? '');
    setStyle(recipe.composer?.style ?? '');
    setParameters((current) => ({
      ...current,
      steps: recipe.steps === undefined ? '' : String(recipe.steps),
      cfg: recipe.cfg === undefined ? '' : String(recipe.cfg),
      sampler: recipe.sampler ?? '',
      scheduler: recipe.scheduler ?? '',
      clipSkip: stored.clipSkip === undefined ? '' : String(stored.clipSkip),
      seedMode: recipe.seed === undefined ? 'explore' : 'manual',
      manualSeed: recipe.seed === undefined ? '' : String(recipe.seed),
    }));
    // The chain is part of the recipe: a picture made with a hires pass that
    // comes back without one is not the same picture, and the writer would be
    // iterating on something they never made.
    if (stored.passChain) setPasses(parsePassChain(stored.passChain));
    setPane('composer');
  };

  const variations = (image: InspirationImage) => {
    const recipe = image.generation ? readRecipe(image.generation) : null;
    const base = recipe?.seed ?? rollSeed();
    void runGeneration({
      seeds: variationSeeds(base, VARIATION_COUNT),
      prompt: recipe?.prompt,
      negative: recipe?.negativePrompt,
    });
  };

  /**
   * Re-point the knobs to this model's working point, and SAY so.
   *
   * Applied on the switch itself rather than in an effect: a writer who picks
   * a model has asked for this, and the same change arriving invisibly on a
   * background load would move a value they had just tuned by hand.
   */
  const applyDefaults = (next: AiRouteSelection) => {
    const catalog = imageCatalogEntry(next.modelId);
    const nextDescriptor = runtime.modelsByConnection[next.connectionId]?.models
      .find((candidate) => candidate.id === next.modelId);
    const defaults = defaultsForModel({
      modelId: next.modelId,
      family: nextDescriptor?.family ?? catalog?.family,
      catalog,
    });
    setBeforeDefaults(parameters);
    setAppliedDefaults(defaults.source);
    setParameters((current) => ({
      ...current,
      sizePreset: defaults.bucketId,
      steps: String(defaults.steps),
      cfg: String(defaults.cfg),
      sampler: defaults.sampler,
      scheduler: defaults.scheduler ?? '',
      clipSkip: defaults.clipSkip === undefined ? '' : String(defaults.clipSkip),
    }));
  };

  const undoDefaults = () => {
    if (beforeDefaults) setParameters(beforeDefaults);
    setAppliedDefaults(null);
    setBeforeDefaults(null);
  };

  /** One X/Y/Z cell per run, tagged so the grid can be found again in Gallery. */
  const runPlot = async (cells: XyzCell[]) => {
    // One seed for the whole plot: a grid whose cells each rolled their own
    // noise shows the seed, not the axis, and is worth nothing. A seed axis
    // overrides this per cell, which is the one time it should differ.
    const seed = resolved.seed ?? rollSeed();
    // One stamp for the whole plot: a grid whose cells arrive as separate
    // batches is a column of single pictures, not a grid.
    const stamp = batchStamp();
    for (const cell of cells) {
      await runGeneration({ seeds: [seed], cell, stamp, tags: ['xyz'] });
    }
  };

  const batches: ResultBatch[] = useMemo(() => {
    const grouped = new Map<number, InspirationImage[]>();
    for (const image of images) {
      const at = image.generation?.createdAt ?? image.createdAt;
      const bucket = grouped.get(at);
      if (bucket) bucket.push(image);
      else grouped.set(at, [image]);
    }
    return [...grouped.entries()]
      .sort((left, right) => right[0] - left[0])
      .map(([at, rows]) => ({ at, images: rows }));
  }, [images]);

  const compareImages = images.filter((image) => compareIds.includes(image.id));

  const openExport = async () => {
    if (!selectedRef) return;
    const rows = await loadRefImages(selectedRef);
    setExportImages(rows.filter((row) => selectedRef.referenceImageIds.includes(row.id)));
    setExporting(true);
  };

  const hasImageModels = runtime.connections.some(
    (connection) => connection.enabled
      && (runtime.modelsByConnection[connection.id]?.models ?? []).some((candidate) => candidate.type === 'image'),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-serif font-bold text-accent-gold flex items-center gap-2">
            <Sparkles size={18} />
            {t('engines.image-studio.name')}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">{t('visualRef.intro')}</p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/settings/ai')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-accent-gold/30 transition"
        >
          <Settings2 size={12} />
          {t('imageStudio.settings')}
        </button>
      </div>

      {!hasImageModels && runtime.connectionsLoaded && (
        <div className="rounded-lg border border-accent-gold/30 bg-accent-gold/5 px-4 py-3 text-xs text-text-muted space-y-1">
          <p className="text-text-primary">{t('imageStudio.noModels.title')}</p>
          {/* Not an error. The cast, the portraits and the fragments below are
              the point of this tab even when nothing can generate. */}
          <p>{t('visualRef.noModels.stillUseful')}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,15rem)] gap-4">
        <aside className="lg:border-r lg:border-border/60 lg:pr-4">
          <CastColumn
            refs={refs}
            thumbnails={thumbnails}
            selectedId={selectedRefId}
            onSelect={(id) => { setSelectedRefId(id); setPane('reference'); }}
            onInsert={(ref) => {
              setSelectedRefId(ref.id);
              setSubjects((current) => (current ? `${current} ${mentionToken(ref)}` : mentionToken(ref)));
              setPane('composer');
            }}
            onCreate={(name) => {
              void createVisualRef(projectId, name).then(async (created) => {
                await reloadRefs();
                setSelectedRefId(created.id);
                setPane('reference');
              });
            }}
            onDelete={setPendingRefDelete}
          />
        </aside>

        <section className="min-w-0 space-y-3">
          <div className="flex items-center gap-1.5">
            {(['composer', 'reference'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setPane(tab)}
                disabled={tab === 'reference' && !selectedRef}
                title={tab === 'reference' && !selectedRef ? t('visualRef.reason.noRefSelected') : t(`visualRef.pane.${tab}`)}
                className={`px-2.5 py-1 rounded-lg text-[11px] border transition disabled:opacity-40 disabled:cursor-not-allowed ${
                  pane === tab
                    ? 'border-accent-gold/50 bg-accent-gold/15 text-accent-gold'
                    : 'border-border text-text-dim hover:text-text-primary'
                }`}
              >
                {t(`visualRef.pane.${tab}`)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPlotting(true)}
              title={t('imageStudio.xyz.title')}
              className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] border border-border text-text-dim hover:text-accent-gold transition"
            >
              <Grid3x3 size={11} />
              {t('imageStudio.xyz.title')}
            </button>
            <button
              type="button"
              onClick={() => setComparing(true)}
              disabled={!compareAction.enabled}
              title={compareAction.enabled ? t('visualRef.action.compare') : t(compareAction.reasonKey ?? '')}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] border border-border text-text-dim hover:text-accent-gold transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <GitCompare size={11} />
              {t('visualRef.action.compare')} ({compareIds.length})
            </button>
          </div>

          {pane === 'reference' && selectedRef ? (
            <ReferenceEditor
              projectId={projectId}
              visual={selectedRef}
              entries={entries}
              onChange={(changes) => updateVisualRef(selectedRef.id, changes).then(reloadRefs)}
              onReload={() => { void reloadRefs(); }}
              onExportDataset={() => { void openExport(); }}
            />
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-surface p-3 space-y-2.5">
                <label className="block">
                  <span className="block text-[10px] text-text-muted mb-1">{t('visualRef.composer.subjects')}</span>
                  <textarea
                    value={subjects}
                    onChange={(event) => setSubjects(event.target.value)}
                    onKeyDown={(event) => onWeightKeyDown(event, setSubjects)}
                    onDrop={(event) => {
                      const name = event.dataTransfer.getData('text/plain');
                      if (!name) return;
                      event.preventDefault();
                      setSubjects((current) => (current ? `${current} ${mentionToken({ name })}` : mentionToken({ name })));
                    }}
                    rows={2}
                    placeholder={t('visualRef.composer.subjectsPlaceholder')}
                    className="w-full resize-y px-2 py-1.5 bg-elevated border border-border rounded-lg text-[12px] text-text-primary outline-none focus:border-accent-gold"
                  />
                </label>
                {mentions.unknown.length > 0 && (
                  <p className="text-[10px] text-accent-amber">
                    {t('visualRef.composer.unknownMention').replace('{names}', mentions.unknown.join(', '))}
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-[10px] text-text-muted mb-1">{t('visualRef.composer.scene')}</span>
                    <input
                      value={scene}
                      onChange={(event) => setScene(event.target.value)}
                      onKeyDown={(event) => onWeightKeyDown(event, setScene)}
                      placeholder={t('visualRef.composer.scenePlaceholder')}
                      className="w-full px-2 py-1.5 bg-elevated border border-border rounded-lg text-[12px] text-text-primary outline-none focus:border-accent-gold"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] text-text-muted mb-1">{t('visualRef.composer.style')}</span>
                    <input
                      value={style}
                      onChange={(event) => setStyle(event.target.value)}
                      onKeyDown={(event) => onWeightKeyDown(event, setStyle)}
                      placeholder={t('visualRef.composer.stylePlaceholder')}
                      className="w-full px-2 py-1.5 bg-elevated border border-border rounded-lg text-[12px] text-text-primary outline-none focus:border-accent-gold"
                    />
                  </label>
                </div>
                <ResolvedPrompt resolved={resolved} />
                <PromptCraftBar
                  prompt={preview?.options.prompt ?? resolved.prompt}
                  wildcards={preview?.wildcards}
                  unresolvedWildcards={preview?.unresolvedWildcards}
                  seedKnown={resolved.seed !== undefined}
                />
                {/* A pass that is switched on and cannot run is said out loud
                    here, next to the button that would have run it. */}
                {preview?.refusedPasses.map((refusal) => (
                  <p key={refusal.id} className="text-[10px] text-accent-amber">
                    {t(`imageStudio.pass.${refusal.kind}`)}: {t(refusal.reasonKey)}
                  </p>
                ))}
                <div className="flex items-center gap-2">
                  {busy && (
                    <button
                      type="button"
                      onClick={() => handle?.cancel()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-text-muted hover:text-danger hover:border-danger/40 transition"
                    >
                      <Square size={12} />
                      {t('common.cancel')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void runGeneration()}
                    disabled={!generateAction.enabled}
                    title={generateAction.enabled ? t('imageStudio.generate') : t(generateAction.reasonKey ?? '')}
                    aria-label={generateAction.enabled ? t('imageStudio.generate') : t(generateAction.reasonKey ?? '')}
                    className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-gold text-deep text-sm font-semibold hover:bg-accent-amber transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                    {t('imageStudio.generate')}
                  </button>
                </div>
                {!generateAction.enabled && (
                  <p className="text-[10px] text-accent-amber">{t(generateAction.reasonKey ?? '')}</p>
                )}
                {error && (
                  <div className="flex items-start gap-2 px-3 py-2 bg-danger/10 text-danger text-xs rounded-lg">
                    <XCircle size={14} className="mt-0.5 flex-shrink-0" />
                    <span className="break-words">{error}</span>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-[11px] text-text-primary font-medium mb-1.5">{t('visualRef.results.title')}</h3>
                <ResultsGrid
                  batches={batches}
                  compareIds={compareIds}
                  onToggleCompare={(id) => setCompareIds((current) => (
                    current.includes(id) ? current.filter((other) => other !== id) : [...current, id].slice(-4)
                  ))}
                  onIterate={iterate}
                  onVariations={variations}
                  onUseSeed={(image) => {
                    const seed = image.generation?.seed;
                    if (seed === undefined) return;
                    setParameters((current) => ({ ...current, seedMode: 'manual', manualSeed: String(seed) }));
                  }}
                  onPinSeed={(image) => {
                    const seed = image.generation?.seed;
                    if (!selectedRef || seed === undefined) return;
                    void pinHeroSeed(selectedRef.id, seed).then(reloadRefs);
                    toast.success(t('visualRef.action.pinnedSeed').replace('{seed}', String(seed)));
                  }}
                  onCanonical={(image) => {
                    if (!selectedRef) return;
                    void setCanonicalImage(selectedRef.id, image.id).then(reloadRefs);
                    toast.success(t('visualRef.action.canonicalSet').replace('{name}', selectedRef.name));
                  }}
                  onAddToSet={(image) => {
                    if (!selectedRef) return;
                    void addToReferenceSet(selectedRef.id, image.id).then(reloadRefs);
                    toast.success(t('visualRef.action.addedToSet').replace('{name}', selectedRef.name));
                  }}
                  onKeep={(image) => {
                    const tags = image.tags.includes('keep')
                      ? image.tags.filter((tag) => tag !== 'keep')
                      : [...image.tags, 'keep'];
                    void db.inspirationImages.update(image.id, { tags }).then(reloadImages);
                  }}
                  onDiscard={setPendingDiscard}
                  refActions={refActions}
                  generateAction={generateAction}
                  seedAction={seedAction}
                />
              </div>
            </div>
          )}
        </section>

        <aside className="lg:border-l lg:border-border/60 lg:pl-4">
          <ParametersColumn
            route={effectiveRoute}
            onRoute={(next) => {
              setRoute(next ?? undefined);
              void saveProjectSettings(projectId, { imageRoute: next ?? undefined });
              if (next && next.modelId !== effectiveRoute?.modelId) applyDefaults(next);
            }}
            level={level}
            onLevel={(next) => { setLevel(next); persist({ level: next }); }}
            capabilities={capabilities}
            value={parameters}
            onChange={(changes) => {
              setParameters((current) => ({ ...current, ...changes }));
              if (changes.batchSeedMode) persist({ batchSeedMode: changes.batchSeedMode });
            }}
            family={family}
            nativeSize={nativeSize}
            size={size}
            appliedDefaults={appliedDefaults}
            onUndoDefaults={undoDefaults}
            onReapplyDefaults={() => { if (effectiveRoute) applyDefaults(effectiveRoute); }}
            showAllSamplers={showAllSamplers}
            onShowAllSamplers={(next) => { setShowAllSamplers(next); persist({ showAllSamplers: next }); }}
            hasHeroSeed={heroRef !== null}
            passes={passes}
            onPasses={(next) => { setPasses(next); persist({ passChain: next }); }}
            passSupport={passSupport}
            upscalers={upscalers}
            loraStack={loraStack}
            loraManual={loraManual}
            onLoraManual={setLoraManual}
            availableLoras={sdStatus?.loras ?? []}
            lorasDir={sdStatus?.lorasDir}
            resolvedPrompt={preview?.options.prompt ?? resolved.prompt}
          />
        </aside>
      </div>

      <CompareDialog open={comparing} images={compareImages} onClose={() => setComparing(false)} />

      <XyzPlotDialog
        open={plotting}
        onClose={() => setPlotting(false)}
        capabilities={capabilities}
        canGenerate={generateAction.enabled}
        generateReasonKey={generateAction.reasonKey}
        onRun={(cells) => { void runPlot(cells); }}
      />

      {selectedRef && (
        <DatasetExportDialog
          open={exporting}
          visual={selectedRef}
          entry={entries.find((row) => row.id === selectedRef.codexEntryId)}
          images={exportImages}
          onClose={() => setExporting(false)}
        />
      )}

      <ConfirmDialog
        open={pendingDiscard !== null}
        destructive
        message={t('gallery.deleteImageConfirm')}
        onConfirm={() => {
          const image = pendingDiscard;
          setPendingDiscard(null);
          if (image) void deleteGeneratedImage(image.id).then(reloadImages);
        }}
        onCancel={() => setPendingDiscard(null)}
      />

      <ConfirmDialog
        open={pendingRefDelete !== null}
        destructive
        message={t('visualRef.cast.deleteConfirm')}
        onConfirm={() => {
          const ref = pendingRefDelete;
          setPendingRefDelete(null);
          if (!ref) return;
          void deleteVisualRef(ref.id).then(() => {
            if (selectedRefId === ref.id) setSelectedRefId(null);
            void reloadRefs();
          });
        }}
        onCancel={() => setPendingRefDelete(null)}
      />
    </div>
  );
}
