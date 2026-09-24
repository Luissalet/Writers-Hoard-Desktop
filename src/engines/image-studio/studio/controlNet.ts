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
//
// That is the managed local server, whose ControlNets are companion files. A
// server that lists its own (ComfyUI) is asked the same question of ITS list:
// a catalogue id sent there names a file it does not have, and the job fails
// with the model missing.

import type { SdCompanionFile } from '@/services/aiRuntime/sdServer';

export const POSE_CONTROLNET_ID = 'controlnet-sd15-openpose';

export type ControlNetChoice =
  | { ok: true; model: string }
  | {
      ok: false;
      reasonKey:
        | 'visualRef.reason.noControlNet'
        | 'visualRef.reason.controlNetAmbiguous'
        | 'visualRef.reason.controlNetChecking'
        | 'visualRef.reason.controlNetUnsendable';
    };

/** Room for a ComfyUI subfolder or two; a longer name is refused, not truncated. */
const MAX_MODEL_NAME = 255;
const MAX_MODEL_SEGMENTS = 8;

/**
 * Whether `value` can cross IPC as `controlNetModel` — the one rule both sides
 * read, so the studio never chooses a name main would drop.
 *
 * ComfyUI names its ControlNets by their path under its own ControlNet folder
 * (`SD15/control_v11p_sd15_openpose.pth`, with `\` on Windows), so a relative
 * path is allowed. Kept VERBATIM, never normalised: ComfyUI matches the name
 * exactly against the list it reported. What is refused is anything that could
 * name a place rather than an entry: an absolute or UNC path (an empty first
 * segment), a drive letter or alternate data stream (`:`), an empty segment,
 * a segment of only dots and spaces (`.`, `..`, and the `.. ` Windows trims to
 * `..`), and control characters. The managed local runtime is stricter still:
 * it resolves the name only against its catalogue ids and the file names it
 * read out of its own folder, so a path never matches there at all.
 */
export function isControlNetModelName(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > MAX_MODEL_NAME) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f:]/.test(value)) return false;
  const segments = value.split(/[\\/]/);
  return segments.length <= MAX_MODEL_SEGMENTS
    && segments.every((segment) => !/^[.\s]*$/.test(segment));
}

/** The value `controlNetModel` takes: the catalogue id, or the file name of a hand-installed one. */
function modelName(file: SdCompanionFile): string {
  return file.catalogId ?? file.fileName;
}

/** The pose network if there is one, else the only network, else a refusal. */
function pick<T>(installed: readonly T[], isPose: (item: T) => boolean, name: (item: T) => string): ControlNetChoice {
  const pose = installed.find(isPose);
  if (pose) return { ok: true, model: name(pose) };
  if (installed.length === 1) return { ok: true, model: name(installed[0]) };
  return {
    ok: false,
    reasonKey: installed.length === 0 ? 'visualRef.reason.noControlNet' : 'visualRef.reason.controlNetAmbiguous',
  };
}

/**
 * The managed local server, from its companion files.
 *
 * `undefined` means the runtime status has not arrived yet — not that nothing
 * is installed. Generate waits for it rather than telling the writer to
 * install a ControlNet they may already have.
 */
export function chooseControlNet(companions: readonly SdCompanionFile[] | undefined): ControlNetChoice {
  if (companions === undefined) return { ok: false, reasonKey: 'visualRef.reason.controlNetChecking' };
  return pick(
    companions.filter((file) => file.kind === 'controlnet'),
    (file) => file.catalogId === POSE_CONTROLNET_ID,
    modelName,
  );
}

/**
 * Any other server, from the ControlNet names it reported for the model
 * (`ResolverModel.controlNets`). Those are paths in the server's own folder,
 * so OpenPose is recognised by name, whatever its case or subfolder.
 *
 * `undefined` means the server's model list has not arrived yet — as with
 * `chooseControlNet`, Generate waits rather than running without the pose.
 * A name that could not cross IPC is refused here, out loud: main would drop
 * it and the server would then refuse a control image with no ControlNet.
 */
export function chooseReportedControlNet(names: readonly string[] | undefined): ControlNetChoice {
  if (names === undefined) return { ok: false, reasonKey: 'visualRef.reason.controlNetChecking' };
  const choice = pick(names, (name) => name.toLowerCase().includes('openpose'), (name) => name);
  return choice.ok && !isControlNetModelName(choice.model)
    ? { ok: false, reasonKey: 'visualRef.reason.controlNetUnsendable' }
    : choice;
}
