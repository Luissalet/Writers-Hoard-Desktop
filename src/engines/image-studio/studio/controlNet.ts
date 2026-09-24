// ============================================================================
// Which ControlNet a pose reference runs through
// ============================================================================
//
// sd.cpp builds its context with ONE ControlNet, chosen at launch, and a
// control image sent to a server without one is refused outright (the adapter
// will not let it succeed with the hint silently ignored). The request has to
// name the network, and nothing else in the app chooses one — so the studio
// does, from what is installed, and says so when it cannot.
//
// A pose reference is an OpenPose skeleton, so OpenPose wins when present.
// Otherwise a single installed ControlNet is unambiguous (a file the writer
// dropped in by hand, say). Several with no OpenPose among them is refused
// rather than guessed: a skeleton fed to a depth or canny network produces a
// picture that looks like a success and follows nothing.

import type { SdCompanionFile } from '@/services/aiRuntime/sdServer';

export const POSE_CONTROLNET_ID = 'controlnet-sd15-openpose';

export type ControlNetChoice =
  | { ok: true; model: string }
  | { ok: false; reasonKey: 'visualRef.reason.noControlNet' | 'visualRef.reason.controlNetAmbiguous' };

/** The value `controlNetModel` takes: the catalogue id, or the file name of a hand-installed one. */
function modelName(file: SdCompanionFile): string {
  return file.catalogId ?? file.fileName;
}

export function chooseControlNet(companions: readonly SdCompanionFile[] | undefined): ControlNetChoice {
  const installed = (companions ?? []).filter((file) => file.kind === 'controlnet');
  const pose = installed.find((file) => file.catalogId === POSE_CONTROLNET_ID);
  if (pose) return { ok: true, model: modelName(pose) };
  if (installed.length === 1) return { ok: true, model: modelName(installed[0]) };
  return {
    ok: false,
    reasonKey: installed.length === 0 ? 'visualRef.reason.noControlNet' : 'visualRef.reason.controlNetAmbiguous',
  };
}
