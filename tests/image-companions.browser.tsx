// ============================================================================
// Image companions — ControlNets and upscalers installed from the UI
// ============================================================================
//
// Mounts the real AI-settings image section and the studio's fix-it box
// against a scripted `window.electronAPI.sd`, and drives them by clicking:
// the claims are "the button asks main for THIS id", "main's progress events
// reach the row", "cancel reaches main", "delete asks first", and "once the
// file lands the studio's ControlNet refusal lifts on its own".
//
// The store wires its push subscriptions when its module first evaluates, so
// everything that pulls it in is imported AFTER the mock is in place.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SdCompanionFile, SdOpResult, SdProgress, SdRuntimeStatus } from '@/services/aiRuntime/sdServer';
import type { AiDefaults, AiImageRequest, AiImageResult, HardwareProfile } from '@/services/aiRuntime/types';
import { imageCompanionAsset } from '@/services/aiRuntime/imageCatalog';
import { formatBytes } from '@/services/aiRuntime/fit';
import { useLocaleStore } from '@/stores/localeStore';
import { t } from '@/i18n/useTranslation';

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}

const POSE = 'controlnet-sd15-openpose';

interface Deferred { resolve: (result: SdOpResult) => void }

function makeSdMock() {
  const calls = { download: [] as string[], cancel: [] as string[], remove: [] as string[] };
  let statusListener: ((status: SdRuntimeStatus) => void) | null = null;
  let progressListener: ((progress: SdProgress) => void) | null = null;
  let pending: Deferred | null = null;
  const status: SdRuntimeStatus = {
    supported: true,
    backends: ['vulkan'],
    installedBackend: 'vulkan',
    state: 'ready',
    loadedModelId: null,
    url: null,
    models: [],
    downloading: null,
    version: 'test',
    loras: [],
    lorasDir: '/ai/loras',
    companions: [],
    controlNetsDir: '/ai/controlnets',
    upscalersDir: '/ai/upscalers',
    loadedControlNet: null,
    downloadingCompanion: null,
  };
  const push = () => statusListener?.(structuredClone(status));
  const sd = {
    status: async () => structuredClone(status),
    onStatus: (listener: (s: SdRuntimeStatus) => void) => { statusListener = listener; return () => undefined; },
    onProgress: (listener: (p: SdProgress) => void) => { progressListener = listener; return () => undefined; },
    downloadCompanion: (id: string) => {
      calls.download.push(id);
      status.downloadingCompanion = id;
      push();
      return new Promise<SdOpResult>((resolve) => { pending = { resolve }; });
    },
    cancelCompanionDownload: async (id: string) => { calls.cancel.push(id); },
    deleteCompanion: async (id: string) => {
      calls.remove.push(id);
      status.companions = (status.companions ?? []).filter((file) => file.catalogId !== id);
      push();
      return { ok: true };
    },
  };
  const hardware: HardwareProfile = {
    platform: 'linux', cpuModel: 'test', cpuCores: 8, ramTotalBytes: 32e9, ramFreeBytes: 16e9,
    gpus: [], source: 'os-only', gpuConfidence: 'none', detectedAt: 1,
  };
  const aiState = {
    defaults: {} as AiDefaults,
    /** What the studio handed main, as main would receive it. */
    images: [] as { requestId: string; request: AiImageRequest }[],
    imageDone: null as ((payload: { requestId: string; result: AiImageResult }) => void) | null,
  };
  const ai = {
    hardware: async () => hardware,
    listModels: async () => ({ ok: true, models: [] }),
    listConnections: async () => [],
    getDefaults: async () => structuredClone(aiState.defaults),
    generateImage: async (requestId: string, request: AiImageRequest) => {
      aiState.images.push({ requestId, request });
      return { ok: true };
    },
    cancel: async () => undefined,
    // Wired by the AI client at import; nothing streams in this test.
    onStream: () => () => undefined,
    onImageDone: (listener: (payload: { requestId: string; result: AiImageResult }) => void) => {
      aiState.imageDone = listener;
      return () => undefined;
    },
  };
  return {
    api: { sd, ai },
    calls,
    status,
    ai: aiState,
    push,
    progress: (p: SdProgress) => progressListener?.(p),
    /** Main finishing the download: optionally put the file on disk first. */
    finish: (result: SdOpResult, installed?: SdCompanionFile, pushStatus = true) => {
      if (installed) status.companions = [...(status.companions ?? []), installed];
      status.downloadingCompanion = null;
      const done = pending;
      pending = null;
      done?.resolve(result);
      if (pushStatus) push();
    },
  };
}

