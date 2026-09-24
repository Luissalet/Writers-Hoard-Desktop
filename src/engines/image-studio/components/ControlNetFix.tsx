// ============================================================================
// Image Studio — install the pose ControlNet where its absence is read
// ============================================================================
//
// The one Generate refusal the studio can fix in place. The row is the same
// one AI settings shows, so the download, its progress and its cancel behave
// identically in both; the download itself lives in main and the store, so it
// keeps going if the writer leaves. When it lands the store refreshes the
// runtime status, `chooseControlNet` finds the file, the refusal lifts and the
// engine stops rendering this.

import { useTranslation } from '@/i18n/useTranslation';
import { ImageCompanionRow } from '@/components/ai-settings/ImageCompanions';
import { imageCompanionAsset } from '@/services/aiRuntime/imageCatalog';
import { POSE_CONTROLNET_ID } from '../studio/controlNet';

const poseControlNet = imageCompanionAsset(POSE_CONTROLNET_ID);

export default function ControlNetFix() {
  const { t } = useTranslation();
  if (!poseControlNet) return null;
  return (
    <div data-controlnet-fix className="space-y-1">
      <p className="text-[10px] text-text-muted">{t('visualRef.controlNetFix.lead')}</p>
      <ImageCompanionRow asset={poseControlNet} />
    </div>
  );
}
