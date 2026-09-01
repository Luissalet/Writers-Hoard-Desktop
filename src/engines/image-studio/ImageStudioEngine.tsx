// ============================================================================
// Image studio — the engine tab
// ============================================================================
//
// Prompt, model, size, variants → generate through the gateway → every result
// lands in Gallery with its provenance and shows up here as a strip of recent
// generations. Options a server cannot honour are not faked: the studio only
// sends what was set, and a strict server simply ignores nothing.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Dices, ImagePlus, Layers, Loader2, RefreshCw, Settings2, Sparkles, Square, Trash2, XCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConfirmDialog } from '@/engines/_shared';
import type { EngineComponentProps } from '@/engines/_types';
import type { InspirationImage } from '@/types';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import { useImageRuntimeStore } from '@/stores/imageRuntimeStore';
import { useImageHandoffStore } from '@/stores/imageHandoffStore';
import { BUILTIN_SD_ID } from '@/services/aiRuntime/constants';
import ModelRoutePicker from '@/components/ai-settings/ModelRoutePicker';
import VramWarning from '@/components/ai-settings/VramWarning';
import GalleryLightbox from '@/components/gallery/GalleryLightbox';
import { toast } from '@/components/common/toast';
import { detectVramContention } from '@/services/aiRuntime/sdServer';
import { imageCatalogEntry } from '@/services/aiRuntime/imageCatalog';
import type { AiRouteSelection } from '@/services/aiRuntime/types';
import type { ImageHandle } from '@/services/aiRuntime/client';
import { getProjectSettings, saveProjectSettings } from '@/services/copilot/threads';
import {
  IMAGE_SIZE_PRESETS,
  deleteGeneratedImage,
  listGeneratedImages,
  makeThumbnail,
  saveGenerated,
  startGeneration,
} from './operations';

const QUALITIES = ['auto', 'low', 'medium', 'high'] as const;