const settle = () => act(async () => { await new Promise((done) => setTimeout(done, 20)); });

async function click(button: Element | null | undefined, label: string): Promise<void> {
  check(button instanceof HTMLButtonElement, `Missing button: ${label}`);
  check(!button.disabled, `Button disabled: ${label}`);
  await act(async () => { button.click(); });
  await settle();
}

function buttonByText(scope: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
}

export async function testImageCompanionsUi(): Promise<string[]> {
  const mock = makeSdMock();
  window.electronAPI = mock.api as unknown as NonNullable<Window['electronAPI']>;
  useLocaleStore.setState({ locale: 'en', loaded: true });

  const [{ default: LocalImageModelsSection }, { default: ControlNetFix }, { useImageRuntimeStore }, { chooseControlNet }, { useTranslation }] = await Promise.all([
    import('@/components/ai-settings/LocalImageModelsSection'),
    import('@/engines/image-studio/components/ControlNetFix'),
    import('@/stores/imageRuntimeStore'),
    import('@/engines/image-studio/studio/controlNet'),
    import('@/i18n/useTranslation'),
  ]);
  useImageRuntimeStore.setState({ available: true, status: null, progress: {}, errors: {} });

  const pose = imageCompanionAsset(POSE);
  check(pose, 'OpenPose is catalogued');
  const installedPose: SdCompanionFile = { kind: 'controlnet', catalogId: POSE, name: 'control_v11p_sd15_openpose', fileName: pose.fileName, sizeBytes: pose.sizeBytes };

  const host = document.getElementById('root') ?? document.body.appendChild(document.createElement('div'));
  let root: Root | null = createRoot(host);
  const results: string[] = [];
  try {
    // ---- 1. AI settings: the section lists every catalogued companion -------
    await act(async () => { root!.render(<LocalImageModelsSection />); });
    await settle();
    const row = () => host.querySelector(`[data-companion="${POSE}"]`);
    check(row(), 'the OpenPose row is in AI settings');
    check(host.textContent?.includes(t('settings.ai.imageCompanions.title')), 'the companions panel has its title');
    check(host.querySelector('[data-companion="realesrgan-x4"]'), 'the upscaler row is listed too');
    check(row()!.textContent?.includes(formatBytes(pose.sizeBytes)), 'the row shows the download size');
    check(!row()!.textContent?.includes(t('settings.ai.imageCompanions.installed')), 'not installed yet');

    // ---- 2. Download asks main for this id; main's progress reaches the row -
    await click(buttonByText(row()!, t('settings.ai.local.download')), 'Download');
    check(mock.calls.download.join() === POSE, `downloadCompanion called with ${mock.calls.download.join()}`);
    check(row()!.querySelector('[role="status"]'), 'the row switched to its progress state');
    await act(async () => {
      mock.progress({ kind: 'model', id: POSE, phase: 'downloading', receivedBytes: 500_000_000, totalBytes: pose.sizeBytes, fileIndex: 0, fileCount: 1 });
    });
    check(row()!.textContent?.includes(`${formatBytes(500_000_000)} / ${formatBytes(pose.sizeBytes)}`), 'progress bytes are shown');
    const otherDownload = buttonByText(host.querySelector('[data-companion="controlnet-sd15-canny"]')!, t('settings.ai.local.download'));
    check(otherDownload?.disabled, 'a second companion download is held while one runs');
    results.push('Companions: Download calls downloadCompanion with the catalogue id and shows main\'s progress');

    // ---- 3. Cancel reaches main and leaves no sticky error ------------------
    await click(buttonByText(row()!, t('settings.ai.local.cancel')), 'Cancel');
    check(mock.calls.cancel.join() === POSE, 'cancelCompanionDownload called with the id');
    await act(async () => { mock.finish({ ok: false, error: 'cancelled' }); });
    await settle();
    check(buttonByText(row()!, t('settings.ai.local.download')), 'Download is offered again after a cancel');
    check(!row()!.querySelector('[role="status"]'), 'the progress state is gone');
    check(!row()!.textContent?.includes('cancelled'), 'a cancel is not reported as an error');
    results.push('Companions: Cancel calls cancelCompanionDownload and the row resets cleanly');

    // ---- 4. A finished download shows as installed, with Delete -------------
    await click(buttonByText(row()!, t('settings.ai.local.download')), 'Download again');
    await act(async () => { mock.finish({ ok: true }, installedPose); });
    await settle();
    check(row()!.textContent?.includes(t('settings.ai.imageCompanions.installed')), 'the row reads installed');
    const del = row()!.querySelector(`button[aria-label="${t('settings.ai.local.delete')}"]`);
    check(del, 'installed companion offers Delete');

    // ---- 5. Delete confirms first, with the app's dialog --------------------
    await click(del, 'Delete');
    const dialog = () => document.querySelector('[role="dialog"]');
    check(dialog()?.textContent?.includes(pose.label), 'the confirm names the companion');
    check(mock.calls.remove.length === 0, 'nothing deleted before confirming');
    await click(buttonByText(dialog()!, t('common.cancel')), 'Cancel delete');
    check(!dialog() && mock.calls.remove.length === 0, 'cancelling the confirm deletes nothing');
    await click(row()!.querySelector(`button[aria-label="${t('settings.ai.local.delete')}"]`), 'Delete again');
    await click(buttonByText(dialog()!, t('common.delete')), 'Confirm delete');
    check(mock.calls.remove.join() === POSE, 'deleteCompanion called with the id after confirming');
    check(buttonByText(row()!, t('settings.ai.local.download')), 'the row is downloadable again after delete');
    results.push('Companions: installed state, and Delete goes through ConfirmDialog before deleteCompanion');

    // ---- 6. The studio's fix-it: install in place, the refusal lifts --------
    // Mirrors the engine: the refusal comes from `chooseControlNet` over the
    // store's runtime status, and the fix is shown only for noControlNet.
    function StudioProbe() {
      const { t: tr } = useTranslation();
      const status = useImageRuntimeStore((s) => s.status);
      const choice = chooseControlNet(status?.companions);
      if (choice.ok) return <p data-generate-ready>{choice.model}</p>;
      return (
        <div>
          <p data-reason>{tr(choice.reasonKey)}</p>
          {choice.reasonKey === 'visualRef.reason.noControlNet' && <ControlNetFix />}
        </div>
      );
    }
    await act(async () => { root!.unmount(); });
    root = createRoot(host);
    await act(async () => { root!.render(<StudioProbe />); });
    await settle();
    check(host.textContent?.includes(t('visualRef.reason.noControlNet')), 'the studio names the missing ControlNet');
    const fix = () => host.querySelector('[data-controlnet-fix]');
    check(fix()?.querySelector(`[data-companion="${POSE}"]`), 'the fix offers the OpenPose ControlNet');
    check(!fix()!.querySelector(`button[aria-label="${t('settings.ai.local.delete')}"]`), 'the studio row has no Delete');
    mock.calls.download.length = 0;
    await click(buttonByText(fix()!, t('settings.ai.local.download')), 'Studio download');
    check(mock.calls.download.join() === POSE, 'the studio downloads the OpenPose ControlNet');
    await act(async () => {
      mock.progress({ kind: 'model', id: POSE, phase: 'downloading', receivedBytes: 1_000_000_000, totalBytes: pose.sizeBytes, fileIndex: 0, fileCount: 1 });
    });
    check(fix()?.textContent?.includes(formatBytes(1_000_000_000)), 'the studio shows the download progress');
    // Main finishes without pushing a status, so the refresh the store does
    // after the download is what the studio has to pick the file up from.
    await act(async () => { mock.finish({ ok: true }, installedPose, false); });
    await settle();
    check(host.querySelector('[data-generate-ready]')?.textContent === POSE, 'the studio picks the new ControlNet up after install');
    check(!fix(), 'the fix-it box goes away with the refusal');
    results.push('Studio: a missing pose ControlNet is installed in place and Generate unblocks when it lands');

    // ---- 7. The real studio: pin a pose, blocked, then sent with OpenPose ---
    // A managed SD 1.5 model (from the catalogue: sd.cpp never reports a
    // ControlNet on a model) and one reference with one pose in its bank.
    const [{ default: ImageStudioEngine }, { db }, refs, { MemoryRouter }, { useAiRuntimeStore }] = await Promise.all([
      import('@/engines/image-studio/ImageStudioEngine'),
      import('@/db'),
      import('@/engines/image-studio/refs'),
      import('react-router-dom'),
      import('@/stores/aiRuntimeStore'),
    ]);
    const project = 'pose-ui-project';
    const poseData = 'data:image/png;base64,UE9TRQ==';
    await db.inspirationImages.put({ id: 'img-pose-ui', projectId: project, imageData: poseData, tags: [], notes: '', createdAt: 1 });
    const elena = await refs.createVisualRef(project, 'Elena');
    await refs.addControlImage(elena.id, 'img-pose-ui');
    mock.ai.defaults = { image: { connectionId: 'builtin-sd', modelId: 'dreamshaper-8' } };
    mock.status.companions = [];
    mock.push();
    const prefsKey = `wh.imageStudio.${project}`;
    window.localStorage.removeItem(prefsKey);
    const mountStudio = async () => {
      await act(async () => { root!.unmount(); });
      root = createRoot(host);
      await act(async () => {
        root!.render(<MemoryRouter><ImageStudioEngine projectId={project} /></MemoryRouter>);
      });
      await settle();
      await settle();
    };
    try {
      await mountStudio();

      const byTitle = (title: string) => host.querySelector(`button[title="${title}"]`);
      await click(byTitle(t('visualRef.cast.edit')), 'Edit Elena');
      await click(host.querySelector(`button[aria-label="${t('visualRef.editor.usePose')}"]`), 'Use this pose');
      check(host.querySelector(`button[aria-label="${t('visualRef.editor.unpinPose')}"][aria-pressed="true"]`), 'the pose tile reads pinned');
      const stored = JSON.parse(window.localStorage.getItem(prefsKey) ?? '{}') as { pose?: { refId: string; imageId: string } };
      check(stored.pose?.refId === elena.id && stored.pose.imageId === 'img-pose-ui', `the pin was not remembered: ${JSON.stringify(stored.pose)}`);
      await click(byTitle(t('visualRef.cast.insert')), 'Insert Elena');

      const slot = host.querySelector('[data-pinned-pose]');
      check(slot?.textContent?.includes(t('visualRef.composer.pose').replace('{name}', 'Elena')), 'the composer names the pinned pose');
      check(slot?.querySelector(`img[src="${poseData}"]`), 'the composer shows the pinned pose');
      const disclosure = [...host.querySelectorAll('button[aria-expanded]')].find((b) => b.textContent?.includes(t('visualRef.composer.resolved')));
      await click(disclosure, 'Open the disclosure');
      check(host.textContent?.includes(t('visualRef.step.pose').replace('{weight}', '0.55')), 'the disclosure says the pose is applied');

      const generate = () => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === t('imageStudio.generate'));
      check(generate()?.disabled, 'Generate ran a pose with no ControlNet installed');
      check(generate()?.getAttribute('aria-label') === t('visualRef.reason.noControlNet'), `Generate blamed ${generate()?.getAttribute('aria-label')}`);
      check(host.querySelector('[data-controlnet-fix]'), 'the studio did not offer the ControlNet install');

      await act(async () => { mock.status.companions = [installedPose]; mock.push(); });
      await settle();
      check(!host.querySelector('[data-controlnet-fix]'), 'the fix-it box outlived the refusal');
      await click(generate(), 'Generate');
      const sent = mock.ai.images.at(-1);
      check(sent, 'Generate sent nothing');
      check(sent.request.controlImage === poseData, 'the request carries no pose control image');
      check(sent.request.controlNetModel === POSE, `the request named ControlNet ${sent.request.controlNetModel}`);
      await act(async () => { mock.ai.imageDone?.({ requestId: sent.requestId, result: { ok: false, code: 'cancelled', error: 'cancelled' } }); });
      await settle();
      results.push('Studio: a pinned pose on an SD 1.5 model blocks Generate until OpenPose is installed, then rides the request with it');

      // ---- 8. The same pin on a ComfyUI route: its own list, no fix-it box --
      // The ControlNet name has to be one ComfyUI listed; the companion file
      // the local server holds (still installed above) means nothing there.
      const comfyModel = (controlNets: string[]) => ({
        connectionId: 'comfy-test', id: 'sd15.safetensors', type: 'image' as const,
        capabilities: ['image-generation' as const], family: 'sd1', installed: true, controlNets,
      });
      const listControlNets = (controlNets: string[]) => useAiRuntimeStore.setState({
        modelsByConnection: { 'comfy-test': { models: [comfyModel(controlNets)], loading: false, error: null, loadedAt: 1 } },
      });
      listControlNets(['depth.safetensors', 'canny.safetensors']);
      mock.ai.defaults = { image: { connectionId: 'comfy-test', modelId: 'sd15.safetensors' } };
      await mountStudio();
      // Remounted: the pin comes back from the project's studio prefs.
      await click(byTitle(t('visualRef.cast.insert')), 'Insert Elena on ComfyUI');
      check(host.querySelector('[data-pinned-pose]'), 'the pinned pose did not survive a remount');
      check(generate()?.getAttribute('aria-label') === t('visualRef.reason.controlNetAmbiguous'), `ComfyUI Generate blamed ${generate()?.getAttribute('aria-label')}`);
      check(!host.querySelector('[data-controlnet-fix]'), 'the local-server install box was offered for ComfyUI');

      await act(async () => { listControlNets(['depth.safetensors', 'control_v11p_sd15_openpose.pth']); });
      await settle();
      await click(generate(), 'Generate on ComfyUI');
      const comfySent = mock.ai.images.at(-1);
      check(comfySent && comfySent !== sent, 'Generate on ComfyUI sent nothing');
      check(comfySent.request.connectionId === 'comfy-test', `sent to ${comfySent.request.connectionId}`);
      check(comfySent.request.controlImage === poseData, 'the ComfyUI request carries no pose control image');
      check(comfySent.request.controlNetModel === 'control_v11p_sd15_openpose.pth', `ComfyUI was asked for ControlNet ${comfySent.request.controlNetModel}`);
      await act(async () => { mock.ai.imageDone?.({ requestId: comfySent.requestId, result: { ok: false, code: 'cancelled', error: 'cancelled' } }); });
      await settle();
      results.push('Studio: on ComfyUI the pose ControlNet is picked from the model\'s reported list, never the local companions');
    } finally {
      await db.visualRefs.delete(elena.id);
      await db.inspirationImages.delete('img-pose-ui');
      window.localStorage.removeItem(prefsKey);
    }
  } finally {
    await act(async () => { root?.unmount(); });
    root = null;
  }
  return results;
}
