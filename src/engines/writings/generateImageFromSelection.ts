// ============================================================================
// Escritos → Estudio de imagen: turn a selected passage into an image
// ============================================================================
//
// The user selects text in the editor and picks "Generar imagen". The project's
// chosen text model reads the excerpt plus its surrounding context and writes a
// text-to-image prompt; that prompt is handed to the Image Studio, which
// generates it on arrival. Kept out of a React component so the same flow can be
// triggered from anywhere and so the source editor can unmount as we navigate.

import { getProjectSettings } from '@/services/copilot/threads';
import { useAiRuntimeStore } from '@/stores/aiRuntimeStore';
import { completeOnRoute } from '@/services/aiService';
import { useImageHandoffStore } from '@/stores/imageHandoffStore';
import { navigateTo } from '@/engines/_shared/anchoring/navigation';
import { toast } from '@/components/common/toast';
import { t } from '@/i18n/useTranslation';
import { BUILTIN_SD_ID } from '@/services/aiRuntime/constants';

export interface SelectionContext {
  selectedText: string;
  contextBefore: string;
  contextAfter: string;
}

// English on purpose: SD/SDXL render markedly better from English prompts. The
// user sees the result in the studio and can edit or regenerate it there.
const SYSTEM_PROMPT =
  'You are a visual art director helping a novelist illustrate their manuscript. ' +
  'Given an excerpt and its surrounding context, write ONE image-generation prompt in ' +
  'English for a text-to-image model (Stable Diffusion / SDXL). Describe only the concrete ' +
  'visual scene of the excerpt: the subjects and their appearance, the setting, the time of ' +
  'day and lighting, the mood, the camera framing, and a fitting art style. Use vivid, ' +
  'comma-separated descriptive phrases. Do not include dialogue, character names as on-image ' +
  'text, or instructions. Output ONLY the prompt — no preamble, no quotes, no explanation.';

function buildUserMessage(sel: SelectionContext): string {
  const context = `${sel.contextBefore}\n>>> ${sel.selectedText} <<<\n${sel.contextAfter}`.trim();
  return `Passage to illustrate (marked with >>> <<< inside its surrounding context):\n"""\n${context}\n"""\n\nWrite the single image prompt now.`;
}

/** Strip a "Prompt:" label or wrapping quotes a model sometimes adds. */
function cleanPrompt(raw: string): string {
  return raw
    .replace(/^\s*(image\s+)?prompt\s*[:：]\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

export async function generateImageFromSelection(projectId: string, sel: SelectionContext): Promise<void> {
  const selected = sel.selectedText.trim();
  if (!selected) return;

  try {
    const store = useAiRuntimeStore.getState();
    try {
      await store.loadDefaults();
    } catch {
      // defaults may already be loaded, or load lazily below
    }
    const settings = await getProjectSettings(projectId);
    const route = settings.chatRoute ?? useAiRuntimeStore.getState().defaults.chat;
    if (!route) {
      toast.info(t('writings.image.noTextModel'));
      navigateTo('/settings/ai');
      return;
    }

    // The image model runs right after the text model. On one GPU they fight
    // for VRAM (a resident LLM pushes the diffusion model to CPU), so when the
    // image route is the local runtime the text model is asked to unload as
    // soon as its prompt is out. A remote image API needs no such courtesy.
    const imageRoute = settings.imageRoute ?? useAiRuntimeStore.getState().defaults.image;
    const releaseAfter = imageRoute?.connectionId === BUILTIN_SD_ID;

    toast.info(t('writings.image.generatingPrompt'), 8000);
    let imagePrompt = '';
    try {
      imagePrompt = cleanPrompt(
        await completeOnRoute(route, SYSTEM_PROMPT, buildUserMessage(sel), 1024, { releaseAfter }),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('writings.image.promptFailed'));
      return;
    }
    if (!imagePrompt) {
      toast.error(t('writings.image.promptFailed'));
      return;
    }

    useImageHandoffStore.getState().request({ prompt: imagePrompt, autoGenerate: true });
    navigateTo(`/project/${encodeURIComponent(projectId)}/image-studio`);
  } catch (err) {
    // The editor calls this as `void`; a rejected settings read must not be a
    // silent dead-click.
    toast.error(err instanceof Error ? err.message : t('writings.image.promptFailed'));
  }
}