export default function ImageStudioEngine({ projectId }: EngineComponentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const runtime = useAiRuntimeStore();
  const [route, setRoute] = useState<AiRouteSelection | undefined>(undefined);
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  // 'native' follows the model's training resolution when it reports one.
  const [preset, setPreset] = useState('native');
  const [quality, setQuality] = useState<(typeof QUALITIES)[number]>('auto');
  const [count, setCount] = useState(1);
  const [seed, setSeed] = useState<string>('');
  const [steps, setSteps] = useState<string>('');
  const [handle, setHandle] = useState<ImageHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<InspirationImage[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  // A prompt handed over from another engine, queued to generate once a route is
  // resolved (defaults load async, so the route may not be ready on first paint).
  const [autoGenPrompt, setAutoGenPrompt] = useState<string | null>(null);
  // img2img: a reference image (data URL) and its denoise strength.
  const [initImage, setInitImage] = useState<string | null>(null);
  const [strength, setStrength] = useState(0.6);
  // LoRA: one of the files present in the runtime's folder, with its weight.
  const [loraName, setLoraName] = useState('');
  const [loraWeight, setLoraWeight] = useState(0.8);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    void listGeneratedImages(projectId).then(setImages);
  }, [projectId]);

  useEffect(() => {
    reload();
    void runtime.loadConnections();
    void runtime.loadDefaults();
    void getProjectSettings(projectId).then((settings) => {
      if (settings.imageRoute) setRoute(settings.imageRoute);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const effectiveRoute = route ?? runtime.defaults.image;
  const connection = runtime.connections.find((c) => c.id === effectiveRoute?.connectionId);
  const routeModel = effectiveRoute ? runtime.modelsByConnection[effectiveRoute.connectionId]?.models.find((m) => m.id === effectiveRoute.modelId) : undefined;
  const nativeSize = routeModel?.nativeWidth && routeModel.nativeHeight ? { width: routeModel.nativeWidth, height: routeModel.nativeHeight } : null;
  // img2img is offered for local Stable Diffusion models; FLUX does not do
  // classic denoise-strength img2img, so the reference slot stays hidden for it.
  const supportsImg2img = routeModel?.family === 'sd1' || routeModel?.family === 'sdxl';
  const presetValue = preset === 'native' && !nativeSize ? 'square' : preset;
  const size = presetValue === 'native' && nativeSize ? nativeSize : IMAGE_SIZE_PRESETS.find((p) => p.id === presetValue) ?? IMAGE_SIZE_PRESETS[0];
  const busy = handle !== null;
  // The managed image server loads the weights on the first request: say so
  // instead of showing a bare spinner for half a minute.
  const sdStatus = useImageRuntimeStore((s) => s.status);
  const refreshSdRuntime = useImageRuntimeStore((s) => s.refresh);
  const localServerState = sdStatus?.state;
  const isLocalRoute = effectiveRoute?.connectionId === BUILTIN_SD_ID;
  const loadingLocalModel = busy && isLocalRoute && localServerState === 'starting';
  // LoRAs and the VRAM warning only mean anything for the managed local server:
  // a remote image API neither loads LoRA files from this disk nor competes for
  // this graphics card.
  const loras = useMemo(
    () => (isLocalRoute && sdStatus?.lorasSupported !== false ? sdStatus?.loras ?? [] : []),
    [isLocalRoute, sdStatus?.loras, sdStatus?.lorasSupported],
  );
  const activeLora = loraName ? loras.find((lora) => lora.name === loraName) : undefined;
  const contention = useMemo(
    () => (isLocalRoute && effectiveRoute ? detectVramContention(sdStatus?.vram, imageCatalogEntry(effectiveRoute.modelId)) : null),
    [isLocalRoute, effectiveRoute, sdStatus?.vram],
  );

  // Ask main who is holding the card whenever the local runtime becomes the
  // route: the answer is what the warning is drawn from, and it is measured
  // there (nvidia-smi + Ollama's /api/ps), never here. Re-asked on a slow beat
  // because the card can change hands with this tab open — a copilot answer in
  // the dock leaves its model resident — and a warning nobody refreshes is a
  // warning nobody can trust. Main memoises the measurement, so this is one
  // reading, not a poll of the driver.
  useEffect(() => {
    if (!isLocalRoute) return undefined;
    void refreshSdRuntime();
    const timer = setInterval(() => void refreshSdRuntime(), 20_000);
    return () => clearInterval(timer);
  }, [isLocalRoute, refreshSdRuntime]);
  const hasImageModels = useMemo(
    () => runtime.connections.some((c) => c.enabled && (runtime.modelsByConnection[c.id]?.models ?? []).some((m) => m.type === 'image')),
    [runtime.connections, runtime.modelsByConnection],
  );

  const chooseRoute = (next: AiRouteSelection | null) => {
    setRoute(next ?? undefined);
    void saveProjectSettings(projectId, { imageRoute: next ?? undefined });
  };

  const handleReferenceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be picked again after a remove
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('imageStudio.reference.notImage'));
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error(t('imageStudio.reference.tooLarge'));
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    }).catch(() => null);
    if (!dataUrl) {
      toast.error(t('imageStudio.reference.notImage'));
      return;
    }
    // Bound the payload, and require a decodable raster: a successful thumbnail
    // proves the image decoded (an SVG or corrupt file yields undefined). The
    // server resizes to the target anyway.
    const bounded = await makeThumbnail(dataUrl, 1024);
    if (!bounded) {
      toast.error(t('imageStudio.reference.notImage'));
      return;
    }
    setInitImage(bounded);
  };

  const generate = async (override?: { prompt?: string; negative?: string; seed?: number; width?: number; height?: number }) => {
    const text = (override?.prompt ?? prompt).trim();
    if (!text || !effectiveRoute || busy) return;
    setError(null);
    const options = {
      projectId,
      route: effectiveRoute,
      prompt: text,
      negativePrompt: (override?.negative ?? negative).trim() || undefined,
      width: override?.width ?? size.width,
      height: override?.height ?? size.height,
      n: count,
      seed: override?.seed ?? (seed.trim() ? Number(seed) : undefined),
      steps: steps.trim() ? Number(steps) : undefined,
      quality: quality === 'auto' ? undefined : quality,
      initImage: supportsImg2img && initImage ? initImage : undefined,
      strength: supportsImg2img && initImage ? strength : undefined,
      loras: activeLora ? [{ name: activeLora.name, weight: loraWeight }] : undefined,
    };
    const started = startGeneration(options);
    setHandle(started);
    try {
      const result = await started.result;
      const saved = await saveGenerated(options, result);
      if (!saved.ok) {
        if (saved.code !== 'cancelled') setError(saved.error ?? t('imageStudio.error.generic'));
      } else {
        toast.success(t('imageStudio.saved').replace('{count}', String(saved.images.length)));
        reload();
      }
    } catch (err) {
      // A rejected write (quota, most often) used to vanish: the spinner just
      // stopped, `error` stayed null, and the author paid for the generation
      // again to see the same nothing.
      setError(
        t('imageStudio.error.saveFailed').replace(
          '{error}',
          err instanceof Error ? err.message : String(err),
        ),
      );
    } finally {
      setHandle(null);
      // The generation just changed who is on the card (the image server took
      // it, and main may have asked a chat model to step off): re-read it so the
      // warning reflects the machine and not the last minute.
      if (isLocalRoute) void refreshSdRuntime();
    }
  };

  // Drain a prompt handed over from another engine (e.g. a text selection in
  // Escritos): pre-fill it, and queue a generation if it asked for one.
  // Subscribing (not a mount-only effect) so a second hand-off that arrives
  // while the studio is already open is picked up too, not stranded in the store.
  const pendingHandoff = useImageHandoffStore((s) => s.pending);
  useEffect(() => {
    if (!pendingHandoff) return;
    const handoff = useImageHandoffStore.getState().take();
    if (!handoff) return;
    if (handoff.prompt) setPrompt(handoff.prompt);
    if (handoff.initImage) setInitImage(handoff.initImage);
    if (handoff.autoGenerate && handoff.prompt) setAutoGenPrompt(handoff.prompt);
  }, [pendingHandoff]);

  // Fire the queued generation once a route is resolved and nothing is running.
  useEffect(() => {
    if (autoGenPrompt === null || !effectiveRoute || busy) return;
    const queued = autoGenPrompt;
    setAutoGenPrompt(null);
    void generate({ prompt: queued });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenPrompt, effectiveRoute, busy]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-serif font-bold text-accent-gold flex items-center gap-2">
            <Sparkles size={18} />
            {t('engines.image-studio.name')}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">{t('imageStudio.intro')}</p>
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
        <div className="rounded-lg border border-accent-gold/30 bg-accent-gold/5 px-4 py-3 text-xs text-text-muted space-y-2">
          <p className="text-text-primary">{t('imageStudio.noModels.title')}</p>
          <p>{t('imageStudio.noModels.body')}</p>
          <button
            type="button"
            onClick={() => navigate('/settings/ai')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent-gold/15 text-accent-gold hover:bg-accent-gold/25 transition"
          >
            <Settings2 size={12} />
            {t('imageStudio.noModels.cta')}
          </button>
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
        <div>
          <label className="block text-[11px] text-text-muted mb-1">{t('imageStudio.model')}</label>
          <ModelRoutePicker type="image" value={effectiveRoute} onChange={chooseRoute} allowNone={false} />
          {connection && (
            <p className="text-[10px] text-text-dim mt-1">
              {connection.name} · {t(`settings.ai.locality.${connection.locality}`)}
            </p>
          )}
        </div>
        <div>
          <label className="block text-[11px] text-text-muted mb-1">{t('imageStudio.prompt')}</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder={t('imageStudio.promptPlaceholder')}
            className="w-full resize-y rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-gold transition"
          />
        </div>
        {supportsImg2img && (
          <div className="rounded-lg border border-border/60 bg-elevated/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-muted flex items-center gap-1.5">
                <ImagePlus size={12} />
                {t('imageStudio.reference.label')}
              </span>
              {initImage && (
                <button
                  type="button"
                  onClick={() => setInitImage(null)}
                  className="flex items-center gap-1 text-[10px] text-text-dim hover:text-danger transition"
                >
                  <XCircle size={11} />
                  {t('imageStudio.reference.remove')}
                </button>
              )}
            </div>
            {initImage ? (
              <div className="flex items-center gap-3">
                <img src={initImage} alt="" className="w-16 h-16 rounded border border-border object-cover flex-shrink-0" />
                <label className="flex-1 min-w-0 text-[11px] text-text-muted">
                  <span className="flex items-center justify-between">
                    <span>{t('imageStudio.reference.strength')}</span>
                    <span className="font-mono tabular-nums text-text-dim">{strength.toFixed(2)}</span>
                  </span>
                  <input
                    type="range"
                    min={0.1}
                    max={0.95}
                    step={0.05}
                    value={strength}
                    onChange={(e) => setStrength(Number(e.target.value))}
                    className="w-full accent-accent-gold"
                  />
                  <span className="block text-[10px] text-text-dim">{t('imageStudio.reference.strengthHint')}</span>
                </label>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-lg border border-dashed border-border px-3 py-3 text-[11px] text-text-dim hover:text-text-primary hover:border-accent-gold/40 transition"
              >
                {t('imageStudio.reference.drop')}
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleReferenceFile} />
          </div>
        )}
        {isLocalRoute && loras.length > 0 && (
          <div className="rounded-lg border border-border/60 bg-elevated/40 p-3 space-y-2">
            <span className="text-[11px] text-text-muted flex items-center gap-1.5">
              <Layers size={12} />
              {t('imageStudio.lora.label')}
            </span>
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={loraName}
                onChange={(e) => setLoraName(e.target.value)}
                className="px-2 py-1.5 bg-elevated border border-border rounded-lg text-xs text-text-primary outline-none focus:border-accent-gold"
              >
                <option value="">{t('imageStudio.lora.none')}</option>
                {loras.map((lora) => (
                  <option key={lora.name} value={lora.name}>
                    {lora.name}
                  </option>
                ))}
              </select>
              {activeLora && (
                <label className="flex-1 min-w-[10rem] text-[11px] text-text-muted">
                  <span className="flex items-center justify-between">
                    <span>{t('imageStudio.lora.weight')}</span>
                    <span className="font-mono tabular-nums text-text-dim">{loraWeight.toFixed(2)}</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={loraWeight}
                    onChange={(e) => setLoraWeight(Number(e.target.value))}
                    className="w-full accent-accent-gold"
                  />
                </label>
              )}
            </div>
            <p className="text-[10px] text-text-dim">{t('imageStudio.lora.hint')}</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] text-text-muted">
            {t('imageStudio.size')}
            <select value={presetValue} onChange={(e) => setPreset(e.target.value)} className="px-2 py-1.5 bg-elevated border border-border rounded-lg text-xs text-text-primary outline-none focus:border-accent-gold">
              {nativeSize && (
                <option value="native">
                  {t('imageStudio.size.native')} · {nativeSize.width}×{nativeSize.height}
                </option>
              )}
              {IMAGE_SIZE_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(`imageStudio.size.${p.labelKey}`)} · {p.width}×{p.height}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-text-muted">
            {t('imageStudio.quality')}
            <select value={quality} onChange={(e) => setQuality(e.target.value as (typeof QUALITIES)[number])} className="px-2 py-1.5 bg-elevated border border-border rounded-lg text-xs text-text-primary outline-none focus:border-accent-gold">
              {QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {t(`imageStudio.quality.${q}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[11px] text-text-muted">
            {t('imageStudio.variants')}
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="px-2 py-1.5 bg-elevated border border-border rounded-lg text-xs text-text-primary outline-none focus:border-accent-gold">
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="text-[11px] text-text-dim hover:text-text-primary transition ml-auto">
            {showAdvanced ? t('imageStudio.advanced.hide') : t('imageStudio.advanced.show')}
          </button>
        </div>
        {showAdvanced && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block sm:col-span-1">
              <span className="block text-[11px] text-text-muted mb-1">{t('imageStudio.negative')}</span>
              <input value={negative} onChange={(e) => setNegative(e.target.value)} placeholder={t('imageStudio.negativePlaceholder')} className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition" />
            </label>
            <label className="block">
              <span className="block text-[11px] text-text-muted mb-1 flex items-center gap-1">
                {t('imageStudio.seed')}
                <button type="button" onClick={() => setSeed(String(Math.floor(Math.random() * 2_147_483_647)))} title={t('imageStudio.randomSeed')} className="text-text-dim hover:text-accent-gold">
                  <Dices size={11} />
                </button>
              </span>
              <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^\d]/g, ''))} placeholder={t('imageStudio.seedPlaceholder')} className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition font-mono" />
            </label>
            <label className="block">
              <span className="block text-[11px] text-text-muted mb-1">{t('imageStudio.steps')}</span>
              <input value={steps} onChange={(e) => setSteps(e.target.value.replace(/[^\d]/g, ''))} placeholder={t('imageStudio.stepsPlaceholder')} className="w-full px-3 py-2 bg-elevated border border-border rounded-lg text-sm text-text-primary outline-none focus:border-accent-gold transition font-mono" />
            </label>
            <p className="sm:col-span-3 text-[10px] text-text-dim">{t('imageStudio.advanced.note')}</p>
            {isLocalRoute && loras.length === 0 && (
              <p className="sm:col-span-3 text-[10px] text-text-dim">{t('imageStudio.lora.empty')}</p>
            )}
          </div>
        )}
        {contention && !busy && (
          <VramWarning
            contention={contention}
            onProceed={() => void generate()}
            proceedDisabled={!prompt.trim() || !effectiveRoute}
          />
        )}
        <div className="flex items-center gap-2">
          {busy ? (
            <>
              <span className="flex items-center gap-2 text-xs text-text-muted">
                <Loader2 size={14} className="animate-spin text-accent-gold" />
                {loadingLocalModel ? t('imageStudio.loadingLocalModel') : t('imageStudio.generating')}
              </span>
              <button type="button" onClick={() => handle?.cancel()} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-text-muted hover:text-danger hover:border-danger/40 transition">
                <Square size={12} />
                {t('common.cancel')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void generate()}
              disabled={!prompt.trim() || !effectiveRoute}
              className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-gold text-deep text-sm font-semibold hover:bg-accent-amber transition disabled:opacity-40"
            >
              <ImagePlus size={14} />
              {t('imageStudio.generate')}
            </button>
          )}
        </div>
        {error && (
          <div className="flex items-start gap-2 px-3 py-2 bg-danger/10 text-danger text-xs rounded-lg">
            <XCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm text-text-primary font-medium">{t('imageStudio.recent')}</h3>
          <button type="button" onClick={reload} className="p-1 text-text-dim hover:text-accent-gold transition" title={t('common.refresh')}>
            <RefreshCw size={12} />
          </button>
        </div>
        {images.length === 0 ? (
          <p className="text-xs text-text-dim">{t('imageStudio.recentEmpty')}</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {images.map((image, index) => (
              <div key={image.id} className="group relative rounded-lg overflow-hidden border border-border bg-elevated">
                <button type="button" onClick={() => setLightbox(index)} className="block w-full">
                  <img src={image.thumbnailData ?? image.imageData} alt="" className="w-full aspect-square object-cover" />
                </button>
                <div className="p-2 space-y-1">
                  <p className="text-[10px] text-text-muted line-clamp-2" title={image.generation?.prompt}>
                    {image.generation?.prompt ?? image.notes}
                  </p>
                  <p className="text-[9px] text-text-dim font-mono truncate">
                    {image.generation?.modelId} · {image.generation?.width}×{image.generation?.height}
                    {image.generation?.seed !== undefined ? ` · #${image.generation.seed}` : ''}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setPrompt(image.generation?.prompt ?? image.notes);
                        setNegative(image.generation?.negativePrompt ?? '');
                        if (image.generation?.seed !== undefined) setSeed(String(image.generation.seed));
                      }}
                      title={t('imageStudio.reuse')}
                      className="p-1 rounded text-text-dim hover:text-accent-gold transition"
                    >
                      <Copy size={11} />
                    </button>
                    <button
                      type="button"
                      disabled={busy || !effectiveRoute}
                      onClick={() =>
                        void generate({
                          prompt: image.generation?.prompt ?? image.notes,
                          negative: image.generation?.negativePrompt ?? '',
                          width: image.generation?.width,
                          height: image.generation?.height,
                        })
                      }
                      title={t('imageStudio.regenerate')}
                      className="p-1 rounded text-text-dim hover:text-accent-gold transition disabled:opacity-40"
                    >
                      <RefreshCw size={11} />
                    </button>
                    {supportsImg2img && (
                      <button
                        type="button"
                        onClick={() => {
                          setInitImage(image.imageDataOriginal ?? image.imageData);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        title={t('imageStudio.useAsReference')}
                        className="p-1 rounded text-text-dim hover:text-accent-gold transition"
                      >
                        <ImagePlus size={11} />
                      </button>
                    )}
                    <button type="button" onClick={() => setPendingDelete(image.id)} title={t('common.delete')} className="ml-auto p-1 rounded text-text-dim hover:text-danger transition">
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {lightbox !== null && images[lightbox] && (
        <GalleryLightbox
          image={images[lightbox]}
          linkedEntries={[]}
          onClose={() => setLightbox(null)}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        destructive
        message={t('gallery.deleteImageConfirm')}
        onConfirm={() => {
          const id = pendingDelete;
          setPendingDelete(null);
          if (id) void deleteGeneratedImage(id).then(reload);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
